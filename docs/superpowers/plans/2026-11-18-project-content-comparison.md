# Project Content Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Compare candidate layouts using the same current project page and authorized images without saving.
**Architecture:** Pass frozen project/draft/page identity from canvas into the existing library. Reuse project layout-preview for saved candidate versions; keep independent/sample and unsaved-edit states explicit. Existing selection/save and annotation flows remain.
**Tech Stack:** Existing browser ESM, native renderer, Fastify, PostgreSQL/Chromium fixtures; no new dependency.
**Spec:** docs/superpowers/specs/2026-11-18-project-content-comparison-design.md

## Global Constraints
- No external model, new image upload system, permission expansion or automatic content mapping.
- Browsing and closing make no state mutations. Only existing explicit selection/save actions may persist.
- Missing fields, images or capacity are not disguised as successful own-content previews.
- Thumbnail matrix, double-click large preview, annotations and developer controls remain.
- Deploy current decoration release independently before this feature; never include unfinished work.

## Review Focus
- Changed draft or project cannot display a stale successful preview (Tasks 1–2).
- A different resource/version or unsaved edits cannot be silently substituted (Tasks 1–2).
- Failure text must be readable but safely rendered, not executable HTML (Task 2).
- Multiple/no selected project pages must not imply a whole-document realistic preview (Task 2).
- Private images remain under existing project access checks; preview makes no writes (Task 3).

### Task 1: Own-content preview routing contract
Files: new `web/app/src/layout-library/project-preview-ui.js`; new `web/app/tests/layout-project-preview.test.mjs`.
Interfaces: `createProjectLayoutPreview({request,context,resource,isCurrent})` returns async `(layoutId,{signal}={}) => preview`. Context `{projectId,draftId,pageId}`, resource `{id,version,hash,package}` are copied/frozen. Calls `/projects/:projectId/layout-preview` with `{draftId,pageId,scope:'local',resource:{resourceId,version},overrides:{layoutId}}`. `isCurrent()` must still hold before and after response; response draft/page identity must match. It never makes save/update calls.
- [ ] RED tests exact request, abort propagation, wrong returned identity, stale context, unknown layout ID and missing identity fail; sample calls absent.
- [ ] Run `node --test web/app/tests/layout-project-preview.test.mjs`, expected failing missing helper.
- [ ] Implement smallest helper and explicit safe errors; no cached successful content across identity changes.
- [ ] Rerun expected all pass; commit owned files.

### Task 2: Existing matrix and large-preview integration
Files: `canvas-ui.js`, `ui.js`, `matrix-ui.js`; tests `layout-matrix-ui.test.mjs`, `layout-matrix-ui.browser.mjs`, new project preview UI fixture as necessary.
Interfaces: `mountLayoutLibrary.open({onPick,previewContext?})` consumes Task1 context; canvas passes only single current page identity. Preview mode defaults to current-page when context supplied; independent library remains sample. Unsaved edits visibly block real-resource preview rather than silently render a different version. Expose clear mode label. Errors use textContent in cards and large dialog.
- [ ] RED tests current-page label and endpoint, same renderer thumbnail/large, independent sample, unsaved edit guard, reopen/close cancelling in-flight work; double-click/annotation unchanged.
- [ ] Minimal integration with existing controls, explicit single-page scope and sample fallback only by visible mode/state.
- [ ] Run helper/matrix/canvas tests and browser fixture; expect pass including escaped failure text and stale response suppression. Commit.

### Task 3: End-to-end and release
Files: `web/app/tests/layout-library-ui.browser.mjs` or separate `layout-project-content.browser.mjs`; CI gate if separate; verification note.
- [ ] Real disposable PostgreSQL/project fixture with genuine test images: same page content in two compatible candidate layouts; screenshot and inspect both. No fixture substitution after requesting current-page mode.
- [ ] Assert inaccessible image/project rejection, required mapping/capacity failure visible, cancelled/repeated browsing creates no resources/bindings/versions. Verify explicit selection path still enters existing mapping/save flow.
- [ ] Verify matrix double-click and annotations regressions; run full CI and independent review. Preserve deployed data and 4320 entry with backup.

