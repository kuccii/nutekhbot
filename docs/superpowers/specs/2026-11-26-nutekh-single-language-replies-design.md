# Nutekh Single-Language Replies — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-26
- **Scope:** the `nutekh-bot` reply path (DM and group), specifically language selection and enforcement
- **Related:** `docs/superpowers/specs/2026-11-20-nutekh-client-reply-precision-design.md`,
  `docs/superpowers/specs/2026-11-21-nutekh-first-contact-greeting-design.md`

## 1. Context

The owner observed that the bot can start a reply in English and end it in
Kinyarwanda. Read-only evidence in `/opt/nutekh-bot/data/dm-memory.json` confirms
three live failures:

1. Customer: `Restaurant` → assistant replied entirely in Kinyarwanda.
2. Customer: `What do you guys do` → assistant replied in Kinyarwanda.
3. Customer: `Thank you for contacting Mira's pizza Please let us know how we can help you.` → assistant replied in Kinyarwanda.

Root cause (`src/lang.js`, `src/brain.js`):

- `englishDefault('Restaurant')` returns `null` because the word is not in the
  English marker list, so `ensureLanguage()` returns the model's reply unchanged.
- `needsRepair()` only checks a short `FOREIGN_TOKENS` list when the expected
  language is English. Kinyarwanda words such as `Nta kibazo`, `murashobora`,
  `Ni gute`, `Dukora`, `Dutanga`, `Waba ushaka` are not in that list.
- `detectLang()` falls back to `en`, so a Kinyarwanda reply scores as English and
  passes the guard.

The owner's rule: use a non-English language **only** when the customer writes in
that language, or explicitly says they do not understand English. This applies to
Kinyarwanda, French and Swahili. English is the default for everything else.

## 2. Goal and non-goals

**Goal.** Every reply is in one language. The language is chosen by a deterministic
contract and verified after any translation; a mixed reply is never sent.

**Non-goals.**

- Changing the 3-line / one-`?` / 320-character reply guard.
- Changing published-facts rules, lead extraction, or the first-contact greeting copy.
- Adding npm dependencies or moving off CommonJS.
- Changing `.env`, auth, deployment configuration, or the group `[[SKIP]]` rule.

## 3. Decisions

1. **One expected language per message.** Decision order: explicit "doesn't
   understand English" request → confident language detection → greeting hint →
   English.
2. **Confident detection** means the existing `confidentLang()` rule: at least two
   distinct markers of one language and no tie. Single-word greetings are handled
   by the greeting hint on first contact.
3. **Explicit request** is matched by deterministic phrase patterns in English,
   Kinyarwanda, French and Swahili. A named target wins; otherwise the language of
   the request wins; an English request with no named target defaults to
   **Kinyarwanda** (the local language).
4. **Symmetric guard.** A reply is flagged when it contains clear markers of a
   language other than the expected one, in either direction.
5. **Verified repair.** Repair once, verify again, and if still mixed use a fixed
   fallback in the expected language. No second model call, no risk of loops.
6. **Applies to DM and group replies** because both already call `ensureLanguage()`.
   Group `[[SKIP]]` handling is untouched.

## 4. Design

### 4.1 New helper in `src/lang.js`

Add `replyLanguage(customerText, opts = {}) -> 'en' | 'rw' | 'fr' | 'sw'`.
Pure CommonJS, no I/O, no new dependencies. Add `replyLanguage` to `module.exports`
and leave the existing exports (`detectLang`, `confidentLang`, `needsRepair`,
`englishDefault`, `LANG_NAMES`) unchanged and backwards-compatible.

Algorithm:

1. **Explicit request check.** Match these case-insensitive phrase families:
   - English: `i don't understand english`, `i do not understand english`,
     `i don't speak english`, `no english please`,
     `(please )?(reply|speak|write) (in )?(kinyarwanda|french|swahili)`.
   - Kinyarwanda: `simenya icyongereza`, `sindamenya icyongereza`,
     `ntamenya icyongereza`, `mbwira mu kinyarwanda`.
   - French: `je ne comprends pas (l')?anglais`, `je ne parle pas anglais`,
     `répondez en français`.
   - Swahili: `sielewi kiingereza`, `sijui kiingereza`,
     `sina uelewa wa kiingereza`, `jibu kwa kiswahili`.
   Target resolution: an explicit named target wins — `kinyarwanda` → `rw`,
   `french`/`français` → `fr`, `swahili`/`kiswahili` → `sw`. Words meaning
   "English" (`icyongereza`, `anglais`, `kiingereza`, `english`) are **excluded**
   as targets, because the customer is saying they don't understand it. Otherwise
   use the language the phrase was written in (Kinyarwanda → `rw`, French → `fr`,
   Swahili → `sw`). Otherwise → `rw`.
2. `confidentLang(customerText)` when non-null.
3. `opts.defaultLang` when it is one of `en|rw|fr|sw`. This is a call-site hint:
   the first-contact branch passes `greetingLanguage(text)` (`bonjour` → `fr`,
   `muraho` → `rw`, `habari` → `sw`); the normal DM branch passes
   `englishDefault(text)`.
4. `'en'`.

### 4.2 Symmetric language guard in `src/lang.js`

