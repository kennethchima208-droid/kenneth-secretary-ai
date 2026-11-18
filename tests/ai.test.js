import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, selectKnowledge } from '../src/ai/prompt.js';
import { createAiService } from '../src/ai/service.js';
import { finalizeReply } from '../src/utils/text.js';
import { createRedactor } from '../src/utils/redact.js';
import { buildDefaults } from '../src/storage/defaults.js';
import { baseConfig } from './helpers.js';

const d = buildDefaults(baseConfig);
const kn = [
  { id: '1', type: 'faq', title: 'Do you repair laptops?', content: 'Yes, all major brands.' },
  { id: '2', type: 'price', title: 'Screen replacement', content: 'Price depends on model; confirm first.' },
  { id: '3', type: 'instruction', title: '', content: 'Ask for the device model.' },
];
const args = { profile: { ...d.profile, neverSay: 'Never discuss politics' }, settings: d.settings, knowledge: kn, incomingText: 'How much for a screen?', contactName: 'Ada', timezone: 'Africa/Lagos' };

test('prompt contains profile, knowledge, rules and the incoming message', () => {
  const { messages, knowledgeUsed } = buildMessages({ ...args, history: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi Ada' }] });
  const sys = messages[0].content;
  for (const s of ['Kenneth Chima', 'Web developer', 'Computer repair technician', 'Do you repair laptops?', 'Screen replacement', 'Ask for the device model', 'Never discuss politics', 'NEVER invent prices', 'Africa/Lagos', 'Ada']) assert.ok(sys.includes(s), s);
  assert.equal(knowledgeUsed, 3);
  assert.deepEqual(messages.slice(1).map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(messages.at(-1).content, 'How much for a screen?');
});
test('history length setting is respected', () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: 'user', text: `m${i}` }));
  const { messages } = buildMessages({ ...args, settings: { ...d.settings, historyLength: 3 }, history });
  assert.equal(messages.length, 1 + 3 + 1);
});
test('large knowledge bases are narrowed to relevant items (instructions always kept)', () => {
  const big = Array.from({ length: 80 }, (_, i) => ({ id: String(i), type: 'fact', title: `topic${i}`, content: 'x'.repeat(200) + ` keyword${i}` }));
  big.push({ id: 'i', type: 'instruction', title: '', content: 'Always be polite.' });
  const picked = selectKnowledge(big, 'tell me about keyword42');
  assert.ok(picked.some((i) => i.id === 'i'));
  assert.ok(picked.some((i) => i.id === '42'));
  assert.ok(picked.length < big.length);
});
test('finalizeReply strips markdown and respects the max length', () => {
  assert.equal(finalizeReply('**Hi** there', 100), 'Hi there');
  const long = `${'Sentence one is here. '.repeat(30)}`;
  assert.ok(finalizeReply(long, 100).length <= 101);
});
test('AI service: success path uses the shared prompt builder and updates status', async () => {
  let seen;
  const groq = { complete: async ({ messages }) => { seen = messages; return { text: 'Kenneth will confirm the price.', model: 'm', usage: null }; } };
  const store = { get: (n) => ({ settings: d.settings, profile: d.profile, knowledge: { items: kn } }[n]) };
  const status = { groq: { state: 'untested' } };
  const ai = createAiService({ store, config: { timezone: 'Africa/Lagos' }, groq, status });
  const out = await ai.generateReply({ incomingText: 'price?', history: [], contactName: 'Ada' });
  assert.equal(out.reply, 'Kenneth will confirm the price.');
  assert.ok(seen[0].content.includes('Screen replacement'));
  assert.equal(status.groq.state, 'ok');
});
test('AI service: failure is thrown (never a made-up reply) and status shows the error', async () => {
  const groq = { complete: async () => { throw Object.assign(new Error('Groq rate limit reached (429).'), { kind: 'rate_limit' }); } };
  const store = { get: (n) => ({ settings: d.settings, profile: d.profile, knowledge: { items: [] } }[n]) };
  const status = { groq: { state: 'untested' } };
  const ai = createAiService({ store, config: { timezone: 'Africa/Lagos' }, groq, status });
  await assert.rejects(ai.generateReply({ incomingText: 'hi' }), /429/);
  assert.equal(status.groq.state, 'error');
});
test('redactor hides known secrets and token-shaped strings', () => {
  const r = createRedactor(['supersecretpw']);
  const out = r('pw supersecretpw bot 123456789:AAFabcdefghijklmnopqrstuvwxyz0123456 key gsk_abcdefghijklmnopqrstuvwxyz');
  assert.ok(!out.includes('supersecretpw') && !out.includes('AAFabc') && !out.includes('gsk_abc'));
});
