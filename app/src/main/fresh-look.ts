/**
 * Whether a follow-up question is about what's on screen *now*, so Lenz should take a new
 * screenshot instead of reusing the one the conversation started with. Phrase rules only:
 * instant, and wrong guesses cost little (an extra capture, or ⌘Enter to force one).
 */
const RULES: RegExp[] = [
  // "what am I looking at", "what am I seeing", "what's on my screen"
  /\bwhat am i (looking at|seeing|on)\b/,
  /\bwhat(?:'s| is) (?:on|in front of me on) (?:my|the) screen\b/,
  // "...now" / "...currently" with a question about what's shown
  /\bwhat(?:'s| is| am i| are| do i see| about)\b[^.?!]{0,40}\b(?:now|currently)\b/,
  /\b(?:looking at|seeing|showing|on (?:my|the) screen|open)\b[^.?!]{0,20}\b(?:now|currently)\b/,
  /\b(?:now|currently)\b[^.?!]{0,20}\b(?:looking at|seeing|showing|on (?:my|the) screen)\b/,
  // "look again", "check my screen", "take another look", "new screenshot"
  /\b(?:look|check|see) (?:again|at (?:my|the) screen|my screen)\b/,
  /\btake (?:another|a new|a fresh|one more) (?:look|screenshot|capture)\b/,
  /\b(?:new|another|fresh) (?:screenshot|capture)\b/,
  /\brecapture\b/,
  // pointing at something new: "this page", "this tab", "the new window", "what about this one"
  /\b(?:this|this new|the new|that new|the other|another) (?:page|tab|site|website|window|app|screen|slide|question|problem|one)\b/,
  /\b(?:what|how) about (?:now|this|here)\b/,
  /^(?:and|ok|okay|now)?[, ]*(?:this|now|here)\s*\??$/,
  // "I switched tabs", "I scrolled down", "I opened another site"
  /\bi(?:'ve| have)? (?:switched|moved|changed|scrolled|went|gone|opened|navigated|clicked)\b/,
  /\b(?:switched|moved|changed) (?:to|tabs|pages|windows|apps)\b/
]

export function wantsFreshLook(question: string): boolean {
  const q = question
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return q !== '' && RULES.some((r) => r.test(q))
}
