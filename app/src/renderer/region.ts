// Region select overlay: shows the capture; drag to choose an area, Esc to cancel.
const style = document.createElement('style')
style.textContent = `
  html, body { margin: 0; height: 100%; overflow: hidden; cursor: crosshair; background: #000; user-select: none; }
  img { position: fixed; inset: 0; width: 100vw; height: 100vh; }
  .shade { position: fixed; inset: 0; background: rgba(0,0,0,.35); }
  .sel { position: fixed; border: 1.5px solid #fff; box-shadow: 0 0 0 9999px rgba(0,0,0,.35); display: none; }
  .hint { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
          font: 13px -apple-system, system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.6); }
`
document.head.append(style)

const img = document.createElement('img')
const shade = document.createElement('div')
shade.className = 'shade'
const sel = document.createElement('div')
sel.className = 'sel'
const hint = document.createElement('div')
hint.className = 'hint'
hint.textContent = 'Drag to select an area · Esc to cancel'
document.body.append(img, shade, sel, hint)

window.lenzRegion.onImage((b64) => {
  img.src = `data:image/png;base64,${b64}`
})

let start: { x: number; y: number } | null = null
const rectFrom = (e: MouseEvent) => {
  const x = Math.min(start!.x, e.clientX)
  const y = Math.min(start!.y, e.clientY)
  return { x, y, width: Math.abs(e.clientX - start!.x), height: Math.abs(e.clientY - start!.y) }
}

window.addEventListener('mousedown', (e) => {
  start = { x: e.clientX, y: e.clientY }
  shade.style.display = 'none'
  sel.style.display = 'block'
})
window.addEventListener('mousemove', (e) => {
  if (!start) return
  const r = rectFrom(e)
  Object.assign(sel.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
})
window.addEventListener('mouseup', (e) => {
  if (!start) return
  const r = rectFrom(e)
  start = null
  window.lenzRegion.submit(r.width >= 4 && r.height >= 4 ? r : null)
})
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.lenzRegion.submit(null)
})
