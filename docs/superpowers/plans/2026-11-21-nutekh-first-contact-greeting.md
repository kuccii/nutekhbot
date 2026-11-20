# Nutekh First-Contact Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a first-contact standalone greeting a fixed warm reply that names real Nutekh services and asks one easy question, inside the existing DM guard.

**Architecture:** A new dependency-free CommonJS module owns greeting detection, a language hint, and the exact reply copy. `answerDM()` short-circuits to that copy for first-contact greetings, then runs the existing `guardDMReply` → `ensureLanguage` → `guardDMReply` pipeline; all other messages keep the current LLM path.

**Tech Stack:** Node.js 20, CommonJS, `node --test`, existing `require.cache` LLM stub pattern.

**Spec:** `docs/superpowers/specs/2026-11-21-nutekh-first-contact-greeting-design.md`

## Global Constraints

- DM replies only; group path untouched.
- 1–3 short lines, at most one `?`, 320-character cap.
- Published facts only — no prices, timelines, guarantees, or inferred customer details.
- English default; mirror non-English via `ensureLanguage` plus the greeting-word hint.
- CommonJS; no new npm dependencies; offline tests only.
- Keep the public `answerDM` return shape: `{ reply, lead, leadSource, doc, skipped, sources }`.
- Run commands from `G:\nutekhbot-sync` (bash: `/g/nutekhbot-sync`).

## Review Focus

- A real enquiry that merely starts with a greeting ("hello, how much is Grow?") must still use the LLM path — Task 2 test `answerDM uses the normal path when a greeting starts a real enquiry`.
- A returning customer who says "hello" must not be re-introduced to Nutekh — Task 2 test `answerDM does not re-introduce Nutekh for a returning hello`.
- A localized greeting ("Bonjour") must produce a mirrored reply through the existing repair call — Task 2 test `answerDM mirrors a localized first-contact greeting via the repair call`.
- Emoji/punctuation padding ("👋 Hello!!!") must not defeat detection — Task 1 test `isFirstContactGreeting accepts plain and decorated greetings`.
- An audience-style greeting ("good morning everyone") must not trigger the intro — Task 1 test `isFirstContactGreeting rejects enquiries, broadcasts and empty text`.

---

### Task 1: Greeting helper module

**Files:**
- Create: `src/greeting.js`
- Test: `tests/greeting.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `isFirstContactGreeting(text) -> boolean`, `greetingLanguage(text) -> 'en'|'fr'|'rw'|'sw'`, `FIRST_CONTACT_GREETING -> string`. Task 2 imports all three.

- [ ] **Step 1: Write the failing tests**

Create `tests/greeting.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const { isFirstContactGreeting, greetingLanguage, FIRST_CONTACT_GREETING } = require('../src/greeting')

test('isFirstContactGreeting accepts plain and decorated greetings', () => {
  for (const text of ['hello', 'Hi there!', 'hey', 'good morning', 'muraho', 'habari', 'bonjour', 'salut', '👋 Hello!!!']) {
    assert.equal(isFirstContactGreeting(text), true, text)
  }
})

test('isFirstContactGreeting rejects enquiries, broadcasts and empty text', () => {
  for (const text of ['', 'hello, how much is Grow?', 'hi I need a website', 'good morning everyone', 'How much is Grow?']) {
    assert.equal(isFirstContactGreeting(text), false, text)
  }
})

test('greetingLanguage maps localized greetings and defaults to English', () => {
  assert.equal(greetingLanguage('bonjour'), 'fr')
  assert.equal(greetingLanguage('salut'), 'fr')
  assert.equal(greetingLanguage('muraho'), 'rw')
  assert.equal(greetingLanguage('habari'), 'sw')
  assert.equal(greetingLanguage('jambo'), 'sw')
  assert.equal(greetingLanguage('hello'), 'en')
  assert.equal(greetingLanguage('good morning'), 'en')
})

