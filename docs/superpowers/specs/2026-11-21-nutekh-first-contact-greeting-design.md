# Nutekh First-Contact Greeting — Design

- **Status:** Approved (design), pending implementation plan
- **Date:** 2026-11-21
- **Scope:** a targeted change to the shipped `nutekh-bot` private-chat (DM) reply path
- **Related:** `docs/superpowers/specs/2026-11-20-nutekh-client-reply-precision-design.md`

## 1. Context

After the precise-DM-reply change was shipped, the owner reported that the bot's
reply to a bare "hello" is "so weak". The current path is fully LLM-driven:
`answerDM()` calls `retrieve()`, builds the DM system prompt, asks the model, and
then pushes the result through `guardDMReply()` and `ensureLanguage()`.

For a first contact, `bot.js` sets `firstContact = usermem.history(jid).length === 0`
and `answerDM` adds "This is the first contact: greet briefly, then help." to the
user turn. `DM_REPLY_RULES` in `src/brain.js` caps the reply at three short lines,
one question, no repeated greetings and no service list; `guardDMReply()` strips
canned audit/intake sentences unless the customer asked for a next step.

The result is a short, generic acknowledgement with no substance: it does not say
who the bot is, does not name a single Nutekh service, and gives the person no
reason to continue. Because the wording is model-generated, a prompt tweak alone
cannot guarantee the improvement.

## 2. Goal and non-goals

**Goal.** When a person's *first* message to the bot is a standalone greeting,
reply with a warm, deterministic introduction that names real Nutekh services and
asks one easy question — inside the existing DM guard.

**Non-goals.**

- Changing replies to greetings later in a conversation (no re-introduction).
- Changing replies to enquiries that merely *start* with a greeting
  (`"hello, how much is Grow?"` must keep using the normal LLM path).
- Changing group replies, lead extraction for real enquiries, `.env`, auth, or
  deployment configuration.
- Adding npm dependencies or moving off CommonJS.

**Constraints carried over from the shipped DM feature:** DM only; 1–3 short
lines; at most one `?`; 320-character cap; published facts only; English default
with mirroring for confident non-English input (extended by the greeting-word
hint in §3.4); offline tests.

## 3. Decisions

1. **Deterministic, not prompt-only.** A pure helper supplies the exact reply so
   the improvement cannot regress through model variation. The content LLM call
   is skipped for these messages; the existing language-repair call is retained.
2. **First contact only.** Gated on `opts.firstContact === true`, which `bot.js`
   already computes from an empty conversation history.
3. **Standalone greeting only.** The whole message must be a greeting after
   normalization; any additional words go to the normal path.
4. **Language hint from the greeting word.** `bonjour`/`salut` → `fr`, `muraho` →
   `rw`, `habari`/`jambo` → `sw`, all others → `en`. This is passed as
   `defaultLang` to the existing `ensureLanguage()`, which mirrors via the
   existing repair call. This extends mirroring to a single-word greeting,
   where `confidentLang()` deliberately returns `null`.

## 4. Design

### 4.1 New module `src/greeting.js`

CommonJS, no dependencies, no I/O. Exports:

- `isFirstContactGreeting(text)` → boolean
- `greetingLanguage(text)` → `'en' | 'fr' | 'rw' | 'sw'`
- `FIRST_CONTACT_GREETING` → the fixed reply string

**Normalization.** Lowercase, replace every character outside `[a-z\s']` with a
space, collapse whitespace, trim. This removes punctuation and emoji uniformly
without needing extra Unicode handling.

**Trigger match** against the normalized message, anchored at both ends:

```text
^(?:hello|hi|hey|yo|good (?:morning|afternoon|evening)|muraho|habari|jambo|bonjour|salut)(?: there)?$
```

The optional trailing `there` covers the common "hello there" / "hi there".
Empty strings and any message with other words do not match.

**Fixed reply** (exact, three lines, one question):

