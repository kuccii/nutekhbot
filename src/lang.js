const MARKERS = {
  en: ['the', 'is', 'are', 'was', 'were', 'what', 'how', 'much', 'does', 'do', 'you', 'your', 'we', 'our', 'can', 'could', 'would', 'should', 'need', 'want', 'price', 'cost', 'business', 'please', 'thanks', 'thank', 'hello', 'help', 'service', 'services', 'package', 'with', 'for', 'and', 'this', 'that', 'have', 'has'],
  fr: ['bonjour', 'merci', 'vous', 'nous', 'je', 'est', 'pour', 'avec', 'prix', 'combien', "s'il", 'la', 'les', 'des', 'une'],
  rw: ['muraho', 'mwaramutse', 'amakuru', 'murakoze', 'yego', 'oya', 'kandi', 'cyane', 'ufite', 'nshaka', 'ndashaka', 'igiciro', 'amafaranga', 'kuki', 'gute'],
  sw: ['habari', 'jambo', 'mambo', 'karibu', 'asante', 'ndiyo', 'hapana', 'naomba', 'bei', 'gani', 'ngapi', 'vipi', 'nzuri', 'sana', 'ninataka', 'tunataka', 'pesa', 'shilingi'],
}

// Reply-side markers are broader than the customer-side MARKERS so a reply that
// silently switches language is caught even when detectLang still says 'en'.
const REPLY_MARKERS = {
  en: [...MARKERS.en],
  fr: [...MARKERS.fr],
  sw: [...MARKERS.sw],
  rw: [...MARKERS.rw, 'murakaza', 'neza', 'nshobora', 'kugufasha', 'nkeneye', 'dufite', 'dutanga', 'dukora', 'wifuza', 'wifashisha', 'murashobora', 'mwiteguye', 'dushobora', 'gahunda', 'igihe', 'nta', 'amakampani', 'ikoranabuhanga', 'uburyo', 'kwishyura'],
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
  // Confident English always defaults to 'en', even with a stray foreign marker;
  // confident non-English is mirrored by the model.
  if (confident) return confident === 'en' ? 'en' : null
  const readable = readableText(text)
  if (!readable) return 'en'
  const hasForeign = ['fr', 'rw', 'sw'].some((lang) => score(readable, MARKERS[lang]) > 0)
  if (!hasForeign && score(readable, MARKERS.en) > 0) return 'en'
  return null
}

// Explicit requests beat heuristics. The named-target entry stays first so a
// message that disclaims English and names a target resolves to the target.
const EXPLICIT_PHRASES = [
  { re: /\b(?:please\s+)?(?:reply|speak|write)\s+(?:in\s+)?(kinyarwanda|french|swahili)\b/i, fallback: 'rw' },
  { re: /\bi\s+(?:don'?t|do not)\s+(?:understand|speak)\s+english\b/i, fallback: 'rw' },
  { re: /\bno\s+english\s+please\b/i, fallback: 'rw' },
  { re: /\b(?:simenya|sindamenya|ntamenya)\s+icyongereza\b/i, fallback: 'rw' },
  { re: /\bmbwira\s+mu\s+kinyarwanda\b/i, fallback: 'rw' },
  { re: /\bje\s+ne\s+comprends\s+pas\s+(?:l')?anglais\b/i, fallback: 'fr' },
  { re: /\bje\s+ne\s+parle\s+pas\s+anglais\b/i, fallback: 'fr' },
  { re: /\brépondez\s+en\s+français\b/i, fallback: 'fr' },
  { re: /\b(?:sielewi|sijui)\s+kiingereza\b/i, fallback: 'sw' },
  { re: /\bsina\s+uelewa\s+wa\s+kiingereza\b/i, fallback: 'sw' },
  { re: /\bjibu\s+kwa\s+kiswahili\b/i, fallback: 'sw' },
]

const NAMED_TARGETS = { kinyarwanda: 'rw', french: 'fr', swahili: 'sw' }
const REPLY_LANGS = ['en', 'rw', 'fr', 'sw']

function replyLanguage(customerText, opts = {}) {
  const text = String(customerText || '')
  for (const entry of EXPLICIT_PHRASES) {
    const match = entry.re.exec(text)
    if (!match) continue
    const target = NAMED_TARGETS[match[1]?.toLowerCase()]
    return target || entry.fallback
  }
  const confident = confidentLang(customerText)
  if (confident) return confident
  const hint = opts.defaultLang
  return REPLY_LANGS.includes(hint) ? hint : 'en'
}

function needsRepair(expected, replyText, opts = {}) {
  const body = String(replyText || '')
  const min = opts.minChars ?? MIN_REPAIR_CHARS
  if (body.length < min) return false
  if (expected === 'en' && FOREIGN_TOKEN_RE.test(body)) return true
  if (expected === 'en' && ['rw', 'fr', 'sw'].some((lang) => score(body, REPLY_MARKERS[lang]) >= 2)) return true
  if (expected !== 'en') {
    if (score(body, REPLY_MARKERS.en) >= 2) return true
    if (['rw', 'fr', 'sw'].some((lang) => lang !== expected && score(body, REPLY_MARKERS[lang]) >= 2)) return true
  }
  return detectLang(body) !== expected
}

module.exports = { detectLang, confidentLang, needsRepair, englishDefault, LANG_NAMES, replyLanguage }
