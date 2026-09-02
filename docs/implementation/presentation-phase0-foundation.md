# Presentation Phase 0 Foundation

- Alignment baseline: `v2.0.0`
- Base branch: `architecture/presentation-project-alignment-v2.0.0`
- Implementation branch: `feature/presentation-phase0-foundation-v2.0.0`
- Executable package version: `0.7.0`
- Presentation Contract Lock: `pending`
- Phase status: `implemented`
- Contract-dependent integration: `blocked-by-contract-lock`

## 1. Purpose

Phase 0 implements only the reusable foundations that do not depend on a final Presentation package, Schema, ID format or Canonical field set.

It allows development to proceed without copying a candidate Schema or binding `pre-design` to a Presentation branch that has not been accepted.

## 2. Implemented scope

### Contract boundary

- Minimal `PresentationFormatContract` port.
- Explicit failure when no locked Contract is supplied.
- No package name, version, Schema or ID format is guessed.

### Project binding

- `preDesignProjectId` and optional `presentationProjectId` are distinct.
- Binding state supports `awaiting_contract`, `creating`, `ready` and `recovery_required`.
- Absolute host directory is stored outside professional Revision snapshots.
- Binding records use an independent DSH Storage Domain.
- Presentation identity is immutable and unique once assigned.

### Canonical comparison primitives

- Deterministic JSON key ordering.
- Array order remains semantic.
- Unicode strings and keys normalize to NFC.
- Unsupported values, cycles, sparse arrays and non-finite numbers fail closed.
- Stable lower-case SHA-256 semantic hashes.

### Portable path and filesystem foundation

- Project-relative POSIX path validation.
- Absolute paths, traversal, encoded traversal, backslashes and control characters are rejected.
- Same-filesystem sibling staging directories.
- Atomic UTF-8 and Canonical JSON replacement.
- Verified file copy with source preservation, byte-count check and SHA-256 check.
- Staging cleanup refuses non-staging paths.

### Narrative projection

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

### External-change protection

- Deterministic classification of create, update, unchanged, retained and review-required objects.
- An object changed or deleted outside the previous pre-design output is never silently overwritten.
- Existing objects absent from the previous pre-design ledger are not claimed.
- Conflicting objects do not advance the export ledger.

### Source-material and asset planning

- Deterministic category planning for documents, drawings, images, videos, data, models, charts, diagrams, audio and other files.
- Known extension/MIME mismatch fails closed.
- Duplicate SHA-256 reuses the existing object.
- Same-name/different-content files receive a deterministic hash suffix.
- Unicode filenames normalize to NFC.
- Import plans contain project-relative paths only and never expose the source host path.

## 3. Verification snapshot

The Phase 0 workflow executes:

```bash
pnpm install --frozen-lockfile
pnpm exec vitest run tests/presentation-*.spec.ts --maxWorkers=1
pnpm typecheck
```

Current targeted coverage:

```text
Test Files: 6 passed
Tests: 36 passed
TypeScript: PASS
```

The final branch gate additionally runs the full repository test/build suite and built-package regression.

## 4. Explicitly not implemented

- No dependency on a candidate `@architectureworld/presentation-contracts` package.
- No accepted `standardVersion` or Schema Set Hash.
- No real Presentation ID Factory.
- No Canonical Schema adapter.
- No production `project.json`, `outline.json`, Draft or Manifest generation.
- No `/preplan-new` integration.
- No real project directory lifecycle service.
- No source-material or asset Manifest writes.
- No 57-item Repository-to-Projection production adapter.
- No Layout generation.
- No package-version bump, Tag or Release.

## 5. Next gate

The next implementation phase starts only after one accepted Contract Lock records the exact Presentation standard version, package name, package version, Schema Set hash, exported type and validator entries, ID Factory, Fixture paths and source commit.
