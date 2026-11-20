# Nutekh Client Reply Precision (DM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make private-chat client replies answer the actual message, stay within published facts, fit 1–3 short lines with at most one question, and never leak Swahili into an English/emoji-only conversation.

**Architecture:** Rewrite the DM-only instruction block and cut the reply token budget, then enforce the shape deterministically with a pure `guardDMReply()` applied before and after language repair. Language defaults live in `src/lang.js`; the exported `ensureLanguage` stays in `src/brain.js` because it owns `repairLanguage`. Group answers, prospecting, commands, and lead capture are untouched.

**Tech Stack:** Node >= 20, CommonJS (`"type": "commonjs"`), `node --test`, existing LLM stub via `require.cache`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-20-nutekh-client-reply-precision-design.md`

## Global Constraints

- Run all tests from `nutekh-bot` with `npm test` (`node --test`); fully offline.
- No new npm dependencies. CommonJS only. Node >= 20.
- LLM must be stubbed through `require.cache` before `src/brain` is loaded; no network calls in tests.
- DM path only. Group prompt (`systemPrompt('group')`), `answerAuto`, `src/prospect.js`, and all owner commands behave exactly as before.
- Published facts only: `knowledge/brief.md` is authoritative; never invent a price, discount, timeline, guarantee, client name, policy, or business type.
- English default; mirror a confidently detected language; never answer an English or emoji-only message in Swahili.
- Reply shape: max 3 non-empty lines, max 320 characters, max one `?`.
- `answerDM` token cap is exactly 360; DM repair call token cap is 200.
- Lead marker `[[LEAD:…]]` format and fallback extractor are unchanged and must survive trimming.
- No push to `origin` and no VPS deploy without a separate explicit approval.

## Review Focus

- **Link/CV/email-only customer message** → must acknowledge that exact item, not a website pitch. Test in Task 3 (prompt assertion + stubbed CV draft).
- **Customer explicitly asks for audit / price / booking** → audit CTA must be retained within the caps. Test in Task 1.
- **Ambiguous short non-English message** (e.g. `Muraho`, `Merci?`) → must NOT be forced to English. Test in Task 2.
- **Reply carrying a `[[LEAD:…]]` marker** → marker must survive the guard unchanged. Test in Task 3.
- **Short existing-client support message** → no audit CTA, still short. Test in Task 1.

---

### Task 1: Deterministic DM reply guard

**Files:**
- Create: `src/replyguard.js`
- Test: `tests/replyguard.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `guardDMReply(reply: string, customerText: string) => string` — pure, idempotent. Imported by Task 3.

- [ ] **Step 1: Write the first failing test**

`tests/replyguard.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { guardDMReply } = require('../src/replyguard')

test('strips blind audit and intake sentences from a CV reply', () => {
  const reply = 'Thanks, I have your CV. I’ll review it.\n' +
    'I can offer a free 30-minute audit. Share your business type, location, current tools, budget range and timeline.'
  const out = guardDMReply(reply, 'Please check my email the soonest you can. My CV shared as discussed.')
  assert.equal(out, 'Thanks, I have your CV. I’ll review it.')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd nutekh-bot && node --test tests/replyguard.test.js`
Expected: FAIL — cannot find module `../src/replyguard`.

- [ ] **Step 3: Implement the minimal module**

Create `src/replyguard.js` exporting `guardDMReply(reply, customerText)` returning `String(reply || '').trim()` unchanged. Do not add the rules yet.

- [ ] **Step 4: Run it to confirm it passes**

Run: `cd nutekh-bot && node --test tests/replyguard.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Write the remaining failing tests**

Append to `tests/replyguard.test.js`:

```js
test('retains the audit CTA when the customer asks for next steps', () => {
  const out = guardDMReply(
    'I can book a free 30-minute audit. What day suits you?',
    'How much is it? Can we book a call?'
  )
  assert.match(out, /free 30-minute audit/)
})

test('caps the reply at three lines and 320 characters', () => {
  const reply = 'One. Two. Three. ' + 'x'.repeat(400) + '\nFour.\nFive.\nSix.'
  const out = guardDMReply(reply, 'hello there')
  assert.ok(out.split('\n').length <= 3)
  assert.ok(out.length <= 320)
})

test('keeps only the first question', () => {
  const out = guardDMReply(
    'Grow starts at RWF 2M. What is your budget? When do you need it?',
    'hello there'
  )
  assert.equal((out.match(/\?/g) || []).length, 1)
  assert.match(out, /What is your budget\?/)
})

