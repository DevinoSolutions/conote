import type { Editor } from '@tiptap/core'
import { useCallback, useRef } from 'react'
import { useSyncExternalStore } from 'react'

// The four AI extensions expose a lifecycle `state` string on their storage.
// 'idle' means quiescent; anything else means a request is in flight.
type WithState = { state?: string }

function stateOf(storage: unknown): string {
  return (storage as WithState | undefined)?.state ?? 'idle'
}

/** True while ANY of the four AI extensions is mid-request. Drives the poll. */
export function anyAiBusy(editor: Editor): boolean {
  const s = editor.storage
  return (
    stateOf(s.ai) !== 'idle' ||
    stateOf(s.aiChanges) !== 'idle' ||
    stateOf(s.aiSuggestion) !== 'idle' ||
    stateOf(s.aiAgent) !== 'idle'
  )
}

/**
 * Reactive clock for the AI panels. Returns a version number that increments on
 * every editor transaction (the primary, transaction-driven path — the same
 * signal `useEditorState` subscribes to) unioned with a lightweight ~150 ms poll
 * that runs ONLY while an AI extension is non-idle.
 *
 * The poll exists because some storage fields (the agent's `streamingText`, an
 * intermediate `pending` state) mutate between transactions and would otherwise
 * not surface until the next unrelated transaction. When the app is idle there
 * is zero polling — the interval is torn down the moment everything settles.
 *
 * Components read the volatile scalar fields (`state`, `error`, `streamingText`)
 * directly from `editor.storage` in render; consuming this hook is what makes
 * those reads re-run. Structural, transaction-only data (lists, transcript)
 * still goes through `useEditorState` for its deep-equal memoization.
 */
export function useAiTick(editor: Editor): number {
  const versionRef = useRef(0)

  const subscribe = useCallback(
    (notify: () => void) => {
      let intervalId: ReturnType<typeof setInterval> | undefined

      const bump = (): void => {
        versionRef.current += 1
        notify()
      }

      const stopPoll = (): void => {
        if (intervalId !== undefined) {
          clearInterval(intervalId)
          intervalId = undefined
        }
      }

      const startPoll = (): void => {
        if (intervalId === undefined && anyAiBusy(editor)) {
          intervalId = setInterval(() => {
            bump()
            if (!anyAiBusy(editor)) {
              stopPoll()
            }
          }, 150)
        }
      }

      const onTransaction = (): void => {
        bump()
        if (anyAiBusy(editor)) {
          startPoll()
        } else {
          stopPoll()
        }
      }

      editor.on('transaction', onTransaction)
      // Cover the case where a request is already in flight at subscribe time.
      startPoll()

      return () => {
        editor.off('transaction', onTransaction)
        stopPoll()
      }
    },
    [editor],
  )

  return useSyncExternalStore(
    subscribe,
    () => versionRef.current,
    () => 0,
  )
}
