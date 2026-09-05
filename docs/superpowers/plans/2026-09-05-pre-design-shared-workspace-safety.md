# Pre-design Shared Workspace Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish Pre Canonical content into a shared Presentation Workspace through projectId-guarded, ownership-scoped, atomic file transactions that preserve `layouts/**` and every unknown path byte-for-byte.

**Architecture:** The existing Workspace writer remains the orchestration boundary. A managed-path policy derives fixed Canonical files plus dynamic paths from the current build and the last successful Pre hash ledger; the transaction module stages, journals, atomically replaces, validates, and rolls back only that exact set. Shared Manifest records that are not in the Pre ledger remain external and are merged only for Contract validation.

**Tech Stack:** TypeScript 5.9, Node.js 24.11.0, Vitest 3.2, `fs/promises`, DSH 0.1.1-rc.2, Presentation Standard Project Contract 0.1.0.

**Spec:** `docs/superpowers/specs/2026-09-05-pre-design-shared-workspace-safety-design.md`

## Global Constraints

- Modify only `feat/pre-v2.0.0`; create no new development branch.
- Do not merge `main`, force-push, or overwrite newer remote commits.
- Pre remains `2.0.0`; DSH remains the only Agent Runtime.
- Presentation Standard Project Contract remains `0.1.0`; do not edit Schema or Schema Set Hash.
- Node.js validation baseline is `>=24.11.0`.
- `layouts/**` is Presentation-owned and opaque to Pre.
- Unknown paths are external and must remain byte-identical.
- Every production behavior change follows RED → GREEN → full regression.

---

### Task 1: Freeze ownership and identity behavior in RED tests

**Files:**
- Create/modify: `tests/helpers/shared-workspace-fixture.ts`
- Create/modify: `tests/presentation-workspace-ownership.spec.ts`
- Create/modify: `tests/presentation-workspace-identity.spec.ts`
- Create/modify: `tests/presentation-workspace-transaction.spec.ts`

**Interfaces:**
- Consumes: `PresentationStandardProjectService.exportProject()` and Contract 0.1.0 validation.
- Produces: a reusable shared Workspace Fixture containing Pre files, `layouts/**`, a third-party root extension, a valid externally owned asset record, and fault-injection hooks.

- [x] **Step 1: Add a byte-level ownership Fixture**

Create a valid Contract project, add Presentation-owned layout files, add `third-party-extension/custom.json`, and add a legal external asset under `assets/other/future-component/unknown.bin` with a matching external Manifest record.

- [x] **Step 2: Add failing ownership tests**

Assert SHA-256 stability, stable path listing, stable `projectId`, skipped unchanged writes, and preservation of compatible JSON extension keys across three reopen/update cycles.

- [x] **Step 3: Add failing identity tests**

Assert `PROJECT_ID_CONFLICT`, `PROJECT_ID_MISSING`, and `PROJECT_ID_INVALID` fail before any formal or external byte changes.

- [x] **Step 4: Add failing transaction tests**

Inject a failure after the first committed managed path, verify complete rollback, verify restart recovery, verify write locking, and verify a colliding unowned sibling transaction directory is not claimed or deleted.

- [x] **Step 5: Run RED**

Run:

```bash
pnpm test:workspace-safety
```

Expected RED causes: external Manifest content is treated as Pre-owned and an unowned deterministic transaction directory is claimed.

### Task 2: Derive the exact Pre-owned path set

**Files:**
- Modify: `src/presentation/workspace-managed-paths.ts`
- Modify: `src/presentation/workspace-project-writer.ts`

**Interfaces:**
- Consumes: fixed Contract paths, current build documents/files, and `expectedExistingFileHashes` from the binding ledger.
- Produces: an exact `PreDesignManagedPathSet` used for hashes, update actions, backup, commit, and rollback.

- [x] **Step 1: Keep the fixed Canonical path list explicit**

Use:

```text
project.json
rules.json
outline.json
pages/manifest.json
source-materials/manifest.json
assets/manifest.json
```

- [x] **Step 2: Restrict existing dynamic ownership to the last successful Pre ledger**

Treat dynamic Manifest records not present in `expectedExistingFileHashes` as external, even when their relative paths use Contract-reserved payload roots.

- [x] **Step 3: Reject ownership collisions**

Fail with `EXTERNAL_PATH_MODIFICATION_FORBIDDEN` when a new Pre candidate attempts to reuse an external ID or path.

- [x] **Step 4: Run the focused ownership and identity tests**

```bash
pnpm exec vitest run tests/presentation-workspace-ownership.spec.ts tests/presentation-workspace-identity.spec.ts --maxWorkers=1
```

### Task 3: Preserve shared Manifest records without committing external paths

**Files:**
- Modify: `src/presentation/workspace-project-writer.ts`
- Modify: `tests/helpers/shared-workspace-fixture.ts`

