const test = require('node:test')
const assert = require('node:assert/strict')

const { detectLang, needsRepair, LANG_NAMES, confidentLang, englishDefault, replyLanguage } = require('../src/lang')

test('detectLang defaults to English', () => {
  assert.equal(detectLang(''), 'en')
  assert.equal(detectLang('How much does the Grow package cost?'), 'en')
})

test('detectLang recognises French', () => {
  assert.equal(detectLang('Bonjour, combien coûte le pack Grow ? Merci beaucoup'), 'fr')
})

test('detectLang recognises Kinyarwanda', () => {
  assert.equal(detectLang('Muraho, igiciro cya Grow ni angahe? Murakoze'), 'rw')
})

test('detectLang recognises Swahili', () => {
  assert.equal(detectLang('Habari, bei ya Grow ni ngapi? Asante sana'), 'sw')
})

test('detectLang returns English on a tie or a single marker', () => {
  assert.equal(detectLang('Bonjour, hello'), 'en')
  assert.equal(detectLang('merci'), 'en')
})

test('needsRepair ignores a short reply', () => {
  assert.equal(needsRepair('en', 'Asante sana'), false)
})

test('needsRepair flags a clearly Swahili reply to an English message', () => {
  const sw = 'Habari, bei ya Grow ni ngapi? Asante sana kwa swali lako zuri.'
  assert.ok(sw.length >= 40)
  assert.equal(needsRepair('en', sw), true)
})

test('needsRepair leaves an English reply alone', () => {
  assert.equal(needsRepair('en', 'Grow starts at RWF 2M. Shall I book the free audit?'), false)
})

test('LANG_NAMES covers every detected language', () => {
  for (const l of ['en', 'rw', 'fr', 'sw']) assert.equal(typeof LANG_NAMES[l], 'string')
})

test('confidentLang is null for short or ambiguous text', () => {
  assert.equal(confidentLang(''), null)
  assert.equal(confidentLang('Combien?'), null)
  assert.equal(confidentLang('Bonjour, hello'), null)
})

test('confidentLang positively identifies a substantial English message', () => {
  assert.equal(confidentLang('How much does the Grow package cost?'), 'en')
  assert.equal(confidentLang('How much is Grow?'), 'en')
})

test('detectLang still defaults to en when nothing is confident', () => {
  assert.equal(detectLang('Combien?'), 'en')
  assert.equal(detectLang(''), 'en')
})

test('englishDefault treats emoji-only and clearly English text as English', () => {
  assert.equal(englishDefault('👍🏽'), 'en')
  assert.equal(englishDefault('Please check my email the soonest you can.'), 'en')
})

test('englishDefault keeps confident English with a stray foreign marker', () => {
  assert.equal(englishDefault('Please merci the package today'), 'en')
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
