import type { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'

/**
 * The editor surface. `EditorContent` mounts the ProseMirror view into a div
 * carrying `id="editor"` / `class="editor"` (so `#editor .ProseMirror` and the
 * existing styles keep working). A `BubbleMenu` floats over the current
 * selection with quick AI actions, wired to the same commands as the toolbar.
 */
export function EditorPanel({ editor }: { editor: Editor }) {
  return (
    <>
      <BubbleMenu editor={editor} className="bubble-menu">
        <button
          data-testid="bubble-rewrite"
          title="Rewrite the selection"
          onClick={() => editor.chain().focus().aiRewrite().run()}
        >
          Rewrite
        </button>
        <button
          data-testid="bubble-summarize"
          title="Summarize the selection"
          onClick={() => editor.chain().focus().aiSummarize().run()}
        >
          Summarize
        </button>
        <button
          data-testid="bubble-tone-professional"
          title="Adjust the selection to a professional tone"
          onClick={() => editor.chain().focus().aiAdjustTone('professional').run()}
        >
          Tone
        </button>
      </BubbleMenu>
      <EditorContent editor={editor} id="editor" className="editor" />
    </>
  )
}
