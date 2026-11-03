# Pre-design 2.1.0 — milestone 3: evidence intake and shared peer research

## Baseline and scope
- Continue branch `v2.1.0`, product2.1.0, approved8chapters/62modules. Main, existing57 executor, UI and production image inspection are preserved.
- M2's remote run35977160724 passed focused/full/built tests but failed its commit step. The first recovery commit only retired the failed materializer; its referenced tree did not contain the applied M2 source. The M3 integration therefore restores the original hash-locked M2 files before applying M3 and runs all gates on the combined final tree. Do not infer completed integration from a commit message.
- DSH0.1.5-rc.1 / Node>=24.11.0 / pnpm10.15.1 and existing dependency lock unchanged. Reuses parse5, zod, cartographic geometry, Chinese wrapping and checked workspace storage.

## Implemented
1. Capture explicitly named workspace JSON/GeoJSON, UTF-8 text and saved HTML. Exact original bytes/hash, actual relative input path, provenance locator, observation/retrieval dates, source class and rights are archived. HTML text uses parse5; source scripts and instructions do not execute. This is intake of supplied captures, not an autonomous web crawler.
2. Every peer claim resolves to an exact JSON pointer or a unique literal quote. No numeric coercion, guessed coordinate offsets, name-based merging, snippet-to-fact promotion or implicit zero. Source class is not independent verification.
3. Shared `peerId` register for direct competitors, substitutes and mode references. Scalar contradictions remain conflicts. Planned, closed and unknown status stay out of operating-price comparisons. Assumed status/price are counted and grouped separately from documentary records; even documentary counts mean source-recorded status, not a current site survey.
4. Product/format/price and audience/operation tables. Price groups require the same explicit product basis, currency, unit and month; no cross-group market average. Target audiences and sampled observations are separate fields. Occupancy percentages require denominators; visits/revenue remain cited records and never imply profitability.
5. One-data HTML + three CSV tables + native source-coverage matrix + conditional price chart. Every displayed claim links to source selectors/hash; original source text is viewable without executing HTML. Missing map/materials are explicit, not filled with decorative images.
6. Immutable audit runs using shared checked I/O. Replay recomputes analysis, comparisons, OD preparation and renders; it rejects rehashed result/chart changes. A changed active project/revision or changed input/source bytes before commit stops the write. Reading an archived run does not depend on the original files still being unchanged.
7. Optional source-bound peer-to-OD preparation uses the same peer IDs and actual M2 schema. Original source content and selector are retained within the derived coordinate capture. No partial selected set is silently computed; unresolved coordinates return gaps. The regional executor still requires separate explicit network authorization.
8. Real DSH command `/preplan-research-peers`, including active-workspace identity derivation when not supplied. No required new front-door questionnaire and no old-workflow approval/state advancement.

## Use
Place `examples/research/peers.request.json` and its source file under the bound workspace's `research/` folder for a synthetic trial. Source paths are relative to the workspace, not to the request file. For actual research, replace the synthetic raw evidence and bindings; do not rename synthetic values into a real project.

```text
/preplan-research-peers --input="research/peers.request.json"
/preplan-research-peers --verify=RUN-<returned-uuid>
/preplan-research-od --input="research/runs/RUN-<peer-run>/regional-od.request.json"
```

Optional `projectId` must match the actual Pre-design binding; absent identity defaults from the active context. Absent snapshot ID becomes `revision-<active revision>`. The output remains `publicationGranted:false` and is not a client-report approval.

Source claim fields: name/address/status/positioning/format/coordinate/price/targetAudience/observedAudience/metric. An input selectionReason and role are retained as decisions, not field evidence. `documents[]` and inline `captures[]` are mutually exclusive.

## Reproduce
```sh
pnpm test:research-v210
pnpm typecheck
pnpm test
pnpm test:built
pnpm exec tsx scripts/build-peer-research-demo.ts
```
The demo writes peer and regional audit runs to `work/research-peer-demo`, with `DEMO.json` listing both offline replay receipts. Private project reports, credentials and fonts are not included.

## Validation / limits
- Progress and command logs are in `docs/development/v2.1.0-m3-progress.md` and the delivery evidence archive; remote CI must be read for the exact final commit.
- The cold built-Host test now has a bounded20s per-test startup budget after measured7.27s import+initialization exceeded the old5s default. No behavioural assertion, source-quality rule, route budget or production sandbox setting was weakened.
- This is a typed subset of3.04–3.06 plus2.04 input preparation. It does not independently discover every competitor, authenticate websites, investigate financial performance, prove demand gaps or finish these whole professional modules.
- No new full-project62 scheduler, automated open-web search/extraction, evidence authentication, licensed map generation, report-page material panel integration, fullPPT/PDF renderer upgrade or user-device deployment is claimed.
- Hashes/replay protect internal consistency, not authenticity against an author who changes all input evidence. Filesystem guards do not claim privileged-attacker isolation.

## Next
Wire the existing DSH research/source tools to prepare candidate records with retained primary snapshots, add case/industry recommendation evidence gates, and expose these audit outputs to the existing workspace/page pipeline. Keep peer identity, source dates, conditional evidence and legacy isolation intact. Run actual-project acceptance separately from synthetic tests.
