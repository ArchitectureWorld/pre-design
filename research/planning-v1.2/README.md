# Approved v1.2 catalogue — executable planning projection

Authority is the user-approved **62项研究与成果统一规格 v1.2**, not the old v0.6 product. The complete `unified-data.json` comes from `pre-design_v1.2_规格数据与复核包.zip`. Its exact bytes are locked by SHA-256 in `catalog-lock.json`. The lossless Brotli copy `unified-data.json.br` now packages the complete approved dictionary. The loader decompresses at most 2 MiB, verifies the original byte hash before parsing, cross-checks the routing index and freezes the result. This supplies source, query, method, copy and output requirements; it does NOT turn those descriptions into 62 executable field schemas.

The checked-in **`src/research-v2/catalog-data.ts`** is a generated, immutable routing/identity projection: eight chapters,62 modules,176 candidate dependency edges,76 candidate figures,62 audit tables and57 legacy-reference mappings. It contains the original titles, port names/types, edge conditions/selectors, figure names/types/templates/size presets, table names/columns and dataset filenames. It does NOT replace each module's original sources, query templates, four research steps, professional method, limitations, copy requirements or acceptance criteria. Those are now available through `loadResearchSpecification()` / `getResearchModuleSpec()`. Per-field executable schemas currently cover only the regional node/OD vertical slice; other modules still need adapters before automatic execution can be enabled.

## Reproduce and verify

```sh
node scripts/compile-planning-index.mjs /path/to/approved/unified-data.json --check
pnpm verify:research-v210
pnpm test:research-v210
```

Without `--check`, the importer regenerates the same TypeScript data file. It rejects source bytes whose hash differs from the approved input. It does not fetch URLs, execute the HTML/JSON, or silently accept another specification version. A deliberate source upgrade must update the approval record, importer pin and lock together. No user-local path is shipped in runtime configuration.

## Compact data format

The compact tuples are only the generated storage format. `compilePlanningIndex` expands them into named typed objects before use.

- `modules`: `[itemId, title, primaryPort, conditionFieldOrNull, primaryDependencyGroups, datasetFilename, tableTitle, tableColumns, figures]`.
- `figures`: `[title, figureType, pageTemplate, sizePreset]`; FIG IDs follow the approved within-module list, not a fixed one-figure limit.
- `alternatives`: `[target, originalGroupSource, conditionField, trueSource, truePort, falseSource, falsePort]`.
- `legacy`: `[oldWorkItemId, oldObjectId, researchTargets, internalTargets]`.
- `portTypes` and `extraPorts`: exact shared port identities. `edgePorts` records non-primary selectors, including case failure modes feeding risk analysis.

Edge-array presentation order is not execution priority. Source-fidelity checks compare each complete edge record by `edgeId`; the lock explicitly sorts by `edgeId`. Applicability is evaluated before dependency sorting. Unknown flags leave routes pending, not false. Figures are **planned candidates**, never image-generation receipts; a table required for audit does not have to appear on a report page.

## Current runtime boundary

`/preplan-research-plan` reads this index and computes a read-only plan. No project is initialized or mutated. No model, research provider or renderer is called by that read-only command. The separate `/preplan-research-od` command consumes an explicitly supplied, source-bound request, computes and saves a new immutable regional research bundle. Network routing requires `--online`; archived replay uses `--verify` without network. See `docs/pre-v2.1.0-milestone2-handoff.md`. `assessResearchInputs` checks typed envelopes, exact snapshot identity, lifecycle and the declared minimum quality state; it cannot prove the truth of records or grant publication permission. Old57 workflows remain the only existing automatic execution path until the new per-field research adapters and integration tests are complete.
