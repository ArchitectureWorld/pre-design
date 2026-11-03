# Pre 2.1.0 milestone 2 — full research specs and regional OD vertical slice

> Execute inline using executing-plans and test-driven-development. This plan does not authorize merging main or publishing packages.

**Goal:** Keep the existing 57-workflow executor intact while making one new research chain executable, replayable and available through DSH.
**Spec:** Owner-approved planning-research.v1.2, source SHA256 `1ad0d7b0a2b52a84515cd97ab313c5596c0da02bea6175eaf4390d39d99d2a08`.
**Base:** v2.1.0@c2d7f7e6e4854a4393c6c8dad65cbd1714bcfeae (tree 9e95e3916e77fa45cf9a6bc739950a3f1500e30d).
**Architecture:** Full immutable source specification alongside the existing routing index. A typed regional-node/OD request validates source-bound coordinates, reuses existing Haversine and OSRM adapters, and produces datasets, claims, SVG/HTML and an append-only audit bundle. DSH invokes this explicit slice; it does not mark all62 workflows done.
**Tech stack:** Existing Node24.11, TypeScript, Zod, cartography providers and Vitest; no additional package or private paid API.

## Constraints and review focus
- Continue v2.1.0 only; preserve DSH0.1.5-rc.1, product2.1.0, old histories, UI and existing image-review policies.
- Original professional field descriptions are retained, not silently advertised as 62 executable field schemas. This milestone implements exact schemas for the regional slice only.
- Unknown travel mode, unavailable routing, provisional entrances and missing evidence fail or degrade explicitly. No invented speed/time or route geometry.
- File input cannot authorize network access; only the explicit human command option may enable bounded public requests. Untrusted locator URLs are never fetched.
- Source/response hash proves byte identity, not truth. Same frozen source/snapshot links every numeric claim and artifact.
- No internal filesystem path leakage into public pages; source bundle remains an internal audit product. Synthetic sample is clearly labelled.
- Reject traversal, symlink components, wrong workspace identity and tampered archive/manifest; abort before commit; never overwrite old snapshots.

## Tasks
1. Full spec loader (source archive, immutable spec/item lookup, source hash check, packaged lookup) + source fidelity tests and enriched read-only plan command.
2. Typed regional-node/OD request and deterministic execution: original coordinate/source pointers, provenance classes, reviewed snap tolerance, mode/direction, bounded provider and fallback; test before implementation.
3. Same-source SVG route/geometry map, distance/time chart, native HTML/CSV table, claims/trace; independent bundle hash checks and offline replay. No fake base map when unavailable.
4. Isolated run store and DSH command with session/workspace binding, explicit network consent, safe relative input, terminal snapshot and audit verification.
5. Synthetic example, CLI rehearsal, package/full regression, branch push, remote verification and handoff.

## Interface preflight
- Full source spec -> catalog: compare identity/ports/edge sets against locked planning index; no second divergent routing model.
- Request -> execution: schema validates entire input before any provider call. All coordinates bind to captured JSON via selectors.
- Execution -> presentation/store: file manifest contains byte hashes and same snapshot references. Report and audit use the same rows; missing numbers stay null.
- Command -> store: root is resolved from Host session, project identity checked; path parameter is confined to that root; generated destinations are never user-controlled.

## Validation
For each task first run a failing targeted test, implement and rerun. Final: pnpm typecheck; pnpm test:research-v210; pnpm test; pnpm test:built; source --check; audit replay; git diff --check. Browser root restrictions are recorded separately from product failures, and remote CI is the final complete-suite authority.
