# Nutekh Single-Language Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every bot reply use exactly one language, chosen by a deterministic contract, with one verified repair and a localized fallback if the repair still mixes languages.

**Architecture:** `src/lang.js` gains `replyLanguage()` (decides the expected language) and a symmetric reply marker guard. `src/brain.js` swaps `ensureLanguage()` from `confidentLang() || opts.defaultLang` to that contract, re-checks after a single repair call, and returns a fixed fallback in the expected language on failure. DM and group paths need no call-site changes because both already call `ensureLanguage()`.

**Tech Stack:** Node.js CommonJS, `node:test` + `node:assert/strict`, existing LLM stub via `require.cache[require.resolve('../src/llm')]`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-26-nutekh-single-language-replies-design.md`

## Global Constraints

- CommonJS only; no new npm dependencies; offline tests only.
- Decision order: explicit "doesn't understand English" phrase → `confidentLang()` → `opts.defaultLang` hint → `en`.
- Confident detection = existing rule: ≥2 distinct markers, no tie.
- English request naming no target → `rw`. Words meaning "English" (`icyongereza`, `anglais`, `kiingereza`, `english`) are never targets.
- Brand/product names `WhatsApp`, `AI`, `Grow`, `ImaliCloud`, `Hresa`, `VUKA`, `CRM`, `websites` are neutral and must not appear in any marker list.
- Reply guard stays 3 lines / one `?` / 320 characters (`src/replyguard.js` unchanged).
- Group `[[SKIP]]` handling unchanged. First-contact greeting copy unchanged: `Hi! I'm Nutekh's assistant — we're a digital agency in Kigali.\nWe help with websites, WhatsApp automation, payments and more.\nWhat brings you in?`
- Exact fallbacks: `en` = `I'm here to help with Nutekh's services, packages, and support. What would you like to know?`; `rw` = `Nshobora kugufasha ku serivisi za Nutekh. Ufite ikibazo runaka?`; `fr` = `Je peux vous aider avec les services de Nutekh. Que souhaitez-vous savoir ?`; `sw` = `Ninaweza kukusaidia na huduma za Nutekh. Unataka kujua nini?`
- VPS deployment requires explicit owner confirmation and must preserve `.env`, `auth/`, `data/`, `documents/`, `media/`, `logs/`, `node_modules/`.

## Review Focus

These are the spec-implied inputs most likely to break if a task is done literally but carelessly. Each has a pinning test in the owning task.

1. **Short/ambiguous English customer text** (`Restaurant`, `👍🏽`) must default to English, not leave the model free to answer in Kinyarwanda — pinned in Task 1 (`replyLanguage`) and Task 4 (`answerDM` live failures).
2. **Foreign tail that `detectLang()` still scores as English** (e.g. `Muraho, ufite` inside an otherwise English reply) must trigger repair, while **brand names must not** — pinned in Task 2 (`needsRepair` mixed-tail and brand-neutrality tests).
3. **Explicit phrase with a named target** (`I don't understand English, reply in French`) must use the named target, not the phrase language or the `rw` default — pinned in Task 1 and Task 4.
4. **Repair that fails or returns the same mixed text** must yield the localized fallback, never the mixed reply, and must not call the model twice — pinned in Task 3.
5. **Group path** must repair a mixed reply but leave `[[SKIP]]` as a skipped result — pinned in Task 4.

---

### Task 1: Deterministic language selection in `src/lang.js`

**Files:**
- Modify: `src/lang.js`
- Test: `tests/lang.test.js`

**Interfaces:**
- Consumes: existing `MARKERS`, `confidentLang(text)` from `src/lang.js`.
- Produces: `replyLanguage(customerText, opts = {}) -> 'en' | 'rw' | 'fr' | 'sw'`, exported from `src/lang.js`. `opts.defaultLang` is accepted when it is one of `en|rw|fr|sw`.

- [ ] **Step 1: Write the failing tests**

Add `replyLanguage` to the destructured require at `tests/lang.test.js:4`, then append:

