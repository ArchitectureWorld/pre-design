# Source visual pipeline report

## Changes

- `src/presentation/source-visual-pipeline.ts`: adds `deriveVisualAssetsFromSources(input)`. It classifies PDF/CAD/archive sources, requires an injected adapter to plan and produce visual outputs, rejects non-image/video output names and MIME types, records the source material link, tool, method, MIME, dimensions and SHA-256, and emits `derived_source_material` asset inputs compatible with the existing presentation builder.
- `tests/source-visual-pipeline.spec.ts`: tests injected PDF/CAD/archive adapter calls, provenance and page binding records, repeat-run reuse without a second renderer call, unavailable-tool blockers, and rejection of a DWG masquerading as an image.

## Verification

```powershell
pnpm typecheck
pnpm exec vitest run tests/source-visual-pipeline.spec.ts tests/presentation-material-registry.spec.ts tests/presentation-material-plan.spec.ts --maxWorkers=1
```

Result: typecheck passed; 3 files / 19 tests passed. `git diff --check` passed for the two new pipeline files.

## Blockers / boundary

- No production archive extractor, PDF renderer, or CAD renderer is configured by this change. Without an injected adapter the function returns an explicit `SOURCE_VISUAL_TOOL_UNAVAILABLE` blocker and never fabricates a visual.
- The pipeline intentionally does not mutate source files or the registry. Feed its `assets` result into the existing material preparation/build path; that path maps `sourceMaterialKeys` to formal `sourceMaterialIds` in the generated asset manifest.
