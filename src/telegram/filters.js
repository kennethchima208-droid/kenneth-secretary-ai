/** Pure decision functions for Telegram Business messages (easy to test, no side effects). */

export function normalizeConnection(bc) {
  return {
    id: bc.id,
    userId: bc.user?.id ?? null,
    userName: [bc.user?.first_name, bc.user?.last_name].filter(Boolean).join(' ') || null,
    username: bc.user?.username ?? null,
    userChatId: bc.user_chat_id ?? null,
    // Newer Bot API versions use rights.can_reply; older ones used can_reply.
    canReply: Boolean(bc.rights?.can_reply ?? bc.can_reply),
    isEnabled: Boolean(bc.is_enabled),
    date: bc.date ?? null,
  };
}

const skip = (reason) => ({ ok: false, reason });

/** Steps 1-4 from the spec: connection enabled, can_reply, incoming (not ours), private chat. */
export function evaluateMessage({ message, connection, botId = null }) {
  if (!connection) return skip('no_connection');
  if (!connection.isEnabled) return skip('connection_disabled');
  if (!connection.canReply) return skip('no_reply_permission');
  if (message.chat?.type !== 'private') return skip('not_private');
  if (message.sender_business_bot || (botId != null && message.from?.id === botId)) return skip('sent_by_assistant');
  if (!message.from) return skip('no_sender');
  if (connection.userId != null && message.from.id === connection.userId) return skip('outgoing_owner');
  if (message.from.is_bot) return skip('bot_sender');
  if (connection.userId != null && message.chat.id === connection.userId) return skip('owner_chat');
  return { ok: true };
}

/** Step 5: is this chat permitted by the application's settings? */
export function evaluateAccess({ settings, contact }) {
  if (settings.replyMode === 'off') return skip('mode_off');
  if (contact?.paused) return skip('contact_paused');
  if (settings.chatAccessMode === 'allowlist' && !contact?.allowed) return skip('not_allowlisted');
  return { ok: true };
}

export function extractText(message) {
  return (message.text ?? message.caption ?? '').trim();
}

export const REASON_TEXT = {
  no_connection: 'unknown business connection',
  connection_disabled: 'business connection is disabled',
  no_reply_permission: 'bot does not have the "reply to messages" permission',
  not_private: 'not a private chat',
  sent_by_assistant: 'message was sent by the assistant',
  no_sender: 'message has no sender',
  outgoing_owner: 'message was sent by the owner',
  bot_sender: 'sender is a bot',
  owner_chat: "owner's own chat",
  mode_off: 'reply mode is OFF',
  contact_paused: 'replies are paused for this contact',
  not_allowlisted: 'contact is not on the allowlist',
  cooldown: 'reply cooldown is active',
  empty: 'message has no text',
};
