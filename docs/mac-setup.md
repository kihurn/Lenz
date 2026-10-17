# Setting up Lenz on your Mac

Lenz runs on your Mac and asks the AI on your PC. This guide covers the Mac side.
The PC side (Ollama, the search engine, Tailscale) has its own guide.

## 1. Install the tools (once)

1. **Xcode Command Line Tools** (needed to build the text-recognition helper):
   ```bash
   xcode-select --install
   ```
2. **Node.js LTS** from [nodejs.org](https://nodejs.org) (or `brew install node`).
3. **Tailscale** from the Mac App Store or [tailscale.com/download](https://tailscale.com/download).
   Sign in with the same account you use on your PC.

## 2. Get the code

```bash
git clone https://github.com/kihurn/lenz.git
cd lenz/app
npm ci
npm run build:ocr
```

## 3. Try it before your PC is ready

Lenz ships with a pretend AI server that streams a sample answer, so you can try the panel,
hotkeys and screen capture right away.

```bash
# Terminal 1
npm run mock-ollama

# Terminal 2
npm run dev
```

In Lenz, open **Settings** (gear icon), set **Ollama address** to `http://127.0.0.1:11434`,
and save. Press **⌘⇧Space** and ask anything; you'll get the sample answer.

## 4. Build the app

```bash
npm run dist:mac
```

This creates `dist/mac-arm64/Lenz.app` and a `.dmg`. Drag Lenz into Applications.

The app is signed "ad hoc" (no paid Apple developer account), so the first time:

- **Right-click Lenz → Open**, then confirm. After that it opens normally.
- macOS will ask for **Screen Recording** permission the first time you capture.
  Allow it in System Settings → Privacy & Security → Screen Recording, then reopen Lenz.
- After you rebuild the app, macOS may ask for Screen Recording permission again
  (the ad-hoc signature changes with each build). Remove the old Lenz entry and allow the new one.

## 5. Connect to your PC

1. Make sure Tailscale is connected on both the Mac and the PC.
2. In Lenz **Settings**, set:
   - **Ollama address**: `http://<pc-name>:11434` (your PC's Tailscale name, e.g. `http://study-pc:11434`)
   - **Search engine address**: `http://<pc-name>:8888`
3. Press **Test connection**. You should see the Ollama version, your vision models and
   "Search engine reachable".

## Using Lenz

| Action | Default |
|---|---|
| Capture the screen and ask | ⌘⇧Space |
| Select an area and ask | ⌘⇧X |
| Show or hide the panel | ⌘⇧L |
| Ask | Enter |
| Capture again, then ask | ⌘Enter |
| New line | Shift+Enter |
| Hide the panel | Esc |

Header toggles:

- **Fast / Accurate**: smaller model for speed, or bigger model for better answers.
- **Think**: lets the model reason before answering (slower, better for multi-step maths).
- **Search**: searches the web first and cites sources as [1], [2].
- **Auto / Text / Image**: what Lenz sends. Auto sends just the recognised text when the
  screen is mostly text (fastest) and the image for diagrams, graphs and handwriting.

Lenz never saves your screenshots or conversations; they're gone when you close it.
