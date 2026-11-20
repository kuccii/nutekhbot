const test = require('node:test')
const assert = require('node:assert/strict')
const { guardDMReply } = require('../src/replyguard')

test('strips blind audit and intake sentences from a CV reply', () => {
  const reply = 'Thanks, I have your CV. I’ll review it.\n' +
    'I can offer a free 30-minute audit. Share your business type, location, current tools, budget range and timeline.'
  const out = guardDMReply(reply, 'Please check my email the soonest you can. My CV shared as discussed.')
  assert.equal(out, 'Thanks, I have your CV. I’ll review it.')
})

test('retains the audit CTA when the customer asks for next steps', () => {
  const out = guardDMReply(
    'I can book a free 30-minute audit. What day suits you?',
    'How much is it? Can we book a call?'
  )
  assert.match(out, /free 30-minute audit/)
})

test('caps the reply at three lines and 320 characters', () => {
  const reply = 'One. Two. Three. ' + 'x'.repeat(400) + '\nFour.\nFive.\nSix.'
  const out = guardDMReply(reply, 'hello there')
  assert.ok(out.split('\n').length <= 3)
  assert.ok(out.length <= 320)
})

test('keeps only the first question', () => {
  const out = guardDMReply(
    'Grow starts at RWF 2M. What is your budget? When do you need it?',
    'hello there'
  )
  assert.equal((out.match(/\?/g) || []).length, 1)
  assert.match(out, /What is your budget\?/)
})

test('returns empty when every sentence is canned', () => {
  assert.equal(
    guardDMReply('I can offer a free 30-minute audit. Share your business type and budget range.', 'Please check my email.'),
    ''
  )
})

test('removes a canned CTA from a short support reply', () => {
  const out = guardDMReply(
    'Thanks for flagging this. I’ll pass it to our support team. Shall I book a free call to check?',
    'The invoice is wrong'
  )
  assert.equal(out, 'Thanks for flagging this. I’ll pass it to our support team.')
})

test('is idempotent', () => {
  const reply = 'Thanks, I have your CV. I’ll review it.\nI can offer a free 30-minute audit. Share your business type.'
  assert.equal(
    guardDMReply(guardDMReply(reply, 'Please check my email.'), 'Please check my email.'),
    guardDMReply(reply, 'Please check my email.')
  )
})

test('caps a single token with multiple question marks at one', () => {
  const out = guardDMReply('What is your timeline??', 'hello there')
  assert.equal((out.match(/\?/g) || []).length, 1)
  assert.equal(out, 'What is your timeline?')
})
