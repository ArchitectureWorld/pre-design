# Versioned Component Upload V3 Implementation Plan
> **For agentic workers:** Use executing-plans task-by-task.

**Goal:** Connect validated page components to private reusable candidates for newly admitted uploads, without altering old jobs.
**Architecture:** Version 3 observes each selected page before profile, requires one evidence-backed archetype per page, then requests a strict style/geometry proposal and compiles through the deterministic adapter. The existing workflow checkpoint mechanism validates every cached output again. The model cannot author permissions, source IDs, arbitrary SVG or review receipts.
**Tech Stack:** Existing JavaScript, Zod, node:test, PostgreSQL and native HTML renderer.
**Spec:** docs/architecture/REFERENCE_COMPONENT_CONTRACT_V3.md; approved reference-fidelity-workbench design and parent instruction to proceed.

## Global Constraints
- Only explicit new native upload conversations use version 3; ordinary default remains 2 and retry/old versions retain exact prompts.
- At most six explicitly selected image pages from one owned document in V3, rejected before model calls if exceeded; unselected text/native objects are excluded.
- Results private, visual review pending; image objects are placeholders, never original image copies.
- No additional real model calls before reporting bounded test budget.
- Unsupported geometry/content must fail explicitly, not disappear.

## Review Focus
- Forged or swapped page identity fails before adaptation.
- Cached outputs go through same source/role/geometry gates.
- Incomplete per-page profile, lost local text and unmapped decorations cannot masquerade as fidelity.
- Model-supplied permissions or SVG are rejected by strict schema.
- Old versions and old checkpoints are unchanged.

### Task 1: V3 stage contracts and source/profile correspondence
- [x] Add failing tests for per-page observation, profile coverage/counts and strict adaptation.
- [x] Implement component-upload-workflow.mjs with bounded source mapping and restricted model style proposal.
- [x] Run focused tests, review source immutability/permissions.

### Task 2: Workflow integration and admission
- [x] Add failing whole workflow fake-provider tests, old-version and cached retry tests.
- [x] Wire V3-only observe-components, profile context/gates, deterministic prototype adaptation, new admission.
- [x] Verify old prompts unchanged and unknown version rejected pre-call.

### Task 3: Acceptance
- [x] Independent security/compatibility review.
- [x] Real server upload pipeline with controlled provider; label not real-model visual acceptance.
- [x] Report exact model trial budget before any new remote request.
- [x] Only after review and regression, backup/build/deploy and verify served artifact hashes/UI.

## Verified outcome, 2026-11-17
- Cloud implementation through `7381a4c`; deployed aggregate `cc04c84` to existing CSADI-Linux port 4320, with source/dist/database/config backup and unchanged project data/model policy snapshots.
- Local focused regression: 76 passed. Controlled-provider real PostgreSQL upload and real Chrome tests passed; these do not establish real-model visual fidelity.
- Actual served hashes matched all five checked assets. Live entry showed trial default OFF, explicit page selection/cost disclosure, retained original three-page candidate, matrix and large preview with Escape close, zero page errors.
- Independent compatibility/security review passed, including old version paths and strict V3 profile format.
- Authorized real original-PDF page 15 round consumed three requests (observe/components/profile), zero fallback/retry, 241451 ms. Components produced 37 observations; profile failed because it repeated 25 optional coarse regions against the prior 24-item bound. No design-spec/adaptation, candidate or publication followed.
- `7381a4c` removes the redundant regions field from V3 profile contract only, sends its strict schema and preserves old versions. Offline reproduction/review passed; no additional real request has validated the changed prompt.
- Provider-reported tokens recovered: 29333 input + 6237 output = 35570 total. Currency cost unavailable; reported token counts are not a bill.
- Real-model full-flow success and source visual fidelity remain unverified. Original three-page candidate remains private and awaiting user visual judgment.

## Next gated verification (not executed)
- Preserve successful observe/components checkpoints; confirm fingerprints and caps before reusing them. Changed profile input must recompute, not reinterpret the rejected original response.
- Request a fresh bounded budget before profile/design-spec/adapt model calls. Stop at first failure, no implicit retries; no source image sharing or publication.
- Acceptance must jointly check complete source component coverage, honest unknown/missing features, editable content replacement, and original-page visual comparison. Structural success alone cannot pass this gate.

