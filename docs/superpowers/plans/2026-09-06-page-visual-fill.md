# Page Visual Fill Implementation Plan

> **For agentic workers:** Use test-driven implementation and task-scoped review. The user approved the plan and the three visual samples; execute without another design gate.

**Goal:** Missing-page visuals can be explicitly planned, generated or imported, adopted, and synchronized with honest provenance and stable page bindings.

**Architecture:** Reuse the existing visual generation/adoption service and standard project material pipeline. Extend the explicit material registry to distinguish originals from generated/tool assets. A bounded page-visual service/command coordinates user-requested fills; normal auto-sync remains generation-free. Rendering code consumes the existing pageAssets contract.

**Tech Stack:** TypeScript, Vitest, existing DSH commands/governance, Presentation contracts.

**Spec:** User-approved sequence: real source first, licensed general images or AI concepts when needed, explicit provenance, project asset library then page library then layout/export. No overwriting hand layouts. Three sample AI concepts accepted on 2026-09-06.

## Global Constraints

- Keep existing branch; never create a branch or force push.
- Preserve original project state, 57 completed work items, hand layouts and review history.
- Do not change model configuration or fixed VisualAgent model; do not call a paid model from tests.
- Every generated/concept image has a visible AI-concept disclosure. Source/derived/tool-generated assets retain their different origins. External Codex image_gen images use the existing generated_by_tool origin, not source_material or a false claim of Pre generation.
- Real maps, statistical values, legal redlines, current-site photos and approvals must never be fabricated. General images retain source and licensing details.
- Exact findingId pageBindings only for fill outputs; no chapter-wide fallback.
- Ordinary sync/build never generates images. Explicit generation is idempotent for a page content/style brief, including repeat requests and existing adopted candidates.
- Missing, invalid or cancelled results are reported, not silently marked covered. Do not replace existing imagery or hand layouts by default.

## Task 1: Page visual fill and provenance

**Ownership:** `src/presentation/material-registry.ts`, a new `src/presentation/page-visual-fill.ts` (and one small persistence helper if warranted), command wiring in `src/commands/register.ts` and `src/index.ts`, `src/visual/agent.ts` only if needed for candidate reuse, generated caption in `src/report/source.ts`, focused tests and `docs/presentation-material-registry.md`.

**Consumes:** `FrozenProjectInput`, `PresentationAdoptedAssetInput`, `preparePresentationMaterials`, standard project stable finding/page IDs, existing `VisualAgentService.generate/adopt`.

**Produces:** A user-visible `preplan-visual-fill` command with a read-only plan mode, an explicit single-page generate mode, and an adoption mode. Reuse the existing generated-assets pipeline with persistent page association; registry also accepts explicit adopted external images/diagrams with provenance.

- [x] Write focused failing tests: external AI picture stays out of source-materials and exports with generated_by_tool + disclosure; a generated picture binds only its named finding; a CAD/reference file does not count as covered; duplicate requests reuse candidate/adopted output; changed brief gets a new task identity; unknown finding and invalid source/licensing fail before state changes.
- [x] Run `pnpm exec vitest run tests/presentation-page-visual-fill.spec.ts tests/presentation-material-registry.spec.ts --maxWorkers=1` and record the expected RED evidence.
- [x] Extend registered material entries with optional explicit provenance (backwards-compatible default original). Generated assets do not create a SourceMaterialRecord. Validate all required provenance fields and write disclosure into displayName/method so current consumers show it.
- [x] Implement a pure missing-page plan derived from canonical draft image associations, preserving stable findingId, page ID, title, key message and existing image status. Use the same admissible image MIME/role rules as the export/layout consumers.
- [x] Implement explicit generation/adoption orchestration. Hash page identity + actual page content + prompt + style; persist association, reuse existing candidates/adopted results, reject mismatch/unknown page, report aborted/unavailable generation. Preserve the current fixed model route. No library search or new provider subsystem.
- [x] Wire command entry and status text with honest candidate/adopted/coverage states. Synchronize only after adoption, not after a plan or failed generation.
- [x] Run focused tests, typecheck and the full suite once. Record commands and result counts; inspect diff for unrelated edits. Commit only owned files after tests, do not push or deploy.

## Task 2: Accepted project assets and deterministic diagrams

**Ownership:** external remediation workspace and project visual candidates only; no source modules shared with Task 1.

- [x] Reuse the three accepted samples. Build topic-specific image prompts from the already-reviewed 58-page plan; use restrained approved visual style. Keep public facilities on safe land-side sites.
- [x] Generate only missing topic images; reuse only on semantically related pages with explicit finding bindings. Keep prompt/source/hash metadata and inspect each image.
- [x] Build diagram/data specifications directly from each page's current content. Preserve conditional wording, numerical units and uncertain status. No inferred approval, invented values or misleading totals.
- [x] Create real diagram assets with deterministic native vector rendering; inspect readable labels and clipping. These are information diagrams, not substitutes for requested concept bitmap images.
- [x] Prepare an explicit adopted asset registry in isolation. Cover all 58 former missing pages, retaining existing assets and source gaps. Source material originals stay read-only.

## Task 3: Integration, review and release

- [x] Back up current live project, plugin profile and affected storage before deployment.
- [x] Build standard project in isolated staging from the actual frozen project plus the accepted registry; verify 90 pages, existing text/history preservation, every image in project and page libraries, and exact origin/source metadata.
- [x] Inspect representative layouts and the complete per-page asset/overflow check. Existing manual layouts remain unchanged; new layouts should use adopted imagery and disclose concepts without obscuring text.
- [x] Independently review Task 1 diff and resolve issues. Run final build/typecheck/full tests, package checksum and package-source consistency checks.
- [x] Install tested package into the exact Web profile; restart only its DSH process if needed, preserve Tailscale and the unsent input. Use standard sync without force; verify real API, files and rendered page consumption.
- [ ] Commit delivery changes and push HEAD to the existing original remote branch without force. Verify local/remote commit and installed artifact consistency. Report actual coverage, limits and pending host checks honestly.
