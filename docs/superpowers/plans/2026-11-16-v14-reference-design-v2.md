# V14 Reference Design V2 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans; tasks have separate file ownership and shared interface coordination.

**Goal:** Implement the user-approved P0–P4 reference understanding and migration upgrade and push a reviewable remote branch.

**Architecture:** Bounded source extraction → batched observations → validated Reference Design Profile → declarative V2 composition package → actual rendering and hash-bound human review. Existing V1 packages and project version protections remain supported.

**Tech Stack:** Node 24, Fastify, PostgreSQL, DSH, Chromium, Python/OOXML, MIT PPT Master utilities where suitable.

**Spec:** `docs/superpowers/specs/2026-11-16-v14-reference-design-v2.md`

## Global Constraints

- No production deployment or port/data changes; remote review branch is `codex/v14-reference-design-v2`.
- No source documents or user business content in reusable packages or public repository.
- No arbitrary package HTML/CSS/JS execution. Preserve cancellation, ownership and immutable versions.
- Preserve V1 resource loading and manual override semantics.

## Review Focus

- A later reference page differs from the cover: page order/coverage and evidence must be accurate.
- Models return fabricated page references or invalid JSON mid-pipeline: no fallback template or partial published result.
- A new page contains both figures and tables: content must survive or the app explicitly rejects capacity mismatch.
- A package changes after visual confirmation: stale approval cannot authorize publishing/application.
- One user attempts source previews for another user's shared resource: no original bytes leak.

## Tasks

### 1. Reference extraction and routing
Files: `reference-pptx.mjs` / extractor support, `reference-document.mjs`, `reference-limits.mjs`, parser tests; root owns UI routing and upload persistence.
- [ ] Reproduce default PPTX bypass and parser limitations with tests.
- [ ] Implement bounded PPTX structure + preview extraction using verified upstream code where appropriate.
- [ ] Preserve metadata on upload, expose authenticated preview pages, route PPTX to V14.
- [ ] Run genuine reference files and parser regressions.

### 2. V2 composition contract and renderer
Files: `contract.mjs`, `composition-contract.mjs`, `render.mjs`, `composition-render.mjs`, `assets.mjs`, contract/render tests.
- [ ] Test V1 compatibility, non-16:9, multiple figures plus table, unsupported/omitted content, safe styling.
- [ ] Implement schemas, layout selection, content integrity, reusable export, render components.
- [ ] Extend approved workflow item schemas and material resolver for supported composition content.
- [ ] Run browser measurements and previous native-layout regressions.

### 3. Multistage V14 and design evidence
Files: `reference-profile.mjs`, `reference-workflow.mjs`, `jobs.mjs`, `conversations.mjs`, `skills/layout-reference/**`, pipeline tests.
- [ ] Test batched calls, provenance validation, failure/cancel, no default substitution, profile persistence.
- [ ] Implement extracted inventory → observations → profile → compile with actual stage receipts.
- [ ] Store private analysis separately; keep reusable Profile devoid of source content/paths.
- [ ] Update Skill and downstream binding documentation.

### 4. Comparison and approval
Files: `reference-review.mjs`, `store.mjs`, `routes.mjs`, `ui.js`, `conversation-ui.js`, `ui.css`, `validation.mjs`, review/API/browser tests.
- [ ] Test source-preview authorization, real sample comparison, stale approval and binding gates.
- [ ] Display profile/evidence and source preview alongside selected native composition; provide real-project preview.
- [ ] Persist owner-confirmed review bound to package hash/version; enforce publication/application gate.
- [ ] Preserve legacy V1 workflow and source isolation.

### 5. Integration, review and remote delivery
Files: CI workflows, `docs/reviews/v14-reference-design-v2/**`.
- [ ] Run isolated PostgreSQL, build, relevant/full Web tests and Chromium verification.
- [ ] Review actual project PPTX/PDF privately; commit only reproducible receipts without source bytes.
- [ ] Independent code review, fix material findings and reverify affected gates.
- [ ] Commit, push, verify remote SHA and CI; write Claude review entry point with changes, risks, limitations and reproduction commands.
