const CLIENT_SEGMENTER = new Intl.Segmenter('zh-CN', { granularity: 'word' })
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const CLIENT_CHUNK_WIDTH = 6
export const CLIENT_PROTECTED_PHRASES = [
  '项目所处的区域网络',
  '公共界面与运营模型',
  '降低一次性投入风险',
  '全天候使用',
  '滨江文化活力区',
  '滨水资源',
  '行动层',
  '公共界面',
  '项目所处的',
  '可使用',
  '可运营',
  '首期同步介入',
  '待项目实测校核',
  '亲水界面',
  '分阶段',
  '重叠需求',
  '运营启动的共同需求排序',
  '形成持续发生的城市生活目的地',
] as const
const CLIENT_PROTECTED_PHRASE_SET = new Set<string>(CLIENT_PROTECTED_PHRASES)
const CLIENT_PROTECTED_PHRASE_PATTERN = new RegExp(
  `(${[...CLIENT_PROTECTED_PHRASES].sort((left, right) => right.length - left.length).join('|')})`,
  'u',
)

type ClientSegment = Readonly<{
  segment: string
  isWordLike: boolean
}>

export function clientCharacterWidth(character: string): number {
  return /[\x00-\xff]/u.test(character) ? 0.55 : 1
}

export function clientTextWidth(value: string): number {
  return [...value].reduce((width, character) => width + clientCharacterWidth(character), 0)
}

function semanticSegments(value: string): ClientSegment[] {
  const rawSegments: ClientSegment[] = value.split(CLIENT_PROTECTED_PHRASE_PATTERN).flatMap(piece => (
    CLIENT_PROTECTED_PHRASE_SET.has(piece)
      ? [{ segment: piece, isWordLike: true }]
      : [...CLIENT_SEGMENTER.segment(piece)].map(segment => ({
          segment: segment.segment,
          isWordLike: segment.isWordLike === true,
        }))
  ))
  const segments: ClientSegment[] = []
  for (let index = 0; index < rawSegments.length; index += 1) {
    const current = rawSegments[index]!
    const next = rawSegments[index + 1]
    const previous = segments.at(-1)
    if (current.isWordLike && current.segment === '所'
      && next?.isWordLike === true && next.segment.startsWith('处')
      && previous?.isWordLike === true) {
      segments.pop()
      segments.push({
        segment: `${previous.segment}${current.segment}${next.segment}`,
        isWordLike: true,
      })
      index += 1
      continue
    }
    segments.push(current)
  }
  return segments
}

function segmentPiece(value: string): string[] {
  const chunks: string[] = []
  let buffer = ''
  let bufferWidth = 0
  const flush = (): void => {
    if (buffer !== '') chunks.push(buffer)
    buffer = ''
    bufferWidth = 0
  }

  for (const segment of semanticSegments(value)) {
    const copy = segment.segment
    const width = clientTextWidth(copy)
    if (segment.isWordLike === true) {
      if (buffer !== '' && bufferWidth + width > CLIENT_CHUNK_WIDTH) flush()
      buffer += copy
      bufferWidth += width
      continue
    }
    if (buffer === '' && chunks.length > 0) {
      chunks[chunks.length - 1] += copy
      continue
    }
    buffer += copy
    bufferWidth += width
  }
  flush()
  return chunks
}

export function clientTextChunks(value: string): string[] {
  return value.split(/(\d{4}-\d{2}-\d{2}|\n)/u).flatMap(piece => {
    if (piece === '') return []
    if (piece === '\n' || ISO_DATE.test(piece)) return [piece]
    return segmentPiece(piece)
  })
}

function splitOversizedChunk(chunk: string, maximumLineWidth: number): string[] {
  const pieces: string[] = []
  let current = ''
  let width = 0
  for (const character of [...chunk]) {
    const nextWidth = clientCharacterWidth(character)
    if (current !== '' && width + nextWidth > maximumLineWidth) {
      pieces.push(current)
      current = character
      width = nextWidth
    } else {
      current += character
      width += nextWidth
    }
  }
  if (current !== '') pieces.push(current)
  return pieces
}

function wrapSourceLine(sourceLine: string, maximumLineWidth: number): string[] {
  const chunks = clientTextChunks(sourceLine).flatMap(chunk => (
    clientTextWidth(chunk) <= maximumLineWidth ? [chunk] : splitOversizedChunk(chunk, maximumLineWidth)
  ))
  const lines: string[][] = []
  let current: string[] = []
  let width = 0
  for (const chunk of chunks) {
    const nextWidth = clientTextWidth(chunk)
    if (current.length > 0 && width + nextWidth > maximumLineWidth) {
      lines.push(current)
      current = [chunk]
      width = nextWidth
    } else {
      current.push(chunk)
      width += nextWidth
    }
  }
  if (current.length > 0 || sourceLine === '') lines.push(current)

  const tail = lines.at(-1)
  const previous = lines.at(-2)
  while (tail !== undefined && previous !== undefined && clientTextWidth(tail.join('')) < 3 && previous.length > 1) {
    const moved = previous.at(-1)!
    if (clientTextWidth(moved + tail.join('')) > maximumLineWidth) break
    previous.pop()
    tail.unshift(moved)
  }
  return lines.map(line => line.join(''))
}

export function wrapClientText(
  text: string,
  maximumLineWidth: number,
  maximumLines: number,
  errorCode: string,
): string {
  const lines = text.split('\n').flatMap(sourceLine => wrapSourceLine(sourceLine, maximumLineWidth))
  if (lines.length > maximumLines) {
    throw new Error(`${errorCode}: ${text.replaceAll('\n', ' / ')}`)
  }
  return lines.join('\n')
}
