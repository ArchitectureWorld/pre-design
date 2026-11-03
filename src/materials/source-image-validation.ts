import sharp from 'sharp'
import { verifiedRasterImageDimensions } from '../governance/site-boundary-asset-store.ts'

/** Camera JPEGs may retain data after EOI. Decode their full pixel stream,
 * preserving the original file and hash. Generated/boundary images stay strict. */
export async function verifiedSourceImageDimensions(mime: 'image/jpeg' | 'image/png' | 'image/webp', bytes: Buffer) {
  try { return verifiedRasterImageDimensions(mime, bytes) } catch (error) {
    const eoi = bytes.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (mime !== 'image/jpeg' || bytes[0] !== 0xff || bytes[1] !== 0xd8 || eoi < 2 || eoi === bytes.length - 2) throw error
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 100_000_000 })
    const metadata = await image.metadata()
    if (metadata.format !== 'jpeg') throw error
    const { data, info } = await image.raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true })
    if (info.width < 1 || info.height < 1 || info.width !== metadata.width || info.height !== metadata.height
      || data.length !== info.width * info.height * info.channels) throw error
    return { width: info.width, height: info.height }
  }
}
