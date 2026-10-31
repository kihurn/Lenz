# Setting up Lenz on your Mac

Lenz runs on your Mac and asks the AI on your PC. On the PC, the AI (Ollama) sits behind
**C0RE**, a gateway that only lets in apps with their own key. This guide covers the Mac side.

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

In Lenz, open **Settings** (gear icon), set **C0RE address** to `http://127.0.0.1:11434`,
and save (the pretend server doesn't need a key). Press **⌘⇧Space** and ask anything; you'll get
the sample answer. Afterwards, set the address back to `http://kihurn-desktop:7080`.

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
2. Get Lenz's key: on any Tailscale device, open `http://kihurn-desktop:7080/admin`,
   go to **Keys**, and press the eye button next to **lenz**. Copy the key (it starts with `c0re_`).
   The key's reach should be **private** (works only from your Tailscale devices).
3. In Lenz **Settings**:
   - **C0RE address**: `http://kihurn-desktop:7080` (already the default)
   - **C0RE key**: paste the key. Lenz stores it encrypted with the Mac's Keychain; it is never
     shown again. To change it later, paste a new one; leave the box empty to keep the saved key.
4. Press **Test connection**. You should see "C0RE reachable and key accepted" and your vision models.
   "Can't reach the search engine" is expected until SearXNG is set up on the PC.
5. Press **Save**.

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

- **Fast / Accurate**: `qwen3-vl:4b-instruct` for speed, or `qwen3-vl:8b-instruct` for better answers.
- **Think**: switches to the thinking model `qwen3-vl:8b`, which reasons before answering (slower,
  better for multi-step maths). The PC can't hold it and the Accurate model at once, so the first
  answer after turning Think on or off takes a few extra seconds while the PC swaps models.
- **Search**: searches the web first and cites sources as [1], [2].
- **Auto / Text / Image**: what Lenz sends. Auto sends just the recognised text when the
  screen is mostly text (fastest) and the image for diagrams, graphs and handwriting.

Lenz never saves your screenshots or conversations; they're gone when you close it.

## When something goes wrong

| Lenz says | What to do |
|---|---|
| Can't reach your PC | Check the PC is on and Tailscale is connected on both. |
| Lenz needs its C0RE key / C0RE didn't accept the key | Paste the key again in Settings (C0RE dashboard → Keys → eye button). |
| Lenz's key is switched off in C0RE | In the C0RE dashboard, edit **lenz** and set reach back to **private**. |
| Lenz's key only works over Tailscale | Use `http://kihurn-desktop:7080`, not the public address. |
| C0RE doesn't let Lenz use '…' | In the C0RE dashboard, edit **lenz** and allow that model (or tick "All installed models"). |
| Its AI engine (Ollama) is offline | On the PC, start Ollama (open it from the Start menu). |
| Model '…' isn't installed | On the PC, in PowerShell, run the `ollama pull …` command Lenz shows. |