```js
test('replyLanguage honours explicit "does not understand English" phrases', () => {
  assert.equal(replyLanguage("I don't understand English"), 'rw')
  assert.equal(replyLanguage('I do not understand english'), 'rw')
  assert.equal(replyLanguage('no English please'), 'rw')
  assert.equal(replyLanguage('simenya icyongereza'), 'rw')
  assert.equal(replyLanguage('je ne comprends pas anglais'), 'fr')
  assert.equal(replyLanguage('je ne parle pas anglais'), 'fr')
  assert.equal(replyLanguage('sielewi Kiingereza'), 'sw')
  assert.equal(replyLanguage('mbwira mu kinyarwanda'), 'rw')
})

test('replyLanguage prefers a named target over the phrase language', () => {
  assert.equal(replyLanguage("I don't understand English, reply in French"), 'fr')
  assert.equal(replyLanguage('Please speak in Swahili'), 'sw')
  assert.equal(replyLanguage('jibu kwa kiswahili'), 'sw')
})

test('replyLanguage uses confident detection before the call-site hint', () => {
  assert.equal(replyLanguage('Muraho, igiciro cya Grow ni angahe? Murakoze'), 'rw')
  assert.equal(replyLanguage('Habari, bei ya Grow ni ngapi? Asante sana'), 'sw')
  assert.equal(replyLanguage('How much does the Grow package cost?'), 'en')
  assert.equal(replyLanguage('Muraho, ndashaka website', { defaultLang: 'en' }), 'rw')
})

test('replyLanguage falls back to the hint, then to English', () => {
  assert.equal(replyLanguage('Bonjour', { defaultLang: 'fr' }), 'fr')
  assert.equal(replyLanguage('hello', { defaultLang: 'de' }), 'en')
  assert.equal(replyLanguage('Restaurant'), 'en')
  assert.equal(replyLanguage('👍🏽'), 'en')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lang.test.js`
Expected: the four new tests fail with `TypeError: replyLanguage is not a function`; existing tests still pass.

- [ ] **Step 3: Implement `replyLanguage` in `src/lang.js`**

Add a case-insensitive `EXPLICIT_PHRASES` array of `{ re, fallback }` entries with exactly these patterns (word boundaries, `\s+` between words). `fallback` is the language used when no named target is captured; for English phrases it is `rw`, because "I don't understand English" with no named target defaults to Kinyarwanda. Phrase order does not decide the result: scan **all** matching entries for a named target first, because the explicit named target wins even when an earlier phrase family (e.g. the English disclaimer) matched with a different fallback. Words meaning "English" (`icyongereza`, `anglais`, `kiingereza`, `english`) are never capture targets.

- `/\b(?:please\s+)?(?:reply|speak|write)\s+(?:in\s+)?(kinyarwanda|french|swahili)\b/i` → `fallback: 'rw'`, capture group 1 is a named target.
- `/\bi\s+(?:don'?t|do not)\s+(?:understand|speak)\s+english\b/i` → `fallback: 'rw'`
- `/\bno\s+english\s+please\b/i` → `fallback: 'rw'`
- `/\b(?:simenya|sindamenya|ntamenya)\s+icyongereza\b/i` → `fallback: 'rw'`
- `/\bmbwira\s+mu\s+(kinyarwanda)\b/i` → `fallback: 'rw'`, capture group 1 is a named target.
- `/\bje\s+ne\s+comprends\s+pas\s+(?:l')?anglais\b/i` → `fallback: 'fr'`
- `/\bje\s+ne\s+parle\s+pas\s+anglais\b/i` → `fallback: 'fr'`
- `/\brépondez\s+en\s+(français)\b/i` → `fallback: 'fr'`, capture group 1 is a named target.
- `/\b(?:sielewi|sijui)\s+kiingereza\b/i` → `fallback: 'sw'`
- `/\bsina\s+uelewa\s+wa\s+kiingereza\b/i` → `fallback: 'sw'`
- `/\bjibu\s+kwa\s+(kiswahili)\b/i` → `fallback: 'sw'`, capture group 1 is a named target.

Implement `replyLanguage(customerText, opts = {})` as: (1) normalize U+2019 to ASCII `'` in a local `text` used for explicit-phrase matching, so mobile smart quotes match the ASCII phrases; (2) scan every phrase entry against `text`; return the first recognized named target from capture group 1 across all matches (`kinyarwanda` → `rw`, `french`/`français` → `fr`, `swahili`/`kiswahili` → `sw`) before returning any entry fallback; (3) if no named target exists, return the first matching entry's `fallback`; (4) return `confidentLang(customerText)` when non-null; (5) return `opts.defaultLang` when it is one of `en|rw|fr|sw`; (6) return `'en'`. Do not modify `detectLang`, `confidentLang`, `englishDefault`, `MARKERS` or the existing exports. Add `replyLanguage` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lang.test.js`
Expected: all tests pass (17 existing + 4 new = 21).

- [ ] **Step 5: Commit**

```bash
git add src/lang.js tests/lang.test.js
git commit -m "feat(language): add deterministic reply language selection"
```

---

