import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { search, searchKeymap, openSearchPanel } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder } from '@codemirror/view'

export type MarkdownFormat = 'bold' | 'italic' | 'heading' | 'bullet' | 'task' | 'quote' | 'code' | 'link'

export interface MarkdownEditorHandle {
  format: (format: MarkdownFormat) => void
  focus: () => void
  search: () => void
  undo: () => void
  redo: () => void
}

interface MarkdownEditorProps {
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
}

/** One CodeMirror instance per document: edits never rebuild the parser or lose undo history. */
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(function MarkdownEditor({ value, onChange, readOnly }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const editor = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), history(),
          bracketMatching(), markdown({ base: markdownLanguage }), syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          search(), EditorView.lineWrapping, placeholder('Bir fikir yaz…  Markdown ve [[not bağlantıları]] kullanabilirsin.'),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorState.readOnly.of(Boolean(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })
    editorRef.current = editor
    return () => { editor.destroy(); editorRef.current = null }
    // A different note mounts this component with a different key. Preserve the current edit history otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.state.doc.toString() === value) return
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    search: () => { if (editorRef.current) openSearchPanel(editorRef.current) },
    undo: () => { if (editorRef.current) undo(editorRef.current) },
    redo: () => { if (editorRef.current) redo(editorRef.current) },
    format: (format) => {
      const view = editorRef.current
      if (!view) return
      const selection = view.state.selection.main
      const from = selection.from
      const to = selection.to
      const selected = view.state.sliceDoc(from, to)
      let replacement = selected
      let start = from
      let end = to
      if (format === 'bold' || format === 'italic' || format === 'code') {
        const mark = format === 'bold' ? '**' : format === 'italic' ? '*' : '`'
        const content = selected || (format === 'code' ? 'kod' : 'metin')
        replacement = `${mark}${content}${mark}`
        start = from + mark.length
        end = start + content.length
      } else if (format === 'link') {
        replacement = `[${selected || 'bağlantı'}](https://)`
        start = from + 1
        end = start + (selected || 'bağlantı').length
      } else {
        const line = view.state.doc.lineAt(from)
        const prefix = format === 'heading' ? '## ' : format === 'bullet' ? '- ' : format === 'task' ? '- [ ] ' : '> '
        const match = line.text.match(/^(?:#{1,6}\s+|[-*]\s+(?:\[[ xX]\]\s+)?|>\s+)/)
        view.dispatch({ changes: { from: line.from, to: line.from + (match?.[0].length ?? 0), insert: prefix } })
        view.focus()
        return
      }
      view.dispatch({ changes: { from, to, insert: replacement }, selection: { anchor: start, head: end } })
      view.focus()
    },
  }), [])

  return <div ref={hostRef} className="eon-notes-codemirror" aria-label="Markdown düzenleyici" />
})
