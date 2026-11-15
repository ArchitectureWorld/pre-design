// Shared by the browser, parser, storage, and model boundary.
export const PDF_REFERENCE_MAX_BYTES = 100 * 1024 * 1024
export const OTHER_REFERENCE_MAX_BYTES = 24 * 1024 * 1024
export const MAX_REFERENCE_BYTES = PDF_REFERENCE_MAX_BYTES
export const MAX_REFERENCE_PDF_PAGES = 30
export const MAX_REFERENCE_IMAGES = 64
export const MAX_REFERENCE_IMAGE_BYTES = 200 * 1024 * 1024
export const MAX_REFERENCE_TEXT = 192000
export const PDF_REFERENCE_TEXT_CHARACTERS = 96000
export const UPLOAD_TIMEOUT_MS = 600000
export const PDF_PARSE_TIMEOUT_MS = 300000
export const REFERENCE_ANALYSIS_TIMEOUT_MS = 600000
export const referenceByteLimit = filename => /\.pdf$/i.test(filename ?? '') ? PDF_REFERENCE_MAX_BYTES : OTHER_REFERENCE_MAX_BYTES
export const referenceLimitLabel = filename => /\.pdf$/i.test(filename ?? '') ? '100 MiB' : '24 MiB'