**Interfaces:**
- Consumes: existing shared Manifest documents, candidate Pre Manifests, and the exact Pre-owned path sets.
- Produces: a Contract-valid candidate snapshot containing both Pre and external records, while write actions remain Pre-only.

- [x] **Step 1: Project existing Manifests to Pre-owned records for external-change comparison**

Exclude legal external Manifest records before comparing the current shared Manifest with the last Pre hash.

- [x] **Step 2: Merge external records into candidate Manifests**

Append unchanged external `materials` / `assets` records after the current Pre records.

- [x] **Step 3: Copy external payload bytes into staging only**

Copy regular external payload files into the candidate tree solely so Contract 0.1.0 validates the complete shared project. Do not add those paths to the transaction action list.

- [x] **Step 4: Keep the persisted hash ledger Pre-scoped**

Return candidate hashes captured before the external merge so future Pre syncs do not absorb Presentation-owned records into Pre ownership.

- [x] **Step 5: Run focused tests**

```bash
pnpm test:workspace-safety
pnpm typecheck
```

### Task 4: Fail closed on transaction-directory ownership

**Files:**
- Modify: `src/presentation/workspace-write-transaction.ts`
- Test: `tests/presentation-workspace-transaction.spec.ts`

**Interfaces:**
- Consumes: deterministic transaction path, `owner.json`, and `journal.json`.
- Produces: `WORKSPACE_RECOVERY_FAILED` when neither valid ownership marker exists.

- [x] **Step 1: Preserve unknown sibling directories**

Before any rename or recursive removal, require at least one valid Pre transaction metadata file bound to the target Workspace.

- [x] **Step 2: Retain existing active-lock and abandoned-journal behavior**

A live owner returns `WORKSPACE_WRITE_LOCKED`; a valid abandoned journal is rolled back and cleaned.

- [x] **Step 3: Verify transaction tests**

```bash
pnpm exec vitest run tests/presentation-workspace-transaction.spec.ts --maxWorkers=1
```

### Task 5: Cross-platform CI and machine-readable acceptance

**Files:**
- Modify: `.github/workflows/presentation-standard-project-integration.yml`
- Modify: `package.json`
- Create: `scripts/emit-workspace-compatibility-result.mjs`
- Create: `docs/acceptance/pre-design-presentation-workspace-compatibility.json`

**Interfaces:**
- Consumes: successful Linux and Windows Workspace safety jobs.
- Produces: a JSON acceptance result with Contract version and all required preservation/rollback flags.

- [x] **Step 1: Set Node.js baseline**

Set `engines.node` and CI setup to `>=24.11.0` / `24.11.0`.

- [x] **Step 2: Add the OS matrix**

Run `pnpm verify:presentation-contract` and `pnpm test:workspace-safety` on `ubuntu-latest` and `windows-latest`.

- [ ] **Step 3: Emit machine-readable acceptance evidence**

After both matrix jobs pass, execute:

```bash
node scripts/emit-workspace-compatibility-result.mjs
```

The output must contain exactly the required Contract and safety booleans and must not infer cross-repository runtime validation.

- [ ] **Step 4: Run final CI on the final documentation/evidence HEAD**

Wait for both matrix jobs, targeted integration, full regression, packed runtime tests, `git diff --check`, and clean checkout checks.

### Task 6: Architecture, acceptance, and handoff documentation

**Files:**
- Create: `docs/architecture/shared-workspace-ownership.md`
- Create: `docs/acceptance/pre-design-presentation-workspace-compatibility.md`
- Create: `docs/handoff/2026-09-05-pre-design-presentation-workspace-handoff.md`
- Modify: `README.md`
- Modify: `HANDOFF.md`
- Modify: `docs/version-matrix.json`

**Interfaces:**
- Consumes: final implementation commit and GitHub Actions run IDs.
- Produces: the authoritative ownership contract, acceptance boundary, and next-session continuation point.

- [ ] **Step 1: Document the exact managed path list and layouts ownership**

State that dynamic ownership requires the Pre binding ledger and that unknown paths never enter commit actions.

- [ ] **Step 2: Document projectId authority and errors**

Record `project.json.projectId` as the only formal source and list all application-layer errors.

- [ ] **Step 3: Document transaction and recovery state flow**

Include the sibling transaction layout, action journal, rollback order, restart recovery, and lock behavior.

- [ ] **Step 4: Record tested and untested compatibility boundaries**

Pre CI validates Contract fixtures on Linux and Windows. The Presentation repository must still run:

```bash
npm ci
npm run verify:contracts
npm run verify:workspace
npm run verify:layout
```

against the same physical Workspace for the final two-repository E2E.

- [ ] **Step 5: Record final branch, implementation SHA, CI run, and commands**

Do not write PASS until the corresponding final-HEAD job is complete.
