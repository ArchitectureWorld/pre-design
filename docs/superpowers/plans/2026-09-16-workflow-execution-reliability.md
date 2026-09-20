# Workflow execution reliability implementation plan

> Execution: inline in the approved `E:\前期策划开发` checkout, using the executing-plans and test-driven-development skills. No development subagents. Keep `feat/pre-v2.0.1`.

**Goal:** Stop automatic planning work from falling into unbounded general-purpose tool experimentation, and provide a bounded native path to read project source materials.

**Architecture:** Reuse the existing Research → DSH child analysis → quality evaluation → Proposal Gateway pipeline for both one and multiple workflows, including persisted running work. Give the current session a workspace-bound material reader and a compact material inventory. Keep model/provider selection, evidence requirements, revision validation and approval rules intact.

**Tech stack:** TypeScript, DSH 0.1.5-rc.1, Vitest, Node; PDF.js for native PDF text extraction.

## Constraints and evidence

- Development root is `E:\前期策划开发`; baseline is remote `feat/pre-v2.0.1@6d77306a6229c44419cf3bcb5d8a7a976e24711b`.
- Old checkouts contain unrelated uncommitted work. Project folders, including `D:\shaotanhe`, are source/test materials, never development roots.
- The live DSH response stream already contains `echo "[OK: Action logged ...]"` in assistant tool-call arguments. This local evidence locates the bad command before PowerShell dispatch; it does not distinguish model generation from upstream provider rewriting.
- `ParallelWorkflowExecutor.canRun()` requires two ready workflows; `AutomationCoordinator` resumes running workflows through an unrestricted parent follow-up. These paths omit the existing centralized research and quality loop.
- The Research runtime currently discovers JSON fields only. PDF input must not be reported as read merely because a filename was found, and extracted document text must not be automatically asserted to satisfy a required research fact.
- Do not modify credentials, running host configuration, formal project state, old checkouts, or external repositories. Formal deployment requires the user's final confirmation after reviewable results.

## Task 1: Controlled execution for a single or resumed workflow

Files: `src/runtime/parallel-workflow-executor.ts`, `src/runtime/coordinator.ts`, and runtime regression tests.

- [x] Add failing behavioral tests for one ready item, one persisted running item, no duplicate running transition, concurrent invocations, and an unavailable analysis provider.
- [x] Change selection to prefer persisted running items, otherwise ready items; retain bounded concurrency and the same quality/Gateway path.
- [x] Expose `isEnabled(projectId): boolean` so the coordinator can distinguish automatic mode from manual mode; automatic mode must report an unavailable analyzer as a blocker rather than issuing a parent follow-up.
- [x] Catch coordinator failures and persist a workflow blocker instead of leaving a detached rejected promise and a stale running status.
- [x] Run runtime tests and verify a real local DSH child with no general-purpose tools receives the exact schema and evidence.

Key acceptance:
```ts
expect(result).toMatchObject({ attempted: 1, completed: 1, blocked: 0 })
expect(followups).toHaveLength(0) // automatic execution never falls back to parent tool exploration
expect(transitions.map(row => row.to)).toEqual(['running', 'confirmed'])
```

## Task 2: Workspace-bound source reading and explicit missing-data feedback

Files: new `src/materials/workspace-materials.ts`, `src/tools/register.ts`, context/prompt integration, material tests and package manifest/lock.

- [x] Add failing tests for source inventory, exact PDF pages, UTF-8 text, page/character bounds, scanned/empty PDF, unsupported binaries, traversal/symlink escape and aborted reads.
- [x] Implement `WorkspaceMaterialReader.list(root, signal?)` and `read(root, {path, startPage?, maxPages?}, signal?)` with SHA-256, page/line locators, truncation metadata and explicit extraction status.
- [x] Register `preplanning_read_material` against the current bound session workspace. Add material inventory to controlled context, with supported formats and a direct next action.
- [x] Keep `targetSchema`, sample payload and source materials semantically separate. Successful extraction does not certify research facts or approve proposals.
- [x] Report missing Research data points and material guidance through the existing blocked workflow path; no Python/PATH probing or invented shell success.

Key acceptance:
```ts
expect(result.pages[0]).toMatchObject({ page: 2, text: 'Verified source page two' })
expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
await expect(reader.read(root, { path: '../outside.txt' })).rejects.toThrow(/workspace/)
```

## Task 3: Verification and development handoff

- [x] Run targeted tests, typecheck, required contract/version checks, build, then full regression. Fresh full-run and focused follow-up results are recorded in `docs/workflow-execution-reliability-verification.md`; the original baseline print-layout failure remains explicit.
- [x] Verify native PDF extraction on a source PDF read-only, and run an isolated DSH execution with a separate home/workspace. Distinguish real-model evidence from deterministic integration tests.
- [x] Build a reviewable package and record exact test results and remaining host/provider limitations in `docs/workflow-execution-reliability-verification.md`.
- [x] Record this development root in repository documentation. Leave the approved branch and diff ready for review; no unsolicited commit, push, formal installation or host restart.
