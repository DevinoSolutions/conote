import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { AiChange, AiChangesStorage } from './types.js'

/** Authoritative state for staged changes and their preview decorations. */
export interface AiChangesPluginState {
  changes: AiChange[]
  selectedId: string | null
  decorations: DecorationSet
}

export const aiChangesPluginKey = new PluginKey<AiChangesPluginState>('conoteAiChanges')

type AiChangesMeta =
  | { type: 'set'; changes: AiChange[] }
  | { type: 'select'; id: string | null }
  | { type: 'remove'; id: string }
  | { type: 'clear' }

/** CSS class on the deletion (strikethrough) part of a change. */
export const CHANGE_DEL_CLASS = 'conote-ai-change-del'
/** CSS class on the insertion (highlight) part of a change. */
export const CHANGE_INS_CLASS = 'conote-ai-change-ins'
/** Modifier suffix added to whichever parts belong to the selected change. */
export const CHANGE_SELECTED_SUFFIX = '--selected'

function buildDecorations(
  doc: ProseMirrorNode,
  changes: AiChange[],
  selectedId: string | null,
): DecorationSet {
  if (changes.length === 0) {
    return DecorationSet.empty
  }
  const decorations: Decoration[] = []
  for (const change of changes) {
    const selected = change.id === selectedId

    if (change.oldText !== '' && change.range.to > change.range.from) {
      const cls = selected
        ? `${CHANGE_DEL_CLASS} ${CHANGE_DEL_CLASS}${CHANGE_SELECTED_SUFFIX}`
        : CHANGE_DEL_CLASS
      decorations.push(
        Decoration.inline(
          change.range.from,
          change.range.to,
          { class: cls, 'data-change-id': change.id },
          { id: change.id },
        ),
      )
    }

    if (change.newText !== '') {
      const cls = selected
        ? `${CHANGE_INS_CLASS} ${CHANGE_INS_CLASS}${CHANGE_SELECTED_SUFFIX}`
        : CHANGE_INS_CLASS
      const changeId = change.id
      const newText = change.newText
      decorations.push(
        Decoration.widget(
          change.range.to,
          () => {
            const span = document.createElement('span')
            span.className = cls
            span.setAttribute('data-change-id', changeId)
            span.textContent = newText
            return span
          },
          { side: 1, key: `ins-${changeId}${selected ? CHANGE_SELECTED_SUFFIX : ''}` },
        ),
      )
    }
  }
  return DecorationSet.create(doc, decorations)
}

/**
 * Maps each change through a document-changing transaction. Deletion/replace
 * changes are dropped if the mapped range's text stops matching `oldText`
 * (invalidated by an edit inside them). Pure insertions have no text to compare,
 * so they are kept as a zero-width position unless the mapping deletes it.
 */
function mapChanges(tr: Transaction, doc: ProseMirrorNode, changes: AiChange[]): AiChange[] {
  const out: AiChange[] = []
  for (const change of changes) {
    if (change.oldText === '' && change.range.from === change.range.to) {
      const result = tr.mapping.mapResult(change.range.from, 1)
      if (result.deleted) {
        continue
      }
      out.push({ ...change, range: { from: result.pos, to: result.pos } })
      continue
    }
    const from = tr.mapping.map(change.range.from, 1)
    const to = tr.mapping.map(change.range.to, -1)
    if (to <= from) {
      continue
    }
    if (doc.textBetween(from, to, '\n') !== change.oldText) {
      continue
    }
    out.push({ ...change, range: { from, to } })
  }
  return out
}

/**
 * Creates the ProseMirror plugin that owns staged changes and renders them as
 * preview decorations without modifying the document. Changes are remapped
 * through every transaction and mirrored into `storage` after each view update.
 */
export function createAiChangesPlugin(config: {
  storage: AiChangesStorage
}): Plugin<AiChangesPluginState> {
  return new Plugin<AiChangesPluginState>({
    key: aiChangesPluginKey,
    state: {
      init(): AiChangesPluginState {
        return { changes: [], selectedId: null, decorations: DecorationSet.empty }
      },
      apply(tr, value, _oldState, newState): AiChangesPluginState {
        const meta = tr.getMeta(aiChangesPluginKey) as AiChangesMeta | undefined

        let changes = value.changes
        let selectedId = value.selectedId

        if (tr.docChanged) {
          changes = mapChanges(tr, newState.doc, changes)
        }

        if (meta) {
          if (meta.type === 'set') {
            changes = meta.changes
            selectedId = null
          } else if (meta.type === 'select') {
            selectedId = meta.id
          } else if (meta.type === 'remove') {
            changes = changes.filter(change => change.id !== meta.id)
          } else if (meta.type === 'clear') {
            changes = []
            selectedId = null
          }
        }

        if (selectedId && !changes.some(change => change.id === selectedId)) {
          selectedId = null
        }

        if (
          !meta &&
          !tr.docChanged &&
          changes === value.changes &&
          selectedId === value.selectedId
        ) {
          return value
        }

        return {
          changes,
          selectedId,
          decorations: buildDecorations(newState.doc, changes, selectedId),
        }
      },
    },
    props: {
      decorations(state) {
        return aiChangesPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },
    },
    view() {
      return {
        update(view) {
          const pluginState = aiChangesPluginKey.getState(view.state)
          if (!pluginState) {
            return
          }
          config.storage.changes = pluginState.changes
          config.storage.selectedId = pluginState.selectedId
        },
      }
    },
  })
}
