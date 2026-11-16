# PPT Master pure library subset

Upstream: https://github.com/hugohe3/ppt-master

Pinned revision: `3af3e8ef774c4d67ee57e1306d9256d08c9ee1bf` (2026-11-15).

Copyright (c) 2025-2026 Hugo He. MIT license; see `LICENSE`.

The five files in `pptx_to_svg/` are unmodified upstream pure Python library
modules. `UPSTREAM.json` records their original paths and Git blob hashes.
This subset reads OOXML relationships, master/layout/slide inheritance, shape
frames and theme colors. It does not include or invoke the upstream CLI,
Skill workflow, attribution guard, SVG renderer, or template publisher.
No attribution guard is disabled or replaced.

Pre-design's adjacent `reference-pptx.py` adapter validates the untrusted
archive before using these libraries. It records limitations for unexpanded
native objects, unresolved geometry, rotated/flipped group descendants,
explicit-only text styles and bounded metadata. Real visual previews are
rendered separately with LibreOffice and Poppler.

## Runtime and execution

Install Python 3.10 or newer, LibreOffice Impress, and Poppler (`pdfinfo`,
`pdftoppm`). On Debian/Ubuntu the usual packages are `python3`,
`libreoffice-impress`, `poppler-utils`, and suitable fonts such as
`fonts-noto-cjk`. No pip installation is required for this parser.
The web process calls an absolute Python adapter path with argument arrays,
then LibreOffice in an isolated temporary user profile, then Poppler. Shell
commands are not constructed from file names or document data.

`PRE_LAYOUT_PYTHON_BINARY` can set the administrator-controlled Python binary
(default `/usr/bin/python3`). `PRE_LAYOUT_OFFICE_BINARY` can set the
administrator-controlled office executable (default `soffice` from PATH).
These values are server configuration, never attachment or request fields.
The process group is terminated on cancellation or timeout, and temporary
files are removed after the child exits. Missing runtime components return
an explicit error; no placeholder image is substituted for a real preview.

## Limits and privacy

The uploaded PPTX is limited to 512 MiB. Archive validation permits at most
10,000 entries, 768 MiB in total expanded content, 96 MiB per non-XML entry,
8 MiB per XML part, and 64 MiB of XML in total. It validates names, duplicate
entries, symbolic links, compression methods, actual expanded bytes, CRCs,
XML depth, relationships and necessary native structure before rendering.
Password-protected archives, macros, ActiveX, DTD/entity declarations and
unsafe directly linked SVG/VML resources are rejected. External relationships
are recorded by count, never fetched; the preview package removes them along
with executable/embedded-object, hyperlink-action and audio/video relations.
Source file bytes stay unchanged. The parser does not run embedded content.

At most 2,000 slides are accepted. Their presentation order and native parent
relationships are preserved. Up to 30 preview pages are chosen uniformly
across the whole deck, including its first and last pages. The temporary
rendering package contains the selected slides and reachable static parts;
the returned image `page` always refers to the original 1-based slide number.
A page-count mismatch stops the result instead of returning misaligned images.

Metadata includes at most 8,000 shapes overall and 500 shapes per native part;
each shape has up to 2,000 text characters and 16 explicit style runs. Each
slide summary has up to 2,000 characters; aggregate extracted text has a
96,000-character limit. `structure` plus `pages` is capped at 4 MiB, with
truncation recorded and page/parent identities retained. Preview edges are
limited to 1,600 pixels. The complete parse/render operation has a five-minute
deadline. A 512 MiB upload still occupies a bounded, sizable request buffer;
the hosting service must enforce its upload and concurrency limits.

All source text, structure, previews and hashes are private attachment data.
They are not reusable template content. No customer slide or source archive
is included in this vendor directory, test fixtures or repository.

## Accuracy boundaries

- `kind` preserves the original native shape category; text, picture, group,
  connector and graphic-frame objects are distinguished.
- `geometryStatus: native-frame` describes the source frame, not an exact
  painted-pixel bounding box. Rotation is separate. Descendants of rotated or
  flipped groups are marked `approximate`; missing frames are `unresolved`.
- Placeholder frames inherit from layout and master through upstream code.
  Master/layout/slide ownership is retained rather than inferred from repetition.
- Theme colors and major/minor fonts are read from the actual theme part.
  Run fonts and sizes are explicit values; full effective paragraph/font
  inheritance is not claimed. Complex overrides and effects need visual review.
- Charts, tables, SmartArt and OLE expose available text, type and frame only;
  their complete semantic graph or data is not reconstructed by this adapter.
- LibreOffice previews are actual rasterized pages. They can differ from
  PowerPoint because of font substitution or unsupported effects. Removed
  dynamic/embedded objects and missing external assets are reported as limits.
- `source_profile` and `design_spec.md` in the full upstream workflow involve
  agent judgment. This adapter supplies native facts and visual evidence only;
  design interpretation is performed by Pre-design's separate reference workflow.
