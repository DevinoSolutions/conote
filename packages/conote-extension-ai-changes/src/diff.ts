/**
 * A single word-level edit hunk. Offsets are into the OLD plain text.
 * A pure insertion has `oldStart === oldEnd`; a pure deletion has `newText === ''`.
 */
export interface DiffHunk {
  /** Character offset in the old text where the replaced span begins. */
  oldStart: number
  /** Character offset in the old text where the replaced span ends (exclusive). */
  oldEnd: number
  /** Text that replaces `oldText.slice(oldStart, oldEnd)`. */
  newText: string
}

/** Product of token counts above which we skip the LCS table and fall back to one whole-text hunk. */
const LCS_BUDGET = 1_000_000

/** Collapses runs of whitespace to a single space and trims, for whitespace-insensitive comparison. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * True when `oldText` and `newText` carry the same visible characters in the same
 * order and differ only in whitespace (a reflow: single vs double space, stray
 * leading/trailing space). A word-boundary change such as `ab` -> `a b` is NOT
 * whitespace-only. Callers use this to drop hunks that would render as noise — a
 * struck-through word replaced by the identical word.
 */
export function isWhitespaceOnlyEdit(oldText: string, newText: string): boolean {
  return collapseWhitespace(oldText) === collapseWhitespace(newText)
}

/**
 * Splits text into diff tokens. A token is a word together with its trailing
 * horizontal whitespace (spaces, tabs); each newline is its own token so that
 * block boundaries survive diffing and anchoring intact. Concatenating the
 * tokens reproduces the input exactly.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const re = /\n|[^\S\n]*\S+[^\S\n]*|[^\S\n]+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[0])
  }
  return tokens
}

type Op =
  | { type: 'equal'; token: string }
  | { type: 'del'; token: string }
  | { type: 'ins'; token: string }

/**
 * Longest-common-subsequence alignment over two token arrays, emitted as a flat
 * op stream (equal / del / ins). Uses a full DP table; callers guard the size.
 */
function diffTokens(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }
  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'equal', token: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', token: a[i] })
      i++
    } else {
      ops.push({ type: 'ins', token: b[j] })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'del', token: a[i] })
    i++
  }
  while (j < m) {
    ops.push({ type: 'ins', token: b[j] })
    j++
  }
  return ops
}

/** Merges each maximal run of non-equal ops into one hunk; equal ops flush the run. */
function buildHunks(ops: Op[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let oldOffset = 0
  let inHunk = false
  let hunkStart = 0
  let hunkOldEnd = 0
  let hunkNew = ''

  const flush = () => {
    if (inHunk) {
      hunks.push({ oldStart: hunkStart, oldEnd: hunkOldEnd, newText: hunkNew })
      inHunk = false
      hunkNew = ''
    }
  }

  for (const op of ops) {
    if (op.type === 'equal') {
      flush()
      oldOffset += op.token.length
      continue
    }
    if (!inHunk) {
      inHunk = true
      hunkStart = oldOffset
      hunkOldEnd = oldOffset
      hunkNew = ''
    }
    if (op.type === 'del') {
      oldOffset += op.token.length
      hunkOldEnd = oldOffset
    } else {
      hunkNew += op.token
    }
  }
  flush()
  return hunks
}

/**
 * Word-level diff of `oldText` against `newText`, returned as hunks whose offsets
 * index into `oldText`. Returns `[]` when the texts are identical. Falls back to a
 * single whole-text replace hunk when the token counts would make the LCS table
 * too large.
 */
export function diffWords(oldText: string, newText: string): DiffHunk[] {
  if (oldText === newText) {
    return []
  }
  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)

  if (oldTokens.length * newTokens.length > LCS_BUDGET) {
    return [{ oldStart: 0, oldEnd: oldText.length, newText }]
  }

  return buildHunks(diffTokens(oldTokens, newTokens))
}