Introduce a curated `REPLY_MARKERS` map for reply checking. It extends the
existing markers with the words seen in live failures, e.g. Kinyarwanda
`murakaza`, `nshobora`, `kugufasha`, `nkeneye`, `dukora`, `dutanga`, `ufite`,
`wifuza`, `murashobora`, `mwiteguye`, `gute`, `nta`, `amakampani`,
`ikoranabuhanga`, `uburyo`, `kwishyura`. Brand and product names (`WhatsApp`, `AI`,
`Grow`, `ImaliCloud`, `Hresa`, `VUKA`, `CRM`, `websites`) are **neutral** and must
not appear in any marker list.

Change `needsRepair(expected, replyText, opts = {})` to flag when:

- `expected === 'en'` and either an unmistakable foreign token from the existing
  `FOREIGN_TOKENS` set appears, **or** at least two distinct markers from one
  non-English language appear in the reply; or
- `expected !== 'en'` and either two distinct English markers appear, or a clear
  marker set of a different non-English language appears.

Keep the `minChars` gate (default 40, DM passes 12) and the existing
`detectLang(body) !== expected` comparison as a final check. The function stays
total and pure.

### 4.3 `ensureLanguage()` in `src/brain.js`

- Compute `expected = replyLanguage(customerText, opts)` instead of
  `confidentLang(customerText) || opts.defaultLang`.
- If no repair is needed, return the reply unchanged (fast path).
- Otherwise call the existing `repairLanguage()` once with the expected language,
  then re-run `needsRepair(expected, repaired, { minChars: opts.minRepairChars })`.
- If the repaired text still needs repair, return the fixed fallback for the
  expected language instead of the mixed text.

Exact fallbacks (one line, one question, no invented facts):

| Language | Fallback |
|---|---|
| `en` | `I'm here to help with Nutekh's services, packages, and support. What would you like to know?` (existing `DM_FALLBACK`) |
| `rw` | `Nshobora kugufasha ku serivisi za Nutekh. Ufite ikibazo runaka?` |
| `fr` | `Je peux vous aider avec les services de Nutekh. Que souhaitez-vous savoir ?` |
| `sw` | `Ninaweza kukusaidia na huduma za Nutekh. Unataka kujua nini?` |

`answerDM()` and `answerAuto()` keep their current call sites; both benefit from
the new contract. `answerAuto()`'s `[[SKIP]]` early return is unchanged. The
first-contact greeting branch keeps its exact copy and passes through the same
verified guard.

### 4.4 Error handling

- `repairLanguage()` already catches LLM failures and returns the input; the
  post-repair check then sends the fallback instead of a mixed reply.
- `replyLanguage()` and `needsRepair()` are pure and cannot throw on normal input.
- No new failure mode in `bot.js`, `src/replyguard.js` or `src/sanitize.js`.

## 5. Testing (offline, no new dependencies)

Use the existing `require.cache` LLM stub pattern in `tests/`.

1. `replyLanguage()` unit tests: explicit phrases in all four languages, named
   target wins, English request with no target → `rw`, confident detection,
   greeting hint, short English (`Restaurant`) → `en`, emoji-only → `en`.
2. `needsRepair()` tests: each live failure body is flagged as needing repair for
   `en`; localized bodies with English brand words are **not** flagged; English
   body with a Kinyarwanda tail is flagged; English body containing only neutral
   brand words is not flagged.
3. `answerDM()` wiring tests with stubbed raw replies:
   - `Restaurant` + Kinyarwanda raw → one repair call targeting English, final
     reply English.
   - `What do you guys do` + Kinyarwanda raw → repaired to English.
   - Mira's Pizza English text + Kinyarwanda raw → repaired to English.
   - `simenya icyongereza` → repair target Kinyarwanda.
   - `I don't understand English` → repair target Kinyarwanda.
   - `je ne comprends pas anglais` → repair target French.
   - `sielewi Kiingereza` → repair target Swahili.
   - `Muraho, ndashaka website` → repair target Kinyarwanda.
   - `Bonjour` first contact → still French via greeting hint.
   - stub keeps returning mixed text → localized fallback returned, no second
     repair call.
4. `answerAuto()` test: group reply with mixed language is repaired or falls
   back; `[[SKIP]]` still returns `skipped: true`.

## 6. Acceptance criteria

- `npm test` passes locally and on the VPS with no new dependencies.
- No reply contains clear markers of two languages at once.
- An English or ambiguous message never gets a Kinyarwanda/French/Swahili reply.
- A local-language reply happens only via confident detection or an explicit
  request.
- A failed or still-mixed repair yields the short fallback in the expected language.
- VPS deployment requires explicit owner confirmation and must preserve `.env`,
  `auth/`, `data/`, `documents/`, `media/`, `logs/` and `node_modules/`.

## 7. Risks

- **False positives from loanwords.** Mitigated by curated markers that exclude
  brand/product names and by requiring two distinct markers, except for the
  unmistakable explicit-request phrases.
- **Over-correction of genuinely mixed customer messages.** Accepted: the owner's
  rule is one reply language, chosen from the customer's dominant/confident
  language.
- **Repair model ignores the instruction.** Mitigated by the post-repair check
  and fixed fallback; this is the hard guarantee.
- **Translation quality of localized fallbacks.** They are short, factual and
  generic; the owner can change the copy in one place later.
