# 通用汇报图像质量实施计划

> Approved design: ../specs/2026-09-19-report-image-quality-design.md
> Execution: existing feat/pre-v2.0.1 checkout; no commits, worktree moves, or workflow reruns.

## Scope and invariants

Implement the eight approved requirements in reusable pre-design code. Preserve the existing dirty tree, manuscript SHA256 8dab750be4caaad992bdd45bd5eaae06ca7e2720de237b59dbeffee24ed7750c, revision 103, 57 completed workflows, prior executions and previous delivery artifacts. New evidence lives in work/report-image-quality/. No real text/review model call before reconciling the exhausted authorization; no automatic renewal. Use images as needed after demand and allocation are correct. HTML, 16:9, <=15% text/table-only pages; no fixed page count.

## Shared interfaces and ownership

Controller owns src/visual/image-policy.ts and ClientVisualAsset.imageIdentity/imageQuality fields. Image identity exposes originalId, fileSha256, pixelFingerprint, derivedFromSha256 and verification status; confirmed derivatives share originalId. Similarity alone is a candidate, not automatic identity. Image quality ties actual pixel review to image hash, brief hash, usage and placement. Unreviewed imagery must never be called reviewed.

| Tasks sharing an interface | Producer | Consumer / ruling |
| --- | --- | --- |
| 1 and 2 | identity service + image-policy types | layout reads imageIdentity; final physical-page audit counts families including cover |
| 2 and 4 | layout media bounds / fit | review validates final placement and caches by placement hash; uncertain subject => contain |
| 3 and 4 | case scale/evidence + source assets | source-first selection; real plans remain intact and do not masquerade as project site |
| 1 and 4 | original identity | allocation enforces max 2, same-page max 1; replenishment receives explicit gaps |

## Task 1 — original identity (parallel worker)

Own src/visual/image-identity.ts and tests/image-identity.spec.ts only. Implement decoded-pixel exact/rescale/compression identification and crop/annotation candidate detection with conservative confirmation. Persist derivation provenance; avoid merging independent same-style images. Tests first: renamed/encoded/resized same image, crop, annotated derivative, similar independent scene, corrupted bytes. Report red/green results. No model calls or project writes.

## Task 2 — composition, flow and captions (parallel worker)

Own src/report/regular/layout.ts, stage-connections.ts, render-html.ts, visual-audit.ts and corresponding layout/flow/HTML tests. First write failing tests for repeated stage image, narrow square crop, intact analytical composite, long centered translucent captions and sequential/branch graphs. Prefer image-aware arrays/pagination; crop keeps >=80% area and all verified subjects. Intact analysis; uncertainty uses contain. Explicit sequence => numbering and placement, no redundant arrows. Parallel is not numbered as chronology. Alpha .35, opaque readable text. Physical page audit counts source families, excludes unrelated/unreviewed images from compliance, preserves existing stage scope check. Coordinate audit strictness with controller pipeline integration.

## Task 3 — sourced point/line/area cases (parallel worker)

Own src/report/case-studies/* and tests/report-case-studies.spec.ts. Maintain 3–5 real built cases and 3–4 pages each. Add sourced area/line/point coverage and media purpose. Reject/replenish missing overall and circulation evidence; never invent geography, scale or routes. Use true project scale. Existing catalogs can stay as historical candidates, but cannot be silently certified for new coverage. Tests first: complete case, missing area/line evidence, unsupported claims, repeated gallery original. Source-only web research allowed; no model calls. Analysis derivations and photo sources remain in provenance, not caption disclaimers.

## Task 4 — demand, inspection and source acquisition (controller)

Own visual/image-policy, per-slot scene demand, report-scene-visuals, page-visual-fill, material registry, agent-classes, AgentClassPanel and integration files. Replace topic fan-out with independent briefs; topics are retrieval hints only. Add globally configurable 素材审图 using DSH live catalog and native child image input, strict structured output, cancellation, finite attempts and separate execution evidence. Preserve authorization accounting: review is a model task, failures consume reservation. Record route capability only after a real image challenge. Cache keyed by image + brief + placement. Domestic positioning from actual project brief only, not reference text. Add source-first acquisition with original download/provenance, size limits, hash/decoded dimensions/effective display resolution and same quality policy for web/AI. Missing or rejected materials return finite gaps instead of indefinite generation.

## Task 5 — integration and acceptance (controller)

Run focused regression tests, typecheck/build and full required suite. Review all changed domains against design; record findings and fixes in work/report-image-quality/progress.md. Determine real model authorization/capability needs only after no-model checks. Populate genuine sourced assets, inspect actual pixels, allocate and export new HTML via normal code. Browser audit all physical pages for image families/crop/ratio/broken images and representative composition. Preserve old delivery, deploy with backup and no active RPC; verify listener, native business outcome, manuscript/workflow history hashes. Do not call the task complete on gates/tests alone.

## Plan review

Ownership boundaries checked; shared types are controller-owned, workers do not alter global deployment or runtime. Layout can finish independently; final audit strictness is enabled only with a wired replenishment and review path. Case authoring cannot invent missing evidence. Existing text authorization does not cover real review by changing class name. Revisions of scope are recorded, not implicit.