### Task 2: Symmetric language guard in `src/lang.js`

**Files:**
- Modify: `src/lang.js`
- Test: `tests/lang.test.js`

**Interfaces:**
- Consumes: `MARKERS`, `MIN_REPAIR_CHARS`, `FOREIGN_TOKEN_RE`, `score(text, markers)`, `detectLang(text)` from `src/lang.js`.
- Produces: `needsRepair(expected, replyText, opts = {}) -> boolean` — same signature, new symmetric behavior. Internal `REPLY_MARKERS` map is not exported.

- [ ] **Step 1: Write the failing tests**

Append to `tests/lang.test.js`:

```js
test('needsRepair flags the live Kinyarwanda "Restaurant" reply', () => {
  const rw = 'Turi kumwe! Dufite igisubizo cyiza ku ruhande rwa restaurant yawe. Ufite ibikoresho iki gihe wifashisha cyangwa ukaba ufite gahunda yo gukoresha ibindi?'
  assert.ok(rw.length >= 40)
  assert.equal(needsRepair('en', rw), true)
})

test('needsRepair flags the live Mira\'s Pizza Kinyarwanda reply', () => {
  const rw = "Nta kibazo! Iyo mwiteguye, murashobora kutwandikira. Ni gute dushobora kubafasha mu gihe mugitegura?"
  assert.ok(rw.length >= 40)
  assert.equal(needsRepair('en', rw), true)
})

test('needsRepair flags a foreign tail even when detectLang scores the reply as English', () => {
  const mixed = 'We can help with your website. Muraho, ufite ikibazo?'
  assert.equal(needsRepair('en', mixed, { minChars: 12 }), true)
})

test('needsRepair ignores neutral brand and product names', () => {
  const rw = 'Murakoze! Nshobora kugufasha ku serivisi za Nutekh. WhatsApp, AI, Grow, ImaliCloud, Hresa, VUKA, CRM na websites birahari. Ufite ikibazo runaka?'
  assert.equal(needsRepair('rw', rw), false)
  assert.equal(needsRepair('en', 'We use WhatsApp, AI and Grow with ImaliCloud, Hresa, VUKA, CRM and websites.'), false)
})

test('needsRepair flags an English reply to a non-English expectation', () => {
  assert.equal(needsRepair('rw', 'We can help with a clear, fast website. What type of business do you run?'), true)
  assert.equal(needsRepair('fr', 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'), true)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/lang.test.js`
Expected: the five new tests fail; Task 1 tests still pass.

- [ ] **Step 3: Implement the symmetric guard in `src/lang.js`**

Add `REPLY_MARKERS` as a new map with one array per language. For `en`, copy `MARKERS.en`. For `fr` and `sw`, copy `MARKERS.fr` and `MARKERS.sw`. For `rw`, copy `MARKERS.rw` and append exactly: `murakaza`, `neza`, `nshobora`, `kugufasha`, `nkeneye`, `dufite`, `dutanga`, `dukora`, `wifuza`, `wifashisha`, `murashobora`, `mwiteguye`, `dushobora`, `gahunda`, `igihe`, `nta`, `amakampani`, `ikoranabuhanga`, `uburyo`, `kwishyura`. (Existing `gute`, `ufite`, `nshaka`, `ndashaka` are already present; do not duplicate them.) None of the Global Constraints brand names go into any array.

Rewrite `needsRepair(expected, replyText, opts = {})` keeping `const body = String(replyText || '')`, `const min = opts.minChars ?? MIN_REPAIR_CHARS`, and `if (body.length < min) return false` first. Then, in order:

1. `if (expected === 'en' && FOREIGN_TOKEN_RE.test(body)) return true` (unchanged).
2. When `expected === 'en'`, return true if `['rw', 'fr', 'sw'].some((lang) => score(body, REPLY_MARKERS[lang]) >= 2)`.
3. When `expected !== 'en'`, return true if `score(body, REPLY_MARKERS.en) >= 2` or if any *other* non-English language scores ≥ 2 against `REPLY_MARKERS`.
4. Finish with the unchanged `return detectLang(body) !== expected`.

