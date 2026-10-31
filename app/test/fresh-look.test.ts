import { describe, expect, it } from 'vitest'
import { needsScreen, wantsFreshLook } from '../src/main/fresh-look'

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

describe('needsScreen', () => {
  it.each([
    'explain this',
    'what does this mean?',
    'solve question 3',
    'what is the answer to Q2b',
    'what does this graph show?',
    "what's on my screen?",
    'summarise this page',
    'can you see the diagram?',
    'what is the highlighted word',
    'translate this paragraph',
    'is my code shown here correct?',
    'what does that mean',
    'explain that',
    ''
  ])('looks for %j', (q) => {
    expect(needsScreen(q, true)).toBe(true)
  })

  it.each([
    'what is photosynthesis?',
    'help me write an email to my teacher',
    'quiz me on WW2',
    'explain the formula for kinetic energy',
    'is it true that bats are blind?',
    'give me 5 tips for revising',
    'what is the capital of France'
  ])('just chats for %j', (q) => {
    expect(needsScreen(q, true)).toBe(false)
  })

  it('in an ongoing chat, "this"/"that" refer to the conversation, not the screen', () => {
    expect(needsScreen('explain that more simply', false)).toBe(false)
    expect(needsScreen('can you expand on this', false)).toBe(false)
    expect(needsScreen('what does this graph show?', false)).toBe(true)
  })
})