```text
Hi! I'm Nutekh's assistant — we're a digital agency in Kigali.
We help with websites, WhatsApp automation, payments and more.
What brings you in?
```

All facts come from the published brief (Kigali digital agency; websites,
WhatsApp automation, payments). No prices, timelines, guarantees, or inferred
customer details.

### 4.2 Wiring into `answerDM`

At the very start of `answerDM(text, history, notes, opts)`, before `retrieve()`:

1. If `opts.firstContact === true` **and** `isFirstContactGreeting(text)`:
   - `reply = guardDMReply(FIRST_CONTACT_GREETING, text) || DM_FALLBACK`
   - `reply = await ensureLanguage(reply, text, { ...opts,
     defaultLang: greetingLanguage(text), minRepairChars: 12, short: true })`
   - `reply = guardDMReply(reply, text) || DM_FALLBACK`
   - return `{ reply, lead: null, leadSource: null, doc: null, skipped: false, sources: 0 }`
2. Otherwise, run the existing path unchanged.

Retrieval, the 360-token content call, and `extractLead()` are all skipped for
the greeting branch. `sources: 0` reflects the skipped retrieval. The public
return shape is unchanged.

### 4.3 Error handling and failure modes

- `ensureLanguage()` already catches LLM failures and returns the input reply,
  so a failed translation degrades to the English greeting — still warm and
  within the guard.
- `guardDMReply()` is pure and total; if it ever returns an empty string, the
  existing `DM_FALLBACK` is used.
- `bot.js`, `src/sanitize.js`, `src/lang.js`, `src/replyguard.js` and the group
  path are untouched. No new failure modes.

## 5. Testing

All tests are offline and use the existing `require.cache` LLM stub pattern from
`tests/reply-wiring.test.js`. New file `tests/greeting.test.js` plus additions to
`tests/reply-wiring.test.js`:

1. Trigger accepts `hello`, `Hi there!`, `hey`, `good morning`, `muraho`,
   `habari`, `bonjour`, `salut`, and emoji-padded variants.
2. Trigger rejects `''`, `hello, how much is Grow?`, `hi I need a website`,
   `good morning everyone` (broadcast), and a plain question.
3. `greetingLanguage()` maps `bonjour`/`salut`/`muraho`/`habari`/`jambo` and
   defaults to `en`.
4. `FIRST_CONTACT_GREETING` has exactly 3 lines, one `?`, ≤ 320 chars, contains
   `Nutekh`, `Kigali`, `websites`, `WhatsApp automation`, `payments`, and no price
   pattern.
5. `answerDM('hello', [], '', { firstContact: true })` returns the fixed reply,
   `chatCalls.length === 0`, `sources === 0`, `lead === null`.
6. `answerDM('hello', [], '', { firstContact: false })` still calls the content
   LLM (`chatCalls.length >= 1`).
7. `answerDM('hello, how much is Grow?', [], '', { firstContact: true })` still
   calls the content LLM.
8. `answerDM('Bonjour', [], '', { firstContact: true })` makes the 200-token
   language-repair call with a French target.

## 6. Acceptance criteria

- `npm test` passes locally and on the VPS with no new dependencies.
- A first-contact "hello" produces the exact three-line reply above.
- A returning customer saying "hello" does not receive the introduction again.
- A first-contact "hello, how much is Grow?" still gets a factual, tailored
  answer from the normal path.
- A first-contact "Bonjour" gets a French greeting; a tool failure falls back to
  the English greeting.
- Deployment to the VPS is a separate step and requires explicit confirmation.

## 7. Risks

- **Over-broad trigger.** Mitigated by the anchored whole-message match and by
  tests for enquiries that merely start with a greeting.
- **Translation drift.** The repair call may rephrase the French/Kinyarwanda/
  Swahili greeting. It still names services and asks one question; the guard
  re-applies line/character/question caps afterwards.
- **Fixed copy feels repetitive.** Accepted deliberately for the reliability the
  owner asked for; changing it later is a one-line edit in `src/greeting.js`.
