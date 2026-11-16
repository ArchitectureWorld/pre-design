#!/usr/bin/env python3
"""Bounded read-only PPTX facts plus an inert, sampled preview package.

The original archive is never extracted or modified. This adapter uses only
Python's standard library and the separately attributed ppt-master libraries.
"""
from __future__ import annotations

import hashlib
import base64
import json
import math
import posixpath
import re
import stat
import sys
import zipfile
from pathlib import Path
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET

sys.path.insert(0, str(Path(__file__).parent / "vendor" / "ppt_master"))
from pptx_to_svg.ooxml_loader import OoxmlPackage, blip_embed_relationship_ids, inherited_shape_visibility
from pptx_to_svg.shape_walker import walk_sp_tree
from pptx_to_svg.emu_units import NS
from pptx_to_svg.color_resolver import ColorPalette, find_color_elem, resolve_color

MIB = 1024 * 1024
MAX_ENTRIES = 10_000
MAX_EXPANDED = 768 * MIB
MAX_ENTRY = 96 * MIB
MAX_XML = 8 * MIB
MAX_XML_TOTAL = 64 * MIB
MAX_SLIDES = 2000
MAX_SHAPES = 8000
MAX_PART_SHAPES = 500
MAX_TEXT = 96_000
MAX_METADATA = 4 * MIB
MAX_PREVIEWS = 30
UPSTREAM = {"repository": "https://github.com/hugohe3/ppt-master", "revision": "3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf", "license": "MIT"}
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
PPT_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
BLOCKED_RELS = {"oleObject", "package", "control", "activeXControl", "vbaProject", "attachedTemplate", "externalLink", "hyperlink", "audio", "video", "media"}


