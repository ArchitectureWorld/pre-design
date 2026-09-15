# Workspace-first Pre Entry Implementation Plan

> **Execution:** Follow Superpowers TDD and verification. Work only on `feat/pre-v2.0.1`; do not create a side branch.

**Goal:** Make Pre visible and usable from the selected DSH Workspace before the first chat prompt, remove all project-start text inputs, and initialize/sync `原始资料/` into the canonical Pre project structure without fake `hello` messages.

**Architecture:** Treat the DSH Workspace as the project identity/root. Register a root-scoped Pre global panel through DSH `sidebar.panellist` + keyed `main`, while retaining the Session header action as a shortcut. Project initialization happens against the Workspace path; command execution may create/reuse a blank Session programmatically when an Agent-bound command needs a Session, but never emits synthetic user content. `原始资料/` is external/user-owned; standardized copies are written only through existing `source-materials/` ownership rules.

**Compatibility baseline:** Compile the client extension against a DSH release that exposes root `main` and `sidebar.panellist` (0.1.5-rc.2 baseline). Keep Pre's own project/contract version at 2.0.1 / Presentation Standard Project Directory 0.1.0.

---

## Task 1 — Lock root-panel behavior with failing client tests

**Files**
- Modify: `tests/browser-plugin.client.spec.tsx`
- Modify: `tests/direct-start.client.spec.ts`
- Modify: `tests/direct-start-workspace.client.spec.ts`
- Modify/delete obsolete expectations: `tests/workspace-form-draft.client.spec.tsx`

**RED assertions**
1. Client registers `main` keyed panel and matching `sidebar.panellist` entry named `前期策划` at root scope.
2. Existing `conversation.session.header.actions` shortcut remains.
3. Workspace-first view can render with no formal Session.
4. No statement/project-name input exists.
5. Direct start accepts Workspace identity/path rather than `statement`.
6. New project display name is derived from Workspace basename.
7. No fake prompt/message is sent as part of startup.

Run the focused client tests and confirm they fail for the expected missing behavior.

## Task 2 — Implement Workspace-first client surface

**Files**
- Modify: `src/client/index.tsx`
- Modify: `src/client/PreplanningLauncher.tsx`
- Modify: `src/client/PreplanningProjectForm.tsx` (convert/remove form behavior)
- Add if useful: `src/client/PreplanningWorkspacePanel.tsx`
- Modify: `src/client/direct-start.ts`
- Remove/simplify: `src/client/workspace-draft.ts`
- Modify: `package.json`
- Regenerate: `pnpm-lock.yaml`

**Implementation**
1. Register root `main` panel with key `preplanning` and `sidebar.panellist` entry with the same id.
2. Read selected/current Workspace through DSH root-level Workspace projection/API rather than `sessions.list[sessionId].cwd`.
3. Keep Session header button as a shortcut to the same Pre experience.
4. Make the entry zero-input: project title comes from Workspace folder basename.
5. Replace statement-driven `startDirectPreplanning` contract with Workspace-driven start.
6. If Agent command execution needs a Session, reuse/create the Workspace's blank Session via DSH's Session/Workspace API; do not send synthetic user text.
7. Upgrade only the DSH dependency baseline needed to compile against the official root-panel APIs; avoid unrelated refactors.

Run focused client/type tests until GREEN.

## Task 3 — Lock `原始资料/` ingestion with failing tests

**Files**
- Add: `tests/workspace-source-inbox.spec.ts`
- Extend: `tests/workspace-project-root.spec.ts`
- Extend relevant presentation workspace ownership/transaction tests.

**RED assertions**
1. Missing `原始资料/` is created safely.
2. Empty inbox produces a machine-readable external-source blocker / waiting state, not approval UI.
3. Recursive files are copied/registered under canonical `source-materials/` through the existing material registry.
4. Source bytes in `原始资料/` never move, mutate, or delete.
5. Duplicate contents deduplicate by SHA-256/stable material id.
6. Repeat sync is idempotent.
7. Unknown Workspace paths and `layouts/**` remain untouched.
8. Unsafe/symlink escapes are rejected or skipped under existing path security rules.

Run the focused ingestion tests and confirm RED.

## Task 4 — Implement safe source inbox initialization/sync

**Files**
- Modify existing pipeline only as needed:
  - `src/presentation/material-plan.ts`
  - `src/presentation/material-registry.ts`
  - `src/presentation/standard-project-service.ts`
  - `src/presentation/workspace-project-writer.ts`
  - related command/service wiring
- Add one focused inbox scanner/service file only if it keeps ownership boundaries explicit.

**Implementation**
1. Resolve `${workspaceRoot}/原始资料` as external input.
2. Create directory if missing; never claim it as a Pre-managed directory.
3. Recursively enumerate regular files without following escaping symlinks.
4. Feed files into the existing Contract-backed source-material pipeline; preserve bytes and relative provenance without machine absolute paths in persisted state.
5. Copy, never move; never delete historical standardized materials just because an inbox file disappears.
6. Return material count and `waiting_for_source` / `blocked_external` semantics for an empty inbox.

Run ingestion + presentation-standard + workspace-safety tests until GREEN.

## Task 5 — Wire zero-input automatic startup

**Files**
- Modify command/service layer as required by existing architecture.
- Update client status copy/tests.

**Flow**
`selected Workspace → probe binding → recover or initialize from Workspace basename → ensure/sync 原始资料 → automatic mode → run`

If no usable source exists, initialize the canonical project but remain in `blocked_external`/`等待原始资料`; do not start an approval workflow.

## Task 6 — Full verification and review

Run:
- `pnpm typecheck`
- focused client tests
- source inbox tests
- `pnpm test:presentation-standard`
- `pnpm test:workspace-safety`
- `pnpm test:automation-invariants`
- `pnpm test`

Then inspect the final diff for:
- no Proposal/manual-approval regression;
- no fake `hello`/synthetic user message;
- no ownership expansion over unknown Workspace files;
- no accidental `presentation-tools` change;
- no branch change;
- deterministic same-Workspace project recovery.

Only after fresh verification may the implementation be called complete.