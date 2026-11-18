# PDF/image-first reusable visual reconstruction: bounded decoration v1

## Intent and decision
PDF page images and uploaded images are primary inputs. Editable source slides and original photos are not prerequisites. Rebuild source-guided visual structure with editable content slots and replaceable images; label derived geometry and unrepresented texture/typography honestly. This increment improves a general image→components→adapt→compile pipeline, not a single hand-authored candidate.

Existing adaptation already receives the actual verified page image, but its schema only permits filled rectangles and diamonds. The SVG sanitizer already supports more safe primitives. Options considered: arbitrary SVG/free paths (rejected: too much surface and business-content tracing risk), a new image-observation stage (deferred: redundant extra calls for this limited capability), or a versioned bounded grammar in the existing image-guided adaptation (chosen). No additional model stage is needed.

## Scope
New component-v3 tasks freeze `referenceDecorationVersion: 1`. Retried/old tasks without this marker keep byte-identical old contracts and schemas. Unknown versions fail before calls. Existing accepted observations are not rewritten or represented as newly observed shapes.

The new adaptation grammar retains rect/diamond and adds rounded rectangle, ellipse, and straight line (horizontal/vertical/two diagonal directions), with bounded radius/stroke values. Every shape must reference one actual same-page decoration component and use its observed bounds. The proposed shape/style is explicitly image-guided derivation, not validated original-vector extraction. No arbitrary paths, text/glyph outlines, images, URLs, textures, business prose, invisible overlays or foreground layer changes. Unsupported forms stay unrepresented.

Deterministic SVG generation and sanitization preserve component identity and bounds. Existing contrast and overlap safety must not be weakened: an opaque full rectangular background may support text; partial/non-rectangular overlaps with text still reject. New strokes must remain within component bounds. Existing content slot count/binding, image replacement, source ownership and input text remain unchanged.

## Verification and boundaries
TDD old-version rejection/new-version acceptance, schema/runtime agreement, clipping/bounds, source isolation and exact old prompt/cache identity. A three-page synthetic image-driven pipeline fixture covers chapter/title bands, information separators and multi-card geometry with differing content densities and image aspect ratios. Real browser checks include actual fonts/images, no clipping/obscuration, SVG primitive rendering, short/medium/long text and overflow rejection. Existing approved image observations may be used privately for compatibility and manual image-estimate comparisons, never relabeled as new model observations.

No existing user candidate is replaced, no new same-named production candidate is created, and no source asset or copy-restricted native PDF content is extracted. Development and generic tests are cloud-first; local access is limited to authorized test/deployment. True supplier-quality acceptance and whole-document aesthetic fidelity remain separate from controlled fixtures. Background texture, original brush lettering, photo identity, foreground layers and image-focus relationships are not solved by this increment.

Line stroke width uses a short-side ratio greater than 0 and at most 1, allowing thin observed rules to retain full thickness. Half-stroke endpoint insets and butt caps keep paint within bounds; coincident final endpoints are rejected rather than rendering an invisible rule.
