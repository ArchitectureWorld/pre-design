# Version Authority

> Machine authority: [`docs/version-matrix.json`](version-matrix.json)  
> Human explanation: this file  
> Scope: `architecture/presentation-project-alignment-v2.0.0`

## 1. Single version matrix

| Namespace | Current value | Exact meaning |
|---|---:|---|
| Alignment baseline | `v2.0.0` | Architecture, content-projection and implementation-plan baseline for this branch |
| Git branch | `architecture/presentation-project-alignment-v2.0.0` | Working branch carrying the alignment baseline |
| Executable npm package | `0.7.0` | Actual value of `package.json#version`; unchanged by this branch |
| Published release/tag | `v0.7.0` | Existing published historical baseline; unchanged and never moved |
| Business contract line | `contracts/v0.6` | Existing 57-item business-contract line; historical/retained |
| Governance contract line | `contracts/v0.7` | Existing governance-contract line; historical/retained |
| Presentation standard major line | `v1` | Name of the standard family |
| Presentation `standardVersion` target | `1.0.0` | Required semantic version of `Presentation Standard Project Directory v1` |
| Presentation package name/version/hash | **not locked** | Must remain unset until an accepted Contract Lock commit |
| Historical client-report candidate line | `v0.8` | Unreleased historical candidate/evidence label; not the package version, tag or current alignment baseline |
| Historical handoff bundle label | `FINAL_v2.0` | Archive-directory label only; not SemVer and not a version authority |
| Alignment implementation | `blocked-by-contract-lock` | Documentation and plan are ready; production integration must not start until the lock is accepted |

## 2. Naming rules

1. SemVer values in machine fields use `2.0.0`, `1.0.0`, `0.7.0` without a prefix.
2. Human labels, branch names, file names and Git tags use lowercase `v`, for example `v2.0.0`.
3. Uppercase `V` prefixes are prohibited in current normative files.
4. The alignment baseline must never be described as the npm package version, plugin release, Git tag or GitHub Release.
5. `Presentation Standard Project Directory v1` is the standard-family name; its `standardVersion` is `1.0.0`.
6. Exact Presentation package coordinates and Schema Set hash may only be introduced by:
   `docs/contracts/presentation-standard-project-v1-lock.json`.
7. Before that lock exists and passes verification, normative files must not select either a package name or a candidate Presentation branch.

## 3. Authority order

For version questions on this branch, use:

1. `docs/version-matrix.json`;
2. this file;
3. `package.json` only for the executable package version;
4. the alignment specification, content baseline and implementation plan for their subject matter;
5. `README.md` for user-facing installation information;
6. `HANDOFF.md` as the current operational handoff summary;
7. `HANDOFF_HISTORY.md`, `contracts/v0.6`, `contracts/v0.7`, historical evidence and old release notes only as historical records.

`HANDOFF_HISTORY.md` is a non-authoritative index that points to the last Git commit and blob containing the former long-form handoff. The conflicting historical prose is no longer present in the current authority tree.

## 4. Historical labels

- `docs/acceptance.md` is historical acceptance evidence for the published `0.7.0` package line.
- `docs/acceptance-v0.8.md` records an unreleased client-report candidate line named `v0.8`; it is not a package version, Git tag, GitHub Release or alignment baseline.
- `handoff/FINAL_v2.0/` uses an old bundle label. It is historical archive material and has no SemVer authority.
- `HANDOFF_HISTORY.md` is a superseded-history index. The full former text remains available only through the Git commit and blob recorded there.

## 5. Contract-lock transition

When the Presentation Contract is accepted, one commit must atomically:

1. create `docs/contracts/presentation-standard-project-v1-lock.json`;
2. set `presentationStandard.contractLockStatus` to `locked`;
3. fill `packageName`, `packageVersion` and `schemaSetSha256`;
4. set `implementation.status` to `ready-for-implementation`;
5. update all three alignment documents without changing their alignment baseline from `v2.0.0`;
6. run `pnpm verify:alignment-versions`.

A Contract Lock does not change:

- `package.json#version`;
- the published `v0.7.0` tag;
- `contracts/v0.6`;
- `contracts/v0.7`;
- the alignment baseline `v2.0.0`.

## 6. Future version changes

- A new architecture baseline requires a new SemVer value and matching branch/file labels.
- An executable package release requires separate authorization, code verification, package-version change and Release process.
- A Presentation standard upgrade changes only the Contract Lock and compatibility work unless it also changes the alignment architecture.
- Historical tags, Releases and versioned contract directories are immutable.
