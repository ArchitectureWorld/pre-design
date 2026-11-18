# Visual semantics and project reuse verification

## Deployed state
- Cloud runtime through 64384df; browser regression 19de7da. Local deployed e7dd4da97b69d85a558612871c10c05158bf3497 at fixed 4320.
- Explicit new-task opt-in for one extra semantic stage per selected page; default off, expense and pending-review status visible.
- New component tasks carry versioned platform-derived citation footer. Original Profile/geometry stays unchanged. Collision or insufficient space rejects; old tasks and reviewed resources remain unchanged.
- Independent reviews passed: semantics contract 12 tests, integration 36, entry 31, footer 38. Cloud full: 973 tests, 901 pass, 56 existing failures, 16 skipped; not a full pass.
- Real local PG 16 tests passed. Real Chrome/PG uploaded synthetic PNG, executed six controlled stages, created private test resource, rejected binding before review, simulated explicit review, bound complete source paragraphs/points, rendered citation, and exported reusable resource without project text.
- Long chapter plus 64 references rejected by real browser LAYOUT_PAGE_UNFIT; not truncated. Screenshots checked. No production candidate added.
- Actual served dist hashes and old reference comparison checked. Backup source/config/dist/database and before/after snapshots retained locally. No existing data/config differences.

## Bounded real observation, not a successful extraction
Only previously authorized page 15 PNG and saved image-observed 37-component structure were submitted. Original PDF was not read.
- Single semantics-1 stage; 2 actual HTTP requests, 65.8 seconds; provider retries disabled, request guard and 180-second deadline.
- Primary yaoguang-codex / yaoguang02-gpt-6-astra: HTTP 413, request exceeds gateway body limit.
- Fallback SenseNova / sensenova-6.8-flash-lite: max-tokens termination at requested output cap 4096. No valid completed observation accepted.
- Reported assistant usage: input 3338, output 4096, total 7434 tokens, one message only. This is not a complete two-request bill. Currency cost unavailable.
- No retry, no further stages, no new candidate, no publication.
- Source image hash 6e3406fbc4b2bfed3123ed89ab11541475ae1e1beba45e159baa8aef8fe58d28; saved observation canonical hash d0d3d8b0d1c3610a327099efb4cd5cfddf4b9f6e4a83977f070b3e7f92d32559.

## Remaining work
Offline transport-size reduction with explicit original/derived provenance and unchanged coordinates; inspect reasoning versus structured-output budget before changing contracts. Preserve fine detail and unknown states. No additional real calls without a new bounded authorization. Semantic observation never establishes visual fidelity, source editability, sharing rights or exact emphasis text binding.

