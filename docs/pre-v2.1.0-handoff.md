> Milestone 2 continuation: see [source-bound regional OD handoff](pre-v2.1.0-milestone2-handoff.md). The milestone1 text below is retained as history.

# Pre-design 2.1.0 — milestone 1 handoff

## Coordinates
- Development branch: `v2.1.0`.
- Base: merged Pre2.0.2 at `main@a1c1ad12b469d086037ec66e4bd89c7c0e4ac422`.
- Product/package: `2.1.0`, development foundation; not merged, tagged, released or published.
- Approved scope: research specification v1.2, eight chapters/62 modules.
- DSH0.1.5-rc.1 / Node>=24.11.0 / pnpm10.15.1 / Presentation format0.1.0 unchanged.

## Implemented in this milestone
1. Generated catalogue identity/routing projection with source and compiled fingerprints; a deterministic importer verifies the owner's complete approved JSON.
2. Three-valued condition evaluation and typed alternatives. All16 known flag combinations are checked for unique routes and DAG validity. Unknown conditions propagate pending/blocked results; they do not silently turn into N/A.
3. Input readiness uses actual output-port selectors, type, scope, date, claim references, limitations, exact snapshot and current lifecycle. A plan whose contents changed without a matching fingerprint is rejected.
4. Dynamic candidate deliverables: all configured FIG instances and the audit table, no fabricated outputHash, no mandatory one-figure-per-page rule.
5. Read-only57-to62 legacy-reference plans. Old records, revisions, approvals and evidence remain unchanged. New references are unreviewed; unknown schemas/objects and ambiguous revisions are rejected.
6. Screen169 and A3 geometry/density preflight: actual displayed size, physical PPI, analytical crop checks and photo retention thresholds. This is not a new renderer or a substitute for existing real-image inspection.
7. Actual DSH command registration: `/preplan-research-plan`, plus `--item=2.03` and `--json` for inspection. No network, model, filesystem writes or project creation occurs.

## Try the new entry
```text
/preplan-research-plan
/preplan-research-plan --industryPlanning=false --existingBuildings=false --externalPartners=false --marketing=false
/preplan-research-plan --industryPlanning=true --item=5.06 --json
```

The four flags are explicit review inputs for this read-only milestone, NOT a new compulsory front-door questionnaire. Existing zero-input workspace entry and A/B/C/D UI continue unchanged except the current version label.

## Not implemented yet
- Full62 professional field schemas, every source/query/research-step adapter and actual62-workflow execution.
- Persistent62-run state and replacement/migration of the old executor, production evidence/result semantic gates, budget-reservation service and automatic feedback loops.
- A3/16:9 renderer integration, page manifests, actual image generation/inspection changes and complete export audit package.
- Full real-project end-to-end62-run acceptance and user-device deployment.

Do not report “62项已执行” because the catalogue or projection exists. Do not replace old workflow IDs by position. Do not remove image inspection, original-family, crop, copy-layout, source or workspace safety checks.

## Next milestone
Compile the complete original module specs (fields, provenance, queries, methods and output schemas), introducing a separate62-run model. Wire one vertical slice (important regional nodes → OD distance table/map → typed artifacts/claims → audit receipt) into existing DSH provider/tool capabilities; exercise public-service alternatives and unavailable-data paths. Only enable new automatic execution after this vertical integration passes. Reuse the immutable planning index and keep its source lock in sync.

## Validation
Commands: `pnpm typecheck`, `pnpm test:research-v210`, `pnpm test`, `pnpm test:built`, importer `--check`, `git diff --check`. Execution evidence and final results are recorded in `docs/development/v2.1.0-progress.md`. Tests in this milestone are synthetic unit/integration and existing regression tests, not a real project's research certification.
