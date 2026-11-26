const test = require('node:test')
const assert = require('node:assert/strict')
const { tmpDataDir } = require('./helpers')

process.env.DATA_DIR = tmpDataDir()
process.env.LLM_API_KEY = 'test'
process.env.EMBED_URL = 'http://127.0.0.1:1'

const llmPath = require.resolve('../src/llm')
let chatCalls = []
let chatQueue = []
let jsonReply = null
require.cache[llmPath] = {
  id: llmPath,
  filename: llmPath,
  loaded: true,
  exports: {
    chat: async (messages, opts) => { chatCalls.push({ messages, opts }); return chatQueue.length ? chatQueue.shift() : '' },
    chatJSON: async () => jsonReply,
    CHAT_MODEL: 'stub', BASE: 'stub', KEY: 'test',
  },
}

const { answerDM } = require('../src/brain')
const { FIRST_CONTACT_GREETING } = require('../src/greeting')

function reset(replies) {
  chatCalls = []
  chatQueue = replies.slice()
  jsonReply = null
}

test('answerDM removes the canned audit paragraph from a CV reply', async () => {
  reset(['Thanks, I have your CV. I’ll review it.\nI can offer a free 30-minute audit. Share your business type and budget range.'])
  const res = await answerDM('Please check my email the soonest you can. My CV shared as discussed.', [], '')
  assert.doesNotMatch(res.reply, /free 30-minute audit/)
  assert.ok(res.reply.split('\n').length <= 3)
})

test('answerDM asks the model for at most 360 tokens', async () => {
  reset(['Sure, I can help with that.'])
  await answerDM('How much is Grow?', [], '')
  assert.ok(chatCalls[0].opts.max_tokens <= 360)
})

test('answerDM keeps an English reply for an emoji-only message', async () => {
  reset(['Ndio, naelewa.', 'Thanks! 👍'])
  const res = await answerDM('👍🏽', [], '')
  assert.doesNotMatch(res.reply, /Ndio|naelewa/)
  assert.match(res.reply, /Thanks/)
})

test('answerDM leaves a qualified lead marker untouched', async () => {
  reset(['Grow starts at RWF 2M.\n[[LEAD: {"type":"sales","business":"Shop","need":"POS","budget":"RWF 2M"}]]'])
  const res = await answerDM('I run a shop in Kigali, budget is RWF 2M, I need POS.', [], '')
  assert.equal(res.leadSource, 'marker')
  assert.equal(res.lead.business, 'Shop')
  assert.ok(res.reply.split('\n').length <= 3)
})

test('answerDM uses a 200-token short instruction for language repair', async () => {
  reset(['Ndio, naelewa.', 'Thanks, I understand your request.'])
  await answerDM('👍🏽', [], '')
  assert.equal(chatCalls.length, 2)
  assert.equal(chatCalls[1].opts.max_tokens, 200)
  assert.match(chatCalls[1].messages[0].content, /At most 3 short lines and one question/)
})

test('answerDM uses the fixed warm greeting on first-contact hello', async () => {
  reset([])
  const res = await answerDM('hello', [], '', { firstContact: true })
  assert.equal(res.reply, FIRST_CONTACT_GREETING)
  assert.equal(chatCalls.length, 0)
  assert.equal(res.sources, 0)
  assert.equal(res.lead, null)
  assert.equal(res.leadSource, null)
})

test('answerDM does not re-introduce Nutekh for a returning hello', async () => {
  reset(['Again, what do you need?'])
  const res = await answerDM('hello', [{ role: 'user', text: 'How much is Grow?' }], '', { firstContact: false })
  assert.equal(res.reply, 'Again, what do you need?')
  assert.doesNotMatch(res.reply, /Nutekh's assistant/)
  assert.equal(chatCalls.length, 1)
})

test('answerDM uses the normal path when a greeting starts a real enquiry', async () => {
  reset(['Grow starts at RWF 2M.'])
  const res = await answerDM('hello, how much is Grow?', [], '', { firstContact: true })
  assert.match(res.reply, /Grow/)
  assert.equal(chatCalls.length, 1)
})

test('answerDM mirrors a localized first-contact greeting via the repair call', async () => {
  reset(['Bonjour ! Nous sommes une agence à Kigali. Que cherchez-vous ?'])
  const res = await answerDM('Bonjour', [], '', { firstContact: true })
  assert.equal(chatCalls.length, 1)
  assert.equal(chatCalls[0].opts.max_tokens, 200)
  assert.match(chatCalls[0].messages[0].content, /French/)
  assert.match(res.reply, /Bonjour/)
})

test('answerDM falls back to the French greeting if translation fails', async () => {
  reset([])
  const res = await answerDM('Bonjour', [], '', { firstContact: true })
  assert.equal(res.reply, 'Je peux vous aider avec les services de Nutekh. Que souhaitez-vous savoir ?')
  assert.equal(chatCalls.length, 1)
})
