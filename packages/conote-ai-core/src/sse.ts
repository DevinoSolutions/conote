/**
 * Incremental Server-Sent Events line parser.
 *
 * Feed it raw decoded string chunks (which may be split at arbitrary byte
 * boundaries, including mid-line) and it returns the value of each complete
 * `data:` field found so far. Comments (lines starting with `:`), empty lines
 * and other SSE fields are ignored — this parser only surfaces `data` payloads,
 * which is all the OpenAI-compatible streaming protocol uses.
 *
 * Handles LF and CRLF line endings. A trailing partial line is retained until
 * more input arrives or `flush()` is called.
 */
export class SseLineParser {
  private buffer = ''

  /** Feed a chunk of text; returns each complete `data:` payload found. */
  push(chunk: string): string[] {
    this.buffer += chunk

    const out: string[] = []
    let newlineIndex: number
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex)
      this.buffer = this.buffer.slice(newlineIndex + 1)

      const data = parseDataLine(stripCr(line))
      if (data !== undefined) {
        out.push(data)
      }
    }
    return out
  }

  /** Return any final line left in the buffer that was not newline-terminated. */
  flush(): string[] {
    if (this.buffer.length === 0) {
      return []
    }

    const line = this.buffer
    this.buffer = ''

    const data = parseDataLine(stripCr(line))
    return data !== undefined ? [data] : []
  }
}

/** Normalize CRLF by dropping a trailing carriage return. */
function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Return the payload of a `data:` line, or undefined for comments, empty lines
 * and non-data fields. Per the SSE spec a single optional space after the colon
 * is stripped.
 */
function parseDataLine(line: string): string | undefined {
  if (line === '' || line.startsWith(':') || !line.startsWith('data:')) {
    return undefined
  }

  const value = line.slice('data:'.length)
  return value.startsWith(' ') ? value.slice(1) : value
}
