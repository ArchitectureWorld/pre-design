# Automatic Conditional Report Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans; retain the existing read-only supervisor. No additional development agents.

**Goal:** Completed automatic planning generates truthful conditional HTML/PPTX/PDF without a human boundary-confirmation prerequisite.

**Architecture:** A separately branded conditional bundle projects frozen planning text into existing client render contexts. A dedicated package service owns generation, identity validation, staging, failure records and project/revision idempotency. The coordinator completion hook and export command share it; formal publication stays unchanged.

**Tech Stack:** TypeScript, Vitest, existing DSH governance, PptxGenJS and Chromium PDF renderers.

**Spec:** `work/cycle12-report-design-notes.md`, `work/cycle11-report-blocker.json`.

## Global Constraints

- Work in E:\前期策划开发, feat/pre-v2.0.1; preserve all uncommitted changes. No commit/push/new branch.
- Phase1 runtime only; no content/math audit, source reopening or additional model requests.
- All57 workflows complete; original project revision103; model budget106/120 remains unchanged by report generation.
- Conditional output is publishable:false, includes unknown boundary and content-review limitations, and cannot enter formal publish.
- Keep failed/cancelled rendering visible and prevent stale/incomplete revisions from producing a current report.

## Task1: controlled conditional projection and three-format artifact contract

Files: new `src/report/conditional-report.ts`; modify `client-policy.ts`, `page-plan.ts`, `validate-artifacts.ts`; test `tests/conditional-report.spec.ts`.

Interfaces: `createConditionalReportBundle(input: FrozenProjectInput): ConditionalReportBundle`; `planConditionalPages(bundle, medium): ClientPagePlan`; `validateAndHashConditionalArtifacts(root, identity, bundle): Promise<ArtifactManifestRecord>`.

- [x] Add failing tests for unknown boundary, real frozen content, no default-profile inventions, no synthetic boundaries, conditional rejection by formal validator and frozen branding.
- [x] Build neutral report identity/disclosures and paginate original report entry text/basis into narrative blocks. Reuse existing client renderer APIs, with controlled conditional policy/page-plan checks instead of formal visual/page-count requirements.
- [x] Require matching three-format identities, signatures and hashes, plus conditional visible disclosure.
- [x] Run `pnpm exec vitest run tests/conditional-report.spec.ts tests/report-package.spec.ts`.

```ts
const bundle = createConditionalReportBundle(input)
expect(bundle.publishable).toBe(false)
expect(() => assertPublishableClientReportBundle(bundle)).toThrow()
expect(JSON.stringify(bundle.report)).toContain('条件式策划成果')
```

## Task2: conditional package generation and visible governance state

Files: new `src/report/conditional-package-service.ts`; modify governance types/domain/JSON Schema, report links/status/Dashboard; test `tests/conditional-package.spec.ts` and session status tests.

Interface: `ConditionalReportPackageService.generate(projectId, revision, signal?): Promise<ArtifactManifestRecord>`; required source/currentRevision/isComplete callbacks keep runtime boundaries explicit.

- [x] Add tests for no-boundary generation, concurrent same-revision deduplication, intact persistent reuse, missing files, pending revision, source revision change, cancellation and renderer failure cleanup.
- [x] Store staging/generated_conditional/failed records; require generatedAt + manifest for successful conditional records; keep published semantics unchanged.
- [x] Await both renderers before cleanup, verify artifacts then recheck revision/completion before atomic rename and record. Failed output is never reusable success.
- [x] Expose conditional mode and actual sourceRevision in structured/text status and report links; present clear labels.
- [x] Run conditional package, governance, session and client status tests plus typecheck.

```ts
const [first, second] = await Promise.all([service.generate('project', 103), service.generate('project', 103)])
expect(second.packageId).toBe(first.packageId)
expect(records.at(-1)?.status).toBe('generated_conditional')
```

## Task3: automatic completion, deployment and real acceptance

Files: `src/runtime/coordinator.ts`, `src/index.ts`, `src/commands/register.ts`; tests `tests/coordinator-report.spec.ts`, commands and production verification work scripts.

- [x] Add an optional completion port. Only invoke after nonempty complete registry-backed snapshot; use generation AbortController to cancel on pause and retain observable lastError on report failure without reopening confirmed workflows.
- [x] Compose the conditional service in index and use it from both the completion hook and preplan-export. Deduplication is shared. Report errors/status are visible.
- [x] Test completed restart, incomplete/blocked/pending cases, pause cancellation, failure visibility and duplicate starts.
- [x] Run all related tests/typecheck, independent review and full suite. Pack, back up, deploy through dsh-web-restart3, compare protected hashes and authenticate original session.
- [x] Resume original completed session once to trigger real automatic generation. Verify three file identities/hashes, HTTP downloads and rendered content. Repeat export to prove same package reuse with zero new model reservations.
- [x] Mark Phase1 complete only after actual three-format generation. Notify and delete dsh monitor; do not begin Phase2.

```ts
await coordinator.start(agent, projectId)
await completionObserved
expect(generate).toHaveBeenCalledOnce()
expect(coordinator.lastError(projectId)).toBeUndefined()
```


Acceptance: 2026-09-17, source revision103, 57/57 complete. Final controlled excerpts contain99 pages; HTML retains full detail. Final notification uses native paired command events. Initial custom event was retained with an ignorable compatibility marker after a backed-up single-record migration. Native reader rejection-before/success-after and two host restart checks close the actual compatibility defect. Full151 files/995 tests and typecheck pass; original session generated one package, three HTTP/hash-verified formats, zero added model calls. See work/cycle12-live-audit.json. Content correctness remains Phase2.