## Subsequent bounded rounds and deployed remediation
- One resume launch was blocked by execution-sandbox DNS (2 SDK transport attempts, no response). Stopped; parent explicitly authorized corrected network execution.
- Corrected round: 2 requests / 167590 ms, no fallback. Profile accepted; Design Spec rejected prototype-only binding/purpose/contentFitRules fields. `4e9a874` isolated V3 spec schema/prompt; legacy prompts retained. Independent review passed.
- Next separately authorized round: 2 requests / 108217 ms, no fallback. Design Spec accepted; adaptation rejected nested page/card/band background incorrectly. `47c1633` uses final opaque top layer; partial/diamond/alpha fail closed. Independently reviewed.
- No subsequent remote calls. Saved raw response replay compiled 25 slots; browser found title overflow. Explicit title-reuse derived width/capacity (`7fe7761`, spacing correction `2cbaec1`) passed browser 4/21/27-character cases, rejects 28 without modifying content. Positive 48px letter spacing permits 5 CJK; old 11 CJK negative control overflowed 144px vs60px.
- `d21d628` server-authored titleReuseVersion1 only for newly admitted component trials; old jobs remain undefined. Unknown/incompatible versions rejected before cache/model. Independent review passed. Deployed local aggregate `8430ec4` to4320 with source/dist/DB/config backup; 57 focused and2 actual PG upload tests passed. Five served asset hashes and live Chrome old candidate/default-off trial verified; data/model/config snapshot unchanged.
- Offline full workflow with read-only copied checkpoints and runModel hard-throw completed. A new private resource `9809f033-5fe0-4ee1-b597-9fa6e2485b57` v1 preserved replay candidate; not shared/published or visually accepted.
- Original-page visual manual transcription (458 characters, uncertain glyphs explicitly not verified as native extraction) exposed7 local overflows. Explicit content-specific manual geometry changes: three labels expanded left within blank space, three conclusions moved upward/two-line height, middle first body expanded vertically before next paragraph. No source/model response changes, no font reduction or truncation. Browser full transcription and standard2-page fixture passed; JSON export/import/rebind and browser reuse passed.
- Same private resource v2 is `第15页 · 真实文字适配派生（待视觉确认）`. Live4320 library and original page15 side-by-side verified, visual-acceptance checkbox remains unchecked. Original three-page candidate unaffected. No original photographs or business text included in exported template; real-text test remains private outside library package.
- Important limitations: v2 seven-slot adjustment is manual/content-specific, not general automation. Source calligraphic chapter marker, exact fonts, paper texture, watermark and inline emphasis styles are not restored. Images are synthetic placeholders. Global character budget does not guarantee each slot can fit arbitrary replacements; actual browser content testing remains required.
- Next: generalize the explicit seven-slot adaptation into configurable bounded rules with provenance and collision checks. No new model call budget remains.

## 2026-11-17 measured content-fit continuation

- `3073adb`: internal opt-in proposal from browser outer-box measurements, stale hashes rejected; explicit left/down/up policies constrained by original parent group, growth budget, and all final sibling rectangles. Source text/font/observations are not modified. No public endpoint or default auto-fit yet.
- `730e1c2` / `1c24537`: canvas-space DOM measurement includes padding/border, preserves container-query context with a temporary hidden clone, cleans it in finally, and rejects slot/descendant/intermediate-ancestor transforms and non-horizontal writing. Whole-page scale remains supported. Fractional CSS width is not inflated by integer scrollWidth rounding when no measurable horizontal overflow exists.
- Actual Chrome on CSADI-Linux private QA worktree: 1000px canvas, whole-page transform scale(.5), and responsive 500px render normalize to within 2 canvas pixels. Five negative cases pass. A transformed child span was first reproduced at estimated width 86.4062 vs actual 253.21875, then the rejection regression turned green.
- Actual private page 15 replay: existing 458-character manually transcribed test content -> new normalized measurements -> 7 explicit directional policies -> formal component adapter -> fresh native render -> zero reported overflow. No model calls, no original-file sharing, no production or existing candidate mutation. Evidence: `component-final-private-replay/normalized-policy-receipt.json` and `normalized-policy-real-text.html` in the local private QA evidence directory.
- This is not automatic design-intent inference or general visual acceptance. The seven policies were explicitly selected. It is not yet a shipped user-facing control. Existing v2 private candidate remains unchanged. Next integration must make policy selection/derived changes visible and must remeasure every changed content/font/canvas/version, not trust browser-supplied geometry as an authorization or reuse a prior fit receipt.

