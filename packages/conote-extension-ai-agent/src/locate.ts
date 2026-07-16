import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * A plain-text projection of the document paired with a per-character position
 * map. `text` is what the agent reads and searches; `posAt[i]` is the
 * ProseMirror position of `text[i]`, or `-1` for the synthetic `\n` block
 * separators, which have no single deletable position.
 *
 * This mirrors the projection technique used by the sibling AiChanges and
 * AiSuggestion extensions; it is duplicated here so this package stays
 * independently publishable rather than importing across extension packages.
 */
export interface DocTextIndex {
  text: string
  posAt: number[]
}

/**
 * Builds a plain-text projection over the document range `[from, to)`. Text
 * blocks are joined with `\n` separators (marked `-1` in `posAt`) so a match
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

/** The plain document text the agent reads. */
export function docPlainText(doc: ProseMirrorNode, from?: number, to?: number): string {
  return buildDocTextIndex(doc, from, to).text
}

/** Resolves a plain-text offset to the ProseMirror position an insertion should anchor at. */
export function positionAtOffset(index: DocTextIndex, offset: number): number | null {
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
 * Anchors a plain-text range `[start, end)` to a ProseMirror range. Empty ranges
 * (`start === end`) resolve to a single insertion position (`from === to`).
 * Returns `null` when the range touches a block separator (i.e. would span a
 * block boundary) or cannot be placed.
 */
export function anchorRange(
  index: DocTextIndex,
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (start === end) {
    const pos = positionAtOffset(index, start)
    return pos == null ? null : { from: pos, to: pos }
  }
  for (let k = start; k < end; k++) {
    if (index.posAt[k] == null || index.posAt[k] === -1) {
      return null
    }
  }
  return { from: index.posAt[start], to: index.posAt[end - 1] + 1 }
}
