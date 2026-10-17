import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../src/main/settings'

let file: string
beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'lenz-settings-')), 'settings.json')
})

describe('settings', () => {
  it('has the spec defaults', () => {
    expect(DEFAULT_SETTINGS.serverUrl).toBe('http://study-pc:11434')
    expect(DEFAULT_SETTINGS.searxngUrl).toBe('http://study-pc:8888')
    expect(DEFAULT_SETTINGS.models).toEqual({ accurate: 'qwen3-vl:8b', fast: 'qwen3-vl:4b' })
    expect(DEFAULT_SETTINGS.hotkeys.capture).toBe('CommandOrControl+Shift+Space')
    expect(DEFAULT_SETTINGS.hotkeys.region).toBe('CommandOrControl+Shift+X')
    expect(DEFAULT_SETTINGS.imageMaxSide).toBe(1280)
    expect(DEFAULT_SETTINGS.search).toEqual({ results: 5, pagesToRead: 2, pageTimeoutMs: 2500, budgetMs: 4000 })
    expect(DEFAULT_SETTINGS.quickActions.map((a) => a.id)).toEqual(['explain', 'steps', 'summarize', 'quiz', 'define'])
  })

  it('returns defaults when file missing', () => {
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns defaults when file is corrupt JSON', () => {
    writeFileSync(file, '{not json')
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('merges partial file with defaults', () => {
    writeFileSync(file, JSON.stringify({ serverUrl: 'http://100.1.2.3:11434', search: { results: 3 } }))
    const s = loadSettings(file)
    expect(s.serverUrl).toBe('http://100.1.2.3:11434')
    expect(s.models.accurate).toBe('qwen3-vl:8b')
    expect(s.search).toEqual({ ...DEFAULT_SETTINGS.search, results: 3 })
  })

  it('falls back to defaults when stored values are invalid', () => {
    writeFileSync(file, JSON.stringify({ serverUrl: 'ftp://x', imageMaxSide: 5 }))
    expect(loadSettings(file)).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects non-http URLs', () => {
    const r = saveSettings(file, { ...DEFAULT_SETTINGS, serverUrl: 'file:///etc' })
    expect(r.ok).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('rejects out-of-range numbers', () => {
    expect(saveSettings(file, { ...DEFAULT_SETTINGS, imageMaxSide: 100 }).ok).toBe(false)
    expect(saveSettings(file, { ...DEFAULT_SETTINGS, maxAnswerTokens: 0 }).ok).toBe(false)
  })

  it('strips trailing slash from URLs', () => {
    expect(saveSettings(file, { ...DEFAULT_SETTINGS, serverUrl: 'http://study-pc:11434/' }).ok).toBe(true)
    expect(loadSettings(file).serverUrl).toBe('http://study-pc:11434')
  })

  it('round-trips valid settings', () => {
    const s = { ...DEFAULT_SETTINGS, models: { accurate: 'gemma4:e4b', fast: 'qwen3-vl:4b' } }
    expect(saveSettings(file, s)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(file, 'utf8')).models.accurate).toBe('gemma4:e4b')
    expect(loadSettings(file)).toEqual(s)
  })
})
