import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import type { DiffHunk } from './diff.js'

/**
 * A plain-text projection of the document (or a slice of it) paired with a
 * per-character position map. `text` is what we send to the model and diff;
 * `posAt[i]` is the ProseMirror position of `text[i]`, or `-1` for the synthetic
 * `\n` block separators, which have no deletable position.
 */
export interface DocTextIndex {
  text: string
  posAt: number[]
}

/**
 * Builds a plain-text projection over the document range `[from, to)`. Text
 * blocks are joined with `\n` separators (marked `-1` in `posAt`) so that a hunk
 * cannot silently span a block boundary. With no range it projects the whole doc.
 */
export function buildDocTextIndex(
  doc: ProseMirrorNode,
  from = 0,
  to = doc.content.size,
): DocTextIndex {
  let text = ''
  const posAt: number[] = []
  let sawText = false
  let pendingSeparator = false

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (sawText) {
        pendingSeparator = true
      }
      return
    }
    if (node.isText) {
      const value = node.text ?? ''
      for (let i = 0; i < value.length; i++) {
        const charPos = pos + i
        if (charPos < from || charPos >= to) {
          continue
        }
        if (pendingSeparator) {
          text += '\n'
          posAt.push(-1)
          pendingSeparator = false
        }
        text += value[i]
        posAt.push(charPos)
        sawText = true
      }
    }
  })

  return { text, posAt }
}

/** The plain document text sent to the model. */
export function docPlainText(doc: ProseMirrorNode, from?: number, to?: number): string {
  return buildDocTextIndex(doc, from, to).text
}

/** Resolves a plain-text offset to the ProseMirror position an insertion should anchor at. */
function positionAtOffset(index: DocTextIndex, offset: number): number | null {
  const { posAt } = index
  if (offset < posAt.length && posAt[offset] !== -1) {
    return posAt[offset]
  }
  if (offset > 0 && posAt[offset - 1] != null && posAt[offset - 1] !== -1) {
    return posAt[offset - 1] + 1
  }
  return null
}

/**
 * Anchors a diff hunk to a ProseMirror range using the projection. Pure
 * insertions (`oldStart === oldEnd`) resolve to a single position (`from === to`).
 * Returns `null` when the hunk touches a block separator (i.e. would span a block
 * boundary) or cannot be placed.
 */
export function anchorHunk(
  index: DocTextIndex,
  hunk: DiffHunk,
): { from: number; to: number } | null {
  const { oldStart, oldEnd } = hunk
  if (oldStart === oldEnd) {
    const pos = positionAtOffset(index, oldStart)
    return pos == null ? null : { from: pos, to: pos }
  }
  for (let k = oldStart; k < oldEnd; k++) {
    if (index.posAt[k] == null || index.posAt[k] === -1) {
      return null
    }
  }
  return { from: index.posAt[oldStart], to: index.posAt[oldEnd - 1] + 1 }
}
