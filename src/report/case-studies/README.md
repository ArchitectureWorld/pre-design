# Project-supplied case studies

The production service has no built-in project, region, case catalog or image collection. `prepareCaseStudies(input, workspaceRoot)` reads `input.caseStudyCatalog` or the explicit project file `.pre-design/report-case-catalog.json`, whose shape is `{ projectId, cases: VerifiedCaseStudy[] }`. A missing catalog returns `CASE_STUDIES_CATALOG_REQUIRED`; a different project identity is rejected.

The source, exact-quote, completion/opening, point/line/area, image hash, similarity and application checks remain required. At least three suitable cases must have evidence for the current project before the full case supplement can be exported. The bundle preserves its input catalog independently of the selected application copy, so altered cached definitions fail validation. Structural checks do not substitute for reading the actual source or independent review.

Images are read from verified workspace cache or fetched from the explicit original HTTPS source and checked against its recorded hash. `PrepareCaseStudiesOptions.bundledImages` may supply explicit source bytes by hash, primarily for offline tests; the runtime ships no example images.

Historical examples and photos live in `tests/fixtures/case-studies/`. Their context is archived in `docs/examples/report-case-studies.md` and is not production input.
