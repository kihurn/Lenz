# Lenz

A free, screen-aware study assistant. Press a hotkey on your Mac, Lenz captures your screen
(or an area you select), and a local AI model on your own PC answers questions about it in a
floating panel. You never have to switch windows or describe what you're looking at.

- **Free:** the AI runs on your PC with [Ollama](https://ollama.com); web search runs on your
  PC with [SearXNG](https://docs.searxng.org). No paid APIs.
- **Fast:** reads on-screen text with macOS's built-in text recognition and sends only text
  when that's enough; answers stream as they're written.
- **Works away from home:** the Mac reaches the PC privately over [Tailscale](https://tailscale.com).
- **Private:** captures happen only when you press the hotkey and are never saved.
- **Visible by design:** Lenz does not hide from screen sharing or recording.

## Layout

| Path | What |
|---|---|
| `app/` | The Mac app (Electron + TypeScript) |
| `app/native/ocr/` | Text-recognition helper (Swift, Apple Vision) |
| `docs/mac-setup.md` | Install, run and build on the Mac |
| `docs/mac-manual-test.md` | Checklist for testing on a real Mac |
| `docs/superpowers/` | Design spec and implementation plans |

The Windows PC side (Ollama, SearXNG, Tailscale setup scripts) comes next.

## Development

```bash
cd app
npm ci
npm test          # unit tests
npm run typecheck
npm run dev       # run the app (macOS)
npm run mock-ollama  # pretend AI server for trying the UI
```
