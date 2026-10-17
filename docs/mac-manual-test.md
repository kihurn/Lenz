# Lenz Mac manual test checklist

Automated tests cover the logic (settings, Ollama client, prompts, text/image choice, OCR
wrapper, search, the ask pipeline, Markdown rendering). These checks cover what only a real
Mac can show. Run them with `npm run mock-ollama` + `npm run dev` first, then against the PC.

Write down anything that fails, with what you did and what you saw.

## Check these first

These three can only be checked on a real Mac, and they matter most:

- [ ] **Lenz is not in its own capture:** with the panel hidden *and* with it showing,
      press ⌘⇧Space over a slide. The thumbnail shows only the slide, and the answer
      doesn't mention Lenz's buttons or previous answers.
- [ ] **First-run permission prompt:** on a fresh install, the first ⌘⇧Space shows macOS's
      Screen Recording prompt, and Lenz appears in System Settings → Screen Recording.
- [ ] **Area select from another app:** with Preview in front, press ⌘⇧X and drag immediately;
      the selection starts where you clicked. Try again and press Esc; it cancels.

## First run and permissions

- [ ] `npm run build:ocr` succeeds and creates `native/ocr/build/lenz-ocr`.
- [ ] First ⌘⇧Space asks for Screen Recording permission.
- [ ] With permission **denied**, the panel shows "Lenz needs Screen Recording permission…"
      and **Open Screen Recording settings** opens the right page.
- [ ] After allowing it and reopening Lenz, capture works.

## Panel

- [ ] Panel stays on top of other apps.
- [ ] Panel appears over a full-screen app (e.g. a full-screen PDF in Preview).
- [ ] Panel follows you to other desktops (Spaces).
- [ ] Panel can be dragged by its top bar and resized; position is remembered after restart.
- [ ] Esc hides the panel; ⌘⇧L shows and hides it; ⌘W hides it (Lenz keeps running).
- [ ] Light and dark mode both look right (System Settings → Appearance).

## Capture

- [ ] ⌘⇧Space: thumbnail appears; Lenz's own panel is **not** in the thumbnail.
- [ ] ⌘⇧X: dimmed overlay, drag a box, panel shows only that area.
- [ ] ⌘⇧X then Esc cancels without changing the current capture.
- [ ] With two displays, the capture is of the display under the mouse.

## Reading the screen (OCR)

Try each, and check the label under the thumbnail:

- [ ] A text-heavy slide or article → "Reading the text on screen".
- [ ] A PDF page with equations → answer quotes the equations correctly (image mode if OCR is unsure).
- [ ] Code in an editor → answer refers to the right lines.
- [ ] A diagram or graph → "Looking at the image".
- [ ] Auto/Text/Image toggle changes what is sent (Image always attaches the picture).

## Answers

- [ ] Answer streams in word by word; math renders properly; code is highlighted.
- [ ] Stop button stops the answer immediately.
- [ ] A follow-up question remembers the previous answer and the same capture.
- [ ] Quick actions (Explain, Step-by-step, Summarize, Quiz me, Define) each work.
- [ ] Think toggle shows "Thinking it through…" before the answer (needs a model that can think).
- [ ] Fast toggle uses the smaller model (check Ollama's log on the PC, or answer speed).
- [ ] Pressing ⌘⇧Space while an answer is streaming stops it, clears the panel and starts fresh
      (Stop button disappears, no leftover "Capturing…" text).
- [ ] The Auto/Text/Image toggle goes back to Auto after each new capture.

## Search

- [ ] With Search on, status shows "Searching…" then "Reading 2 pages…".
- [ ] Numbered sources appear under the answer; clicking one opens the browser.
- [ ] With the search engine stopped, Lenz says "Search unavailable — answering without it." and still answers.

## Failure handling

- [ ] PC off (or Tailscale disconnected): "Can't reach your PC…" appears within about 3 seconds.
- [ ] Wrong model name in Settings: message names the model and the `ollama pull` command.
- [ ] Turn Wi-Fi off mid-answer: the partial answer stays, an error and **Retry** appear.
- [ ] Settings → Test connection shows Ollama version, latency, vision models and search status.
- [ ] Settings rejects an invalid address (e.g. `file:///`) with a clear message.

## Speed and memory (against the PC)

- [ ] Hotkey to first words of an answer: about 2 s or less on a good connection.
- [ ] Short answer complete: about 5 s or less (Search off).
- [ ] With Search on: complete answer with sources in about 8 s or less.
- [ ] Activity Monitor: Lenz uses under ~400 MB of memory in total.