Keep the function pure and total; do not change its signature or any other export.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lang.test.js`
Expected: all 26 tests pass (21 after Task 1 + 5 new), including the pre-existing 40-character gate tests at `tests/lang.test.js:77-85`.

- [ ] **Step 5: Commit**

```bash
git add src/lang.js tests/lang.test.js
git commit -m "feat(language): make the reply guard symmetric across languages"
```

---

### Task 3: Verified repair and localized fallbacks in `src/brain.js`

**Files:**
- Modify: `src/brain.js` (import at line 5, `DM_FALLBACK` area at line 12, `ensureLanguage()` at lines 286-292)
- Test: `tests/brain.test.js`

**Interfaces:**
- Consumes: `replyLanguage(customerText, opts)`, `needsRepair(expected, replyText, { minChars })`, existing `repairLanguage(text, lang, chatFn, short = false)`.
- Produces: `ensureLanguage(reply, customerText, opts = {}) -> Promise<string>` with post-repair verification; internal `LANG_FALLBACKS` map in `src/brain.js`.

- [ ] **Step 1: Update the two now-stale tests and add two new ones in `tests/brain.test.js`**

Replace the assertion in `'ensureLanguage keeps the original reply when the repair call fails'` (line 155) so the mixed reply is not returned. Rename the test to reflect the new fallback contract:

```js
test('ensureLanguage falls back to English when the repair call fails', async () => {
  const out = await ensureLanguage(SW_REPLY, 'How much is Grow?', {
    chat: async () => { throw new Error('offline') },
  })
  assert.equal(out, "I'm here to help with Nutekh's services, packages, and support. What would you like to know?")
})
```

Replace `'ensureLanguage leaves a correct reply alone for a short ambiguous message'` (line 172) with two tests, because a short ambiguous message now defaults to English:

```js
test('ensureLanguage repairs a French reply to English for a short ambiguous message', async () => {
  const fr = 'Bonjour ! Le pack Grow coûte RWF 2M. Vous pouvez réserver un audit gratuit avec notre équipe.'
  let used = null
  const out = await ensureLanguage(fr, 'Combien?', {
    chat: async (messages) => { used = messages; return 'Grow starts at RWF 2M. Shall I book the free audit?' },
  })
  assert.match(out, /Grow starts at RWF 2M/)
  assert.match(used[0].content, /English/)
})

test('ensureLanguage leaves a French reply alone for a confidently French message', async () => {
  const fr = 'Bonjour ! Le pack Grow coûte RWF 2M. Vous pouvez réserver un audit gratuit avec notre équipe.'
  let called = false
  const out = await ensureLanguage(fr, 'Bonjour, combien ?', {
    chat: async () => { called = true; return 'x' },
  })
  assert.equal(out, fr)
  assert.equal(called, false)
})
```

Append:

```js
test('ensureLanguage uses the English fallback when repair leaves a mixed reply', async () => {
  const mixed = 'We can help with your website. Muraho, ufite ikibazo? and we can also help with more.'
  let calls = 0
  const out = await ensureLanguage(mixed, 'Restaurant', {
    chat: async () => { calls++; return mixed },
  })
  assert.equal(out, "I'm here to help with Nutekh's services, packages, and support. What would you like to know?")
  assert.equal(calls, 1, 'repair must be attempted exactly once')
})

