import { useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewProps {
  content: string
  onOpenNote: (title: string) => void
}

/**
 * Safe GFM renderer for Eon2's journal-backed Markdown.
 * The Markdown AST is rendered to React, never injected into innerHTML.
 */
export function MarkdownPreview({ content, onOpenNote }: MarkdownPreviewProps) {
  const markdown = useMemo(() => content.replace(
    /\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]+)?(?:\|([^\]\r\n]+))?\]\]/g,
    (_, target: string, alias: string | undefined) => {
      const label = (alias || target).replace(/[\\\[\]]/g, '\\$&')
      return '[' + label + '](eon-note:' + encodeURIComponent(target.trim()) + ')'
    },
  ), [content])

  return <article className="eon-notes-markdown" aria-label="Markdown okuma görünümü">
    <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={url =>
      url.startsWith('eon-note:') ? url : defaultUrlTransform(url)
    } components={{
      a: ({ href, children }) => {
        if (href?.startsWith('eon-note:')) {
          let target = ''
          try { target = decodeURIComponent(href.slice('eon-note:'.length)) } catch { /* Invalid links remain inert. */ }
          return <button type="button" className="eon-notes-wikilink" onClick={() => onOpenNote(target)}>{children}</button>
        }
        return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      },
      img: ({ src, alt }) => <img src={src} alt={alt || ''} loading="lazy" decoding="async"/>,
      input: ({ type, checked }) => type === 'checkbox'
        ? <input type="checkbox" checked={Boolean(checked)} readOnly aria-label="Markdown görev durumu"/>
        : null,
    }}>{markdown}</ReactMarkdown>
  </article>
}
