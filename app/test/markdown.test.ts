// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/markdown'

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('**bold** and a list:\n\n- one\n- two')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<li>one</li>')
  })

  it('renders inline and block math', () => {
    expect(renderMarkdown('Energy $E = mc^2$ here')).toContain('class="katex"')
    expect(renderMarkdown('$$\\int_0^1 x\\,dx$$')).toContain('katex-display')
  })

  it('bad LaTeX does not throw', () => {
    const html = renderMarkdown('broken $\\frac{1}{$ math')
    expect(typeof html).toBe('string')
    expect(html).toContain('frac')
  })

  it('sanitizes scripts and javascript links', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n<img src=x onerror=alert(1)>')
    const div = document.createElement('div')
    div.innerHTML = html
    expect(div.querySelector('script')).toBeNull()
    expect(div.querySelector('img')).toBeNull()
    expect([...div.querySelectorAll('*')].some((el) => el.hasAttribute('onerror'))).toBe(false)
    expect([...div.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') ?? ''))).toBe(false)
  })

  it('makes links open externally', () => {
    const html = renderMarkdown('[Wiki](https://en.wikipedia.org)')
    expect(html).toContain('href="https://en.wikipedia.org"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('highlights code blocks', () => {
    expect(renderMarkdown('```python\nprint("hi")\n```')).toContain('hljs')
  })

  it('handles an unfinished stream mid-math without throwing', () => {
    expect(() => renderMarkdown('The answer is $x = \\sqrt{')).not.toThrow()
  })
})
