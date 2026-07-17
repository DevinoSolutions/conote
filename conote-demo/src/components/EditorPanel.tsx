import type { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { IconRewrite, IconSummarize, IconTone } from './icons'

/**
 * The editor surface. `EditorContent` mounts the ProseMirror view into a div
 * carrying `id="editor"` / `class="editor"` (so `#editor .ProseMirror` and the
 * existing styles keep working). A `BubbleMenu` floats over the current
 * selection with quick AI actions, wired to the same commands as the toolbar.
 */
export function EditorPanel({ editor }: { editor: Editor }) {
  return (
    <div className="editor-shell">
      <BubbleMenu editor={editor} className="bubble-menu">
        <span className="bubble-label" aria-hidden="true">
          AI
        </span>
        <button
          data-testid="bubble-rewrite"
          className="bubble-btn"
          title="Rewrite the selection"
          onClick={() => editor.chain().focus().aiRewrite().run()}
        >
          <IconRewrite />
          <span>Rewrite</span>
        </button>
        <button
          data-testid="bubble-summarize"
          className="bubble-btn"
          title="Summarize the selection"
          onClick={() => editor.chain().focus().aiSummarize().run()}
        >
          <IconSummarize />
          <span>Summarize</span>
        </button>
        <button
          data-testid="bubble-tone-professional"
          className="bubble-btn"
          title="Adjust the selection to a professional tone"
          onClick={() => editor.chain().focus().aiAdjustTone('professional').run()}
        >
          <IconTone />
          <span>Tone</span>
        </button>
      </BubbleMenu>
      <EditorContent editor={editor} id="editor" className="editor" />
    </div>
  )
}
