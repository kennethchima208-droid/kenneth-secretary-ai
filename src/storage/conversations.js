import { randomUUID } from 'node:crypto';

const MAX_MESSAGES = 200;
const iso = () => new Date().toISOString();

export function displayName(chat) {
  return [chat?.first_name, chat?.last_name].filter(Boolean).join(' ') || chat?.title || chat?.username || String(chat?.id ?? 'Unknown');
}

export function upsertConversation(store, { chatId, name, username }) {
  const chats = store.get('conversations').chats;
  const key = String(chatId);
  const conv = (chats[key] ??= { chatId, name, username: username ?? null, createdAt: iso(), updatedAt: iso(), messages: [] });
  conv.name = name || conv.name;
  conv.username = username ?? conv.username;
  const contacts = store.get('contacts').contacts;
  contacts[key] ??= { allowed: false, paused: false };
  return conv;
}

/** role: 'user' (contact), 'assistant' (our reply), 'owner' (you, typing manually). */
export function appendMessage(store, chatId, msg) {
  const conv = store.get('conversations').chats[String(chatId)];
  const entry = { id: randomUUID(), at: iso(), ...msg };
  conv.messages.push(entry);
  if (conv.messages.length > MAX_MESSAGES) conv.messages.splice(0, conv.messages.length - MAX_MESSAGES);
  conv.updatedAt = entry.at;
  return entry;
}

/** Conversation memory for the AI: only what was really said (drafts and failures are excluded). */
export function recentHistory(conv, limit) {
  if (!conv || limit <= 0) return [];
  return conv.messages
    .filter((m) => m.role === 'user' || m.role === 'owner' || (m.role === 'assistant' && m.status === 'sent'))
    .slice(-limit)
    .map((m) => ({ role: m.role, text: m.text }));
}

export function summarize(conv, contact) {
  const last = (pred) => [...conv.messages].reverse().find(pred);
  const lastIn = last((m) => m.role === 'user');
  const lastOut = last((m) => m.role === 'assistant');
  return {
    key: String(conv.chatId), name: conv.name, username: conv.username,
    lastMessage: lastIn ? { text: lastIn.text, at: lastIn.at } : null,
    lastReply: lastOut ? { text: lastOut.text, at: lastOut.at, status: lastOut.status } : null,
    createdAt: conv.createdAt, updatedAt: conv.updatedAt, messageCount: conv.messages.length,
    allowed: Boolean(contact?.allowed), paused: Boolean(contact?.paused),
  };
}
