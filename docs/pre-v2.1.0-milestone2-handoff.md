# Pre-design 2.1.0 — milestone 2: source-bound regional OD

## Coordinates and authority
- Branch `v2.1.0`; start `c2d7f7e6e4854a4393c6c8dad65cbd1714bcfeae`; main remains unchanged.
- Package version `2.1.0`; DSH `0.1.5-rc.1`, Node `>=24.11.0`, pnpm `10.15.1`; no new dependencies.
- Complete approved v1.2 source SHA-256 `1ad0d7b0a2b52a84515cd97ab313c5596c0da02bea6175eaf4390d39d99d2a08`.
- Full 8/62 dictionary is now losslessly packaged in `research/planning-v1.2/unified-data.json.br`. Source identity/routing projection remains unchanged.

## What is implemented
1. Full specification loading and byte/index cross-checking: all 62 original source/query/field-description/method/output/copy/QA entries. Exact executable field schemas exist only for the regional slice, not all62.
2. Typed import of supplied important-region / entrance candidates, selection reasons and coordinate source bindings. JSON pointers must identify coordinates in captured source bytes; a name or unsupported CRS cannot silently become a location. This is NOT automated discovery of important regions or full completion of 2.02.
3. Module2.03 execution: existing WGS84/WebMercator geometry/Haversine and public OSRM adapter are reused. Straight distance, road distance and static-network duration stay separate. Driving route geometry and endpoint snapping are validated against an explicitly reviewed project tolerance. No invented speed-to-time conversion or straight-line isochrone.
4. Input/source/result/claim/response snapshots, per-run request quota, timeouts and abort handling. Unavailable routes retain null road/time; geometry figure is omitted, not faked. Only explicitly authorized execution sends coordinates to the fixed public OSRM service.
5. Native SVG route geometry illustration, comparison chart, CSV/JSON table and HTML report from the same result. Route figure has no geographic basemap and says so. Every numeric HTML cell references a claim. Injected fixture transport is visibly distinguished from online public-service transport.
6. Append-only `research/runs/RUN-<uuid>/` storage in the bound standard workspace. Existing `project.json`, old57 states, revisions, approvals and UI are not rewritten. Reject symlinks/path escape/cross-project input; recheck workspace identity and active revision before commit. Writes are staged and renamed only after checks.
7. Archived offline replay re-executes calculations and re-renders all outputs; checks complete result, file set, contents and manifest. Rehashed edits to numbers, output ports or publication flags are rejected. No online fallback during replay.
8. Actual DSH `/preplan-research-od` command, registered through the existing Host; `/preplan-research-plan --item=2.03 --json` also returns the full specification.

## Use in an existing DSH project
Create a request JSON **inside the already bound standard workspace**; use `examples/research/regional-od.request.json` as a schema example only. Replace its synthetic names/captures/coordinates and project/snapshot/scope/date with actual, documented inputs. The request `projectId` is the active Pre-design project ID, not the separate Presentation-standard project ID in `project.json`. The Host registry verifies both identities.

```text
/preplan-research-plan --item=2.03 --json
/preplan-research-od --input="research/地域请求.json"
/preplan-research-od --input="research/地域请求.json" --online
/preplan-research-od --verify=RUN-<returned-uuid>
```

Default offline execution still calculates straight distances and produces a limited audit package; road distances/times remain null. `--online` explicitly authorizes sending selected entrance coordinates to the public OSRM route endpoint. It does not authorize general scraping or sending source documents. A missing map/route service, missing reviewed snap tolerance or unsupported travel mode must not be papered over. Capture locators are documentation, never arbitrary URLs fetched by the runner.

Open the returned relative `report.html` for review. All original captures/responses, tables, claims and the analysis trace are stored beside it. The command does not automatically replace client-report pages or advance the old workflow.

## Reproduce without a model or network
```sh
pnpm verify:research-v210
pnpm test:research-v210
pnpm exec tsx scripts/build-research-regional-demo.ts
pnpm exec tsx scripts/verify-regional-audit.ts /absolute/path/to/workspace RUN-<uuid>
pnpm typecheck
pnpm test
pnpm test:built
```
`work/research-regional-demo/DEMO.json` lists generated injected-response and offline runs. Demo data are intentionally synthetic and do not establish actual regional distances or traffic conditions. No project PDFs, customer files or credentials are shipped in examples.

## Scope and limitations
- Hashes prove byte consistency, not source truth or authorship. Replay is a computational/representation check, not an independent factual audit. All runs remain `limited`, `publicationGranted:false`.
- The runner validates supplied captures; it does not independently obtain official region boundaries, vet whether the chosen region is relevant, or survey actual entrance access. These remain required professional review.
- OSRM durations are static road-network estimates, not live traffic or historical-time proofs; source/as-of mismatches carry explicit limitations. Walking/cycling/transit routes are not silently treated as driving.
- The route illustration has actual supplied/provider coordinates and scale, but no licensed geographic basemap. Full cartographic approval is still outstanding.
- 16:9/A3 preflight from M1 remains available; this slice produces SVG/HTML, not complete new PPT/PDF renderer integration. Existing image inspection/original-family/crop safeguards remain in place.
- Safe filesystem guards target untrusted paths and static symlinks in a trusted user's workspace. They do not claim OS-level isolation against a concurrent privileged filesystem attacker.
- New62 persistent orchestration, semantic publication gate for all modules, general budget reservation, automatic feedback loops and all-module adapters are NOT complete. No real-project E2E certification or user-device deployment has been performed.

## Next stage
Connect evidence-bound candidate discovery and licensed map data to the same regional request schema, then expose audit-bundle results in the existing workspace material panel and connect the 62-run scheduler. Extend 2.04/3.04–3.07 using shared peer IDs, with typed professional schemas and the same no-fabrication/replay rules. Do not substitute menu counts for end-to-end research acceptance.
