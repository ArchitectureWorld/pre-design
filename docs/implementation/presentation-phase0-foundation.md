# Presentation Phase 0 Foundation

- Alignment baseline: `v2.0.0`
- Base branch: `architecture/presentation-project-alignment-v2.0.0`
- Implementation branch: `feature/presentation-phase0-foundation-v2.0.0`
- Executable package version: `0.7.0`
- Presentation Contract Lock: `pending`
- Phase status: `implemented`
- Contract-dependent integration: `blocked-by-contract-lock`

## 1. Purpose

Phase 0 implements only reusable foundations that do not depend on a final Presentation package, Schema, stable ID format or Canonical field set.

It allows `pre-design` development to proceed without copying a candidate Schema, guessing a Presentation version, or binding the plugin to a Presentation branch that has not been accepted.

The Phase 0 boundary remains:

```text
pre-design professional state
        ↓ contract-neutral projection and file planning
internal Presentation-neutral objects
        ↓ blocked until Contract Lock
canonical Presentation project files
```

## 2. Implemented scope

### 2.1 Contract boundary

- Minimal `PresentationFormatContract` port.
- Explicit failure when no locked Contract is supplied.
- No package name, package version, Schema, Schema Set Hash or stable ID format is guessed.
- Candidate Presentation branches are not treated as runtime dependencies.

### 2.2 Project binding

- `preDesignProjectId` and optional `presentationProjectId` are distinct identities.
- Binding state supports `awaiting_contract`, `creating`, `ready` and `recovery_required`.
- Absolute host directory is stored outside professional Revision snapshots.
- Binding records use an independent DSH Storage Domain.
- Presentation identity is immutable and unique once assigned.
- `PresentationBindingRepository` is opened and closed with the DSH plugin Host lifecycle.
- The repository is exposed through `ctx.preplanning.presentationBindings` for later command and service composition.
- `/preplan-new` does not yet create a Presentation binding or project directory.

### 2.3 Canonical comparison primitives

- Deterministic JSON key ordering.
- Array order remains semantic.
- Unicode strings and keys normalize to NFC.
- Unsupported values, cycles, sparse arrays and non-finite numbers fail closed.
- Stable lower-case SHA-256 semantic hashes.

### 2.4 Portable path and filesystem foundation

- Project-relative POSIX path validation.
- Absolute paths, traversal, encoded traversal, backslashes and control characters are rejected.
- Same-filesystem sibling staging directories.
- Atomic UTF-8 and Canonical JSON replacement.
- Verified file copy with source preservation, byte-count check and SHA-256 check.
- Staging cleanup refuses non-staging paths.

### 2.5 Narrative projection

- Eight default pre-design narrative topics.
- Empty topics are omitted.
- Project-specific topics may be added explicitly.
- One professional finding creates one single-conclusion page candidate.
- Multiple professional objects and evidence records may support one page.
- Five semantic block types: `heading`, `text`, `list`, `metric_group`, `table`.
- Independent speaker notes and formal asset references.
- Content nature and generic source references.
- New identities come only from an injected ID Factory.
- No Layout, font, coordinate, template or rendering fields.

### 2.6 Frozen 57-object adapter

- Existing `FrozenProjectInput` and `FrozenStateObject` are adapted into contract-neutral `ProfessionalFinding` objects.
- All 57 professional objects are deterministically consolidated into ten narrative findings.
- Every source object is included exactly once; none is duplicated or omitted.
- `IM02` is isolated in the decision-and-next-steps finding and excluded from the delivery finding.
- Reversing the input object order produces the same result.
- Empty professional source groups do not create placeholder findings.
- Decision items become a semantic ordered list.
- Only formally adopted matching assets are referenced when `adoptedAssetIds` is available.
- Evidence IDs are not invented when the frozen source does not supply evidence identifiers.
- The adapter does not emit Presentation Canonical JSON and remains independent of the pending Contract.

### 2.7 External-change protection

- Deterministic classification of create, update, unchanged, retained and review-required objects.
- An object changed or deleted outside the previous pre-design output is never silently overwritten.
- Existing objects absent from the previous pre-design ledger are not claimed.
- Conflicting objects do not advance the export ledger.

### 2.8 Source-material and asset planning

- Deterministic category planning for documents, drawings, images, videos, data, models, charts, diagrams, audio and other files.
- Known extension/MIME mismatch fails closed.
- Duplicate SHA-256 reuses the existing object.
- Same-name/different-content files receive a deterministic hash suffix.
- Unicode filenames normalize to NFC.
- Import plans contain project-relative paths only and never expose the source host path.

### 2.9 Build and host portability

- `tsdown` uses the installed `tsx` config loader explicitly on the Node 20 CI baseline.
- Browser executable resolution supports Windows, macOS and Linux candidates.
- Explicit host configuration and environment overrides remain supported.
- A foreign Windows absolute path is ignored on a POSIX host rather than passed to `spawn`.
- POSIX absolute paths are not misclassified as Windows paths.
- PDF rendering resolves the executable at call time, so a package built on Windows can run on Linux without retaining a Windows browser path.
- Browser-resolution tests are part of the fast Phase 0 CI gate.

## 3. Verification snapshot

The Phase 0 workflow executes a fast targeted gate followed by the complete repository regression gate.

### Targeted gate

```bash
pnpm install --frozen-lockfile
pnpm verify:alignment-versions
pnpm exec vitest run tests/presentation-*.spec.ts tests/browser-executable.spec.ts --maxWorkers=1
pnpm typecheck
```

Current targeted result:

```text
Test Files: 10 passed
Tests: 46 passed
TypeScript: PASS
Version authority: PASS
```

### Full regression gate

```bash
pnpm test
pnpm test:built
git diff --check
```

Current result:

```text
Full build and repository test suite: PASS
Built-package regression: PASS
Diff hygiene: PASS
```

GitHub Actions run used for the current verification snapshot:

```text
workflow: Presentation Phase 0 Foundation
run: 33695951945
head: dd0c04e6fea08b23622441eefb2607897ecbe653
```

## 4. Explicitly not implemented

- No dependency on a candidate `@architectureworld/presentation-contracts` package.
- No accepted `standardVersion`, Contract package version or Schema Set Hash.
- No real Presentation ID Factory.
- No Canonical Schema adapter.
- No production `project.json`, `outline.json`, Draft or Manifest generation.
- No `/preplan-new` automatic Presentation binding or directory creation.
- No real standard project directory lifecycle wired into a DSH command.
- No source-material or asset Manifest writes.
- No Layout generation.
- No package-version bump, Tag or Release.

## 5. Remaining non-blocking risk

The existing large site-boundary asset concurrency test processes a 16 MiB payload and can approach its five-second test threshold on slower CI runners. It currently passes, but the bit-by-bit CRC32 implementation remains a performance-flakiness risk. Any optimization must be introduced with a dedicated failing performance/behavior test rather than by silently increasing the timeout.

## 6. Next gate

Contract-dependent implementation starts only after an accepted Contract Lock records the exact Presentation standard version, package name, package version, Schema Set Hash, exported type and validator entries, stable ID Factory, Fixture paths and source commit.

After Contract Lock, the next production steps are:

1. bind the accepted Contract Adapter;
2. create a Presentation binding during `/preplan-new` under the frozen strong-consistency rules;
3. generate and validate the minimum legal standard project directory;
4. serialize the existing contract-neutral projection into Canonical files;
5. write source-material and adopted-asset Manifests;
6. run the complete project-directory E2E without generating `layouts/`.
