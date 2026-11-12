import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownPreview } from './MarkdownPreview'

test('GFM preview handles headings, tasks, tables and clickable wikilinks safely', () => {
  const html = renderToStaticMarkup(<MarkdownPreview onOpenNote={() => {}}
    content={'# Başlık\n\n- [x] tamam\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[[Fikir|Bağlı not]]\n\n[tehlike](javascript:alert(1))'}/>)
  assert.match(html, /<h1>Başlık<\/h1>/)
  assert.match(html, /type="checkbox"/)
  assert.match(html, /<table>/)
  assert.match(html, /Bağlı not/)
  assert.match(html, /eon-notes-wikilink/)
  assert.doesNotMatch(html, /href="javascript:/)
})
