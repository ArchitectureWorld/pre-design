import { verifiedRasterImageDimensions } from '../../governance/site-boundary-asset-store.ts'

/** Some public JPEG servers pad files with NUL bytes. Keep the original bytes/hash;
 * validate their image stream without padding. Boundary uploads stay strict. */
export function reportImageDimensions(mime: 'image/jpeg' | 'image/png' | 'image/webp', bytes: Buffer) {
  let end = bytes.length
  if (mime === 'image/jpeg') while (end > 2 && bytes[end - 1] === 0) end--
  return verifiedRasterImageDimensions(mime, end === bytes.length ? bytes : bytes.subarray(0, end))
}
