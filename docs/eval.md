# Testing Lenz's accuracy and speed

`npm run eval` asks Lenz a fixed set of questions (in `app/eval/cases.json`, with test screens in
`app/eval/screens/`) in Fast, Accurate and Think, through C0RE on your PC, and reports how many it
got right and how long each took. Run it before and after a change to see if the change helped.

## Run it (Mac, in Terminal)

```bash
cd ~/Documents/lenz/app
read -s C0RE_KEY && export C0RE_KEY      # paste your C0RE key, press Enter (nothing is shown)
npm run eval                              # all modes, ~5–10 minutes
npm run eval -- --modes accurate          # just one mode
npm run eval -- --only algebra-q2,mcq     # just some questions
```

It uses the same address and models as your Lenz settings. At the end you get a table:

```
Mode       Right    Median time  Median first words
Fast       14/19    1.4 s        0.6 s
Accurate   17/19    2.2 s        0.9 s
Think      18/19    9.8 s        8.1 s
```

Every answer is saved in `app/eval/results/<date>.md`. Open it to judge the questions marked `?`
(news questions, which have no fixed answer) and to see why a ✗ was wrong. Sometimes the answer
is right but worded differently; then add that wording to the case.

## Add your own questions

The best tests are your real study screens.

1. Take a screenshot (⌘⇧4) and save it into `app/eval/screens/`, e.g. `my-chem-q.png`.
2. Add a line to `app/eval/cases.json`:
   ```json
   { "id": "my-chem-q", "screen": "my-chem-q.png", "question": "solve question 2", "expect": { "any": ["0.25 mol"] } }
   ```
   - `any`: at least one of these must appear in the answer.
   - `all`: every one of these must appear.
   - `"manual": true`: no automatic check; you judge it in the report.
   - Leave out `screen` for a plain chat question; add `"search": true` to search the web.
