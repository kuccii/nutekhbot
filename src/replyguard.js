const MAX_LINES = 3
const MAX_CHARS = 320

const NEXT_STEP_RE = /\b(audit|price|pricing|cost|how much|quote|book|booking|schedule|call|meeting|get started|starting|work together|onboard|next steps?|demo)\b/i

const CANNED_RE = /(?:free 30-minute audit|30-minute audit|free audit|free call|set up a call|business type|current tools?|budget range|what(?: is|['’]s) the main goal|share your business|let me know about your business|tell me your (?:business type|location|current tools?|budget|timeline))/i

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/

function capReply(text) {
  if (text.length <= MAX_CHARS) return text.trim()

  const window = text.slice(0, MAX_CHARS)
  let cut = -1
  let match

  const sentenceEnd = /[.!?](?=\s|$)/g
  while ((match = sentenceEnd.exec(window)) !== null) cut = match.index + 1

  if (cut === -1) {
    const whitespace = /\s/g
    let last = -1
    while ((match = whitespace.exec(window)) !== null) last = match.index
    cut = last === -1 ? window.length : last
  }

  return text.slice(0, cut).trim()
}

function guardDMReply(reply, customerText) {
  const wantsNextStep = NEXT_STEP_RE.test(String(customerText || ''))
  const lines = String(reply || '').split(/\r?\n/)
  let questionSeen = false
  const keptLines = []

  for (const rawLine of lines) {
    const tokens = rawLine.trim().split(SENTENCE_SPLIT_RE)
    const keptTokens = []

    for (const rawToken of tokens) {
      const sentence = rawToken.trim()
      if (!sentence) continue
      if (!wantsNextStep && CANNED_RE.test(sentence)) continue

      const isQuestion = sentence.endsWith('?')
      if (isQuestion && questionSeen) continue
      if (isQuestion) questionSeen = true
      keptTokens.push(sentence)
    }

    if (keptTokens.length) keptLines.push(keptTokens.join(' '))
    if (keptLines.length === MAX_LINES) break
  }

  return capReply(keptLines.join('\n'))
}

module.exports = { guardDMReply }
