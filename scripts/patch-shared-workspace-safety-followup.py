from pathlib import Path


def replace(path: str, before: str, after: str) -> None:
    target = Path(path)
    content = target.read_text(encoding="utf-8")
    if before not in content:
        raise RuntimeError(f"PATCH_ANCHOR_MISSING: {path}: {before}")
    target.write_text(content.replace(before, after), encoding="utf-8")


replace(
    "tests/helpers/shared-workspace-fixture.ts",
    "join(root, 'assets', 'future-component', 'unknown.bin')",
    "join(root, 'assets', 'other', 'future-component', 'unknown.bin')",
)
replace(
    "tests/helpers/shared-workspace-fixture.ts",
    "relativePath: 'assets/future-component/unknown.bin'",
    "relativePath: 'assets/other/future-component/unknown.bin'",
)
replace(
    "tests/helpers/shared-workspace-fixture.ts",
    """  const externalAssetPath = join(root, 'assets', 'other', 'future-component', 'unknown.bin')
  await writeFile(externalAssetPath, externalAsset)
""",
    """  const externalAssetPath = join(root, 'assets', 'other', 'future-component', 'unknown.bin')
  await mkdir(join(root, 'assets', 'other', 'future-component'), { recursive: true })
  await writeFile(externalAssetPath, externalAsset)
""",
)
replace(
    "tests/presentation-workspace-ownership.spec.ts",
    "'assets/future-component/unknown.bin'",
    "'assets/other/future-component/unknown.bin'",
)
replace(
    "tests/presentation-workspace-ownership.spec.ts",
    "path.startsWith('assets/future-component/')",
    "path.startsWith('assets/other/future-component/')",
)

print("SHARED_WORKSPACE_CONTRACT_SCOPE_PATCH_APPLIED")
