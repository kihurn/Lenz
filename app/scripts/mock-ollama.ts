// Fake Ollama server for trying the Lenz UI before the PC is set up.
// Usage: npm run mock-ollama   (then set the server address to http://127.0.0.1:11434)
import { startMockOllama } from '../test/helpers/mock-ollama'

const answer =
  'Here is a **sample answer** from the mock server.\n\n' +
  'The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.\n\n' +
  '$$\\int_0^1 x^2\\,dx = \\tfrac{1}{3}$$\n\n' +
  '```python\nprint("hello")\n```\n\nSources like [1] would appear below when search is on.'

const tokens = answer.match(/.{1,6}/gs) ?? [answer]
void startMockOllama({ port: 11434, tokens, thinking: ['Considering', ' the screen…'], delayMs: 25 }).then((mock) =>
  console.log(`Mock Ollama listening on ${mock.url} — Ctrl+C to stop`)
)