test('ensureLanguage uses the Kinyarwanda fallback for an explicit request', async () => {
  const en = 'Thank you for your message. I can help with Nutekh services and answer any question you have.'
  let used = null
  const out = await ensureLanguage(en, 'simenya icyongereza', {
    chat: async (messages) => { used = messages; return en },
  })
  assert.equal(out, 'Nshobora kugufasha ku serivisi za Nutekh. Ufite ikibazo runaka?')
  assert.match(used[0].content, /Kinyarwanda/)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/brain.test.js`
Expected: the modified failure test and the two fallback tests fail; `ensureLanguage` still returns the raw mixed text.

- [ ] **Step 3: Implement the verified repair in `src/brain.js`**

At line 5, add `replyLanguage` to the destructured `require('./lang')` and drop `confidentLang` if it is no longer referenced. Immediately after `DM_FALLBACK` (line 12), add `LANG_FALLBACKS` with exactly the four strings from the Global Constraints table in the spec §4.3, keyed `en`, `rw`, `fr`, `sw`; the `en` value must be the `DM_FALLBACK` constant.

Replace the body of `ensureLanguage` with:

```js
async function ensureLanguage(reply, customerText, opts = {}) {
  if (opts.langGuard === false) return reply
  const expected = replyLanguage(customerText, opts)
  if (!needsRepair(expected, reply, { minChars: opts.minRepairChars })) return reply
  const repaired = await repairLanguage(reply, expected, opts.chat || chat, opts.short)
  if (!needsRepair(expected, repaired, { minChars: opts.minRepairChars })) return repaired
  return LANG_FALLBACKS[expected] || DM_FALLBACK
}
```

Do not add a second repair call. Do not change `answerDM()` or `answerAuto()` call sites. Do not change `repairLanguage()`, `guardDMReply()` or the greeting branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/brain.test.js`
Expected: all tests pass, including the unchanged `'ensureLanguage is a no-op when the guard is disabled'` and unchanged group-default tests.

- [ ] **Step 5: Commit**

```bash
git add src/brain.js tests/brain.test.js
git commit -m "feat(language): verify repair and fall back to a single-language reply"
```

---

### Task 4: DM and group wiring regression tests

**Files:**
- Modify: `tests/reply-wiring.test.js` (extend the require at line 24 to include `answerAuto`; append tests)
- No source changes expected.

**Interfaces:**
- Consumes: `answerDM(text, history = [], notes = '', opts = {})`, `answerAuto(text, history = [], recent = [], opts = {})` from `src/brain.js`; the existing `reset(replies)` helper and `chatCalls` array in `tests/reply-wiring.test.js`.
- Produces: none. This task pins that the Task 3 change reaches both paths without call-site edits.

- [ ] **Step 1: Write the wiring tests**

Append to `tests/reply-wiring.test.js`:

```js
test('answerDM repairs the live "Restaurant" failure to English', async () => {
  reset([
    'Turi kumwe! Dufite igisubizo cyiza ku ruhande rwa restaurant yawe. Ufite ibikoresho iki gihe wifashisha cyangwa ukaba ufite gahunda yo gukoresha ibindi?',
    'We can build a clear website for your restaurant. What tools do you use now?',
  ])
  const res = await answerDM('Restaurant', [], '')
  assert.match(res.reply, /website/)
  assert.doesNotMatch(res.reply, /Turi kumwe|Dufite|Ufite/)
  assert.equal(chatCalls.length, 2)
  assert.match(chatCalls[1].messages[0].content, /English/)
})

test('answerDM repairs the live "What do you guys do" failure to English', async () => {
  reset([
    'Dukora ibikorwa byinshi bya digitale. Dutanga websites na WhatsApp automation. Ufite ikibazo runaka?',
    'We build websites and WhatsApp automation. What do you need help with?',
  ])
  const res = await answerDM('What do you guys do', [], '')
  assert.match(res.reply, /websites and WhatsApp automation/)
  assert.doesNotMatch(res.reply, /Dukora|Dutanga|Ufite/)
  assert.match(chatCalls[1].messages[0].content, /English/)
})

test('answerDM replies in Kinyarwanda when the customer does not understand English', async () => {
  reset(['I can help with Nutekh services and answer your questions today.', 'Nshobora kugufasha ku serivisi za Nutekh. Ufite ikibazo runaka?'])
  const res = await answerDM("I don't understand English", [], '')
  assert.match(res.reply, /Nshobora kugufasha/)
  assert.match(chatCalls[1].messages[0].content, /Kinyarwanda/)
})

test('answerDM honours a named target in an explicit request', async () => {
  reset(['I can help with that today.', 'Je peux vous aider avec les services de Nutekh. Que souhaitez-vous savoir ?'])
  const res = await answerDM("I don't understand English, reply in French", [], '')
  assert.match(res.reply, /Je peux vous aider/)
  assert.match(chatCalls[1].messages[0].content, /French/)
})

test('answerAuto repairs a mixed group reply but keeps [[SKIP]] skipped', async () => {
  reset([
    'Turi kumwe! Dufite igisubizo cyiza ku ruhande rwa restaurant yawe. Ufite ibikoresho iki gihe wifashisha cyangwa ukaba ufite gahunda yo gukoresha ibindi?',
    'We can build a clear website for your restaurant. What tools do you use now?',
  ])
  const res = await answerAuto('Restaurant', [], [], { addressed: true })
  assert.equal(res.skipped, false)
  assert.match(res.reply, /website/)
  assert.match(chatCalls[1].messages[0].content, /English/)

  reset(['[[SKIP]]'])
  const skipped = await answerAuto('Restaurant', [], [], { addressed: true })
  assert.equal(skipped.skipped, true)
  assert.equal(skipped.reply, '')
})
```

- [ ] **Step 2: Run the new tests**

Run: `node --test tests/reply-wiring.test.js`
Expected: all tests pass with Task 3 landed. (These are regression tests for behavior that failed at commit `d8cc16e`, so they document the fix rather than drive new source changes.)

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: `tests`, `pass` with `fail 0`, and total count greater than the previous 140 baseline.

- [ ] **Step 4: Commit**

```bash
git add tests/reply-wiring.test.js
git commit -m "test(language): pin single-language DM and group wiring"
```
