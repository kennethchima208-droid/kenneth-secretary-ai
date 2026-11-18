import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccess, evaluateMessage, normalizeConnection } from '../src/telegram/filters.js';
import { connection, incoming } from './helpers.js';

const conn = normalizeConnection(connection());

test('normalizeConnection supports new (rights) and old (can_reply) Bot API shapes', () => {
  assert.equal(normalizeConnection(connection()).canReply, true);
  assert.equal(normalizeConnection(connection({ rights: undefined, can_reply: true })).canReply, true);
  assert.equal(normalizeConnection(connection({ rights: undefined })).canReply, false);
});
test('accepts a normal incoming private message', () => assert.equal(evaluateMessage({ message: incoming(), connection: conn }).ok, true));
test('rejects: unknown / disabled connection, missing can_reply', () => {
  assert.equal(evaluateMessage({ message: incoming(), connection: null }).reason, 'no_connection');
  assert.equal(evaluateMessage({ message: incoming(), connection: { ...conn, isEnabled: false } }).reason, 'connection_disabled');
  assert.equal(evaluateMessage({ message: incoming(), connection: { ...conn, canReply: false } }).reason, 'no_reply_permission');
});
test('rejects group chats', () => assert.equal(evaluateMessage({ message: incoming({ chat: { id: -5, type: 'supergroup' } }), connection: conn }).reason, 'not_private'));
test("rejects the owner's own outgoing messages (prevents reply loops)", () => {
  assert.equal(evaluateMessage({ message: incoming({ from: { id: 111, is_bot: false } }), connection: conn }).reason, 'outgoing_owner');
});
test("rejects messages sent by the assistant itself", () => {
  assert.equal(evaluateMessage({ message: incoming({ sender_business_bot: { id: 999, is_bot: true } }), connection: conn }).reason, 'sent_by_assistant');
  assert.equal(evaluateMessage({ message: incoming({ from: { id: 999, is_bot: true } }), connection: conn, botId: 999 }).reason, 'sent_by_assistant');
});
test('rejects other bots', () => assert.equal(evaluateMessage({ message: incoming({ from: { id: 5, is_bot: true } }), connection: conn }).reason, 'bot_sender'));
test('access rules: off, paused, allowlist, all', () => {
  const s = (o) => ({ replyMode: 'auto', chatAccessMode: 'allowlist', ...o });
  assert.equal(evaluateAccess({ settings: s({ replyMode: 'off' }), contact: { allowed: true } }).reason, 'mode_off');
  assert.equal(evaluateAccess({ settings: s(), contact: { allowed: true, paused: true } }).reason, 'contact_paused');
  assert.equal(evaluateAccess({ settings: s(), contact: { allowed: false } }).reason, 'not_allowlisted');
  assert.equal(evaluateAccess({ settings: s(), contact: undefined }).reason, 'not_allowlisted');
  assert.equal(evaluateAccess({ settings: s(), contact: { allowed: true } }).ok, true);
  assert.equal(evaluateAccess({ settings: s({ chatAccessMode: 'all' }), contact: { allowed: false } }).ok, true);
  assert.equal(evaluateAccess({ settings: s({ chatAccessMode: 'all' }), contact: { paused: true } }).reason, 'contact_paused');
});
