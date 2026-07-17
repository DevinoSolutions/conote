import type { Editor } from '@tiptap/core'
import { useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { SAMPLE_CONTENT, buildExtensions } from './ai-config'
import { GenerationToolbar } from './components/GenerationToolbar'
import { EditWithAiPanel } from './components/EditWithAiPanel'
import { AgentChatPanel } from './components/AgentChatPanel'
import { ProofreadPanel } from './components/ProofreadPanel'

export function App() {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: SAMPLE_CONTENT,
    autofocus: 'end',
  })

  // Expose the live Editor for debugging and automated browser testing. The E2E
  // suite waits on `window.editor.state` and reads storage straight off it.
  useEffect(() => {
    ;(window as unknown as { editor: Editor }).editor = editor
  }, [editor])

  return (
    <div className="wrap">
      <header>
        <h1>CoNote Demo</h1>
        <p>
          AI Generation and Proofreading for Tiptap, streamed through a self-hosted proxy. Select
          text, then try the tools below, or run "Check document" to proofread.
        </p>
      </header>

      <GenerationToolbar editor={editor} />
      <EditWithAiPanel editor={editor} />
      <AgentChatPanel editor={editor} />
      <ProofreadPanel editor={editor} />

      <footer>
        Part of <strong>CoNote</strong>, an open-source fork of Tiptap. Not affiliated with or
        endorsed by Tiptap GmbH. MIT licensed.
      </footer>
    </div>
  )
}
