const GREETING_RE = /^(?:hello|hi|hey|yo|good (?:morning|afternoon|evening)|muraho|habari|jambo|bonjour|salut)(?: there)?$/

const FR_GREETINGS = new Set(['bonjour', 'salut'])
const RW_GREETINGS = new Set(['muraho'])
const SW_GREETINGS = new Set(['habari', 'jambo'])

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isFirstContactGreeting(text) {
  return GREETING_RE.test(normalize(text))
}

function greetingLanguage(text) {
  const greeting = normalize(text)
  if (FR_GREETINGS.has(greeting)) return 'fr'
  if (RW_GREETINGS.has(greeting)) return 'rw'
  if (SW_GREETINGS.has(greeting)) return 'sw'
  return 'en'
}

const FIRST_CONTACT_GREETING = `Hi! I'm Nutekh's assistant — we're a digital agency in Kigali.
We help with websites, WhatsApp automation, payments and more.
What brings you in?`

module.exports = { isFirstContactGreeting, greetingLanguage, FIRST_CONTACT_GREETING }
