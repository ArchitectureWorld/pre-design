# Explicit content presentation v1

User-approved goal: improve reusable page-image-derived layouts, retaining editable text, original source evidence and explicit adaptation, without using copy-restricted native PDF text or relaxing capacity.

## Implementation and compatibility

Cloud runtime: `bf5c6ae` (including `1d53b94` and `beebe28`).

- Exact quote/code-point spans now support `accent-strong`. Stale/overlapping ranges still fail. Text is not rewritten.
- Only explicit `style.presentationVersion: 1` permits `textMarker: disc` on body text slots, or `captionPolicy: when-present` on image slots.
- Captionless images require `caption: ''`, `captionStatus: absent`, and a nonempty `description`. Description stays in alt and text exports. Any nonempty caption remains visible. Old layouts reject absent-caption content before binding/render/export.
- Opt-in synthetic previews demonstrate emphasis on two code points of freshly generated synthetic text. This never infers emphasis in project text or writes the sample into the reusable package.
- New policies are not enabled on old resources/tasks. Existing model prompts/caches and source observations are unchanged.

## Actual checks

Initial tests reproduced missing new behavior; independent review found a V1 resolve/export coverage gap. `beebe28` closes it, with negative regression. Reviewer independently reran 21 focused tests, all passing.

Final full cloud suite: 960 tests, 888 pass, 56 fail, 16 skip. Not a full green suite. Log `/tmp/content-presentation-last-full.log`; failures remain the known socket-restricted PostgreSQL/Chromium groups and existing PDF cancellation/chat/report-check cases.

Local actual PostgreSQL: seven storage/API/assets compatibility checks pass. Actual Chrome source-image-derived private fixture: nine markers, nine quote-bound emphasis ranges, no captions for explicitly captionless placeholders. Adding bold/markers initially caused one body overflow (89 versus 68 px); a private explicit height derivative of +0.025 canvas height resolves it. Original rectangle is retained in receipt, no font/text/capacity change. Full schema rejects overlap. This is a manual adaptation, not an automatic extraction success.

`validatePublication`: two synthetic pages pass plus intentional overflow negative control. Screenshots were visually inspected. Original brush chapter lettering, photos, watermark/texture remain unrepresented; conclusion line wrapping still differs. Original figures are not redistributed. Manual text remains private QA and unconfirmed, not business facts.

## Deployment

CSADI-Linux `76298b42e58943f10c08cacd8e9a770aaa30d71d`, from `06a242e05b6b9fb5cdb1cf9f7634016feee5bc32`.
Backup: `.local/deploy-backups/native-v3-06a242e-to-76298b4-qs8iru3s`.
Plan/receipts: `.cache/presentation-deploy-20261117/`.
Source/config/dist/database backed up. Before/prestop/after snapshots verify no active jobs and no changes to existing resources/projects/materials/drafts/model settings. No migrations/dependencies changed.

Actual 4320 served `index.html`, `composition-render.mjs`, `text-blocks.mjs` hashes match built dist. Actual browser opened the new candidate and its large preview, observing nine list markers, nine synthetic emphasis spans, zero captions. Existing three-page source comparison still works and does not expose unchecked old native evidence. No visual acceptance or sharing was performed. Zero model calls.

New private candidate: `2b006d23-f267-4d54-8fa3-f94233a505f2`, v1, **第15页 · 强调列表与无图注适配（待视觉确认）**. Previous `9809f033-5fe0-4ee1-b597-9fa6e2485b57` v3 retained. New candidate links that source version/hash and remains shareAllowed=false. Entry: fixed 4320 → 版式库 → candidate → 放大预览. Visible content/images are synthetic, not business transcription.

Local evidence directory `/home/zetta/.cache/predesign-resume-300611f/`: `presentation-live.json/png`, `presentation-visual-qa/`, `presentation-postgres.log`, `presentation-final-focused.log`.

## Remaining scope

This release adds safe rendering/storage contracts and an explicit private adapted example, not automatic extraction of all inline semantics. Content mapping can carry validated spans; the current plain-text adaptation editor does not provide a rich-text range editor. Do not claim it can automatically preserve emphasis when a user rewrites prose. Such editing must invalidate stale quotes and remeasure bold/list wrapping before acceptance. Full source visual fidelity and user approval remain pending.
