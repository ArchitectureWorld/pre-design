# Pre-design 当前交接

> Version authority: [`docs/version-matrix.json`](docs/version-matrix.json)  
> Human version policy: [`docs/VERSIONING.md`](docs/VERSIONING.md)  
> Current branch: `architecture/presentation-project-alignment-v2.0.0`

## 1. Current version state

| Namespace | Current state |
|---|---|
| Alignment baseline | `v2.0.0` |
| Executable npm package | `0.7.0` |
| Published historical tag | `v0.7.0` |
| Business contract line | `contracts/v0.6` |
| Governance contract line | `contracts/v0.7` |
| Presentation standard line | `v1` |
| Presentation target `standardVersion` | `1.0.0` |
| Historical unreleased report candidate | `v0.8` |
| Historical archive label | `FINAL_v2.0` |
| Presentation Contract Lock | `pending` |
| Production integration | `blocked-by-contract-lock` |

The alignment baseline is not a package release, Git tag or GitHub Release. No package-version bump is authorized on this branch.

## 2. Current authoritative documents

1. [`docs/version-matrix.json`](docs/version-matrix.json): machine-readable version authority.
2. [`docs/VERSIONING.md`](docs/VERSIONING.md): version policy and transition rules.
3. [`docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md`](docs/superpowers/specs/2026-09-02-pre-design-presentation-project-alignment-v2.0.0-design.md): architecture alignment.
4. [`docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md`](docs/superpowers/specs/2026-09-02-pre-design-presentation-content-baseline-v2.0.0.md): outline, draft and asset-output baseline.
5. [`docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md`](docs/superpowers/plans/2026-09-02-pre-design-presentation-project-alignment-v2.0.0.md): implementation plan.

## 3. Current architecture

- `pre-design` remains an independent executable DSH plugin.
- The pre-design Skill is an internal professional capability of that plugin.
- `presentation-tools` remains a separate DSH visual interaction, layout and export tool.
- `pre-design` creates and fills the standard Presentation project directory.
- `presentation-tools` defines the standard format and provides the visual operating surface.
- DSH Harness remains the only Agent runtime.
- The standard project directory is a neutral data carrier shared by plugins, people and DSH Agents.
- `pre-design` does not create or modify Layout content.
- Existing HTML/PPTX/PDF production paths remain available during the first compatibility stage.

## 4. Current implementation state

Documentation and the implementation plan are ready, but production integration has not started.

The next blocking gate is one accepted Presentation Contract Lock containing:

```text
standardName
standardVersion
packageName
packageVersion
schemaSetSha256
typesEntry
idFactoryEntry
documentValidatorEntry
projectValidatorEntry
minimalFixturePath
fullExamplePath
validationCommand
sourceCommitSHA
```

Before the lock is accepted:

- do not select a candidate Presentation branch;
- do not guess package coordinates or exported entries;
- do not copy Schema into this repository;
- do not start production integration;
- do not change `package.json#version`;
- do not create a new tag or Release.

## 5. Historical handoff

The previous long-form handoff has been removed from the current authority tree and replaced by a non-authoritative history index:

[`HANDOFF_HISTORY.md`](HANDOFF_HISTORY.md)

The index records the last commit and blob containing the full historical text. Git history remains the evidence source. No dated “current”, “only branch” or “unique authority” statement is retained in the current authority tree.

The frozen directory `handoff/FINAL_v2.0/` is also historical material. Its `v2.0` name is not the current alignment SemVer and must not be used as a version authority.

## 6. Required checks

Run before any branch completion claim:

```bash
pnpm verify:alignment-versions
pnpm typecheck
pnpm test
pnpm test:built
```

The first command must print:

```text
PRE_DESIGN_ALIGNMENT_VERSION_CONSISTENCY_PASS
```
