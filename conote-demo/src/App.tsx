import type { Editor } from '@tiptap/core'
import { useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { SAMPLE_CONTENT, buildExtensions } from './ai-config'
import { GenerationToolbar } from './components/GenerationToolbar'
import { EditorPanel } from './components/EditorPanel'
import { EditWithAiPanel } from './components/EditWithAiPanel'
import { AgentChatPanel } from './components/AgentChatPanel'
import { ProofreadPanel } from './components/ProofreadPanel'
import { BrandMark } from './components/icons'

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
    <div className="app">
      <header className="app-bar">
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">CoNote</span>
            <span className="brand-sub">AI writing console</span>
          </div>
        </div>
        <p className="app-tagline">
          Generation, tracked edits, an agent, and proofreading for Tiptap — streamed through a
          self-hosted proxy. Select text, then reach for a tool.
        </p>
        <div className="app-badges">
          <span className="badge">Open&nbsp;source</span>
          <span className="badge badge--accent">MIT</span>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-col" aria-label="Document">
          <GenerationToolbar editor={editor} />
          <EditorPanel editor={editor} />
        </section>

        <aside className="rail" aria-label="AI tools">
          <EditWithAiPanel editor={editor} />
          <AgentChatPanel editor={editor} />
          <ProofreadPanel editor={editor} />
        </aside>
      </main>

      <footer className="app-foot">
        Part of <strong>CoNote</strong>, an open-source fork of Tiptap. Not affiliated with or
        endorsed by Tiptap GmbH. Its own design language, hand-built UI, MIT licensed.
      </footer>
    </div>
  )
}
