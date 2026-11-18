# Versioned component visual semantics implementation plan

> For agentic workers: execute task-by-task with independent review before integration.

**Goal:** Carry image-observed list markers, emphasis regions and caption presence into the existing Reference Bundle and native reusable layout chain, without claiming text transcription or visual acceptance.
**Architecture:** Add a separate strict v1 semantic-evidence envelope keyed by exact source and component IDs. Preserve every existing observation/adaptation prompt, schema and checkpoint unless a new task explicitly opts into a new version. Feed reviewed semantic evidence into deterministic presentation proposals, never source text or permission grants.
**Tech Stack:** Existing Node ESM, Zod, node:test, native renderer and V14 orchestration.
**Spec:** Parent-approved visual semantics → adaptation → new upload/binding/export route; project authority docs/architecture/REFERENCE_DESIGN_INTEGRATION.md.

## Constraints / approach
- No new product entrance, task system or resource library. V14 and Reference Bundle remain authoritative.
- Alternative silently expanding old schema rejected: it changes checkpoint identity. Alternative manual-only style stays supported but does not satisfy automatic extraction.
- Original restricted PDF is not read. Only authorized page images may support later model observations, after a bounded budget is approved.
- Unknown remains unknown. Observed image appearance is not a native font, transcription, visual acceptance, sharing permission, or proof of editable source.
- No automatic quote spans: emphasis rectangles cannot identify exact project characters. Require later explicit text mapping and quote validation.

## Review focus
- Cross-page/source/component forgery rejects.
- Unsupported kind/feature combinations reject.
- Extra text, rights, external URLs and version values reject.
- Unknown/absence does not silently discard user captions or text.
- Old contracts and source objects remain byte-stable.

## Tasks
- [ ] 1. New reference-component-semantics.mjs and tests: validate strict envelope with version/source, unique component IDs; bounded normalized emphasis regions within source component. All components include explicit marker/emphasis/caption status as applicable. Missing observations remain unknown in proposal audit.
- [ ] 2. Deterministic proposal output: known disc body markers and absent image captions yield explicit derived presentation hints only. Emphasis regions remain unmapped-to-text; unknown/unsupported values stay review-required. No automatic package mutation.
- [ ] 3. Coordinate V14 integration file ownership; add explicit task version, checkpoints and model contract without changing old input identities. Only opt-in new tasks.
- [ ] 4. Single synthetic upload→private candidate→review gate→explicit content binding→export integration test; then independently review. Actual authorized image/model acceptance needs separate bounded budget. Do not create more demo candidates.