test('returns empty when every sentence is canned', () => {
  assert.equal(
    guardDMReply('I can offer a free 30-minute audit. Share your business type and budget range.', 'Please check my email.'),
    ''
  )
})

test('removes a canned CTA from a short support reply', () => {
  const out = guardDMReply(
    'Thanks for flagging this. I’ll pass it to our support team. Shall I book a free call to check?',
    'The invoice is wrong'
  )
  assert.equal(out, 'Thanks for flagging this. I’ll pass it to our support team.')
})

test('is idempotent', () => {
  const reply = 'Thanks, I have your CV. I’ll review it.\nI can offer a free 30-minute audit. Share your business type.'
  assert.equal(
    guardDMReply(guardDMReply(reply, 'Please check my email.'), 'Please check my email.'),
    guardDMReply(reply, 'Please check my email.')
  )
})
```

- [ ] **Step 6: Run tests to confirm the new ones fail**

Run: `cd nutekh-bot && node --test tests/replyguard.test.js`
Expected: 6 FAIL (the first test still passes).

- [ ] **Step 7: Implement the full guard**

In `src/replyguard.js`, keep the same signature and define module-level constants per spec §6:

- `MAX_LINES = 3`, `MAX_CHARS = 320`.
- `NEXT_STEP_RE` = `/\b(audit|price|pricing|cost|how much|quote|book|booking|schedule|call|meeting|get started|starting|work together|onboard|next steps?|demo)\b/i`.
- `CANNED_RE` covering the phrases in spec §6.2 (`free 30-minute audit`, `free audit`, `free call`, `set up a call`, `business type`, `current tools?`, `budget range`, `what is/'s the main goal`, `share your business`, `let me know about your business`, and the `tell me your …` intake variants).
- Sentence splitting on `(?<=[.!?])\s+` (Node 20 supports lookbehind), preserving terminators.

Algorithm:
1. Split the reply into lines on `\r?\n`; trim and drop empty lines.
2. Split each line into sentence tokens; keep the tokens in order.
3. If `NEXT_STEP_RE` does not match `customerText`, drop tokens matching `CANNED_RE`.
4. Drop every question token after the first token ending in `?`.
5. Rejoin tokens within each original line with a single space; drop empty lines; keep the first `MAX_LINES`.
6. Join with `\n`; if longer than `MAX_CHARS`, cut back to the last complete sentence boundary before the cap, else to the last word boundary; trim. Return `''` if nothing remains.

Do not append an ellipsis or explanatory text. Do not import from other project modules.

- [ ] **Step 8: Run guard tests to confirm all pass**

Run: `cd nutekh-bot && node --test tests/replyguard.test.js`
Expected: PASS (7 tests).

- [ ] **Step 9: Commit**

```bash
git add src/replyguard.js tests/replyguard.test.js
git commit -m "feat(nutekh-bot): add deterministic DM reply guard"
```

---

### Task 2: Strict language defaults for short replies

**Files:**
- Modify: `src/lang.js:1-46`
- Test: `tests/lang.test.js`

**Interfaces:**
- Consumes: existing `confidentLang`, `detectLang`, `MARKERS` from `src/lang.js`.
- Produces: `englishDefault(text: string) => 'en' | null`; `needsRepair(expected, text, opts = {})` accepts `opts.minChars` and detects unmistakable foreign tokens. Existing exports keep their signatures.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lang.test.js` (extend the existing import to include `englishDefault`):

```js
test('englishDefault treats emoji-only and clearly English text as English', () => {
  assert.equal(englishDefault('👍🏽'), 'en')
  assert.equal(englishDefault('Please check my email the soonest you can.'), 'en')
})

test('englishDefault leaves ambiguous non-English text to the model', () => {
  assert.equal(englishDefault('Muraho'), null)
  assert.equal(englishDefault('Merci?'), null)
  assert.equal(englishDefault('Muraho, nshaka website'), null)
})

test('needsRepair honours a lower minChars for short DM replies', () => {
  assert.equal(needsRepair('en', 'Ndio, naelewa.', { minChars: 12 }), true)
  assert.equal(needsRepair('en', 'Ndio, naelewa.'), false)
})

