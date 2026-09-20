# Sourced built-project comparisons

`prepareCaseStudies(input, workspaceRoot)` selects 3–5 real built projects with at least two distinct similarities supported by both the current project sources and the case sources. It does not call a text model, change the source manuscript or treat a regulation title as a site resource. A new domain needs verified relevant cases before it can meet the minimum.

The v2 contract requires a documented **true project extent**, overall context/layout, relevant circulation and representative point photographs. The preferred four-page order is area → line → point → application. The compatible `site`, `organization`, `experience`, `application` image keys remain stable. Three pages are supported by combining area and line on an appropriate intact source plan/map; the combined analysis must declare both scales. The application page contains only matched features and its applicable project conditions.

`spatial.scope` records the actual study unit and sourced measurements, so a 256 m² building is not silently treated as a whole scenic district. Each spatial layer links source evidence and gallery media. Every route records a traffic mode, claim and exact source quote. Visitor circulation is required; arrival, vehicle and service claims require their own supporting source passages. Missing modes outside the documented project scope remain explicit internal gaps. These structural checks supplement the archived source reads and pixel inspection; they are not semantic source verification by themselves.

`caseStudySourceGaps(row)` exposes acquisition requirements. Missing overall or circulation sources block selection and require replenishment or a different case. `CASE_STUDIES_INSUFFICIENT` carries a structured `sourceGaps` array when fewer than three eligible matches remain. Historical built cases are never certified for new spatial coverage by their old status alone.

The current catalog contains four built-project candidates. Three now have complete sourced spatial coverage:

- Songyang Damushan Tea House: 477.75 m² building / 372.83 m² footprint, original site axonometric, first-floor plan and public figure-eight walking loop, tea-room photographs. The published plan shows service rooms but does not establish an independent delivery route; no vehicle or logistics route is claimed.
- Tianhu Lake Lodge: 256 m² management-building renovation, original master plan and bifurcated-stair second-floor plan, documented visitor arrival and separation from office access, tea/café photographs. The 2.5 km lake route is surrounding context, not the building's development area.
- Xiangshan Bikeway: the approximately 3 km Shuishe–Xiangshan segment, official Chinese map highlighting its relationship to the lake, published cycling/walking organization and actual node photographs. The intact official map is used once for overall context and once for the route; this original is used exactly twice.
- Anji Sight-viewing Platform and Tea House remains a candidate. The source proves a tea house and two pavilions, 260 m² building area and 1,300 m² landscape area. Reading the original tea-house/platform plans did not establish circulation across all three nodes, so its line gap blocks selection until replenished. Its historical photographs and facts are preserved.

For the broad tea/waterfront/walking fixture, selection therefore yields **3 cases, 12 logical pages, 15 source records and 11 distinct source originals**. This count follows source coverage and project matches; it is not hardcoded in selection. Cases must stay within 3–5 and pages within 3–4.

`CaseStudyImage` carries `imageIdentity`, `imageQuality`, `analysisScale` and `mediaPurpose`. `caseStudyPhotos(bundle)` exposes the latter two on its descriptor as well as the compatible `{ caseId, imageId, sourceKey, image, pageIds }`. The primary `row.image` alias is the area image and may be a plan or map. Source classification and a locally viewed source image are **not** a completed model inspection: no `imageQuality.inspection` is manufactured. Placement-specific review and the final physical-page image allowance are handled by the shared image policy and report pipeline.

Every source image also links `locationEvidenceIds`. `CaseStudyPhoto.locationEvidence` resolves the full published source passages for review, including URL, excerpt and source hash. Location is not inferred from photographed people. The Tianhu location label is limited to 福建·福鼎·嵛山岛 and the Anji label to 浙江·安吉, matching the actual published wording.

Original-family checks use source SHA-256, explicit original IDs, decoded-pixel fingerprints and derivative links; they count transitive families across all selected case pages. A family may appear at most twice. A page key may bind only one gallery entry, and repeated media IDs within one layer are rejected. Renaming a file or changing its encoding cannot create an extra allowance when its provenance links it to the same original.

Verified original source-image bytes are bundled by hash for reliable offline export. `refreshImages: true` explicitly checks the published bytes again; changed bytes fail instead of silently replacing a source. Two allowed uses of one original share a materialization promise, avoiding concurrent writes to the same Windows file while preserving page-specific captions and purposes. Ordinary materialization and evidence preparation do not use network/model calls. Output remains separate from the source manuscript:

- `.pre-design/report-case-studies.json`: facts, spatial coverage, matches and independent fingerprint.
- `.pre-design/report-case-studies.evidence.md`: original quotations, scope/route derivations, source gaps, transfer conditions and photographic/drawing credits.
- `.pre-design/report-case-studies/assets/`: hash-verified source media.

Source URLs, acquisition details, original quotations and derivations stay in the evidence records. Formal pages use concise subject captions and conclusions, while the application conditions remain visible as useful planning content. Plans, maps and diagrams retain their full extent through `imageQuality.contentKind` in the shared layout pipeline.

Original verification is recorded under `work/case-study-research/` and `work/case-study-live-verification.json`. The 2026-09-19 replenishment, exact downloaded plan/map bytes, official Chinese route page and per-image source records are in `work/report-image-quality/case-sources/`; `source-replenishment.json` records actual tool image viewing separately from model inspection. No DSH model task was run.

The official Xiangshan map is Chinese. The Damushan axonometric contains English labels, its floor plan has a Chinese/English legend, and the Tianhu second-floor plan also has a bilingual legend. These source images have not been certified under the strict domestic-language image policy. Final placement review or a separately tracked faithful Chinese derivative is still required; the catalog retains the intact publisher originals and their hashes.

The focused tests cover missing area/line evidence, incorrect media scale, unsupported route claims, inflated project scale, shared original families, blocked historical candidates, source-only selection, offline preparation and a synthetic three-page combined-scale case. The isolated synthetic entry is not an additional real case and does not establish new-domain coverage.
