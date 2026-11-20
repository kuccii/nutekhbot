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
