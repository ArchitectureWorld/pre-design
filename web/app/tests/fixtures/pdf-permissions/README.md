# Synthetic PDF permission fixtures

These three two-page files contain only `PUBLIC REFERENCE FIRST PAGE` and `PUBLIC REFERENCE SECOND PAGE`. They were generated from `../reference-pdf.mjs` with Ghostscript 10.02.1's `pdfwrite`, PDF 1.4, encryption revision 3, and a 128-bit key. They contain no project data.

| File | Open password | Permission setting | Expected behavior |
| --- | --- | --- | --- |
| readable.pdf | Empty | `-dPermissions=-4` | Read text and both page images without prompting for a password |
| no-copy.pdf | Empty | `-dPermissions=-20` | Read page images; do not use text extraction because `copy:no` |
| open-password.pdf | `fixture-open` | `-dPermissions=-4` | Reject without the open password |

The synthetic owner password is `fixture-owner`. Tests do not supply either password to Poppler. All fixtures report `Encrypted: yes`; that flag alone does not indicate whether an open password is needed. Ghostscript is only used to create these committed fixtures and is not a test or production runtime dependency.
