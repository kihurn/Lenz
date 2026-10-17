# Lenz — Design Spec

**Date:** 2026-10-16
**Status:** Draft — awaiting review

## 1. Purpose

Lenz is a free, screen-aware study assistant. While studying on a Mac, the user
presses a hotkey, Lenz captures the screen (or a selected region), and a local
AI model answers a question about it in a floating panel — without the user
switching windows or describing what they are looking at.

### Priorities (in order)

1. **Speed and accuracy** — answers must feel faster than opening a chatbot.
2. **Reasoning** — available on demand ("Think longer"), never at the cost of
   default speed.

### Constraints

- **Completely free.** No paid APIs, no subscriptions. All AI runs on the
  user's own hardware.
- **Two machines:**
  - **Client:** MacBook Neo (A18 Pro, 8 GB RAM, macOS) — runs the Lenz app.
  - **AI server:** Windows PC (RTX 4070 Super 12 GB VRAM, 32 GB RAM) — runs
    Ollama and the search engine. Stays at home.
- **Used mainly away from home.** Mac and PC connect over the internet.
- **Mac first**; Windows client support later from the same codebase.
- **Visible by design.** No hiding from screen sharing, screen recorders or
  proctoring tools.

### Success criteria

- From hotkey to the first words of an answer: **≤ 2 s** typical on a good
  connection; complete short answer **≤ 5 s** (no web search, model loaded).
- Text on a typical slide, PDF page or web article is read correctly
  (verified on a fixed set of sample screenshots, see §10).
- With web search on, a complete answer with cited sources in **≤ 8 s**
  typical.
- Works from outside the home network with no router port forwarding.

## 2. System overview

```
 MacBook Neo — Lenz app (Electron)                 Windows PC — AI server
 ┌─────────────────────────────────────┐          ┌──────────────────────────┐
 │ Hotkey → capture (full / region)    │          │ Ollama                   │
 │ → OCR (macOS Vision helper)         │ Tailscale│  └ lenz-study model      │
 │ → choose text-only or image mode    │ ───────▶ │    (Qwen3-VL 8B, tuned)  │
 │ → [optional] web search + page read │ ◀─────── │ SearXNG (search engine)  │
 │ → stream answer into floating panel │          │ Tailscale                │
 └─────────────────────────────────────┘          └──────────────────────────┘
```

- **Tailscale** (free personal plan) puts both machines on a private encrypted
  network. The Mac reaches the PC by its Tailscale name (e.g. `study-pc`) from
  any network. No ports are exposed to the internet.
- No custom server code runs on the PC. Ollama and SearXNG are the servers;
  the PC side is setup and health-check scripts plus configuration.

## 3. Mac client (Electron + TypeScript)

### 3.1 Process layout

- **Main process** — owns everything privileged: global hotkeys, screen
  capture, OCR helper calls, HTTP calls to Ollama/SearXNG/web pages, settings
  storage. Each concern is a separate module with a small interface (§3.8).
- **Renderer (panel UI)** — displays the conversation only. Talks to main via a
  narrow, typed IPC bridge (`contextIsolation: true`, `nodeIntegration: false`,
  sandboxed). The renderer never makes network calls.
- **OCR helper** — a small Swift command-line binary bundled with the app that
  runs Apple's Vision text recognition on an image and returns JSON
  (text + confidence + bounding boxes). Invoked per capture.

### 3.2 Floating panel

- Always-on-top, frameless, translucent, movable and resizable; remembers
  position and size.
- Visible on all Spaces and over full-screen apps.
- Toggle show/hide with a hotkey; `Esc` hides it.
- Does not steal focus from the study material until the user clicks into it
  or starts typing after a capture.
- Contents: capture thumbnail, mode indicators (Text / Image, 🌐 Search,
  🧠 Think longer, Fast/Accurate), quick-action buttons, question box,
  streamed answer, follow-up thread, "New capture" button, Stop button.

### 3.3 Capture

- **Hotkey A** (default `⌘⇧Space`): capture the display under the cursor, open
  the panel, focus the question box.
- **Hotkey B** (default `⌘⇧X`): region select (crosshair overlay), then as A.
- Uses Electron `desktopCapturer` (ScreenCaptureKit on current macOS).
- Lenz's own panel is excluded from the capture (hidden during capture).
- **Screen Recording permission:** detect when missing, show an explanation,
  and open the right System Settings pane. Re-check after the user returns.

### 3.4 Image preparation and input mode

After capture, Lenz decides what to send to the model:

1. Run OCR on the capture (Vision, "accurate" level, language auto-detect).
2. **Text-only mode** if the OCR text is substantial and confident and the
   capture is not dominated by non-text content (heuristic: character count,
   mean confidence, share of the image covered by text boxes). Sends OCR text
   only — the fastest path.
