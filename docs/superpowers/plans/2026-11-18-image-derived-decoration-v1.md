# Image-derived decoration v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reconstruct reusable background geometry from PDF/image guidance using bounded, versioned primitives.
**Architecture:** Pure schema/renderer plus existing image-guided adaptation. New tasks opt in explicitly; legacy schemas/prompts/caches stay exact. No extra inference stage.
**Tech Stack:** Node ESM, Zod, existing SVG sanitizer, PostgreSQL/Chromium fixtures.
**Spec:** docs/superpowers/specs/2026-11-18-image-derived-decoration-v1-design.md

## Global Constraints
- No native extraction of copy-restricted PDF content, new outside AI calls, arbitrary SVG, source text or image bytes in decorations.
- Existing production resources and user content remain unchanged; no duplicate demonstration candidates.
- Shapes remain background-only and map actual same-page decoration IDs. Unknown versions fail closed.
- Keep every current contrast, capacity, overflow, ownership and source-identity guard.

## Review Focus
- Stroke/rounded bounds must stay inside observed components (Task 1).
- Nonrectangular text overlap must not silently weaken contrast checks (Task 1).
- Same component IDs on different pages must not cross-bind (Task 3).
- Old prompts and successful caches must not be relabeled as upgraded (Task 2).
- Source-shape claims and supplier success must not be fabricated by controlled fixtures (Task 3).

### Task 1: Bounded primitives
Files: new `web/app/src/layout-library/component-decorations.mjs`; modify `component-layout-adapter.mjs`; new `web/app/tests/component-decorations.test.mjs`.
Interfaces: `componentDecorationSchema(version)` returns a Zod array schema; `renderComponentDecorations(mapped, canvas, version)` returns sanitized-compatible SVG primitives; `isOpaqueRectDecoration(d, version)` is conservative for contrast handling. `version` undefined is exact legacy; 1 is new grammar.
- [ ] RED legacy strict schema and byte-identical rect/diamond output; rounded rect, ellipse and four line directions accepted only in version 1; unknown shapes/version and unsafe fields rejected.
- [ ] Implement bounded numeric radius/stroke, in-bounds output and same observed-component lookup; retain fail-closed nonrectangular/partial text overlaps.
- [ ] Run new tests and existing component adapter tests; require zero failures; commit only owned files.

### Task 2: Versioned pipeline integration
Files: `component-upload-workflow.mjs`, `native-reference-workflow.mjs`, `reference-workflow.mjs`, `conversations.mjs`; tests `component-upload-integration.test.mjs` plus new exact-legacy contract regression.
Interfaces: `componentAdaptationSchema(version)` and `adaptComponentProposal({...args, decorationVersion})`; new task marker `referenceDecorationVersion:1`, frozen on retry. Legacy input property order and contract remain unchanged.
- [ ] RED new tasks retain version, old tasks remain absent, invalid versions fail before inference; new schema reaches existing adapt stage and generated primitives reach final package.
- [ ] Integrate new grammar without extra stage, record image-guided-derived provenance and unsupported-background limitations, not source-vector extraction.
- [ ] Verify old prompt/schema/checkpoint identity and current image/page hashes with targeted tests; commit.

### Task 3: Cross-page evidence and release
Files: new `web/app/tests/component-decoration-reuse.browser.mjs` and fixture(s) under `web/app/tests/fixtures/`; current CI check script if needed.
- [ ] Add three synthetic pages with source-scoped repeated IDs: chapter band/line, data separators/ellipse, rounded cards. Explicitly label synthetic data and manual image-estimate comparisons.
- [ ] Test replaced short/medium/long text and differently shaped synthetic images; assert slot identity/source isolation, actual pixels/shape presence, no clipping/obscuration and intentional overflow rejection. Source observations remain immutable.
- [ ] Independent review, real PG/Chrome and full CI; inspect screenshots. Preserve runtime/data backup and original 4320 deployment only after diff/active-task checks. No new production candidate.

## Execution ledger

- Root approved this minimum increment as one step toward full visual reconstruction, not complete delivery.
- Task 1 implementation complete: 17/17 primitive/adapter tests. Ruling: radiusRatio uses the short side; line strokeWidthRatio is >0 and <=0.25 of the short side; no stroke on filled shapes. This keeps ordinary opaque rect the only text-supporting shape and avoids ambiguous contrast.
- Task 2 implementation complete: 28/28 workflow/admission tests; combined Tasks 1–2 45/45 and Web build pass. Frozen legacy contract, JSON schema, entire prompt and checkpoint were captured from unmodified d3676bd before implementation, then compared exactly. New version reuses upstream stages, replaces only adapt, and its retry makes zero new model calls.
- Ruling: “explicit opt-in” means the user selects the existing component-v3 extraction flow, and the server freezes decoration version 1 for that new task. It is not a claim the user separately approved a decoration option. Old continuation/retry remains unchanged.
- Task 3 cross-page browser/visual evidence and final independent review remain in progress. No deployment or new supplier call has occurred.

Line stroke width uses a short-side ratio greater than 0 and at most 1, allowing thin observed rules to retain full thickness. Half-stroke endpoint insets and butt caps keep paint within bounds; coincident final endpoints are rejected rather than rendering an invisible rule.
- Latest user priority (2026-11-18): ordinary users must intuitively understand the expected result and compare/select designs. Internal layout structure and exact source reconstruction are not the acceptance goal. Keep editability, approximation and implementation control available for the developer. Finish this bounded reviewed increment, then prioritize the existing thumbnail matrix → double-click large preview → own-content replacement → comparison/annotation experience; do not substitute component counts or more structural UI for visible usefulness.
