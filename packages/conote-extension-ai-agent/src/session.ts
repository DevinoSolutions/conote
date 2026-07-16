import type { Editor } from '@tiptap/core'

import { anchorRange, buildDocTextIndex, docPlainText, positionAtOffset } from './locate.js'
import type { DocTextIndex } from './locate.js'
import { INSERT_TEXT, READ_DOCUMENT, REPLACE_TEXT } from './tools.js'
import type { AiAgentApplyMode } from './types.js'

/**
 * An accumulated edit, expressed in ORIGINAL-document plain-text offsets so it
 * can be anchored to a real ProseMirror range at the end of the loop. Edits are
 * non-overlapping in original coordinates. A pure insertion has `oStart === oEnd`
 * and `oldText === ''`; a deletion has `newText === ''`.
 */
interface StagedEdit {
  oStart: number
  oEnd: number
  oldText: string
  newText: string
}

/** A staged change ready for `aiChangesSet` (a real ProseMirror range + old/new text). */
export interface StagedChange {
  range: { from: number; to: number }
  oldText: string
  newText: string
}

/** Runs a tool call and stages/applies its effect; `read_document` returns text. */
export interface EditSession {
  execute(name: string, args: Record<string, unknown>): string
  /** Returns the staged changes (review mode only; direct mode returns `[]`). */
  collect(): StagedChange[]
}

/** Locates `find` in `text`, optionally requiring `beforeContext` immediately before it. */
function findMatch(
  text: string,
  find: string,
  beforeContext?: string,
): { start: number; end: number } | null {
  if (find.length === 0) {
    return null
  }
  if (typeof beforeContext === 'string' && beforeContext.length > 0) {
    const idx = text.indexOf(beforeContext + find)
    if (idx === -1) {
      return null
    }
    const start = idx + beforeContext.length
    return { start, end: start + find.length }
  }
  const idx = text.indexOf(find)
  if (idx === -1) {
    return null
  }
  return { start: idx, end: idx + find.length }
}

/** Reconstructs the virtual text: original text with all staged edits applied. */
function buildVirtualText(originalText: string, edits: StagedEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.oStart - b.oStart)
  let out = ''
  let cursor = 0
  for (const edit of sorted) {
    if (edit.oStart > cursor) {
      out += originalText.slice(cursor, edit.oStart)
    }
    out += edit.newText
    cursor = Math.max(cursor, edit.oEnd)
  }
  out += originalText.slice(cursor)
  return out
}

interface Segment {
  vStart: number
  vEnd: number
  oStart: number
  oEnd: number
  kind: 'orig' | 'ins'
}

/** Splits the virtual text into original and inserted segments for offset mapping. */
function buildSegments(originalText: string, edits: StagedEdit[]): Segment[] {
  const sorted = [...edits].sort((a, b) => a.oStart - b.oStart)
  const segments: Segment[] = []
  let cursor = 0
  let v = 0
  for (const edit of sorted) {
    if (edit.oStart > cursor) {
      const len = edit.oStart - cursor
      segments.push({ vStart: v, vEnd: v + len, oStart: cursor, oEnd: edit.oStart, kind: 'orig' })
      v += len
    }
    const insLen = edit.newText.length
    segments.push({ vStart: v, vEnd: v + insLen, oStart: edit.oStart, oEnd: edit.oEnd, kind: 'ins' })
    v += insLen
    cursor = Math.max(cursor, edit.oEnd)
  }
  if (cursor < originalText.length) {
    const len = originalText.length - cursor
    segments.push({
      vStart: v,
      vEnd: v + len,
      oStart: cursor,
      oEnd: originalText.length,
      kind: 'orig',
    })
  }
  return segments
}

/** Finds the segment whose virtual span contains offset `v`. */
function segmentAt(segments: Segment[], v: number): Segment | null {
  for (const seg of segments) {
    if (v >= seg.vStart && v < seg.vEnd) {
      return seg
    }
  }
  return null
}

/** Review-mode session: accumulate edits against a virtual text, anchor at the end. */
class ReviewSession implements EditSession {
  private readonly originalText: string
  private readonly index: DocTextIndex
  private readonly edits: StagedEdit[] = []

  constructor(private readonly editor: Editor) {
    const doc = editor.state.doc
    this.index = buildDocTextIndex(doc)
    this.originalText = this.index.text
  }

  execute(name: string, args: Record<string, unknown>): string {
    if (name === READ_DOCUMENT) {
      return buildVirtualText(this.originalText, this.edits)
    }
    if (name === REPLACE_TEXT) {
      return this.replaceText(args)
    }
    if (name === INSERT_TEXT) {
      return this.insertText(args)
    }
    return `Unknown tool: ${name}`
  }

  collect(): StagedChange[] {
    const changes: StagedChange[] = []
    for (const edit of this.edits) {
      const range = anchorRange(this.index, edit.oStart, edit.oEnd)
      if (!range) {
        continue
      }
      changes.push({ range, oldText: edit.oldText, newText: edit.newText })
    }
    return changes
  }

