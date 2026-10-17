import markdownItKatex from '@vscode/markdown-it-katex'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({
  html: false, // raw HTML from the model is shown as text, never rendered
  linkify: true,
  breaks: false,
  highlight: (code, lang) => {
    try {
      const out = lang && hljs.getLanguage(lang) ? hljs.highlight(code, { language: lang }) : hljs.highlightAuto(code)
      return `<pre class="hljs"><code>${out.value}</code></pre>`
    } catch {
      return ''
    }
  }
})
// Bad LaTeX renders as its source text instead of throwing.
md.use((markdownItKatex as unknown as { default?: typeof markdownItKatex }).default ?? markdownItKatex, {
  throwOnError: false,
  output: 'html'
})

/** Markdown (with math and code) → sanitized HTML. Safe to call on partial, still-streaming text. */
export function renderMarkdown(src: string): string {
  let html: string
  try {
    html = md.render(src)
  } catch {
    html = md.utils.escapeHtml(src)
  }
  const tpl = document.createElement('template')
  tpl.innerHTML = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true },
    FORBID_TAGS: ['img', 'style', 'form', 'input', 'iframe'],
    ALLOWED_URI_REGEXP: /^https?:/i
  })
  // Links open in the browser (the panel intercepts clicks and calls openExternal).
  for (const a of tpl.content.querySelectorAll('a')) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
  return tpl.innerHTML
}
