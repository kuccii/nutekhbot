# Nutekh Client Replies — Precise, Tailored, Short (DM) — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-20
- **Scope:** a targeted change to the shipped `nutekh-bot` private-chat (DM) reply path
- **Related:** `docs/superpowers/specs/2026-11-12-nutekh-whatsapp-assistant-design.md`,
  `docs/superpowers/specs/2026-11-17-nutekh-english-default-rwanda-design.md`

## 1. Context

The owner asked for client replies that are "more robust, precise, tailored to what
the user sent, and not long messages". Real DM history pulled read-only from
`/opt/nutekh-bot/data/dm-memory.json` on 2026-11-20 confirms three concrete
failures:

1. **Generic filler.** A customer wrote "Please check my email the soonest you can.
   My CV shared as discussed." The bot replied with a deflection about handling
   service enquiries, then the same "free 30-minute audit" paragraph and the same
   four intake questions ("business type, location, current tools, budget range,
   timeline"). The identical block appears after a bare `👍🏽`.
2. **Invented facts.** A business that described itself as selling energy-saving
   charcoal stoves was answered as "innovative solar energy solutions" — the bot
   inferred a business type the customer never stated.
3. **Language leak.** An English conversation ("Good that you received my email…")
   and an emoji-only message (`👍🏽`) produced Swahili replies.

The root cause is the reply contract, not the model: `PERSONA` in `src/brain.js`
asks for "two to four paragraphs", prescribes a 4-step sales flow whose step 3 is
the audit, and `answerDM` spends `max_tokens: 900` on it. `ensureLanguage` trusts
the model when `confidentLang()` returns `null` (emoji/short messages) and
`needsRepair` ignores replies shorter than 40 characters, so short Swahili replies
slip through.

## 2. Goal and non-goals

**Goal.** Make a private-chat reply answer the *actual* message, use only facts the
customer stated or the published brief supports, fit 1–3 short lines with at most
one question, and stay in the customer's language (English default, never Swahili
for an English/emoji-only message).

**Non-goals (this change).**

- No change to the group-answer path (`answerAuto`, `systemPrompt('group')`).
- No change to the group-prospecting pipeline or `src/prospect.js` outreach drafts.
- No change to `knowledge/brief.md`, prices, packages, or published claims.
- No new data model, no new npm dependency, no network dependency, no CRM/web lookup.
- No change to lead capture (`[[LEAD:…]]` markers and the fallback extractor stay
  exactly as they are).
- No push to `origin` and no VPS deploy without a separate explicit approval.

## 3. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Main failure being fixed | Generic, not-on-topic answers (not length alone) |
| Audit / intake block | Offer only when the customer asks about price, booking, a call, or next steps — never as a reflex |
| Reply length | Hard target: 1–3 short lines, at most one question, no paragraphs |
| Scope | Client DMs only |
| Language | Strict: English default; mirror a confidently detected language; never Swahili into an English/emoji-only conversation |
| Approach | **Prompt rewrite + deterministic DM guard**, with offline tests |

## 4. What changes (and what does not)

| File | Change |
|---|---|
| `src/brain.js` | Add a DM-only override block to `systemPrompt('dm')`; lower `answerDM` `max_tokens` 900 → 360; run the new guard and pass language defaults. |
| `src/replyguard.js` (new) | Deterministic `guardDMReply(reply, customerText)` enforcing no blind CTA, ≤3 lines/≤320 chars, ≤1 question. |
| `src/lang.js` | Add `englishDefault(text)`; extend `needsRepair(expected, text, opts)` with `minChars` and unmistakable-foreign-token detection. |
| `src/brain.js` | Keep the existing exported `ensureLanguage` here (it owns `repairLanguage`); let it accept `defaultLang` / `minRepairChars`. |
| `tests/replyguard.test.js` (new) | Unit tests for the guard. |
| `tests/reply-wiring.test.js` (new) | Stubbed-LLM tests for the DM prompt, token cap, guard application, and language repair (dedicated `require.cache` harness). |
| `tests/brain.test.js`, `tests/lang.test.js` | Cases for the new language options and foreign-token detection. |