class Reject(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def safe_name(name: str) -> bool:
    return bool(name) and len(name) <= 512 and not (name.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", name) or "\\" in name or "\0" in name or any(x in {".", ".."} for x in name.split("/")))


def xml_root(data: bytes, name: str) -> ET.Element:
    # XML declarations can be UTF-16; byte-only searches would miss a DTD.
    try:
        if data[:2] in {b"\xff\xfe", b"\xfe\xff"}:
            decoded = data.decode("utf-16")
        elif data.startswith(b"\x00<"):
            decoded = data.decode("utf-16be")
        elif data.startswith(b"<\x00"):
            decoded = data.decode("utf-16le")
        else:
            decoded = data.decode("utf-8-sig")
    except UnicodeError as exc:
        raise Reject("PPTX XML 编码损坏或不受支持。") from exc
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)\b", decoded, re.I):
        raise Reject("PPTX 不允许包含 DOCTYPE 或 ENTITY 实体定义。")
    if "<?xml-stylesheet" in decoded.lower():
        raise Reject("PPTX 不允许包含外部 XML 样式表。")
    try:
        root = ET.fromstring(decoded)
    except (ET.ParseError, ValueError) as exc:
        raise Reject("PPTX XML 损坏或结构不完整。") from exc
    stack = [(root, 1)]
    nodes = 0
    while stack:
        node, depth = stack.pop()
        nodes += 1
        if depth > 128 or nodes > 200_000:
            raise Reject("PPTX XML 嵌套或元素数量超过处理上限。", 413)
        stack.extend((child, depth + 1) for child in node)
    for node in root.iter():
        for key, value in node.attrib.items():
            if key.rsplit("}", 1)[-1].lower() in {"href", "src"} and not inert_resource(value):
                raise Reject("PPTX XML、SVG 或 VML 含外部资源地址，请先嵌入图片。")
    if name.lower().endswith(".svg") or root.tag.rsplit("}", 1)[-1] == "svg":
        for node in root.iter():
            if node.tag.rsplit("}", 1)[-1].lower() in {"script", "foreignobject"}:
                raise Reject("PPTX 内嵌 SVG 包含不支持的活动内容。")
            for key, value in node.attrib.items():
                if key.rsplit("}", 1)[-1].lower().startswith("on"):
                    raise Reject("PPTX 内嵌 SVG 包含不支持的活动内容。")
                check_svg_style(value)
            if node.tag.rsplit("}", 1)[-1] == "style":
                check_svg_style("".join(node.itertext()))
    return root


def inert_resource(value: str) -> bool:
    if value.startswith("#"):
        return True
    match = re.fullmatch(r"data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+)", value, re.I)
    if not match:
        return False
    try:
        payload = base64.b64decode(re.sub(r"\s+", "", match[2]), validate=True)
    except ValueError:
        return False
    kind = match[1].lower()
    return (kind == "png" and payload.startswith(b"\x89PNG\r\n\x1a\n")) or (kind in {"jpeg", "jpg"} and payload.startswith(b"\xff\xd8\xff")) or (kind == "gif" and payload[:6] in {b"GIF87a", b"GIF89a"}) or (kind == "webp" and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP")


def check_svg_style(value: str):
    # ElementTree has already decoded character entities. Checking the original
    # XML string misses e.g. u&#114;l(...). CSS escapes are deliberately unsupported.
    if "\\" in value:
        raise Reject("PPTX 内嵌 SVG 含不支持的转义样式。")
    normalized = re.sub(r"/\*.*?\*/", "", value, flags=re.S)
    if re.search(r"@import", normalized, re.I) or any(not inert_resource(resource.strip().strip("'\"")) for resource in re.findall(r"url\s*\(([^)]*)\)", normalized, re.I)):
        raise Reject("PPTX 内嵌 SVG 含外部样式资源。")


def relationship_source(name: str) -> str:
    if name == "_rels/.rels":
        return ""
    directory, base = posixpath.split(name)
    if not directory.endswith("/_rels") or not base.endswith(".rels"):
        raise Reject("PPTX 关系文件路径异常。")
    return posixpath.join(directory[:-6], base[:-5])


def relationship_part(name: str) -> str:
    if not name:
        return "_rels/.rels"
    directory, base = posixpath.split(name)
    return posixpath.join(directory, "_rels", base + ".rels")


def target_part(source: str, target: str) -> str:
    parsed = urlsplit(target)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise Reject("PPTX 内部关系含不安全的外部地址。")
    target = unquote(parsed.path)
    if "\\" in target or "\0" in target:
        raise Reject("PPTX 关系包含不安全路径。")
    result = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
    if not safe_name(result):
        raise Reject("PPTX 关系包含越界路径。")
    return result


def validate_package(path: Path) -> dict:
    if path.stat().st_size > 512 * MIB:
        raise Reject("PPTX 原件超过 512 MiB 上限。", 413)
    data = {"xml": {}, "hashes": {}, "rels": {}, "external": 0, "inertRemoved": 0}
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ENTRIES:
            raise Reject("PPTX 压缩包条目数量超过处理上限。", 413)
        names = set()
        declared = 0
        xml_total = 0
        for entry in entries:
            name = entry.filename
            if not safe_name(name) or name.lower() in names or stat.S_ISLNK(entry.external_attr >> 16):
                raise Reject("PPTX 包含不安全或重复的文件路径。")
            names.add(name.lower())
            if entry.flag_bits & 1:
                raise Reject("PPTX 受口令保护，请解除保护后上传。")
            if entry.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                raise Reject("PPTX 使用了不支持的压缩方式。")
            if re.search(r"(?:^|/)(?:vbaproject|activex|vbasignature|embeddings/[^/]+\.(?:exe|dll|js|vbs))", name, re.I):
                raise Reject("PPTX 包含宏或活动控件，请另存为不含宏的 PPTX。")
            declared += entry.file_size
            is_xml = name.lower().endswith((".xml", ".rels", ".svg", ".vml"))
            if entry.file_size > (MAX_XML if is_xml else MAX_ENTRY) or declared > MAX_EXPANDED:
                raise Reject("PPTX 解压后超过处理上限。", 413)
            if is_xml:
                xml_total += entry.file_size
                if xml_total > MAX_XML_TOTAL:
                    raise Reject("PPTX XML 总量超过处理上限。", 413)
        try:
            types = xml_root(archive.read("[Content_Types].xml"), "[Content_Types].xml")
        except KeyError as exc:
            raise Reject("PPTX 缺少内容类型清单。") from exc
        content_types = {node.get("PartName", "").lstrip("/"): node.get("ContentType", "") for node in types if node.tag.endswith("Override")}
        default_types = {node.get("Extension", "").lower(): node.get("ContentType", "") for node in types if node.tag.endswith("Default")}
        expanded = 0
        xml_actual = 0
        for entry in entries:
            if entry.is_dir():
                continue
            name = entry.filename
            content_type = (content_types.get(name) or default_types.get(name.rsplit(".", 1)[-1].lower(), "")).lower()
            is_xml = name.lower().endswith((".xml", ".rels", ".svg", ".vml")) or content_type.endswith(("+xml", "vmldrawing")) or content_type in {"application/xml", "text/xml"}
            chunks = []
            count = 0
            digest = hashlib.sha256()
            with archive.open(entry) as stream:
                while chunk := stream.read(64 * 1024):
                    if count == 0 and chunk.lstrip(b" \t\r\n\xef\xbb\xbf").startswith((b"<?xml", b"<!--", b"<svg", b"\xff\xfe", b"\xfe\xff")):
                        is_xml = True
                    count += len(chunk)
                    expanded += len(chunk)
                    if count > (MAX_XML if is_xml else MAX_ENTRY) or expanded > MAX_EXPANDED:
                        raise Reject("PPTX 实际解压量超过处理上限。", 413)
                    digest.update(chunk)
                    if is_xml:
                        xml_actual += len(chunk)
                        if xml_actual > MAX_XML_TOTAL:
                            raise Reject("PPTX XML 实际总量超过处理上限。", 413)
                        chunks.append(chunk)
            if count != entry.file_size:
                raise Reject("PPTX 压缩包长度或 CRC 校验失败。")
            data["hashes"][name] = {"sha256": digest.hexdigest(), "bytes": count}
            if is_xml:
                raw = b"".join(chunks)
                root = xml_root(raw, name)
                data["xml"][name] = raw
                if name.endswith(".rels"):
                    source = relationship_source(name)
                    relations = []
                    ids = set()
                    for rel in root:
                        if rel.tag != f"{{{REL_NS}}}Relationship":
                            raise Reject("PPTX 关系 XML 命名空间异常。")
                        rid, typ, target = (rel.get(key, "") for key in ("Id", "Type", "Target"))
                        if not rid or rid in ids or not typ or not target:
                            raise Reject("PPTX 存在损坏或重复的关系。")
                        ids.add(rid)
                        external = rel.get("TargetMode") == "External"
                        if rel.get("TargetMode") not in {None, "Internal", "External"}:
                            raise Reject("PPTX 关系模式损坏。")
                        if external:
                            data["external"] += 1
                        part = None if external else target_part(source, target)
                        relations.append({"id": rid, "type": typ, "target": target, "part": part, "external": external})
                    data["rels"][source] = relations
        for source, relations in data["rels"].items():
            for rel in relations:
                if not rel["external"] and rel["part"] not in data["hashes"]:
                    raise Reject("PPTX 关系指向缺失的文件，版式或文档结构损坏。")
        types = xml_root(data["xml"].get("[Content_Types].xml", b""), "[Content_Types].xml")
        if types.tag != f"{{{CT_NS}}}Types":
            raise Reject("PPTX 缺少有效的内容类型。")
        if not any(node.get("ContentType") == PPT_MIME for node in types):
            raise Reject("文件不是受支持的不含宏 PPTX 演示文稿。")
        if any("macroenabled" in node.get("ContentType", "").lower() or "vbaproject" in node.get("ContentType", "").lower() for node in types):
            raise Reject("PPTX 包含宏或活动内容。")
        data["contentTypes"] = content_types
        data["defaultTypes"] = default_types
    return data


def rounded(value: float) -> float | None:
    return round(value, 3) if math.isfinite(value) and abs(value) <= 10_000_000 else None


def text_of(root: ET.Element, limit: int = 2000) -> str:
    paragraphs = ["".join(p.itertext()) if p.tag.endswith("}t") else "".join((node.text or "") for node in p.iter(f"{{{NS['a']}}}t")) for p in root.findall(".//a:p", NS)]
    return "\n".join(paragraphs)[:limit]


def color(parent: ET.Element | None, palette: ColorPalette) -> dict | None:
    try:
        hex_color, alpha = resolve_color(find_color_elem(parent), palette, strict=False)
        return {"color": hex_color, "alpha": round(alpha, 4)} if hex_color else None
    except ValueError:
        return None


def font_identity(theme) -> dict:
    result = {}
    if theme is None:
        return result
    for kind, tag in (("major", "majorFont"), ("minor", "minorFont")):
        root = theme.xml.find(f"a:themeElements/a:fontScheme/a:{tag}", NS)
        if root is None:
            continue
        result[kind] = {name: (root.find(f"a:{name}", NS).get("typeface", "") if root.find(f"a:{name}", NS) is not None else "") for name in ("latin", "ea", "cs")}
        result[kind]["scripts"] = {node.get("script", ""): node.get("typeface", "") for node in root.findall("a:font", NS)}
    return result


def extract_structure(path: Path, package: dict) -> tuple[dict, str, list]:
    warnings = []
    warning_codes = set()
    shape_budget = MAX_SHAPES
    def warn(code, message):
        if code not in warning_codes:
            warning_codes.add(code)
            warnings.append({"code": code, "message": message})
    if package["external"]:
        warn("external-relationships", f"检测到 {package['external']} 个外部关系；未下载外部资源，预览副本已移除外链。")
    with OoxmlPackage(path) as pkg:
        slide_refs = list(pkg.iter_slides())
        order = pkg.presentation.xml.findall("p:sldIdLst/p:sldId", NS)
        if not slide_refs or len(order) != len(slide_refs):
            raise Reject("PPTX 页序或幻灯片关系损坏。")
        if len(slide_refs) > MAX_SLIDES:
            raise Reject(f"PPTX 超过 {MAX_SLIDES} 页结构读取上限。", 413)
        master_refs = list(pkg.iter_all_masters())
        layout_pairs = list(pkg.iter_all_layouts_with_parent())
        if len(master_refs) + len(layout_pairs) > 2000:
            raise Reject("PPTX 母版或版式数量超过处理上限。", 413)
        width, height = pkg.slide_size_px
        if not (1 <= width <= 32000 and 1 <= height <= 32000):
            raise Reject("PPTX 画布尺寸损坏或超过处理上限。", 413)
        master_ids = {part.path: f"master-{i}" for i, part in enumerate(master_refs, 1)}
        layout_ids = {part.path: f"layout-{i}" for i, (part, _) in enumerate(layout_pairs, 1)}
        theme_ids = {}
        themes = []
        palettes = {}
        theme_by_master = {}
        for master in master_refs:
            theme = pkg.resolve_theme(master)
            palette = ColorPalette(master, theme, strict=False, diagnostic_sink=lambda code, message, fallback: warn(code, "部分主题颜色使用了兼容解析；请结合页面预览确认。"))
            palettes[master.path] = palette
            if theme is not None:
                if theme.path not in theme_ids:
                    identifier = f"theme-{len(theme_ids) + 1}"
                    theme_ids[theme.path] = identifier
                    themes.append({"id": identifier, "part": theme.path, "name": theme.xml.get("name", "")[:160], "colors": {k: "#" + v for k, v in palette.scheme.items()}, "fonts": font_identity(theme)})
                theme_by_master[master.path] = theme_ids[theme.path]

        def shapes_for(part, layer, master=None, layout=None):
            nonlocal shape_budget
            palette = palettes.get(master.path if master else part.path) or ColorPalette(None, None, strict=False)
            roots = walk_sp_tree(part.xml, layout_xml=layout.xml if layout else None, master_xml=master.xml if master else None)
            result = []
            count = 0
            def visit(nodes, group=None, approximate=False, hidden_parent=False):
                nonlocal shape_budget, count
                for node in nodes:
                    count += 1
                    hidden = hidden_parent or node.hidden
                    transform = node.xfrm
                    if len(result) < MAX_PART_SHAPES and shape_budget > 0:
                        shape_budget -= 1
                        item = {"id": node.spid, "name": node.name[:160], "kind": node.kind, "x": rounded(transform.x), "y": rounded(transform.y), "width": rounded(transform.w), "height": rounded(transform.h), "rotation": rounded(transform.rot), "flipH": transform.flip_h, "flipV": transform.flip_v, "sourcePart": part.path, "sourceLayer": layer, "hidden": hidden, "geometryStatus": "approximate" if approximate else "native-frame"}
                        if group is not None:
                            item["groupId"] = group
                        if any(item[key] is None for key in ("x", "y", "width", "height")) or (transform.w == 0 and transform.h == 0):
                            item["geometryStatus"] = "unresolved"
                            warn("unresolved-geometry", "部分元素没有可解析的原生坐标；未将缺失几何当作可靠位置。")
                        if approximate:
                            warn("group-transform", "旋转或翻转分组内部的坐标为近似值；完整空间关系以真实页面预览为准。")
                        if node.placeholder:
                            item["placeholder"] = {"type": node.placeholder.type, "index": node.placeholder.idx, "size": node.placeholder.sz, "orientation": node.placeholder.orient}
                        if node.kind != "grpSp":
                            text = text_of(node.xml)
                            if text:
                                item["text"] = text
                                runs = []
                                for run in node.xml.findall(".//a:r", NS)[:16]:
                                    props = run.find("a:rPr", NS)
                                    value = {"text": (run.findtext("a:t", "", NS))[:200]}
                                    if props is not None:
                                        if props.get("sz", "").isdigit():
                                            value["fontSize"] = int(props.get("sz")) / 100
                                        for attr, field in (("b", "bold"), ("i", "italic")):
                                            if attr in props.attrib:
                                                value[field] = props.get(attr) in {"1", "true"}
                                        latin = props.find("a:latin", NS)
                                        east = props.find("a:ea", NS)
                                        if latin is not None:
                                            value["fontFace"] = latin.get("typeface", "")[:160]
                                        if east is not None:
                                            value["eastAsianFont"] = east.get("typeface", "")[:160]
                                        fill = color(props.find("a:solidFill", NS), palette)
                                        if fill:
                                            value.update(fill)
                                    runs.append(value)
                                item["runs"] = runs
                                item["runCount"] = len(node.xml.findall(".//a:r", NS))
                        fill = color(node.xml.find("p:spPr/a:solidFill", NS), palette)
                        if fill:
                            item["fill"] = fill
                        preset = node.xml.find("p:spPr/a:prstGeom", NS)
                        if preset is not None:
                            item["preset"] = preset.get("prst")
                        if node.xml.find("p:spPr/a:custGeom", NS) is not None:
                            item["freeform"] = True
                        blip = node.xml.find("p:blipFill/a:blip", NS)
                        if blip is not None:
                            media = next((part.resolve_rel(rid) for rid in blip_embed_relationship_ids(blip) if part.resolve_rel(rid)), None)
                            if media:
                                item["image"] = {"part": media, **package["hashes"].get(media, {}), "mimeType": package["contentTypes"].get(media) or package["defaultTypes"].get(media.rsplit(".", 1)[-1].lower(), "application/octet-stream")}
                                crop = node.xml.find("p:blipFill/a:srcRect", NS)
                                if crop is not None:
                                    item["image"]["crop"] = {key: int(crop.get(key, "0")) / 100000 for key in ("l", "t", "r", "b") if re.fullmatch(r"-?\d+", crop.get(key, "0"))}
                        if node.kind == "graphicFrame":
                            graphic = node.xml.find("a:graphic/a:graphicData", NS)
                            item["graphicType"] = graphic.get("uri", "").rsplit("/", 1)[-1] if graphic is not None else "unknown"
                            warn("complex-native-object", "图表、表格、SmartArt 和嵌入对象仅保留可读取文字、边界及类型；未完整还原其语义或数据。")
                        result.append(item)
                    if node.children:
                        visit(node.children, node.spid, approximate or bool(transform.rot or transform.flip_h or transform.flip_v), hidden)
            visit(roots)
            return {"shapes": result, "shapeCount": count, "shapesTruncated": count > len(result)}

        masters = [{"id": master_ids[m.path], "part": m.path, "themeId": theme_by_master.get(m.path), **shapes_for(m, "master", master=m)} for m in master_refs]
        layouts = []
        for part, master in layout_pairs:
            common = part.xml.find("p:cSld", NS)
            layouts.append({"id": layout_ids[part.path], "part": part.path, "masterId": master_ids.get(master.path), "name": common.get("name", "")[:160] if common is not None else "", "type": part.xml.get("type", ""), **shapes_for(part, "layout", master=master)})
        slides = []
        text_chunks = []
        remaining_text = MAX_TEXT
        for ref, native_id in zip(slide_refs, order):
            if ref.layout is None or ref.master is None or ref.layout.path not in layout_ids or ref.master.path not in master_ids:
                raise Reject("PPTX 幻灯片的母版或版式继承关系不完整。")
            page_text = text_of(ref.part.xml, 12_000)
            label = f"第 {ref.index} 页\n"
            if remaining_text > len(label):
                snippet = (label + page_text)[:remaining_text]
                text_chunks.append(snippet)
                remaining_text -= len(snippet)
            hidden = ref.part.xml.get("show", "1").lower() in {"0", "false", "off"}
            if hidden:
                warn("hidden-slides", "隐藏幻灯片仍按原文件页序记录；若被抽样，也会生成该页预览。")
            show_layout, show_master = inherited_shape_visibility(ref)
            slides.append({"page": ref.index, "slideId": native_id.get("id"), "part": ref.part.path, "layoutId": layout_ids[ref.layout.path], "masterId": master_ids[ref.master.path], "themeId": theme_by_master.get(ref.master.path), "hidden": hidden, "showLayoutShapes": show_layout, "showMasterShapes": show_master, "text": page_text[:2000], **shapes_for(ref.part, "slide", master=ref.master, layout=ref.layout)})
        if remaining_text <= 0:
            warn("text-limit", f"PPTX 文字已截断至 {MAX_TEXT} 字；完整页序仍保留。")
        if any(part["shapesTruncated"] for part in masters + layouts + slides):
            warn("shape-limit", f"结构最多保留 {MAX_SHAPES} 个元素、每个页面或版式 {MAX_PART_SHAPES} 个；超出部分已明确标记。")
        warn("style-resolution", "字体与字号记录显式运行样式，主题字体另列；未完整计算所有段落和主题继承。预览由 LibreOffice 渲染，字体替换或复杂效果可能与 PowerPoint 有差异。")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(MIB), b""):
                digest.update(chunk)
        source_digest = digest.hexdigest()
        structure = {"schema": "pre-design.pptx-structure.v1", "provenance": {"parser": "ppt-master-pure-library+pre-design-adapter.v1", "upstream": UPSTREAM, "sourceSha256": source_digest, "externalRelationships": package["external"]}, "canvas": {"width": rounded(width), "height": rounded(height), "unit": "px", "widthEmu": pkg.slide_size_emu[0], "heightEmu": pkg.slide_size_emu[1]}, "themes": themes, "masters": masters, "layouts": layouts, "slides": slides, "limits": {"maxSlides": MAX_SLIDES, "maxShapes": MAX_SHAPES, "maxShapesPerPart": MAX_PART_SHAPES, "maxShapeTextCharacters": 2000, "maxRunsPerShape": 16, "maxRunTextCharacters": 200, "maxSlideTextCharacters": 2000, "maxMetadataBytes": MAX_METADATA, "truncated": any(part["shapesTruncated"] for part in masters + layouts + slides)}, "warnings": warnings}
        return structure, "\n\n".join(text_chunks), slide_refs


def sampled_pages(count: int) -> list[int]:
    if count <= MAX_PREVIEWS:
        return list(range(1, count + 1))
    return [1 + (i * (count - 1) + (MAX_PREVIEWS - 1) // 2) // (MAX_PREVIEWS - 1) for i in range(MAX_PREVIEWS)]


def serialize_opc(root: ET.Element, namespace: str) -> bytes:
    # Office package readers require the conventional default namespace for
    # Relationships and Content Types, even though prefixed XML is well-formed.
    ET.register_namespace("", namespace)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def write_preview_package(source: Path, output: Path, package: dict, structure: dict, selected: list[int]):
    selected_parts = {slide["part"] for slide in structure["slides"] if slide["page"] in selected}
    presentation = next((rel["part"] for rel in package["rels"].get("", []) if rel["type"].endswith("/officeDocument") and not rel["external"]), "ppt/presentation.xml")
    filtered = {}
    for owner, relations in package["rels"].items():
        keep = []
        for rel in relations:
            suffix = rel["type"].rsplit("/", 1)[-1]
            if rel["external"] or suffix in BLOCKED_RELS or "digital-signature" in rel["type"]:
                package["inertRemoved"] += int(not rel["external"])
                continue
            if owner == presentation and suffix == "slide" and rel["part"] not in selected_parts:
                continue
            keep.append(rel)
        filtered[owner] = keep
    reachable = set()
    pending = [""]
    while pending:
        owner = pending.pop()
        if owner in reachable:
            continue
        reachable.add(owner)
        pending.extend(rel["part"] for rel in filtered.get(owner, []))
    if not selected_parts.issubset(reachable):
        raise Reject("PPTX 抽样预览的页序关系不完整。")
    reachable.discard("")
    reachable.add("[Content_Types].xml")
    for owner in list(reachable) + [""]:
        rel_name = relationship_part(owner)
        if rel_name in package["xml"]:
            reachable.add(rel_name)
    with zipfile.ZipFile(source) as archive, zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as target:
        for name in sorted(reachable):
            if name.endswith(".rels"):
                owner = relationship_source(name)
                root = ET.Element(f"{{{REL_NS}}}Relationships")
                for rel in filtered.get(owner, []):
                    ET.SubElement(root, f"{{{REL_NS}}}Relationship", {"Id": rel["id"], "Type": rel["type"], "Target": rel["target"]})
                target.writestr(name, serialize_opc(root, REL_NS))
            elif name == presentation:
                root = xml_root(package["xml"][name], name)
                ids = root.find("p:sldIdLst", NS)
                if ids is None:
                    raise Reject("PPTX 页序结构损坏。")
                for page, child in enumerate(list(ids), 1):
                    if page not in selected:
                        ids.remove(child)
                for custom in root.findall("p:custShowLst", NS):
                    root.remove(custom)
                target.writestr(name, ET.tostring(root, encoding="utf-8", xml_declaration=True))
            elif name in selected_parts:
                root = xml_root(package["xml"][name], name)
                root.set("show", "1")
                target.writestr(name, ET.tostring(root, encoding="utf-8", xml_declaration=True))
            elif name == "[Content_Types].xml":
                root = xml_root(package["xml"][name], name)
                for child in list(root):
                    part = child.get("PartName")
                    if part and part.lstrip("/") not in reachable:
                        root.remove(child)
                target.writestr(name, serialize_opc(root, CT_NS))
            else:
                with archive.open(name) as reader, target.open(name, "w") as writer:
                    while chunk := reader.read(MIB):
                        writer.write(chunk)


def bound_metadata(structure: dict, pages: list):
    def size():
        return len(json.dumps({"structure": structure, "pages": pages}, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if size() <= MAX_METADATA:
        return
    structure["limits"]["truncated"] = True
    structure["warnings"].append({"code": "metadata-limit", "message": "结构和页面元数据超过 4 MiB，已缩减元素详情；全部页序及母版/版式关系仍保留。"})
    parts = structure["slides"] + structure["layouts"] + structure["masters"]
    for part in parts:
        for shape in part["shapes"]:
            shape.pop("runs", None)
            if "text" in shape:
                shape["text"] = shape["text"][:200]
    while size() > MAX_METADATA:
        removed = False
        for part in parts:
            if part["shapes"]:
                part["shapes"] = part["shapes"][:len(part["shapes"]) // 2]
                part["shapesTruncated"] = True
                removed = True
        if not removed:
            for part in parts:
                part.pop("text", None)
            for page in pages:
                page.pop("text", None)
            if size() > MAX_METADATA:
                raise Reject("PPTX 结构元数据超过处理上限。", 413)
            break


def main():
    source, preview = map(Path, sys.argv[1:3])
    package = validate_package(source)
    structure, text, _ = extract_structure(source, package)
    count = len(structure["slides"])
    selected = sampled_pages(count)
    write_preview_package(source, preview, package, structure, selected)
    if package["inertRemoved"]:
        structure["warnings"].append({"code": "inert-preview", "message": "预览副本已移除超链接动作、嵌入执行对象及音视频关系；保留可用静态图像。"})
    pages = [{"page": s["page"], "kind": "slide", "width": structure["canvas"]["width"], "height": structure["canvas"]["height"], "text": s["text"][:1000], "layoutId": s["layoutId"], "masterId": s["masterId"], "shapeCount": s["shapeCount"], "preview": s["page"] in selected} for s in structure["slides"]]
    bound_metadata(structure, pages)
    print(json.dumps({"structure": structure, "pages": pages, "text": text, "pageCount": count, "readPages": selected}, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Reject as exc:
        print(json.dumps({"error": str(exc), "statusCode": exc.status}, ensure_ascii=False))
        sys.exit(2)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, ET.ParseError, ValueError, KeyError, OSError, OverflowError, RecursionError) as exc:
        print(json.dumps({"error": "PPTX 结构或 CRC 校验失败，文件可能已损坏。", "statusCode": 400}, ensure_ascii=False))
        sys.exit(2)