test('needsRepair applies the 40-character gate before the foreign-token rule', () => {
  assert.equal(needsRepair('en', 'Je vous prie de patienter.'), false)
  assert.equal(needsRepair('en', 'Je vous prie de patienter.', { minChars: 12 }), true)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `cd nutekh-bot && node --test tests/lang.test.js`
Expected: FAIL — `englishDefault is not a function`; `needsRepair` cases fail.

- [ ] **Step 3: Implement `englishDefault` and extend `needsRepair`**

In `src/lang.js`:

- `englishDefault(text)`: return `null` when `confidentLang(text)` is non-null; strip URLs, `@mentions`, digits, emoji and punctuation; return `'en'` when nothing readable remains, or when at least one English marker matches and no French/Kinyarwanda/Swahili marker matches; otherwise `null`.
- `needsRepair(expected, text, opts = {})`: use `const min = opts.minChars ?? 40`; if `String(text).length < min`, return `false` (existing behaviour). When `expected === 'en'` and the body matches the foreign-token regex below, return `true`. Otherwise return the existing `detectLang(body) !== expected`.
- Foreign-token regex (word-boundary, case-insensitive) from spec §7.2: `ndio, ndiyo, habari, jambo, asante, karibu, sana, shilingi, nshaka, ndashaka, murakoze, amakuru, yego, oya, cyane, igiciro, bonjour, merci, vous, nous, svp`.
- Export `englishDefault` alongside the existing names. Leave `detectLang`, `confidentLang`, `LANG_NAMES`, and `MARKERS` unchanged.

- [ ] **Step 4: Run tests to confirm all pass**

Run: `cd nutekh-bot && node --test tests/lang.test.js`
Expected: PASS (all language tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/lang.js tests/lang.test.js
git commit -m "feat(nutekh-bot): strict language defaults for short DM replies"
```

---

### Task 3: Rewrite the DM prompt and wire the guard into `answerDM`

**Files:**
- Modify: `src/brain.js:1-6, 106-116, 245-292, 324-334`
- Modify: `tests/brain.test.js`
- Create: `tests/reply-wiring.test.js`

**Interfaces:**
- Consumes: `guardDMReply(reply, customerText) => string` (Task 1); `englishDefault(text) => 'en' | null` and `needsRepair(expected, text, opts)` (Task 2).
- Produces: unchanged `answerDM(text, history, notes, opts)` return shape `{ reply, lead, leadSource, doc, skipped, sources }`. `systemPrompt` is additionally exported for tests.

- [ ] **Step 1: Write failing prompt-scope tests**

Append to `tests/brain.test.js` (add `systemPrompt` to the existing import from `../src/brain`):

```js
test('DM prompt carries the short precise reply rules', () => {
  const dm = systemPrompt('dm', '')
  assert.match(dm, /DM REPLY RULES/)
  assert.match(dm, /Answer the customer's exact message/)
  assert.match(dm, /Never infer a business/)
  assert.match(dm, /link, CV, email/)
  assert.match(dm, /free 30-minute audit.*only when/i)
})

test('group prompt does not carry the DM reply rules', () => {
  assert.doesNotMatch(systemPrompt('group', ''), /DM REPLY RULES/)
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `cd nutekh-bot && node --test tests/brain.test.js`
Expected: FAIL — `systemPrompt is not a function` (not exported).

- [ ] **Step 3: Export `systemPrompt` and add the DM-only override block**

In `src/brain.js`:

- Import `englishDefault` from `./lang` and `guardDMReply` from `./replyguard`.
- Define `DM_REPLY_RULES` containing the exact DM rules from spec §5, including the heading `DM REPLY RULES` and the phrases asserted above.
- In `systemPrompt('dm')`, append `DM_REPLY_RULES` after the customer notes and before returning; do not touch the group branch.
- Add `systemPrompt` to `module.exports`.

- [ ] **Step 4: Run prompt tests to confirm they pass**

Run: `cd nutekh-bot && node --test tests/brain.test.js`
Expected: PASS (all brain tests, including the pre-existing ones).

- [ ] **Step 5: Write failing end-to-end wiring tests**

Create `tests/reply-wiring.test.js` with its own LLM stub, following `tests/fallback.test.js` but recording calls:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const llmPath = require.resolve('../src/llm')
let chatCalls = []
let chatQueue = []
let jsonReply = null
require.cache[llmPath] = {
  id: llmPath,
  filename: llmPath,
  loaded: true,
  exports: {
    chat: async (messages, opts) => { chatCalls.push({ messages, opts }); return chatQueue.length ? chatQueue.shift() : '' },
    chatJSON: async () => jsonReply,
    CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test',
  },
}

const { answerDM } = require('../src/brain')

function reset(replies) {
  chatCalls = []
  chatQueue = replies.slice()
  jsonReply = null
}

test('answerDM removes the canned audit paragraph from a CV reply', async () => {
  reset(['Thanks, I have your CV. I’ll review it.\nI can offer a free 30-minute audit. Share your business type and budget range.'])
  const res = await answerDM('Please check my email the soonest you can. My CV shared as discussed.', [], '')
  assert.doesNotMatch(res.reply, /free 30-minute audit/)
  assert.ok(res.reply.split('\n').length <= 3)
})

test('answerDM asks the model for at most 360 tokens', async () => {
  reset(['Sure, I can help with that.'])
  await answerDM('How much is Grow?', [], '')
  assert.ok(chatCalls[0].opts.max_tokens <= 360)
})

test('answerDM keeps an English reply for an emoji-only message', async () => {
  reset(['Ndio, naelewa.', 'Thanks! 👍'])
  const res = await answerDM('👍🏽', [], '')
  assert.doesNotMatch(res.reply, /Ndio|naelewa/)
  assert.match(res.reply, /Thanks/)
})

test('answerDM leaves a qualified lead marker untouched', async () => {
  reset(['Grow starts at RWF 2M.\n[[LEAD: {"type":"sales","business":"Shop","need":"POS","budget":"RWF 2M"}]]'])
  const res = await answerDM('I run a shop in Kigali, budget is RWF 2M, I need POS.', [], '')
  assert.equal(res.leadSource, 'marker')
  assert.equal(res.lead.business, 'Shop')
  assert.ok(res.reply.split('\n').length <= 3)
})
```

- [ ] **Step 6: Run wiring tests to confirm they fail**

Run: `cd nutekh-bot && node --test tests/reply-wiring.test.js`
Expected: FAIL — canned text still present; `max_tokens` is 900; Swahili not repaired.

- [ ] **Step 7: Wire the guard, token cap, and language defaults into `answerDM`**

In `src/brain.js`:

- Change the `chat` call in `answerDM` to `{ max_tokens: 360 }` (leave `answerAuto` at 700).
- After `tidy(...)`, apply `reply = guardDMReply(reply, text)`; if empty, use the existing fallback string from line 281.
- Extend the exported `ensureLanguage(reply, customerText, opts = {})`:
  - keep the `opts.langGuard === false` short-circuit;
  - `const expected = confidentLang(customerText) || opts.defaultLang || null`; keep `if (!expected) return reply`;
  - call `needsRepair(expected, reply, { minChars: opts.minRepairChars })`;
  - when `opts.short` is true, pass a short-style instruction to `repairLanguage` and use `max_tokens: 200` there.
- `answerDM` calls `ensureLanguage(reply, text, { ...opts, defaultLang: englishDefault(text), minRepairChars: 12, short: true })`, then applies `guardDMReply` a second time with the same empty fallback.
- Do not change `answerAuto`, `extractLead`, `parseMarkers`, or `tidy`.

- [ ] **Step 8: Run wiring tests to confirm they pass**

Run: `cd nutekh-bot && node --test tests/reply-wiring.test.js`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the full suite**

Run: `cd nutekh-bot && npm test`
Expected: all tests pass (existing 110 plus the new guard, language, prompt and wiring tests).

- [ ] **Step 10: Commit**

```bash
git add src/brain.js tests/brain.test.js tests/reply-wiring.test.js
git commit -m "feat(nutekh-bot): tighten DM reply prompt and wire guard"
```

## Self-Review

- **Spec coverage:** §5 → Task 3 Steps 3/7; §6 → Task 1; §7.1–7.2 → Task 2; §7.3 → Task 3 Step 7; §8 → Tasks 1–3 tests; §9 risks → CTA-retained, token-cap, marker-survival, and group-scope tests; §10 → Task 3 Step 9. No gaps.
- **Ambiguity resolved:** the spec's `ensureLanguage` stays in `src/brain.js` (it owns `repairLanguage`); `src/lang.js` only gains `englishDefault` and the extended `needsRepair`.
- **Type consistency:** `guardDMReply(string, string) => string`, `englishDefault(string) => 'en'|null`, `needsRepair(string, string, object) => boolean` used identically in every task.
- **Review Focus:** every listed input has a named test in its owning task.
