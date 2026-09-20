# Client planning report implementation plan

> For agentic workers: use subagent-driven-development for independent case-study and diagram tasks; the root agent owns integration and layout. Preserve all existing edits; no commits, branch changes, paid DSH text calls or workflow reruns.

**Goal:** Generate reusable client-facing planning reports with concise presentation copy, regular image compositions, clear diagrams, 16:9 single-page viewing and 3–5 evidenced built-project comparisons.

**Architecture:** Keep the frozen professional state and original manuscript intact. Apply a versioned, deterministic presentation-copy projection to both cached and newly generated manuscripts, while rejecting prohibited copy in new model outputs. Build one physical page plan consumed by HTML, PDF and PPTX. Add separately fingerprinted case-study evidence and deterministic comparison pages, without invalidating or rewriting the seven source chapters.

**Tech stack:** TypeScript, Vitest, HTML/CSS/SVG, PptxGenJS, existing Edge PDF exporter and DSH package deployment.

**Spec:** User's five requirements in the current conversation, recorded below.

## Global constraints

- User-visible copy must not contain image/material disclaimers such as 意向, 拟议关系示意, 非现场实景, 不代表实际地理位置. Preserve evidence and qualifications in the separate source record; do not turn proposals into assertions of existing built conditions.
- Supported regular compositions: full background; left/right/top/bottom half background; horizontal/vertical multi-image arrangements. Maps and diagrams use contain; photos may use cover.
- Default single-page canvas is 16:9 (13.333333 by 7.5 inches), including browser and print. Future A3 is optional and must reflow, not stretch.
- Include 3–5 verified completed/operating comparison projects, each with at least two distinct supported similarities. Two different dimensions are not required. A project without enough matching evidence must fail explicitly, never fabricate examples.
- Current 10-task DSH text grant is exhausted. Changes and evidence preparation must cause zero new text-model calls. Reuse 13 accepted concept images and existing source materials.
- Keep revision 103, project identity, professional state, source manuscript, existing delivery and execution history. Back up before deployment and deliver to a new directory.
- No more than three concurrent sub-agents. Independent workers own disjoint files and must accommodate other edits.

## Task 1: Reusable case studies

Owner: case-study worker. Files: new src/report/case-studies/* and tests/report-case-studies.spec.ts only.

Interface: `prepareCaseStudies(input: FrozenProjectInput, workspaceRoot?: string): Promise<ReportCaseStudies>`; `caseStudyPages(cases: ReportCaseStudies): PlanningManuscriptPage[]`; `caseStudySources(cases: ReportCaseStudies): PlanningManuscriptSource[]`. Avoid extending global types in the worker; root integrates the returned data.

- [x] Record real source URLs, publisher, access date, supporting excerpts, hashes and delivery status for a small reusable catalog; independently verify live source content.
- [x] Select 3–5 matches using supported project signals, validate at least two distinct similarities, separate verified facts from project-specific recommendations, and persist evidence separately from source manuscript.
- [x] Emit client-ready comparison pages and source entries. Add positive and negative tests for evidence, duplicates, similarity count and no model calls.

## Task 2: Diagram rendering

Owner: diagram worker. Files: src/presentation/manuscript-diagrams.ts and tests/manuscript-diagrams.spec.ts only.

- [x] Preserve existing public API, page bindings, node/edge identities and content hash behavior.
- [x] Replace sparse grid rectangles with compact readable SVG composition, consistent typography, routed arrows, clear flow hierarchy and no visible material disclaimers.
- [x] Verify every node/edge remains represented, escape user text, avoid label overlap, and test deterministic output and binding safety.

## Task 3: Copy policy and physical page plan

Owner: root. Files: src/report/manuscript/*, client-types.ts, planning-page-layout.ts, render-planning-page.ts, conditional-report.ts, render-html.ts, render-print-html.ts, render-pptx.ts, conditional-package-service.ts, projector files and focused tests.

- [x] Add one shared prohibited-visible-copy policy for new generation, editorial output and deterministic cached-manuscript projection. Store removed qualifications in source notes.
- [x] Keep original policy/source fingerprints valid; add presentation version to package cache identity instead of silently initiating seven-chapter rewriting.
- [x] Create shared page geometry and regular media arrangements, paginate complete text and tables, use image-free continuation pages and dedicated diagram pages.
- [x] Make all three renderers consume identical physical page content and image geometry; show every planned asset; avoid shrinking body text to hide overflow.
- [x] Add single-page browser navigation, keyboard controls, page count, hash location and proportional scaling.

## Task 4: Integration, deployment and visible acceptance

Owner: root, with bounded independent review when implementation is ready.

- [x] Wire prepared cases into both formal/conditional report sources and enforce count at export; preserve all source-state and model-budget protections.
- [x] Update automation prompt to monitor the new composition target without restoring an obsolete manuscript hash.
- [x] Run focused copy, case, diagram, projection, page-plan and artifact tests, typecheck/build; run broader suite once unless new failures require more.
- [x] Export revision 103 without text-model dispatch. Verify identical page sequences, 16:9 dimensions, forbidden copy absent, image count, text completeness and no overflow with browser/PDF/Office checks.
- [x] Back up and deploy; inspect actual rendered representative pages, page navigation and downloaded outputs; deliver new files with accurate implementation/test evidence.

## Progress

- Implementation, full tests, native deployment and visible acceptance complete. See docs/regular-report-verification-2026-09-18.md for source paths and evidence.
- Ownership scan: worker files are disjoint from each other and root. Case interface is additive; diagram interface remains unchanged. Root owns all integration files.