  private replaceText(args: Record<string, unknown>): string {
    const find = args.find
    const replace = args.replace
    if (typeof find !== 'string' || typeof replace !== 'string') {
      return 'Error: replace_text needs string "find" and "replace" arguments.'
    }
    const beforeContext = typeof args.before_context === 'string' ? args.before_context : undefined

    const virtualText = buildVirtualText(this.originalText, this.edits)
    const match = findMatch(virtualText, find, beforeContext)
    if (!match) {
      return `Not found: ${JSON.stringify(find)}. Read the document and try a different quote.`
    }

    const segments = buildSegments(this.originalText, this.edits)
    const startSeg = segmentAt(segments, match.start)
    const endSeg = segmentAt(segments, match.end - 1)
    if (!startSeg || !endSeg) {
      return 'Error: could not locate the match within the document.'
    }

    // Expand the match to whole inserted segments so the merged edit maps onto a
    // contiguous original range.
    const oStart = startSeg.kind === 'orig' ? startSeg.oStart + (match.start - startSeg.vStart) : startSeg.oStart
    const vExpStart = startSeg.kind === 'orig' ? match.start : startSeg.vStart
    const oEnd = endSeg.kind === 'orig' ? endSeg.oStart + (match.end - endSeg.vStart) : endSeg.oEnd
    const vExpEnd = endSeg.kind === 'orig' ? match.end : endSeg.vEnd

    const range = anchorRange(this.index, oStart, oEnd)
    if (!range) {
      return 'Could not map the match to a document range (it spans a block boundary). Edit one paragraph at a time.'
    }

    const newText =
      virtualText.slice(vExpStart, match.start) + replace + virtualText.slice(match.end, vExpEnd)
    const oldText = this.originalText.slice(oStart, oEnd)

    // Drop any prior edits fully covered by the expanded range; the merged edit
    // reproduces their content.
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i]
      const covered = e.oStart >= oStart && e.oEnd <= oEnd
      if (covered) {
        this.edits.splice(i, 1)
      }
    }
    this.edits.push({ oStart, oEnd, oldText, newText })

    return replace.length === 0
      ? `Deleted ${JSON.stringify(find)}.`
      : `Replaced ${JSON.stringify(find)} with ${JSON.stringify(replace)}.`
  }

  private insertText(args: Record<string, unknown>): string {
    const position = args.position
    const text = args.text
    if ((position !== 'start' && position !== 'end') || typeof text !== 'string') {
      return 'Error: insert_text needs position "start" | "end" and a string "text" argument.'
    }
    const offset = position === 'start' ? 0 : this.originalText.length
    // Ensure the insertion can be anchored to a real position before recording it.
    const pos = anchorInsertionPosition(this.index, this.editor, position)
    if (pos == null) {
      return 'Could not place the insertion in the document.'
    }
    this.edits.push({ oStart: offset, oEnd: offset, oldText: '', newText: text })
    return `Inserted text at ${position}.`
  }
}

/** Direct-mode session: apply each edit immediately via a transaction. */
class DirectSession implements EditSession {
  constructor(private readonly editor: Editor) {}

  execute(name: string, args: Record<string, unknown>): string {
    if (name === READ_DOCUMENT) {
      return docPlainText(this.editor.state.doc)
    }
    if (name === REPLACE_TEXT) {
      return this.replaceText(args)
    }
    if (name === INSERT_TEXT) {
      return this.insertText(args)
    }
    return `Unknown tool: ${name}`
  }

  collect(): StagedChange[] {
    return []
  }

  private replaceText(args: Record<string, unknown>): string {
    const find = args.find
    const replace = args.replace
    if (typeof find !== 'string' || typeof replace !== 'string') {
      return 'Error: replace_text needs string "find" and "replace" arguments.'
    }
    const beforeContext = typeof args.before_context === 'string' ? args.before_context : undefined

    const index = buildDocTextIndex(this.editor.state.doc)
    const match = findMatch(index.text, find, beforeContext)
    if (!match) {
      return `Not found: ${JSON.stringify(find)}. Read the document and try a different quote.`
    }
    const range = anchorRange(index, match.start, match.end)
    if (!range) {
      return 'Could not map the match to a document range (it spans a block boundary). Edit one paragraph at a time.'
    }
    this.editor.view.dispatch(this.editor.state.tr.insertText(replace, range.from, range.to))
    return replace.length === 0
      ? `Deleted ${JSON.stringify(find)}.`
      : `Replaced ${JSON.stringify(find)} with ${JSON.stringify(replace)}.`
  }

  private insertText(args: Record<string, unknown>): string {
    const position = args.position
    const text = args.text
    if ((position !== 'start' && position !== 'end') || typeof text !== 'string') {
      return 'Error: insert_text needs position "start" | "end" and a string "text" argument.'
    }
    const index = buildDocTextIndex(this.editor.state.doc)
    const pos = anchorInsertionPosition(index, this.editor, position)
    if (pos == null) {
      return 'Could not place the insertion in the document.'
    }
    this.editor.view.dispatch(this.editor.state.tr.insertText(text, pos, pos))
    return `Inserted text at ${position}.`
  }
}

/** Resolves the ProseMirror position for a start/end insertion, with an empty-doc fallback. */
function anchorInsertionPosition(
  index: DocTextIndex,
  editor: Editor,
  position: 'start' | 'end',
): number | null {
  const size = editor.state.doc.content.size
  if (index.text.length > 0) {
    const offset = position === 'start' ? 0 : index.text.length
    const pos = positionAtOffset(index, offset)
    if (pos != null) {
      return pos
    }
  }
  // Empty (or textless) document: fall back to just inside the first/last block.
  if (size <= 0) {
    return null
  }
  return position === 'start' ? Math.min(1, size) : Math.max(0, size - 1)
}

/** Creates the edit session for the given apply mode. */
export function createEditSession(editor: Editor, mode: AiAgentApplyMode): EditSession {
  return mode === 'direct' ? new DirectSession(editor) : new ReviewSession(editor)
}
