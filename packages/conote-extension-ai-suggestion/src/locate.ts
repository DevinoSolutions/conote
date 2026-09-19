import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * A plain-text projection of the document paired with a per-character position
 * map. `text` is what we send to the model and search for `deleteText` in;
 * `posAt[i]` is the ProseMirror position of `text[i]`, or `-1` for synthetic
 * block separators that have no deletable position.
 */
export interface DocTextIndex {
  text: string
  posAt: number[]
}

/**
 * Walks the document's text nodes to build a plain-text projection. Text blocks
 * are joined with `\n` separators (marked `-1` in `posAt`) so that a
 * `deleteText` search cannot silently span a block boundary.
 */
export function buildDocTextIndex(doc: ProseMirrorNode): DocTextIndex {
  let text = ''
  const posAt: number[] = []

  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (text.length > 0) {
        text += '\n'
        posAt.push(-1)
      }
      return
    }
    if (node.isText) {
      const value = node.text ?? ''
      for (let i = 0; i < value.length; i++) {
        text += value[i]
        posAt.push(pos + i)
      }
    }
  })

  return { text, posAt }
}

/** The plain document text sent to the model. */
export function docPlainText(doc: ProseMirrorNode): string {
  return buildDocTextIndex(doc).text
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = []
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    found.push(index)
    index = haystack.indexOf(needle, index + 1)
  }
  return found
}

function toRange(
  index: DocTextIndex,
  start: number,
  length: number,
): { from: number; to: number } | null {
  for (let k = 0; k < length; k++) {
    const pos = index.posAt[start + k]
    if (pos == null || pos === -1) {
      return null
    }
  }
  return { from: index.posAt[start], to: index.posAt[start + length - 1] + 1 }
}

/**
 * Resolves a `deleteText` string to a ProseMirror range. When the text occurs
 * multiple times, `beforeText` (a short snippet the model reports as preceding
 * context) disambiguates; if it does not match any occurrence, the first
 * occurrence is used. Returns `null` when the text is empty, not found, or would
 * span a block boundary.
 */
export function locateSuggestion(
  index: DocTextIndex,
  deleteText: string,
  beforeText?: string,
): { from: number; to: number } | null {
  if (!deleteText) {
    return null
  }
  const found = occurrences(index.text, deleteText)
  if (found.length === 0) {
    return null
  }
  let chosen = found[0]
  if (beforeText) {
    const disambiguated = found.find(i => index.text.slice(0, i).endsWith(beforeText))
    if (disambiguated !== undefined) {
      chosen = disambiguated
    }
  }
  return toRange(index, chosen, deleteText.length)
}
