const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}

export interface SessionToolResult {
  toolCallId: string
  isError: boolean
  content: unknown[]
}

/** Read current tool-role messages and archived pre-0.2 session events. */
export function sessionToolResults(data: unknown): SessionToolResult[] {
  const message = object(object(data).message)
  const values = message.role === 'tool' ? [message] : Array.isArray(message.content)
    ? message.content.filter(value => object(value).type === 'tool-result') : []
  return values.flatMap(value => {
    const block = object(value)
    return typeof block.toolCallId === 'string' && Array.isArray(block.content)
      ? [{ toolCallId: block.toolCallId, isError: block.isError === true, content: block.content }] : []
  })
}

/** Preserve native receipt metadata exactly for audit checks; missing isError is never approval. */
export function sessionToolReceipts(data: unknown): { toolCallId: string; isError: unknown; content: unknown }[] {
  const message = object(object(data).message)
  const values = message.role === 'tool' ? [message] : Array.isArray(message.content)
    ? message.content.filter(value => object(value).type === 'tool-result') : []
  return values.flatMap(value => {
    const block = object(value)
    return typeof block.toolCallId === 'string'
      ? [{ toolCallId: block.toolCallId, isError: block.isError, content: block.content }] : []
  })
}