Unchanged: `src/sanitize.js`, `src/llm.js`, `src/memory.js`, `src/prospect.js`,
`src/signals.js`, `src/outreach.js`, `bot.js`, `knowledge/brief.md`, all commands.

```
customer DM ─► retrieve ─► chat (max_tokens 360, DM override prompt)
                    └► parseMarkers ─► tidy ─► guardDMReply ─► ensureLanguage
                                                   └► guardDMReply again (idempotent)
                                                          └► reply to customer
```

`parseMarkers` removes `[[LEAD:…]]` before the guard sees the text, so the marker
is never truncated by the line/character caps. If the guard empties a reply, the
existing short fallback line is used rather than reconstructing the old pitch.

## 5. DM prompt contract (`src/brain.js`)

`systemPrompt('dm')` gains a clearly marked override block placed **after** the
company brief and customer notes, stating that it supersedes the generic
style/sales-flow instructions above it for private chats:

- Answer the customer's exact message first; reference what they actually wrote.
- Use only facts in the brief and retrieved knowledge. Never invent a price,
  discount, timeline, guarantee, business type, or what their company does. Never
  infer a business from its name.
- If the customer shares a link, CV, email, document, or photo, acknowledge
  precisely that item and respond to their request. If you cannot open it, say so
  plainly in one short line; do not replace it with a website/Google pitch.
- Maximum 3 short lines. No paragraphs, no repeated greetings, no service list.
- At most one question.
- Offer the free 30-minute audit, contact details, or intake questions **only**
  when the customer asks about price, a quote, booking a call, getting started, or
  next steps.
- Output only the customer-facing reply (plus the internal `[[LEAD:…]]` line when
  genuinely qualified, per the existing rule).

The shared `PERSONA` text and the group prompt are not rewritten; the DM override
block wins for DMs by explicit instruction.

`answerDM` uses `max_tokens: 360` (down from 900). The final user-turn instruction
keeps "Reply as Nutekh Assistant" and the first-contact rule, and adds the short
reply requirement once so the model sees it in both places.

## 6. Deterministic guard contract (`src/replyguard.js`)

`guardDMReply(reply, customerText)` is a pure function: no I/O, no external
imports, deterministic, idempotent.

### 6.1 Next-step intent (customer message)

The canned CTA is retained only when the customer's own text matches:

```
/\b(audit|price|pricing|cost|how much|quote|book|booking|schedule|call|meeting|get started|starting|work together|onboard|next steps?|demo)\b/i
```

### 6.2 Canned CTA detection (bot reply)

Sentence-level removal when §6.1 does **not** match. A sentence is canned if it
contains any of:

```
free 30-minute audit | 30-minute audit | free audit | free call | set up a call
business type | current tools? | budget range | what is/’s the main goal
share your business | let me know about your business
tell me your business type / location / budget / timeline
```

Only matching sentences are removed; real answer sentences before them are kept.
A sentence is a line or a `[.!?]`-terminated clause. Punctuation and whitespace
are preserved; blank lines are collapsed.

### 6.3 One question

Count sentences ending in `?`. Keep the first question sentence; remove later
question sentences. A reply with no question is fine.

### 6.4 Length cap

After §6.2–6.3, keep the first 3 non-empty lines and at most 320 characters. When
the character cap would split a sentence, cut back to the last complete sentence
boundary before the cap; if there is none, cut at the last word boundary. Trim
trailing whitespace. Do not append an ellipsis or explanatory note.

### 6.5 Empty result

If every sentence was removed, return `''`. `answerDM` then uses the existing
short fallback: `I'm here to help with Nutekh's services, packages, and support.
What would you like to know?` (unchanged text, now reached only in a degenerate
case).

## 7. Language contract (`src/lang.js`, `src/brain.js`)

### 7.1 `englishDefault(text)`

Returns `'en'` or `null`. Returns `null` when `confidentLang(text)` already found
a language. Otherwise:

- strip URLs, `@mentions`, digits, emoji and punctuation; if nothing readable
  remains (e.g. `👍🏽`) → `'en'`;
- if the text contains at least one English marker and no French, Kinyarwanda, or
  Swahili marker → `'en'`;
