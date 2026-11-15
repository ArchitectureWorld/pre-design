import {referenceByteLimit, UPLOAD_TIMEOUT_MS} from './reference-limits.mjs'

function abortError() {
  return new DOMException('操作已取消', 'AbortError')
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function httpError(status, data) {
  return Object.assign(new Error(data?.error || '请求失败'), {status})
}

function downloadFilename(disposition) {
  const extended = disposition?.match(/(?:^|;)\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i)
  const value = (extended?.[1] ?? extended?.[2] ?? '').trim()
  const encoded = value.match(/^UTF-8'[^']*'(.*)$/i)?.[1]
  if (encoded) {
    try {
      return decodeURIComponent(encoded)
    } catch { /* Invalid extended filenames must not prevent downloading the file. */ }
  }
  return disposition?.match(/filename="([^"]+)"/)?.[1] ?? 'layout.json'
}

function validateUploadFile(file, requestId) {
  if (!file || !Number.isFinite(file.size) || file.size < 0) throw new TypeError('请选择有效文件')
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new TypeError('请求编号不合法')
  if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 180 || /[\x00-\x1f\x7f/\\]/u.test(file.name)) {
    throw new TypeError('参考文件名不合法')
  }
  const maxBytes = referenceByteLimit(file.name)
  if (file.size > maxBytes) throw new RangeError(`文件大小超过上限（${maxBytes / 1024 / 1024} MiB）`)
}

/** Send files directly with XHR; keep ordinary JSON requests on fetch. */
export function createLayoutRequest({getToken, fetchImpl = globalThis.fetch, XMLHttpRequestCtor = globalThis.XMLHttpRequest}) {
  return async function request(path, options = {}) {
    throwIfAborted(options.signal)
    const hasBody = options.body !== undefined
    const hasFile = options.file !== undefined
    if (hasFile && hasBody) throw new TypeError('文件和 JSON 请求内容不能同时指定')
    if (hasFile) validateUploadFile(options.file, options.requestId)
    const headers = {
      Authorization: 'Bearer ' + getToken(),
      ...(hasFile ? {
        'Content-Type': 'application/octet-stream',
        'X-Reference-Filename': encodeURIComponent(options.file.name),
        'X-Reference-Request-Id': options.requestId,
      } : hasBody ? {'Content-Type': 'application/json'} : {}),
    }
    const body = hasFile ? options.file : hasBody ? JSON.stringify(options.body) : undefined
    const method = options.method ?? 'GET'
    const url = '/api' + path

    if (hasFile || (hasBody && typeof options.onUploadProgress === 'function')) {
      if (typeof XMLHttpRequestCtor !== 'function') throw new Error('当前环境不支持上传进度')
      return xhrRequest(XMLHttpRequestCtor, url, {...options, method, headers, body})
    }

    const response = await fetchImpl(url, {
      method, headers,
      ...(hasBody ? {body} : {}),
      ...(options.signal ? {signal: options.signal} : {}),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw httpError(response.status, data)
    }
    if (options.download) return {
      blob: await response.blob(),
      filename: downloadFilename(response.headers.get('Content-Disposition')),
    }
    return response.json()
  }
}

function xhrRequest(XMLHttpRequestCtor, url, {method, headers, body, signal, onUploadProgress, download}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequestCtor()
    let settled = false
    let uploaded = false
    const cleanup = () => {
      signal?.removeEventListener('abort', cancel)
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null
      xhr.upload.onprogress = xhr.upload.onload = null
    }
    const finish = (error, result) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result)
    }
    const cancel = () => {
      if (settled) return
      finish(abortError())
      xhr.abort()
    }

    xhr.upload.onprogress = event => {
      if (!settled && !uploaded && typeof onUploadProgress === 'function') onUploadProgress({
        phase: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : 0,
      })
    }
    xhr.upload.onload = () => {
      if (settled || uploaded) return
      uploaded = true
      if (typeof onUploadProgress === 'function') onUploadProgress({phase: 'parsing'})
    }
    xhr.onload = async () => {
      if (settled) return
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          let data = null
          try {
            const text = download ? await xhr.response.text() : xhr.responseText
            data = JSON.parse(text)
          } catch { /* Non-JSON upstream errors must still preserve HTTP status. */ }
          finish(httpError(xhr.status, data))
        } else if (download) {
          finish(null, {blob: xhr.response, filename: downloadFilename(xhr.getResponseHeader('Content-Disposition'))})
        } else {
          finish(null, JSON.parse(xhr.responseText))
        }
      } catch (error) {
        finish(error)
      }
    }
    xhr.onerror = () => finish(new Error('网络连接失败，请重试'))
    xhr.ontimeout = () => finish(Object.assign(new Error('上传或解析超时，请重试'), {name: 'TimeoutError'}))
    xhr.onabort = () => finish(abortError())
    signal?.addEventListener('abort', cancel, {once: true})

    try {
      if (signal?.aborted) return cancel()
      xhr.open(method, url, true)
      xhr.timeout = UPLOAD_TIMEOUT_MS
      if (download) xhr.responseType = 'blob'
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
      xhr.send(body)
    } catch (error) {
      finish(error)
    }
  })
}