## Offline diagnosis after the bounded failure
- Independent inspection of only the isolated trial session found no final-text blocks. The fallback had one reasoning block (13,736 characters, not a token count), 609 reasoning increments, and max-tokens termination. Do not treat this as an oversized JSON response; no JSON body was produced.
- Installed DSH pi-ai adapter `profileOptions` turns `off` into omission of the reasoning option. Its own `reasoningInfo` comment warns that omission cannot disable a provider whose default is thinking. `reasoningEfforts:false` is capability metadata, not a proven provider-side switch.
- Official [SenseNova 6.8 API guide](https://github.com/OpenSenseNova/SenseNova6.8/blob/main/API.md) documents output tokens including reasoning and mentions thinking/non-thinking sampling modes, but does not specify a switch for this model. The [current Chat API reference](https://token.sensetime.com/docs/api-reference/endpoint/llm/chat) defers supported fields to the account console. No Qwen/ZAI parameter has been assumed, no provider settings changed.

## Proposed next bounded check (not executed or newly authorized)
Prefer the existing primary route alone over guessing a fallback reasoning switch. One semantics-1 request, <=180 seconds, output cap 4096, no fallback/retry/downstream/candidate. First hard-check final serialized body and source/derived identity, then obtain authorization.
- Authorized existing page-image PNG: 902,809 bytes, 1400x788.
- Offline JPEG quality 90, 4:4:4, same dimensions: 338,733 bytes; SHA f861be49d3243241ad7b4b4abd9c0bd7d2d4c3d3a3076f6c0e9b56842700f954.
- Base64 plus 65,536-byte reserve estimate: 517,180 bytes, NOT measured complete provider request bytes or a verified gateway limit.
- Both images visually checked: bullet marks, orange emphasis and small text remain distinguishable at displayed resolution; compression is lossy, not proof of preserved pixel detail or model recognition. Product already renders PDF page images as JPEG quality 90; this test conversion uses only the previously authorized PNG, not the restricted PDF.
Alternative: one request through an existing configured vision route with independently verified reasoning controls. No such route has yet been established in this diagnosis; SenseNova's switch must not be guessed. No new model calls occurred. Costs remain unknown until supplier-reported data, and reported partial usage is not a full bill.

## Authorized JPEG-primary trial outcome
After independent review of 49d24d1, ran the single page15 trial once. Actual configured route uses OpenAI Responses (not Chat Completions), fixed primary only. Guard installation readiness is mandatory before SDK startup; Cordis initialization-failure negatives and real installed serializer tests passed. Local focused 12 passed; cloud full 987: 915 passed, 56 existing failures, 16 skipped.
- Exactly one guarded fetch attempt; serialized JSON body 461,661 bytes, SHA dad22318ae8e74d04e566f0ae21eba8d5100632245b7acad78435ed728218d1e; output cap 4096.
- Failed TRANSPORT / connection-error after ~2.9 seconds; total 3.17 seconds. No HTTP status, final text or valid usage was received. This does not establish that the provider received the request, that 413 is resolved, or that a model was billed.
- No fallback/retry/other stage/candidate. Once-only lock and private receipts retained. Production source remains e7dd4da, unchanged; not redeployed.
- Current shell has Seccomp=2 and AF_UNIX creation denied, while IPv4 socket/loopback works. Default injected HTTP/SOCKS proxies were explicitly removed for trial; isolated worker also omits proxy env. Logs lack the underlying cause, so do not attribute the failure conclusively to sandbox, DNS, TLS or provider. Further authorized diagnostics are credential-free metadata probes only, not model requests.

## Separately authorized network-corrected trial
Credential-free probes demonstrated EAI_AGAIN under default isolation but successful DNS and HTTPS HEAD=405 with approved network execution. The previous request's departure could not be absolutely reconstructed; parent explicitly approved one correction while accepting possible second billing. Old lock/receipts retained, new independent claim created.
- One guarded Responses request, 35.9 seconds, body 461,679 bytes, image identity unchanged. No fallback/retry. Observation validated (not full visual acceptance).
- 25 relevant components: nine disc markers; four absent image captions; 16 emphasis-present and five emphasis-absent. Nine bullets/four captionless photographs align with inspected page image; individual emphasis regions and text bindings still require review.
- Raw supplier usage: inputTokens=4055, outputTokens=1076, totalTokens=9355, cacheReadTokens=4224. Preserve these separately; do not infer a pricing equation. Existing strict arithmetic aggregate remains unknown; new reportedUsage supports source values. Currency cost unavailable.
- No downstream model stages, new candidates, source changes or deployments. Subsequent work is offline visual review, explicit pending human mapping and reusable integration.

## Offline page-image review (assistant review, not user acceptance)
Using only the authorized page image, the returned body markers align with all three columns' three bullet paragraphs (9). The four photo objects have no independent captions; the colored strips below are card headings/labels, not permission to remove project-supplied captions.
The 16 emphasis-present objects align at the coarse visual-feature level: page/section/subheading, three card headings, three conclusions, all three left body paragraphs, middle third body paragraph, all three right body paragraphs. Five emphasis-absent objects are the three small card labels and middle first/second paragraphs. In left/right third paragraphs the model supplies separate wrapped-line regions, matching the visible continuation pattern. Precise pixel bounds, font identity, color values and source-to-project character binding are NOT verified by this count-level review.
For reuse, nine markers and four when-present caption policies may be derived under the existing versioned adapter. All 16 emphasis rows must stay `emphasis-needs-explicit-text-binding`: normalized source rectangles cannot be converted into project character offsets without an explicit user-reviewed text mapping. Supplied project captions remain intact. No whole-page raster, original photos, watermark or source prose is added to reusable resources; no sharing rights are inferred. The old scratch `offline-component-replay.mjs` reads the restricted PDF and MUST NOT be used for subsequent replay; use saved image-only observation and validated response objects instead.

## 2026-11-18 Explicit emphasis review and binding delivery

- Cloud implementation `769253c`, line-ending correction `14d2f67`; independent review confirmed candidate source/role/strict metadata, old checkpoint behavior, no extra model calls, exact spans/CAS/export isolation. Reviewer reproduced CRLF bug; RED regression then fixed using DOM UTF-16-to-original boundary mapping before code-point conversion, never normalizing saved source.
- Local deployment commit `325931f` on CSADI-Linux, port 4320. Source archive and prior dist backed up; no migration or candidate/project data edits. Service active, worktree clean after deployment.
- Real PostgreSQL: 13 focused UI/store tests passed, including same-revision competing writes, original draft preservation, rejected forged spans and reusable exports without project text.
- Real Chrome + real HTTP + PostgreSQL fixture: explicit add/save/reopen emphasis and restore-source flow passed, CRLF/lone CR/emoji selections retain exact source, half-surrogate selection rejected. Model calls 0. Initial browser attempt hit 404 because new private QA directory had no dist; built QA assets then reran successfully. No business-data change.
- Screenshot reviewed: saved project preview shows chosen phrase bold; original full text preserved. This is synthetic controlled interaction QA, not original PDF visual acceptance.
- Actual 4320 served asset SHA256 matched local built bytes: content-mapping-ui `d1b02e16c6c875f5599b03878e0b9ed690b19d6bed72dea7c8648c7c99c74ba1`; review-ui `fda5a40ed7eaa586d15d5c9afe32c16c9586387e787dfec1b92b1c5c09fd69b3`; fidelity-assessment `98a3660a45c6452fe94bfac4f9e879ee566a0fe96075e2d3c3bec2349bb63c43`; canvas-ui `0bb7c729acd61e0f60f7df2ff005ca791cf3c81483f8427cd4c1d9c47a69b0e9`. Real Chrome loaded product title and new module, verified CRLF quote/offset.
- User path: project page → page layout → a layout with local text slots → select original paragraphs → optional explicit emphasis → select phrase/style → confirm mapping. Reference comparison shows source page/component/region candidates only for new version-marked semantic tasks; previous tasks/results are not upgraded.
- Boundaries: source regions are pending suggestions, not recognized words. Style is user-derived, not proof of original font/color. Title-only candidates remain comparison-only. Regions currently presented as normalized coordinates and source navigation, not image overlays. No existing private candidate was changed or new same-named candidate made. Neither 3-page nor 87-page real automatic pipeline is claimed passed. Amount remains unknown, not zero; this implementation/test/deploy phase made no model calls.