- otherwise → `null` (let the model mirror short non-English messages).

### 7.2 `needsRepair(expected, text, opts = {})`

- `minChars` defaults to 40 (existing behaviour); `answerDM` passes 12 so short
  replies can be repaired. A reply shorter than `minChars` is never repaired.
- Once the length gate passes, when `expected === 'en'` and the reply contains an
  unmistakable foreign token, return `true`. Token set (word-boundary, case-insensitive):
  `ndio, ndiyo, habari, jambo, asante, karibu, sana, shilingi, nshaka, ndashaka,
  murakoze, amakuru, yego, oya, cyane, igiciro, bonjour, merci, vous, nous, svp`.
- Otherwise keep the current `detectLang(body) !== expected` comparison.

### 7.3 `ensureLanguage(reply, customerText, opts)` (in `src/brain.js`)

The existing exported function stays in `src/brain.js` because it owns
`repairLanguage`; it is not moved to `src/lang.js`.

- `expected = confidentLang(customerText) || opts.defaultLang || null`.
- Pass `opts.minRepairChars` through to `needsRepair`.
- `answerDM` calls it with `{ ...opts, defaultLang: englishDefault(text),
  minRepairChars: 12 }`.
- `repairLanguage` gains a short-style instruction ("English only; at most 3 short
  lines and one question") for the DM path and uses `max_tokens: 200` there.
- Group path calls `ensureLanguage(reply, text)` with no new options: behaviour
  unchanged.

## 8. Tests

All offline. LLM is stubbed through `require.cache` as in the existing suite; no
new dependencies.

`tests/replyguard.test.js`:

- CV/email customer text → audit + intake sentences removed, answer kept.
- Customer asks "how much / book a free audit" → CTA retained.
- Three-plus lines → reduced to 3; sentence boundary not cut mid-sentence.
- Two or more questions → only the first remains.
- Reply made entirely of canned CTA → returns `''`.
- Guard is idempotent (`guard(guard(x)) === guard(x)`).

`tests/reply-wiring.test.js` (new file with its own LLM `require.cache` stub;
kept separate from `tests/brain.test.js`, which loads the brain without a stub):

- `answerDM` system prompt contains the DM override block and the no-inference /
  link-CV rule.
- `answerDM` calls the LLM with `max_tokens <= 360`.
- End-to-end stub: CV-style message + canned draft → final reply has no audit
  block and is ≤3 lines.
- Emoji-only English customer + stubbed Swahili draft → final reply is English.
- Group-answer prompt still lacks the DM override (regression guard for scope).

`tests/lang.test.js`:

- `englishDefault('👍🏽') === 'en'`; `englishDefault('Please check my email…') === 'en'`;
  `englishDefault('Muraho, nshaka website') === null`.
- `needsRepair('en', 'Ndio, naelewa.') === true` with `minChars: 12`, and `false`
  with the default `minChars: 40` (short-reply exception scoped to the DM caller).
- Existing detection tests remain green.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Guard strips a legitimate answer that happens to mention "budget" | Removal is sentence-level and only when the customer did **not** express next-step intent; pattern list uses phrases, not isolated common words. |
| Lowered token cap truncates before the `[[LEAD:…]]` marker | 360 tokens is ample for 3 lines plus one JSON line; a test asserts the cap and an existing lead test asserts marker survival. |
| Language false positives on short replies | Foreign-token list is limited to unmistakable words; `englishDefault` only fires for emoji/no-letter or clearly English text. |
| Model ignores the prompt | Deterministic guard is the final authority for CTA, length and questions. |
| Prompt override leaks into group answers | Override lives only in `systemPrompt('dm')`; a regression test asserts the group prompt is unchanged. |

## 10. Acceptance criteria

1. `npm test` passes locally (existing 110 tests plus new ones), fully offline.
2. A CV/email message no longer gets the audit/intake paragraph.
3. Emoji-only and short English messages never get a Swahili reply.
4. Every DM reply is ≤3 short lines with at most one question. When the customer
   asked for next steps, the audit may be offered — still within both caps.
5. No invented business type or facts beyond the published brief.
6. Group answers, outreach drafts, commands, and lead capture behave exactly as
   before.
