import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkKey, createKeyStore, type Cipher } from '../src/main/secrets'

// Stand-in for safeStorage: reversible but never plain text on disk.
const cipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s, 'utf8').reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString('utf8')
}

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'lenz-key-')), 'c0re-key.bin')
})

describe('C0RE key store', () => {
  it('starts empty', () => {
    const ks = createKeyStore(file, cipher)
    expect(ks.get()).toBe('')
    expect(ks.has()).toBe(false)
  })

  it('stores the key encrypted and reads it back', () => {
    createKeyStore(file, cipher).set('c0re_secret123')
    expect(readFileSync(file, 'utf8')).not.toContain('c0re_secret123')
    const fresh = createKeyStore(file, cipher)
    expect(fresh.get()).toBe('c0re_secret123')
    expect(fresh.has()).toBe(true)
  })

  it('clear removes the key', () => {
    const ks = createKeyStore(file, cipher)
    ks.set('c0re_x')
    ks.clear()
    expect(existsSync(file)).toBe(false)
    expect(ks.has()).toBe(false)
  })

  it('refuses to save when encryption is unavailable', () => {
    const ks = createKeyStore(file, { ...cipher, isEncryptionAvailable: () => false })
    expect(() => ks.set('c0re_x')).toThrow()
    expect(existsSync(file)).toBe(false)
  })

  it('treats an unreadable file as no key', () => {
    createKeyStore(file, cipher).set('c0re_x')
    const broken = createKeyStore(file, { ...cipher, decryptString: () => { throw new Error('bad') } })
    expect(broken.get()).toBe('')
  })
})

describe('checkKey', () => {
  it('accepts and trims a C0RE key', () => {
    expect(checkKey('  c0re_abc123 \n')).toEqual({ ok: true, key: 'c0re_abc123' })
  })
  it('accepts keys in other formats (C0RE decides)', () => {
    expect(checkKey('C0RE-ABCDEF123').ok).toBe(true)
  })
  it.each(['', 'abc', 'c0re_', 'c0re_a b c', 'sk-123'])('rejects %j', (k) => {
    expect(checkKey(k).ok).toBe(false)
  })
})
