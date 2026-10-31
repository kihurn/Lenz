import { describe, expect, it } from 'vitest'
import { wantsFreshLook } from '../src/main/fresh-look'

describe('wantsFreshLook', () => {
  it.each([
    'what am i looking at right now?',
    'what am I looking at now then?',
    'What’s on my screen?',
    'what about now?',
    'and this?',
    'now?',
    'look again',
    'check my screen',
    'take another look',
    'can you take a new screenshot',
    'what about this page',
    'explain this new tab',
    'what does this website do',
    'ok what is this one',
    'I switched tabs, what is this',
    "I've scrolled down, keep going",
    'what is showing now'
  ])('takes a new look for %j', (q) => {
    expect(wantsFreshLook(q)).toBe(true)
  })

  it.each([
    '',
    'explain step 2 more',
    'why is that the answer?',
    'can you make it shorter',
    'what does mitochondria mean',
    'give me an example',
    'translate it to Malay',
    'solve question 3'
  ])('reuses the screenshot for %j', (q) => {
    expect(wantsFreshLook(q)).toBe(false)
  })
})
