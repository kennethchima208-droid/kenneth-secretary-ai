import { appendMessage, displayName, recentHistory, upsertConversation } from '../storage/conversations.js';
import { evaluateAccess, evaluateMessage, extractText, normalizeConnection, REASON_TEXT } from './filters.js';

const MAX_STORED_CHARS = 4000;
const MAX_PROCESSED = 2000;

/**
 * Handles Telegram Business updates. Telegram access goes through getApi() so tests can pass a mock.
 * Replies are ALWAYS sent with business_connection_id so they appear to come from the owner's account.
 */
export function createBusinessHandler({ store, ai, getApi, log, getBotId = () => null, now = () => Date.now() }) {
  const queues = new Map();
  const stats = () => store.get('conversations').stats;

  // One message at a time per chat, so two quick messages can never produce two overlapping replies.
  function serial(key, fn) {
    const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
    return next;
  }

  async function claim(updateId, key) {
    const p = store.get('processed');
    if ((updateId != null && p.updateIds.includes(updateId)) || p.messageKeys.includes(key)) return false;
    if (updateId != null) p.updateIds.push(updateId);
    p.messageKeys.push(key);
    for (const list of [p.updateIds, p.messageKeys]) if (list.length > MAX_PROCESSED) list.splice(0, list.length - MAX_PROCESSED);
    await store.save('processed');
    return true;
  }

  async function handleConnection(bc) {
    const conn = normalizeConnection(bc);
    store.get('connections').connections[conn.id] = { ...conn, updatedAt: new Date().toISOString() };
    await store.save('connections');
    const state = conn.isEnabled ? 'enabled' : 'disabled';
    log.add('connection', `Business connection ${state} for ${conn.userName ?? conn.userId} (can reply: ${conn.canReply ? 'yes' : 'NO'})`, { id: conn.id, isEnabled: conn.isEnabled, canReply: conn.canReply });
    if (conn.isEnabled && !conn.canReply) log.add('connection', 'The bot cannot reply on this connection. In Telegram: Settings > Business > Chatbots, enable "Reply to messages".');
    return conn;
  }

  async function getConnection(id) {
    const known = store.get('connections').connections[id];
    if (known) return known;
    try {
      const bc = await getApi()?.getBusinessConnection(id);
      if (!bc) return null;
      const conn = normalizeConnection(bc);
      store.get('connections').connections[id] = { ...conn, updatedAt: new Date().toISOString() };
      await store.save('connections');
      return conn;
    } catch (err) {
      log.add('failed', `Could not look up business connection: ${err.message}`);
      return null;
    }
  }

  function handleBusinessMessage({ updateId = null, message }) {
    return serial(String(message.chat?.id), () => processMessage(updateId, message));
  }

  async function processMessage(updateId, message) {
    const chatId = message.chat.id;
    if (!(await claim(updateId, `${chatId}:${message.message_id}`))) return { action: 'duplicate' };

    const connection = await getConnection(message.business_connection_id);
    const verdict = evaluateMessage({ message, connection, botId: getBotId() });
    if (!verdict.ok) {
      if (verdict.reason === 'outgoing_owner') return recordOwnerMessage(message);
      log.add('skipped', `Ignored message: ${REASON_TEXT[verdict.reason] ?? verdict.reason}`, { chatId, reason: verdict.reason });
      return { action: 'skipped', reason: verdict.reason };
    }

    const text = extractText(message).slice(0, MAX_STORED_CHARS);
    if (!text) { log.add('skipped', 'Ignored a message with no text (photo, voice, sticker...).', { chatId }); return { action: 'skipped', reason: 'empty' }; }

    const name = displayName(message.chat);
    const conv = upsertConversation(store, { chatId, name, username: message.chat.username });
    const history = recentHistory(conv, store.get('settings').historyLength);
    appendMessage(store, chatId, { role: 'user', text, telegramMessageId: message.message_id });
    stats().received += 1;
    log.add('incoming', `Message from ${name}: ${text.slice(0, 120)}`, { chatId });
    await Promise.all([store.save('conversations'), store.save('contacts')]);

    const settings = store.get('settings');
    const access = evaluateAccess({ settings, contact: store.get('contacts').contacts[String(chatId)] });
    if (!access.ok) { log.add('skipped', `No reply to ${name}: ${REASON_TEXT[access.reason]}`, { chatId, reason: access.reason }); return { action: 'skipped', reason: access.reason }; }

    const cooldownMs = settings.cooldownSeconds * 1000;
    const lastReply = [...conv.messages].reverse().find((m) => m.role === 'assistant' && (m.status === 'sent' || m.status === 'preview'));
    if (lastReply && cooldownMs > 0 && now() - Date.parse(lastReply.at) < cooldownMs) {
      log.add('skipped', `No reply to ${name}: ${REASON_TEXT.cooldown}`, { chatId, reason: 'cooldown' });
      return { action: 'skipped', reason: 'cooldown' };
    }

    let result;
    try {
      result = await ai.generateReply({ incomingText: text, history, contactName: name });
    } catch (err) {
      stats().failed += 1;
      log.add('ai_error', `AI failed for ${name}: ${err.message}`, { chatId, kind: err.kind });
      log.add('failed', `No reply was sent to ${name} because the AI request failed.`, { chatId });
      await store.save('conversations');
      return { action: 'ai_failed', error: err.message };
    }
    stats().generated += 1;
    log.add('ai_response', `Reply for ${name}: ${result.reply.slice(0, 120)}`, { chatId, model: result.model });

    // Settings may have changed while the AI was thinking; check again before sending.
    const latest = evaluateAccess({ settings: store.get('settings'), contact: store.get('contacts').contacts[String(chatId)] });
    const mode = latest.ok ? store.get('settings').replyMode : 'preview';
    if (mode !== 'auto') {
      appendMessage(store, chatId, { role: 'assistant', text: result.reply, status: 'preview' });
      log.add('preview', `Draft saved for ${name} (not sent).`, { chatId });
      await store.save('conversations');
      return { action: 'preview', reply: result.reply };
    }
    return sendReply({ connection, chatId, name, reply: result.reply });
  }

  async function sendReply({ connection, chatId, name, reply }) {
    const api = getApi();
    const opts = { business_connection_id: connection.id };
    try {
      if (store.get('settings').typingIndicator) await api.sendChatAction(chatId, 'typing', opts).catch(() => {});
      const sent = await api.sendMessage(chatId, reply, opts);
      appendMessage(store, chatId, { role: 'assistant', text: reply, status: 'sent', telegramMessageId: sent?.message_id });
      stats().sent += 1;
      log.add('sent', `Reply sent to ${name}.`, { chatId });
      await store.save('conversations');
      return { action: 'sent', reply, messageId: sent?.message_id };
    } catch (err) {
      stats().failed += 1;
      appendMessage(store, chatId, { role: 'assistant', text: reply, status: 'failed' });
      log.add('failed', `Telegram refused the reply to ${name}: ${err.description ?? err.message}`, { chatId });
      await store.save('conversations');
      return { action: 'send_failed', error: err.description ?? err.message };
    }
  }

  async function recordOwnerMessage(message) {
    const text = extractText(message).slice(0, MAX_STORED_CHARS);
    if (!text) return { action: 'skipped', reason: 'outgoing_owner' };
    const conv = upsertConversation(store, { chatId: message.chat.id, name: displayName(message.chat), username: message.chat.username });
    if (!conv.messages.some((m) => m.telegramMessageId === message.message_id)) {
      appendMessage(store, message.chat.id, { role: 'owner', text, telegramMessageId: message.message_id });
      await Promise.all([store.save('conversations'), store.save('contacts')]);
    }
    return { action: 'skipped', reason: 'outgoing_owner' };
  }

  async function handleEdited({ message }) {
    const conv = store.get('conversations').chats[String(message.chat?.id)];
    const target = conv?.messages.find((m) => m.telegramMessageId === message.message_id && m.role !== 'assistant');
    const text = extractText(message).slice(0, MAX_STORED_CHARS);
    if (!target || !text) return { action: 'ignored' };
    target.text = text; target.edited = true;
    await store.save('conversations');
    log.add('incoming', `A message from ${conv.name} was edited (no new reply is generated for edits).`, { chatId: message.chat.id });
    return { action: 'edited' };
  }

  return { handleConnection, handleBusinessMessage, handleEdited };
}