function readFileBuffer(file, {signal, onProgress}) {
  if (typeof globalThis.FileReader !== 'function') {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, result) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', cancel)
        if (error) reject(error)
        else resolve(result)
      }
      const cancel = () => finish(abortError())
      signal?.addEventListener('abort', cancel, {once: true})
      try {
        if (signal?.aborted) return cancel()
        // arrayBuffer has no progress events or native abort; discard a late result.
        Promise.resolve(file.arrayBuffer()).then(result => finish(null, result), finish)
      } catch (error) {
        finish(error)
      }
    })
  }

  return new Promise((resolve, reject) => {
    const reader = new globalThis.FileReader()
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', cancel)
      reader.onload = reader.onerror = reader.onabort = reader.onprogress = null
      if (error) reject(error)
      else resolve(result)
    }
    const cancel = () => {
      if (settled) return
      finish(abortError())
      reader.abort()
    }
    reader.onprogress = event => {
      if (!settled && typeof onProgress === 'function') onProgress({
        phase: 'reading', loaded: event.loaded, total: event.lengthComputable ? event.total : 0,
      })
    }
    reader.onload = () => finish(null, reader.result)
    reader.onerror = () => finish(reader.error || new Error('文件读取失败'))
    reader.onabort = () => finish(abortError())
    signal?.addEventListener('abort', cancel, {once: true})
    try {
      if (signal?.aborted) return cancel()
      reader.readAsArrayBuffer(file)
    } catch (error) {
      finish(error)
    }
  })
}

/** Return file bytes as base64 without data-URL metadata or DOM dependencies. */
export async function readReferenceBase64(file, {signal, onProgress, maxBytes = referenceByteLimit(file?.name)} = {}) {
  throwIfAborted(signal)
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new RangeError('文件大小上限无效')
  if (!file || !Number.isFinite(file.size) || file.size < 0) throw new TypeError('请选择有效文件')
  const checkSize = bytes => {
    if (bytes > maxBytes) throw new RangeError(`文件大小超过上限（${maxBytes / 1024 / 1024} MiB）`)
  }
  checkSize(file.size)
  const buffer = await readFileBuffer(file, {signal, onProgress})
  throwIfAborted(signal)
  if (!buffer || !Number.isFinite(buffer.byteLength)) throw new Error('文件读取失败')
  checkSize(buffer.byteLength)
  const bytes = new Uint8Array(buffer)
  const chunks = []
  // Multiples of three keep padding confined to the final base64 chunk.
  const chunkSize = 3 * 8192
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    throwIfAborted(signal)
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))))
  }
  return chunks.join('')
}