3. **Image mode** otherwise (diagrams, graphs, handwriting, equations OCR
   reads poorly). Sends a resized image **plus** the OCR text as a hint.
4. The user can force either mode with a toggle; the choice is per capture.

Image resizing: downscale so the longest side is at most a configurable limit
(default 1280 px; region captures are rarely larger), encode as PNG for
text-heavy captures and JPEG (quality 85) otherwise. Thresholds are tuned
against the sample set in §10.

### 3.5 Asking and answering

- **Quick actions** (editable prompt templates in Settings): Explain,
  Step-by-step, Summarize, Quiz me, Define.
- **Free-form questions** typed by the user.
- **Answer length follows the user.** Default is short; asking for detail gets
  detail. A configurable maximum answer length prevents run-on output.
- Responses stream token by token. Markdown rendering with KaTeX for math and
  syntax highlighting for code.
- **Follow-ups** reuse the same capture. To keep prompts small, only the most
  recent image is ever sent; earlier turns are kept as text.
- **Stop** cancels generation immediately.

### 3.6 Modes

| Toggle | Default | Effect |
|---|---|---|
| Fast / Accurate | Accurate | Accurate = Qwen3-VL 8B; Fast = Qwen3-VL 4B. |
| 🧠 Think longer | Off | Uses the model's reasoning ("thinking") mode or the Thinking variant. Shows "Thinking…" while it reasons. If a model swap is needed, shows "Loading model…". |
| 🌐 Search | Off | Web search before answering (§5). |
| Text / Image | Auto | Override §3.4's decision. |

Exact mechanics of "Think longer" depend on what the installed Qwen3-VL tags
support in Ollama; the implementation plan verifies this first and picks
either a `think` request flag or a separate Thinking model.

### 3.7 Settings

Stored locally (electron-store); nothing sensitive is stored.

- Server address (default `http://study-pc:11434`), SearXNG address
  (default `http://study-pc:8888`), **Test connection** button showing
  reachability, installed vision models and round-trip latency.
- Model choice for Fast and Accurate.
- Hotkeys.
- Quick-action prompt templates.
- Default answer length cap; image size limit; search result count.

### 3.8 Module boundaries (main process)

| Module | Responsibility | Depends on |
|---|---|---|
| `capture` | Full-screen and region capture → image buffer | Electron |
| `ocr` | Run Swift helper → `{text, confidence, boxes}` | helper binary |
| `prepare` | Decide mode, resize/encode image, build model input | `ocr` output |
| `ollama` | Stream chat to Ollama; cancel; list models; health | HTTP |
| `search` | Query SearXNG; fetch & extract pages; build context | HTTP |
| `session` | Conversation state, prompt assembly, history trimming | — |
| `settings` | Load/save/validate settings | electron-store |
| `ipc` | Typed bridge between main and renderer | all above |

Each module is unit-testable without Electron except `capture` and `ipc`.

### 3.9 Privacy

- Captures only on explicit hotkey. No background screen watching.
- Nothing is written to disk by default (captures and conversations live in
  memory and are cleared when the panel session ends).
- Traffic to the PC goes only through Tailscale. Web page fetching (§5)
  happens from the Mac over its normal connection.

## 4. AI server (Windows PC)

### 4.1 Components

- **Ollama** (Windows native) — serves the models.
- **Tailscale** — private network.
- **SearXNG** — self-hosted metasearch engine, run with Docker Desktop
  (WSL2 backend). JSON output enabled.

### 4.2 Tuned model: `lenz-study`

An Ollama Modelfile built on Qwen3-VL 8B (Q4_K_M default) with:

- A **short, fixed system prompt** (kept identical between requests so Ollama
  can reuse its prompt cache): act as a concise study tutor; ground answers in
  the provided screen content and search results; match the requested length;
  use `$…$`/`$$…$$` for math; say when content is unreadable instead of
  guessing; cite search sources by number.
- **Low temperature** (≈0.3) for accurate, consistent answers.
- **Context window** sized for one image + OCR text + a few follow-ups
  (starting point 8192 tokens; tuned by the benchmark).
- A `lenz-study-fast` variant on Qwen3-VL 4B with the same prompt.
- Higher-precision (Q8) variant attempted by the setup script if it fits in
  VRAM with the chosen context; falls back to Q4_K_M otherwise.

### 4.3 Server settings

- `OLLAMA_HOST` set so Ollama listens on the network; Windows Firewall allows
  port 11434 **only from Tailscale's address range (100.64.0.0/10)**.