- Full `web/app npm test` at 1c24537: 901 tests, 829 passed, 56 failed, 16 skipped. Not a full green suite. Failures include PG Unix-socket EPERM, Chromium socket restrictions, PDF page 1/page 31 cancellation checks, hidden-first-mounted chat scroll, and research persisted-model tools validation. Full failure names and traces are retained in `/tmp/content-fit-full-suite.log`; these are not papered over by the focused or local browser pass.

## Explicit adaptation preview delivered (2026-11-17)

- Cloud reviewed runtime `ea73fde52c7e68527bfd6b2358d8f52a45a524b1` deployed as local aggregate `937832920c8caf91609126d0f1f248b3026fc4ab` over `8430ec4`. CSADI-Linux port 4320 unchanged. Backup `native-v3-8430ec4-to-9378329-pirs5n1_` retains source, dist, config/service and PostgreSQL dump; before/prestop/after snapshots matched projects, drafts, materials, uploads, prior resource versions, and model policy/config. No active jobs at switch.
- Five served asset byte hashes matched built files. Actual entry `http://192.168.6.45:4320/` -> 版式库 -> 第15页 · 真实文字适配派生（待视觉确认） -> 内容适配预览 was opened in Chrome and generated a real server preview. Explicit review remained unchecked and save disabled; no geometry revision was saved on the user's behalf.
- Existing private resource `9809f033-5fe0-4ee1-b597-9fa6e2485b57` now has metadata-only V3 (hash `9703f7a4b0f1e92f8910ac45f97cec5c6c509493d6fdfb0b4101e66bd4a6bc1f`). V2 slot geometry unchanged, V1/V2 retained. This deliberate post-deploy metadata revision is separate from deployment preservation snapshots. No publication/sharing was performed.
- Final release worktree: `.cache/content-fit-release-qa`. 53 focused tests passed; real PG+Chrome competing confirmations allowed one winner, same-request replay was idempotent, original hash retained, foreign/expired/retired/hash-conflict attempts rejected, trial text absent from new reusable package. UI mocked-API interruption/conflict/reopen tests passed in actual Chrome. Real page-15 UI->Fastify->server Chrome->PG flow separately passed in a temporary test database with full seven-slot before/after review screenshot inspected. Zero model calls.
- The original unbounded cross-user queue was independently reproduced and fixed: preview input 256 KiB, confirmation 4 KiB, package 2 MiB, global two/actor one active requests, no queue, pending receipts max32/global and8/actor, 15min expiry; disconnect signal and 60s cooperative browser cancellation. This is not a hard PostgreSQL timeout. Reviewer independently reran 100-request rejection and deadline/cancel admission release.
- Last broad cloud suite: 920 tests / 848 passed / 56 failed / 16 skipped (`/tmp/content-fit-final-full.log`). Not fully green: PG/Chromium sandbox errors plus PDF cancellation, hidden-chat scroll and persisted research-model tools checks remain recorded. Focused/local tests do not erase those failures.
- Policy metadata is opt-in via `referenceContentFitPolicyVersion:1` only for new explicit component uploads. Missing field on old jobs stays old. Raw model checkpoints and prompts unchanged; cached output is reaccepted with the declared policy version. Unknown combinations reject before model/cache access. Source-less or incompatible parent bounds do not become fictitious whole-page ranges; the candidate explains that adaptation is unavailable.
- New API only accepts full trial text and selected directions, never client rectangles/measurements. Server remeasures and rerenders; receipt binds owner/resource/version/hash and TTL. Confirmation creates a new revision under the resource lock, not publication. Original source observations, font sizes and trial text remain unmodified. `minGap=.002` is an explicit derived clearance policy, not an observed source fact; already-fitting boxes do not repeatedly grow by the safety margin.
- Evidence local root `/home/zetta/.cache/predesign-resume-300611f`: `content-fit-live.json/png`, `content-fit-served-hashes.json`, `content-fit-release-focused.log`, and `component-final-private-replay/content-fit-ui-real-receipt.json`, `content-fit-ui-real-private.png`, `content-fit-enabled.json`. Current screenshot inspected. Live preview compares same-content template before/after, not original PDF fidelity; original PDF remains in the separate source-comparison path.
- Remaining boundaries: inputs currently require every text block; images are synthetic placeholders; font/texture/chapter-calligraphy fidelity is still pending; selected growth directions require a person, not automatic design-intent inference. Default ordinary upload remains unchanged and component trials retain the explicit selected-page bounds. No universal 87-page success or billing estimate is claimed.
