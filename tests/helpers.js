import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/storage/store.js';
import { buildDefaults } from '../src/storage/defaults.js';
import { createActivityLog } from '../src/storage/activity.js';
import { createRedactor } from '../src/utils/redact.js';
import { createBusinessHandler } from '../src/telegram/handler.js';

export const baseConfig = { replyMode: 'preview', chatAccessMode: 'allowlist', maxHistory: 12, cooldownSeconds: 0, typingIndicator: false, ownerName: 'Kenneth Chima', timezone: 'Africa/Lagos' };

export const connection = (over = {}) => ({ id: 'bc1', user: { id: 111, first_name: 'Kenneth' }, user_chat_id: 111, date: 1, rights: { can_reply: true }, is_enabled: true, ...over });
export const incoming = (over = {}) => ({ message_id: 1, date: 1, business_connection_id: 'bc1', chat: { id: 222, type: 'private', first_name: 'Ada', username: 'ada' }, from: { id: 222, is_bot: false, first_name: 'Ada' }, text: 'Hi, are you free tomorrow?', ...over });

export async function makeHarness({ settings = {}, aiImpl, allow = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksai-'));
  const store = new Store(dir, buildDefaults(baseConfig));
  await store.init();
  Object.assign(store.get('settings'), settings);
  const log = createActivityLog(store, createRedactor([]), { echo: false });
  const calls = { sendMessage: [], sendChatAction: [] };
  const api = {
    async sendMessage(chatId, text, opts) { calls.sendMessage.push({ chatId, text, opts }); return { message_id: 900 + calls.sendMessage.length }; },
    async sendChatAction(chatId, action, opts) { calls.sendChatAction.push({ chatId, action, opts }); return true; },
    async getBusinessConnection() { throw new Error('not found'); },
  };
  const aiCalls = [];
  const ai = { generateReply: aiImpl ?? (async (args) => { aiCalls.push(args); return { reply: 'Hello Ada, Kenneth will get back to you.', model: 'test' }; }) };
  const handler = createBusinessHandler({ store, ai, getApi: () => api, log, getBotId: () => 999 });
  await handler.handleConnection(connection());
  if (allow) { store.get('contacts').contacts['222'] = { allowed: true, paused: false }; }
  return { store, handler, api, calls, aiCalls, log, dir, cleanup: async () => { await new Promise((r) => setTimeout(r, 30)); await store.flush(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }); } };
}
