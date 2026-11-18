import test from 'node:test';
import assert from 'node:assert/strict';
import { incoming, makeHarness } from './helpers.js';

test('AUTO: replies through the business connection (not a plain bot message)', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto', typingIndicator: true } });
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  assert.equal(r.action, 'sent');
  assert.equal(h.calls.sendMessage.length, 1);
  assert.equal(h.calls.sendMessage[0].chatId, 222);
  assert.equal(h.calls.sendMessage[0].opts.business_connection_id, 'bc1');
  assert.equal(h.calls.sendChatAction[0].opts.business_connection_id, 'bc1');
  assert.equal(h.store.get('conversations').stats.sent, 1);
  await h.cleanup();
});
test('PREVIEW: generates and saves a draft, sends nothing', async () => {
  const h = await makeHarness({ settings: { replyMode: 'preview' } });
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  assert.equal(r.action, 'preview');
  assert.equal(h.calls.sendMessage.length, 0);
  const msgs = h.store.get('conversations').chats['222'].messages;
  assert.equal(msgs.at(-1).status, 'preview');
  await h.cleanup();
});
test('OFF: no AI call, no send, but the message is recorded', async () => {
  const h = await makeHarness({ settings: { replyMode: 'off' } });
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  assert.equal(r.reason, 'mode_off');
  assert.equal(h.aiCalls.length, 0);
  assert.equal(h.store.get('conversations').chats['222'].messages.length, 1);
  await h.cleanup();
});
test('duplicate Telegram updates are answered once', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  const [a, b] = await Promise.all([h.handler.handleBusinessMessage({ updateId: 7, message: incoming() }), h.handler.handleBusinessMessage({ updateId: 7, message: incoming() })]);
  assert.deepEqual([a.action, b.action].sort(), ['duplicate', 'sent']);
  assert.equal(h.calls.sendMessage.length, 1);
  await h.cleanup();
});
test("owner's outgoing messages never trigger a reply but are kept as history", async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  const r = await h.handler.handleBusinessMessage({ updateId: 2, message: incoming({ message_id: 5, from: { id: 111, is_bot: false }, text: 'I will call you later' }) });
  assert.equal(r.reason, 'outgoing_owner');
  assert.equal(h.calls.sendMessage.length, 0);
  assert.equal(h.store.get('conversations').chats['222'].messages[0].role, 'owner');
  await h.cleanup();
});
test('contact not on allowlist, or paused: no AI call, no send', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' }, allow: false });
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() })).reason, 'not_allowlisted');
  h.store.get('contacts').contacts['222'] = { allowed: true, paused: true };
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 2, message: incoming({ message_id: 2 }) })).reason, 'contact_paused');
  assert.equal(h.aiCalls.length + h.calls.sendMessage.length, 0);
  await h.cleanup();
});
test('group chats are ignored', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming({ chat: { id: -9, type: 'group', title: 'Team' } }) });
  assert.equal(r.reason, 'not_private');
  assert.equal(h.calls.sendMessage.length, 0);
  await h.cleanup();
});
test('AI failure: nothing is sent, error is logged and counted', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' }, aiImpl: async () => { throw Object.assign(new Error('Groq rate limit reached (429).'), { kind: 'rate_limit' }); } });
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  assert.equal(r.action, 'ai_failed');
  assert.equal(h.calls.sendMessage.length, 0);
  assert.equal(h.store.get('conversations').stats.failed, 1);
  assert.ok(h.log.list({ type: 'ai_error' }).length === 1);
  await h.cleanup();
});
test('Telegram send failure is recorded without crashing', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  h.api.sendMessage = async () => { throw Object.assign(new Error('x'), { description: 'Forbidden: bot cannot reply' }); };
  const r = await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  assert.equal(r.action, 'send_failed');
  assert.equal(h.store.get('conversations').chats['222'].messages.at(-1).status, 'failed');
  await h.cleanup();
});
test('cooldown prevents a second reply right after the first', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto', cooldownSeconds: 60 } });
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() })).action, 'sent');
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 2, message: incoming({ message_id: 2 }) })).reason, 'cooldown');
  assert.equal(h.calls.sendMessage.length, 1);
  await h.cleanup();
});
test('disabled connection or missing can_reply permission blocks replies', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  await h.handler.handleConnection({ id: 'bc1', user: { id: 111 }, user_chat_id: 111, is_enabled: true, rights: {} });
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() })).reason, 'no_reply_permission');
  await h.handler.handleConnection({ id: 'bc1', user: { id: 111 }, user_chat_id: 111, is_enabled: false, rights: { can_reply: true } });
  assert.equal((await h.handler.handleBusinessMessage({ updateId: 2, message: incoming({ message_id: 2 }) })).reason, 'connection_disabled');
  assert.equal(h.calls.sendMessage.length, 0);
  await h.cleanup();
});
test('conversation history is isolated per chat', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  h.store.get('contacts').contacts['333'] = { allowed: true, paused: false };
  await h.handler.handleBusinessMessage({ updateId: 1, message: incoming({ text: 'secret from Ada' }) });
  await h.handler.handleBusinessMessage({ updateId: 2, message: incoming({ message_id: 3, chat: { id: 333, type: 'private', first_name: 'Bayo' }, from: { id: 333, is_bot: false }, text: 'hi from Bayo' }) });
  const bayoHistory = JSON.stringify(h.aiCalls.at(-1).history);
  assert.ok(!bayoHistory.includes('secret from Ada'));
  await h.cleanup();
});
test('edited messages update history and do not trigger a reply', async () => {
  const h = await makeHarness({ settings: { replyMode: 'auto' } });
  await h.handler.handleBusinessMessage({ updateId: 1, message: incoming() });
  const before = h.calls.sendMessage.length;
  assert.equal((await h.handler.handleEdited({ message: incoming({ text: 'edited text' }) })).action, 'edited');
  assert.equal(h.calls.sendMessage.length, before);
  assert.equal(h.store.get('conversations').chats['222'].messages[0].text, 'edited text');
  await h.cleanup();
});
