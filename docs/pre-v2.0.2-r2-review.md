# Pre 2.0.2 — UI review correction R2

Branch: `pre-V2.0.2`. Reviewed main: `801afcc794b34fa734ba624303ed9552b152407c`. Previous UI commit: `fc59b4f6dbfc2a19ddb7192f88cbe7ad272cdb0b`.

## Corrected scope

The user rejected the implementation's icon/text proportions and always-visible explanatory copy. The approved A/B/C/D prototype remains the visual reference, with additional simplification explicitly requested. Main's image configuration must not be reduced to a single model selector.

- Keep the project header, four model cards and A/B/C/D geometry pairing; no new sidebar or product workflow.
- Restore 29 px project heading, 16 px class labels, 52 × 56 px category tiles / 27 px glyphs at desktop size. Use restrained font weights and a consistent 18 px action glyph in a 40 px target.
- A/B/C/D show letters; complete theme labels remain accessible and available on hover. Folder, add, reorder, delete and refresh actions use icons with complete accessible names and titles.
- Move descriptions and routing policies into explicit click/touch/keyboard help. Keep required fields, unavailable routes, missing-companion errors, revision conflicts and failed reads visible.
- Display a model name once. Preserve route identifiers in the control title/help and provider groups.
- Display save/discard only after editing; keep explicit labelled discard. Hide execution-history details until expanded; show unresolved counts without equating idle with completed.
- Version appears once in the shell footer. Appearance changes still do not write model configuration or restart tasks.

## Main image-route requirements checked

Sources: `docs/comfyui-companion-llm.md`, `src/agent-classes/types.ts`, `image-tools.ts`, existing model/service tests.

- `Comfyui-PIC / Klein` is a tool-backed route requiring an explicitly selected tool-capable LLM. Primary and each fallback keep their own `llm` pair. No borrowing from another Agent class or parent Session.
- Ordinary image API routes stay direct. ComfyUI endpoints, workflow/model files and credentials remain in that DSH plugin's settings. No new configuration fields or server endpoints were invented.
- Retain revision-checked saves and frozen execution/backup snapshots. A missing/removed/tool-valued companion blocks save. The UI cannot prove tool-calling capability or ComfyUI reachability from the current catalog.
- The prior live-component preview omitted Klein despite the production picker existing. This preview now contains tool/direct/fallback/missing-companion/history scenarios.
- Fix promotion of a configured Klein fallback to primary so it retains its already explicit companion rather than dropping `llm`.
- Protect the known Klein identity in non-image and companion pickers even when a legacy catalog omits `imageTool` metadata.
- Execution details now expose saved and actual paired LLMs and the frozen route chain; missing actual evidence is never invented.

## Verification and reproduction

New regressions: `tests/pre-v202-review-r2.client.spec.tsx`. Existing UI tests were changed only to follow explicit help, condensed copy and the single shell footer.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
node scripts/build-ui-review-v202.mjs
```

The preview builder uses the existing pinned `tsdown`, bundles the actual React components, and writes `work/ui-review-r2/pre-V2.0.2-R2-preview.html`. No network assets or live DSH requests. Simulated controls are clearly outside the plugin UI. Changing a demo scenario resets only demo model data.

Browser checks cover paired theme geometry, missing and saved Klein companions, promotion, on-demand help, execution evidence and narrow panels. Host-side integration remains based on DSH `0.1.5-rc.1`; a real user DSH/ComfyUI session is still required for installation and real generation acceptance.

No main merge, package publication, deployment, session restart, credential change or live model request is authorized by this development delivery. Replace earlier 2.0.2 candidate artifacts by exact commit/hash, not by package version alone.
