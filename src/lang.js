const MARKERS = {
  en: ['the', 'is', 'are', 'was', 'were', 'what', 'how', 'much', 'does', 'do', 'you', 'your', 'we', 'our', 'can', 'could', 'would', 'should', 'need', 'want', 'price', 'cost', 'business', 'please', 'thanks', 'thank', 'hello', 'help', 'service', 'services', 'package', 'with', 'for', 'and', 'this', 'that', 'have', 'has'],
  fr: ['bonjour', 'merci', 'vous', 'nous', 'je', 'est', 'pour', 'avec', 'prix', 'combien', "s'il", 'la', 'les', 'des', 'une'],
  rw: ['muraho', 'mwaramutse', 'amakuru', 'murakoze', 'yego', 'oya', 'kandi', 'cyane', 'ufite', 'nshaka', 'ndashaka', 'igiciro', 'amafaranga', 'kuki', 'gute'],
  sw: ['habari', 'jambo', 'mambo', 'karibu', 'asante', 'ndiyo', 'hapana', 'naomba', 'bei', 'gani', 'ngapi', 'vipi', 'nzuri', 'sana', 'ninataka', 'tunataka', 'pesa', 'shilingi'],
}

const LANG_NAMES = { en: 'English', rw: 'Kinyarwanda', fr: 'French', sw: 'Swahili' }
const MIN_SCORE = 2
const MIN_REPAIR_CHARS = 40

// Unmistakable foreign tokens for the English-default repair path (spec §7.2).
const FOREIGN_TOKENS = [
  'ndio', 'ndiyo', 'habari', 'jambo', 'asante', 'karibu', 'sana', 'shilingi',
  'nshaka', 'ndashaka', 'murakoze', 'amakuru', 'yego', 'oya', 'cyane', 'igiciro',
  'bonjour', 'merci', 'vous', 'nous', 'svp',
]
const FOREIGN_TOKEN_RE = new RegExp(`(^|[^a-zà-ÿ])(${FOREIGN_TOKENS.join('|')})([^a-zà-ÿ]|$)`, 'i')

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

function score(text, markers) {
  const t = String(text || '').toLowerCase()
  let n = 0
  for (const m of markers) {
    if (new RegExp(`(^|[^a-zà-ÿ])${escapeRe(m)}([^a-zà-ÿ]|$)`).test(t)) n++
  }
  return n
}

function confidentLang(text) {
  let best = null
  let bestScore = 0
  let tie = false
  for (const lang of ['en', 'rw', 'fr', 'sw']) {
    const s = score(text, MARKERS[lang])
    if (s > bestScore) { best = lang; bestScore = s; tie = false }
    else if (s === bestScore && s > 0) tie = true
  }
  if (bestScore < MIN_SCORE || tie) return null
  return best
}

function detectLang(text) {
  return confidentLang(text) || 'en'
}

// Keep only claimable letters: URLs, @mentions, digits, emoji and punctuation drop out.
function readableText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
    .replace(/@[\p{L}\p{N}_]+/gu, ' ')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim()
}

function englishDefault(text) {
  const confident = confidentLang(text)
  // A confident non-English language is mirrored by the model. Confident English
  // still goes through the marker checks so clear English defaults to 'en'.
  if (confident && confident !== 'en') return null
  const readable = readableText(text)
  if (!readable) return 'en'
  const hasForeign = ['fr', 'rw', 'sw'].some((lang) => score(readable, MARKERS[lang]) > 0)
  if (!hasForeign && score(readable, MARKERS.en) > 0) return 'en'
  return null
}

function needsRepair(expected, replyText, opts = {}) {
  const body = String(replyText || '')
  const min = opts.minChars ?? MIN_REPAIR_CHARS
  if (body.length < min) return false
  if (expected === 'en' && FOREIGN_TOKEN_RE.test(body)) return true
  return detectLang(body) !== expected
}

module.exports = { detectLang, confidentLang, needsRepair, englishDefault, LANG_NAMES }
