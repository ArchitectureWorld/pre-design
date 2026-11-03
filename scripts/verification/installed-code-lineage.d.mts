export function assertInstalledCodeLineage(installed: unknown, requestedSha256: unknown): {
  readonly depth: number
  readonly installedManifest: string
}
