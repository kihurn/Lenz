import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** The subset of Electron's safeStorage Lenz uses (macOS: backed by the Keychain). */
export interface Cipher {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

export type KeyCheck = { ok: true; key: string } | { ok: false; error: string }

/** Trims a pasted key and checks it looks like a C0RE key. */
export function checkKey(raw: string): KeyCheck {
  const key = raw.trim()
  if (!/^c0re_\S+$/.test(key) || key.length > 512) {
    return { ok: false, error: 'C0RE key: should start with c0re_ (copy it from the C0RE dashboard → Keys).' }
  }
  return { ok: true, key }
}

/** Keeps the C0RE key encrypted in its own file, never in settings.json. */
export function createKeyStore(file: string, cipher: Cipher) {
  let cached: string | null = null

  function get(): string {
    if (cached !== null) return cached
    try {
      cached = existsSync(file) ? cipher.decryptString(readFileSync(file)) : ''
    } catch {
      cached = ''
    }
    return cached
  }

  function set(key: string): void {
    if (!cipher.isEncryptionAvailable()) throw new Error("This Mac can't store the key safely right now.")
    const tmp = `${file}.tmp`
    writeFileSync(tmp, cipher.encryptString(key), { mode: 0o600 })
    renameSync(tmp, file)
    cached = key
  }

  function clear(): void {
    rmSync(file, { force: true })
    cached = ''
  }

  return { get, set, clear, has: () => get() !== '' }
}

export type KeyStore = ReturnType<typeof createKeyStore>
