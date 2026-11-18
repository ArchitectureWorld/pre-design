# Actual-content geometry preflight: verified delivery and remaining limits

## Delivered runtime

Cloud implementation: `ebc1ce8`, transaction-connection correction `fc4a380`, single-connection browser regression `8a45cf4`, cancellation correction `8507fc8`. Remote aggregate `aebc0da` has exactly the same tree (`b8fd20da264307cf02772c0c9a9ca93735e784c1`).

CSADI-Linux deployed `31ee658b`, a two-parent commit preserving previous deployment `21d0a7f` and `aebc0da`, with that exact tree. Existing port 4320 is unchanged. The independent deployment-diff review finished after the already-started switch, not before it: it found no lost deployment-only features, configuration, dependencies, migrations, or service definitions. Seven documentation files were additive. Three synthetic PDFs only corrected their second-line binary marker; all later bytes and rendered PNG hashes matched.

New source/dist/config/service/database backup exists. Before/after configuration, policy, projects, drafts, materials, references and resources matched. Actual Chrome opened the existing library with no JS/HTTP errors. Served index, canvas UI and content-mapping UI hashes matched build. No model calls or new production candidates were made. The dynamic save prompt is shipped, but was not activated by writing a production mapping during this check.

## Verification scope

- Cloud focused mapping/UI/preflight/store/connection: 27/27.
- Independent preflight/store/connection review and rerun: 18/18.
- Real PostgreSQL: 18/18.
- Real HTTP/Chrome temporary fixture, single-connection pool: valid save, overflow rejection before save, preserved input and original draft, restored original content, and no held/waiting connection. No external model calls.
- Cancellation is cooperative. Once COMMIT has been sent, cancellation cannot promise rollback.

CI initially failed on a test helper reading an exited child's `/proc/.../cmdline`. Test-only `4db25d1` / remote `a938bb6` adds deterministic ESRCH/ENOENT coverage while still throwing EACCES/EIO. It does not suppress missing parent-process metadata or weaken actual cancellation checks.

That CI passed core 342/342, legacy 54/54, full Web 1023/1023 and Chromium 2/2, then failed on a stale UI selector matching all five matrix cards. Test-only `5fd565d` / remote `3b901c8` opens the specifically named points layout's large preview and selects its title there, rather than using `.first()` or pretending thumbnails have slot-selection handlers. Real PostgreSQL/Chrome rerun passed 24/24. Its new CI run 44226067422 timed out at the existing 20-minute limit while `apt-get update -qq` remained silent; no tests ran in that attempt. The logs do not establish a particular mirror or lock failure. Bounded, observable dependency setup is the next CI-only correction, not a product change or a reason to skip dependencies. No all-green claim. Test-only commits are not deployed.

## What the user can actually try

At the existing 4320 entrance: layout library → **第15页 · 强调列表与无图注适配（待视觉确认）**, V1 → enlarged preview. Existing candidate identity and hash still match the earlier receipt. Current preview has nine list markers, nine emphasis spans, and no empty figure captions. It remains private, unreviewed, and not authorized for sharing.

The current asset retains three-column organization, image areas, color strips, orange emphasis and conclusion hierarchy. It does not reproduce the original calligraphy, chapter decoration, paper texture, distinct photographs, or exact body/conclusion rhythm. Saving valid geometry is not complete layout extraction, visual acceptance, or evidence of 95% reliability.

## Existing-source and font feasibility check

No independently authorized editable source, original photographs, paper texture, or source font was found in this candidate's existing evidence. The copy-restricted PDF must not be re-extracted through native text/image APIs. Previously quarantined native diagnostics remain unusable. Needed inputs for authentic recovery are an authorized editable original or independently supplied reusable assets; image observations alone do not grant redistribution rights.

An isolated research spike used the already installed Noto CJK fonts and local SIL license, with no downloads or production changes. Extracted regular/bold SC faces total 33.44 MB, so they are not a lightweight rollout. The actual shadow preview does not load a face declared only inside the shadow root; registration in the host document does. `document.fonts.check()` alone gave a misleading true result. CDP confirmed actual custom-font glyph usage after host registration. Fixed fonts changed text geometry; revalidation is necessary. Relative font URLs fail in about:blank/setContent without a base URL, and missing files fail explicitly. Loopback timing is not user-network performance. This remains research, introduces no fixed character subset, and does not solve standalone offline HTML consistency or overall aesthetics.

## Final CI closure

The bounded dependency setup was independently tested with six simulated update/install/cache failure paths and preserves every dependency and the existing 20-minute job limit. It enabled visible failures rather than claiming to diagnose a particular mirror outage.

A subsequent upload-browser assertion still expected the old partial-document workflow. Real PostgreSQL/Chrome inspection confirmed the current result is correct: PDF readPages 1–31, three unique visual source hashes, 33 unique source-hash/page observations, 11 exact model-fixture stages, current complete/extracted/observed/synthesized 33/33, and no current partial-coverage flag. The old user-message attachment and batch limitations are intentionally retained as historical evidence. The test now checks both current complete coverage and historical preservation; no product coverage algorithm or user history was changed.

Remote `155bddad73bc5d5ca2139dfdbc0dc8f9b2a8e8dc` (local `ee738e5b37b8d40958b3ba4151f35520350fd207`, identical tree `ed32986c9fe219edaef2ed8a6fdf9438ae95db65`) passed Verify run `44230395096`, integration job `134553706853`, and Native checks run `44230395106`.

- Core 348/348; legacy 54/54.
- Full Web 1029/1029, zero failures and zero skips.
- Native Chromium 2/2; composition 2/2.
- Library UI 24/24; reference upload 17/17; reference review 9/9.
- 100 MiB PDF: all 31 pages and 31 images extracted, six observation batches.

These are controlled fixtures and regression evidence, not a new paid supplier run, a source-fidelity approval, or a 95% production-reliability estimate. The live runtime remains `31ee658b`; later changes were tests and CI only. No new user candidates, project-data mutations, external AI calls, or font rollout were performed during this closure.
