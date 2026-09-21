# Planning cartography

This module acquires geographic evidence and renders deterministic maps. It never calls an image model, infers coordinates from prose, invents competitors, turns distance rings into driving isochrones, or grants a legal boundary status.

```ts
import {
  planningLocationEvidenceFromSources,
  resolvePlanningLocation,
  createPublicMapProviders,
  preparePlanningAnalysis,
} from './cartography/index.ts'

const evidence = planningLocationEvidenceFromSources(sourceMappedFacts)
const resolved = await resolvePlanningLocation({
  projectName,
  evidence,
  outputDirectory: evidenceCache,
  signal,
})
const result = await preparePlanningAnalysis({
  projectId,
  pageId,
  title,
  kind: 'regional-context',
  location: resolved.location,
  nodes: sourcedNodes,
  requiredEvidence: ['basemap', 'location'],
  outputDirectory: evidenceCache,
  signal,
}, sharedPublicProviders)
```

Create `sharedPublicProviders = createPublicMapProviders()` once per export to reuse downloaded tiles. Fetch, basemap, route, geocoding and clock dependencies are injectable. Network requests use no API credentials: bounded OpenStreetMap Standard raster requests, Nominatim with serialized requests, and OSRM's public driving service. Every downloaded response is saved with URL, retrieval date and SHA-256. Cache directories are new for every run and never overwrite source material or existing evidence.

`planningLocationEvidenceFromSources` consumes the upstream source map's explicit `project-location` role. A source fact has `text`, `source`, optional `placeName`, `contextTerms` and `coordinate`. Coordinate records require a declared CRS. Text-only lookup requires context terms present in the original text and a candidate matching both the place name and every supplied context term. Conflicts and multiple matches remain missing or ambiguous. No ranking-based choice is made. This is a trust boundary: callers must map actual source facts, not generated scenes or model assertions, into these inputs.

`preparePlanningAnalysis` returns `ready`, `partial` or `blocked` plus:

- `assets[].adoptedAsset`: standard `PresentationAdoptedAssetInput`, role `map`, bound only to the requested page.
- `assets[].analysisKind` and `cartography`: existing client report contracts. Preserve these when projecting the adopted asset. Audience/route graphics use `accessibility`; competitor/regional graphics use `regional-context`.
- `assets[].metadataPath`: machine-readable evidence, original coordinate systems, WGS84 positions, viewport/projection, scale latitude, routes with road snap offsets, measurement methods and gaps. Original SVG is adjacent to the raster. `metadata.attributionHtmlPath` identifies a standalone HTML map with full original attribution, copyright/license links and technical details. The Chinese client raster retains translated visible contributor credit, north, scale and measurement units.
- `evidence`: locations, source provenance, straight distances, basemap and route facts. Connect these to the report evidence registry; do not treat a map asset alone as support for an unrelated numerical claim.
- `gaps`: unmet claims. A partial asset can illustrate what was verified, but cannot satisfy the missing claim. A blocked result contains no placeholder or generated scene.

Supported `requiredEvidence` tokens: `basemap`, `location`, `nodes`, `roads`, `straight-distance`, `driving-route`, `driving-time`, `competitors`, `boundary`. `isochrone` and `audience` currently always produce explicit gaps. Other unsupported tokens also remain missing. Only request tokens needed by the actual page claim.

WGS84 / EPSG:4326 and explicit EPSG:3857 coordinates are supported. GCJ-02 / BD-09 return a gap instead of being approximated silently. Driving times are OSRM road-network estimates, do not include live traffic, and do not establish site access permission or an entrance. The default maximum road snap is 1,000 m; both provider snap distance and actual coordinate separation are checked and disclosed. Geodesic rings and distances use mean Earth radius 6,371,008.8 m and never provide customer counts or driving catchments. Public map coverage varies and is not a survey.

Research polygons require source and closed coordinates and are labeled research-only. Confirmed boundaries are intentionally left to the existing project boundary service: a caller-provided status or hash string cannot grant confirmation here.

Regression command:

```text
pnpm exec vitest run tests/planning-cartography.spec.ts tests/planning-cartography-resolver.spec.ts tests/planning-cartography-providers.spec.ts --maxWorkers=1
```

`src/presentation/report-cartography.ts` exposes the report integration:

```ts
prepareReportCartography(demand, frozenProject, workspaceRoot, signal)
```

The helper prefers an explicit canonical project name over a workspace slug. Regional/city scales include sourced administrative context nodes; site/node/scene scales use an actual local viewport without city centers. `origin.method` contains the corroborated location claim and its evidence manifest SHA-256 for inspection. Cache validation also verifies this claim and the companion attribution HTML bytes.

It extracts only formal project-location source fields (not resource/scene locations), resolves administrative context nodes from the same source statement, and requests a driving route only for an accessibility demand. It returns ready assets with `analysisKind`, `cartography`, `provenance`, `analysisEvidence` and `analysisEvidencePath`. Gaps are saved independently under `.pre-design/report-cartography/issues`; unsupported numerical claims do not become adopted assets. The generated evidence and geographic source responses remain in `.pre-design/report-cartography`.

Cache reuse verifies the project source fingerprint, demand/slot fingerprint, source snapshots, geographic response files, map responses, image bytes, evidence metadata and page bindings. Cached claims are compared with the verified evidence manifest. Altered bytes or claims trigger fresh acquisition, and receipts retained by the in-process location resolver are also checked before reuse. Cache age is limited to seven days. `createReportCartographyPreparer(dependencies)` exposes the same four-argument function with injectable network/providers for regression tests; all geographic rendering and cache validation remain real.