- `OLLAMA_KEEP_ALIVE=-1` — keep the model loaded permanently.
- `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` — reduce memory
  use so the context fits alongside the model.
- SearXNG bound to port 8888, same firewall restriction.
- Ollama, Docker/SearXNG and Tailscale start at boot; Windows sleep disabled
  while on AC power (display may still turn off).

### 4.4 Deliverables

- `server/setup.ps1` — idempotent setup: checks prerequisites (Ollama,
  Tailscale, Docker Desktop) and prints install links if missing; applies the
  settings above; pulls models; builds `lenz-study` / `lenz-study-fast`;
  starts SearXNG; prints the address to enter on the Mac.
- `server/healthcheck.ps1` — verifies services, model loaded, VRAM use,
  SearXNG responding, and **benchmarks** time-to-first-token and tokens/sec.
- `server/Modelfile.*`, `server/searxng/settings.yml`,
  `server/docker-compose.yml`.
- `docs/server-setup.md` — step-by-step guide for the manual parts
  (installing Tailscale/Docker, signing in).

## 5. Web search

When 🌐 Search is on:

1. **Query** — Lenz builds a search query. Default: a short model call
   (output capped at ~30 tokens) turning the question + OCR text into a query.
   If the user's question already reads like a search query, it is used
   directly with no extra model call.
2. **Search** — query SearXNG (JSON), take the top N results (default 5):
   title, URL, snippet.
3. **Read** — fetch the top 2 pages in parallel from the Mac with a hard
   timeout (default 2.5 s each); extract main text (Readability) and trim to a
   token budget. Pages that time out are skipped; snippets still count.
4. **Answer** — send screen content + search context to the model, which
   answers citing sources as [1], [2]…; the panel lists clickable sources.

Speed rules: search steps stream status into the panel ("Searching…",
"Reading 2 pages…"); total search budget capped (default 4 s) after which Lenz
answers with whatever it has.

## 6. Speed design (summary)

| Lever | Where |
|---|---|
| Model kept loaded on GPU | §4.3 |
| Text-only mode when OCR suffices | §3.4 |
| Region capture + image downscaling | §3.3, §3.4 |
| Short fixed system prompt (prompt-cache reuse) | §4.2 |
| Only latest image in follow-ups | §3.5 |
| Short answers by default, answer cap | §3.5 |
| Streaming output | §3.5 |
| Fast model toggle | §3.6 |
| Search time budget | §5 |

## 7. Error handling

Every failure shows a clear message in the panel with the fix; nothing hangs.

| Situation | Behaviour |
|---|---|
| PC unreachable (off, asleep, Tailscale down) | Within 3 s: "Can't reach your PC — check it's on and Tailscale is connected." Retry button. |
| Ollama up but model missing | Names the missing model and the command to run on the PC. |
| Model loading (cold start) | "Loading model…" status, then normal streaming. |
| Screen Recording permission missing | Explanation + button opening System Settings. |
| OCR helper fails | Fall back to image mode silently; log the error. |
| SearXNG unreachable / no results | Answer without search; note "Search unavailable". |
| Page fetch timeout | Skip page; use snippets. |
| Generation exceeds answer cap | Stop and show "Answer truncated — ask for more". |
| Mid-stream network drop | Keep partial answer; show error + Retry. |

## 8. Out of scope (v1)

- Windows client build (codebase stays cross-platform; packaging later).
- Continuous/automatic screen watching.
- Voice input, audio capture.
- Saved history, flashcards, notes export.
- Searching the user's own course notes (local RAG).
- Fine-tuning models.
- Hiding from screen sharing or detection — explicitly excluded.

## 9. Repository layout

```
lenz/
  app/                 Electron + TypeScript client
    src/main/          main-process modules (§3.8)
    src/renderer/      panel UI
    src/shared/        IPC types
    native/ocr/        Swift OCR helper
    test/              unit tests + sample screenshots (§10)
  server/              Windows PC setup (PowerShell, Modelfiles, SearXNG)
  docs/                setup guides, specs, plans
```

## 10. Testing

- **Unit tests** (Vitest) for `prepare`, `ollama` (against a mock server),
  `search`, `session`, `settings`.
- **Sample screenshot set** (slides, PDF pages, math, code, diagrams) used to
  tune the text-only/image heuristic and to check answer quality.
- **Model evaluation script** run on the PC: sends the sample set through
  `lenz-study` and records latency and answers for manual review.
- **Server**: `healthcheck.ps1` doubles as the acceptance test.
- **Limits of this environment:** development happens in a Linux cloud
  container without macOS, a display or a GPU. The Swift helper, capture,
  permissions, packaging and end-to-end speed can only be verified on the
  user's Mac and PC; the plan includes a manual test checklist for those.