## Execution ledger
- Root explicitly approved the existing-project read-only approach and continued execution without another design confirmation.
- Pre-flight: Task1 produces the renderer consumed by Task2; context contains IDs only and `isPreviewCurrent` is a separate callback so cloning never serializes functions. Task3 consumes the existing library `open` options and canvas handoff.
- Task1 implementation committed5c7d9aa; RED missing helper → 7/7 contract tests. Endpoint does not return resource hash, so validation does not falsely claim response-hash verification; immutable version is requested and frontend selection/hash consistency is checked.
- Task2 implementation: valid JSDOM fixtures demonstrated baseline failure (sample calls despite project context; dirty resource still rendered), new routing/labels/dirty guard now pass. Three integration, six matrix, seven helper tests green; broader annotation/content adaptation/mapping regressions total38/38 and Webbuild pass. Closing/reopening aborts old requests and cannot mount old content. Real PG/Chrome/full CI remain required in Task3.
- Ruling: multiselection or no current project page stays explicitly labeled sample mode; the interface does not pretend a single preview proves full-deck compatibility.
- Review fix: JSON and invalid-form edits previously left old real-content thumbnails/large preview alive. New input regression RED→GREEN; project preview now immediately invalidates and closes independent of debounce/validity.
- Review fix: opening the library from manual-override mode previously previewed a local candidate but saved manual-only changes. New canvas handoff regression RED→GREEN. Selecting a library resource now explicitly selects local binding; notice explains existing manual overrides remain and still affect appearance. Store local mutation preserves manual data. Task3 must compare actual preview and selected rendering with these overrides, not merely assert notice or scope.
- Latest acceptance extension: verify same resource version+content across preview and existing platform generation/declared export paths, with short/long content. Preserve independent/shared-library behavior and source permissions; do not claim untested skills/export formats.
- Independent review found a release blocker: explicit build copy list omitted new project-preview-ui.js, so build exit0 hid a browser module404. New test recursively reads actual built layout entry static dependencies; reproduced missing module then passed after adding copy entry. Real-dist Chrome network verification still required before release.
- Cloud full `npm test` was run:1055 tests,983passed,56failed,16skipped. It is NOT a suite pass. Failures include PostgreSQL socket EPERM, Chrome socket restrictions and existing Poppler cancellation /proc visibility limitations. Full log `/tmp/project-comparison-full-web.log`; real supported PG/Chrome CI required to resolve environment-dependent verification.
- Real Chrome found another blocker: valid48×45 slot with below-limit text had scroll64×1149 and was silently clipped. Added mounted native preview fit verification after fonts/images/two frames, bounded10s, plus per-candidate pending/passed/failed state. Actual-content choice remains disabled until selected candidate passes; failures replace the misleading crop with an explicit message. Large preview repeats verification. Exact current layout ID is always passed on selection, not automatic matching. Synthetic DOM regressions pass; real Chrome counterexample must be rerun before declaring resolved.
- Independent review found a first-use deadlock: text-slot preview correctly failed without mapping, but fit-gated selection was the only way into mapping. Added a distinct ‘配置原文映射’ action for text-slot candidates. Canvas `mappingOnly` opens the existing mapping editor even when fields already exist, never automatically saves; cancellation is read-only. Explicit mapping submission still uses the existing server geometry preflight. Unit missing-map case RED→GREEN and no-autosave path verified; real PG/Chrome positive/negative mapping verification remains pending.
- Mapping lifecycle review found cancellation/reopen races. UI now aborts the old handoff and checks its generation before closing or reporting errors; canvas checks lifecycle/panel identity after awaits so stale operations cannot mount an old table or overwrite/close a newer panel. RED→GREEN cancellation/late resolve/late rejection regressions; focused suite55/55. Successful open-table save remains independent of closed library lifecycle.
- Task3 real PG/Chrome final fb9ace7 passed, including legal review then first mapping, cancellation no-write, capacity/geometry negative and successful paragraph mapping. Manual preview/generation/HTML export equality verified using lawful native-v1 fixture; V3 readonly comparisons separately verified. Independent final P2 review32/32 no blockers. Complete CI/release pending.
- Final: minor (deferred): existing capacity rejection exposes English CONTENT_FIT code; behavior fails closed but localization remains polish.
- Task3 complete: remote bb2a1d0 full CI1072/1072 Web plus actual PG/Chrome,11 evidence hashes, final screenshots inspected. Approved exacttree deployed as c793c46e at original4320 after maintenance+backup. Live readonly verifies missing mapping rejects without sample substitution and standalone samples work; no business mapping was submitted. Actual successful business-page fitting remains unclaimed.
