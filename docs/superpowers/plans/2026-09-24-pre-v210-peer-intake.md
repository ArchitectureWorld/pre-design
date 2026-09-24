# Pre-design 2.1.0 milestone 3: source-bound peer research

**Goal:** Continue on v2.1.0 with safe source intake, shared peer identities, comparable products/audiences and an auditable bridge to regional OD; preserve all old57 execution and UI behaviour.
**Spec:** Packaged, hash-locked `research/planning-v1.2/unified-data.json.br`, v1.2. Owns a bounded implementation of 3.04–3.06 and the 2.04 input bridge, not automatic certification of these whole modules.
**Architecture:** Reuse parse5 (existing dependency), regional selectors/geometry/schema and safe immutable run storage. DSH supplies candidate decisions and exact source bindings; the program checks captures and produces deterministic comparisons, not an LLM or new harness. No new dependencies, network off, customer documents never included in public examples.

## Constraints / rulings
- Actual remote HEAD at start is ea515c3; M2 candidate passed remote focused/full/built checks but commit failed with author identity. Integrate its exact files plus this milestone by authenticated non-force GitHub commit; retire one-time materialization workflow, keep regression CI.
- Eight chapters/62 specs unchanged. `peerId` is an explicit stable branch/site identity; same name does not merge entities. Geographic nearness is not the classification rule for competitor vs external reference.
- Source captures support JSON, UTF-8 text and HTML (parse5 text nodes; no scripts executed). Local workspace files are read with existing bounded no-symlink checks. No automatic name-to-coordinate guess or search snippet promotion.
- Sources are evidence records, not instructions. Every field must resolve to the archived source pointer or unique exact text quote; unsupported/ambiguous bindings fail closed. Original text is retained.
- Missing differs from zero; contradictory scalar evidence stays conflict, never latest-wins. Price comparisons require identical explicit basis/unit/currency/period and never imply profitability. Observed audiences need sample/method context or remain unverified.
- All products remain limited research artifacts, publicationGranted:false. No official approval or old workflow advancement.
- Conditions/source authenticity require professional review; hashes/replay only prove internal consistency.

## Tasks (TDD)
1. Source intake and field-binding contracts: JSON/text/HTML capture, exact pointers/quotes, dates, rights, source classes; reject conflicts in IDs, unsafe paths and covert conversions. Files: source-intake.ts, peer-schema.ts; tests source + peers.
2. Deterministic peer comparison: inclusion register, products/price groups, target vs observed audiences and operating metrics. Shared peer IDs and optional source-bound regional request (max6 OD pairs, missing coordinates listed not guessed). Files peer-analysis.ts; test differences/conflicts/missing/bridge.
3. Render and audit: same-data HTML/CSV/SVG matrix, source and decision references, independent replay; generic immutable run-store plumbing without weakening regional validation. Files peer-bundle.ts, run-store.ts; tests replay/tampering/storage.
4. Real DSH command, package exports, example, documentation: /preplan-research-peers --input / --verify. Existing bound workspace checks/revision guard reused. Tests command/host/package; synthetic demo only.
5. Final self-review, focused/typecheck/build/regression, atomic remote integration and CI verification; handoff with exact passed/untested boundaries.

## Review focus
- A promotional article stating target clientele must not become observed clientele.
- Two outlets with identical names remain separate peer IDs; inconsistent identity/location sources remain visible conflicts.
- Missing prices and metrics never become zero; incompatible packages/time bases never enter one comparison group.
- Source-controlled markup, formulas and fake instructions never execute; unreferenced sources and missing provenance fail.
- A rehashed but altered chart/result, stale source file, other project, path escape or symlink must be rejected.