test('FIRST_CONTACT_GREETING meets the DM guard contract', () => {
  const lines = FIRST_CONTACT_GREETING.split('\n')
  assert.equal(lines.length, 3)
  assert.equal((FIRST_CONTACT_GREETING.match(/\?/g) || []).length, 1)
  assert.ok(FIRST_CONTACT_GREETING.length <= 320)
  for (const fact of ['Nutekh', 'Kigali', 'websites', 'WhatsApp automation', 'payments']) {
    assert.match(FIRST_CONTACT_GREETING, new RegExp(fact))
  }
  assert.doesNotMatch(FIRST_CONTACT_GREETING, /(RWF|TZS|USD|price|per month)/i)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/greeting.test.js`
Expected: FAIL — `Cannot find module '../src/greeting'`.

- [ ] **Step 3: Implement `src/greeting.js`**

CommonJS module with no imports. Normalize text by lowercasing, replacing every character outside `[a-z\s']` with a space, collapsing whitespace, and trimming. Match the normalized message against this anchored expression (optional trailing `there`):

```text
^(?:hello|hi|hey|yo|good (?:morning|afternoon|evening)|muraho|habari|jambo|bonjour|salut)(?: there)?$
```

`greetingLanguage` uses the normalized greeting: `bonjour`/`salut` → `fr`, `muraho` → `rw`, `habari`/`jambo` → `sw`, everything else → `en`.

`FIRST_CONTACT_GREETING` is exactly:

```text
Hi! I'm Nutekh's assistant — we're a digital agency in Kigali.
We help with websites, WhatsApp automation, payments and more.
What brings you in?
```

Export all three names.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/greeting.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/greeting.js tests/greeting.test.js
git commit -m "feat(nutekh-bot): add deterministic first-contact greeting helper"
```

---

### Task 2: Wire the greeting into `answerDM`

**Files:**
- Modify: `src/brain.js:1-11` (import) and `src/brain.js:293-318` (`answerDM`)
- Modify: `tests/reply-wiring.test.js:9-30` (stub setup) and end of file (new tests)

**Interfaces:**
- Consumes: `isFirstContactGreeting`, `greetingLanguage`, `FIRST_CONTACT_GREETING` from `src/greeting.js` (Task 1).
- Produces: unchanged `answerDM(text, history, notes, opts)` return shape; for first-contact greetings, the fixed reply with `lead: null`, `leadSource: null`, `sources: 0`.

- [ ] **Step 1: Write the failing tests**

Add `const { FIRST_CONTACT_GREETING } = require('../src/greeting')` after the imports in `tests/reply-wiring.test.js`, then append:

```js
test('answerDM uses the fixed warm greeting on first-contact hello', async () => {
  reset([])
  const res = await answerDM('hello', [], '', { firstContact: true })
  assert.equal(res.reply, FIRST_CONTACT_GREETING)
  assert.equal(chatCalls.length, 0)
  assert.equal(res.sources, 0)
  assert.equal(res.lead, null)
  assert.equal(res.leadSource, null)
})

test('answerDM does not re-introduce Nutekh for a returning hello', async () => {
  reset(['Hi again, what do you need?'])
  const res = await answerDM('hello', [{ role: 'user', text: 'How much is Grow?' }], '', { firstContact: false })
  assert.equal(res.reply, 'Hi again, what do you need?')
  assert.equal(chatCalls.length, 1)
})

test('answerDM uses the normal path when a greeting starts a real enquiry', async () => {
  reset(['Grow starts at RWF 2M.'])
  const res = await answerDM('hello, how much is Grow?', [], '', { firstContact: true })
  assert.match(res.reply, /Grow/)
  assert.equal(chatCalls.length, 1)
})

test('answerDM mirrors a localized first-contact greeting via the repair call', async () => {
  reset(['Bonjour ! Nous sommes une agence à Kigali. Que cherchez-vous ?'])
  const res = await answerDM('Bonjour', [], '', { firstContact: true })
  assert.equal(chatCalls.length, 1)
  assert.equal(chatCalls[0].opts.max_tokens, 200)
  assert.match(chatCalls[0].messages[0].content, /French/)
  assert.match(res.reply, /Bonjour/)
})

test('answerDM falls back to the English greeting if translation fails', async () => {
  reset([])
  const res = await answerDM('Bonjour', [], '', { firstContact: true })
  assert.equal(res.reply, FIRST_CONTACT_GREETING)
  assert.equal(chatCalls.length, 1)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/reply-wiring.test.js`
Expected: FAIL — first-contact greeting tests receive a `chatCalls.length` of 1 and a reply from the stub, not `FIRST_CONTACT_GREETING`.

- [ ] **Step 3: Add the greeting branch to `answerDM`**

Import the three exports from `./greeting` at the top of `src/brain.js`. As the first statement of `answerDM`, before `retrieve()`:

- If `opts.firstContact === true && isFirstContactGreeting(text)`, set `reply = guardDMReply(FIRST_CONTACT_GREETING, text) || DM_FALLBACK`.
- Run `reply = await ensureLanguage(reply, text, { ...opts, defaultLang: greetingLanguage(text), minRepairChars: 12, short: true })`.
- Run `reply = guardDMReply(reply, text) || DM_FALLBACK`.
- Return `{ reply, lead: null, leadSource: null, doc: null, skipped: false, sources: 0 }`.
- Otherwise leave the existing body untouched.

Do not call `retrieve()`, the 360-token `chat()`, or `extractLead()` in the greeting branch.

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `npm test`
Expected: PASS — 140 tests (131 existing + 4 from Task 1 + 5 here), 0 failures, with no network access.

- [ ] **Step 5: Commit**

```bash
git add src/brain.js tests/reply-wiring.test.js
git commit -m "feat(nutekh-bot): use warm greeting for first-contact hello"
```

---

## Post-plan note

Deployment to the VPS is deliberately not part of these tasks. It requires explicit
owner confirmation and must preserve `.env`, `auth/`, `data/`, `documents/`, `media/`,
`logs/` and `node_modules/`.
