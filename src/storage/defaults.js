export function buildDefaults(config) {
  return {
    settings: {
      replyMode: config.replyMode,
      chatAccessMode: config.chatAccessMode,
      speakAs: 'assistant',
      personality: 'Friendly, respectful and intelligent. Professional when discussing work, relaxed and conversational with friends. Warm, never robotic.',
      systemInstructions: '',
      responseStyle: 'brief',
      maxResponseChars: 500,
      historyLength: config.maxHistory,
      cooldownSeconds: config.cooldownSeconds,
      typingIndicator: config.typingIndicator,
    },
    profile: {
      name: config.ownerName,
      professions: ['Web developer', 'Computer engineer', 'Computer repair technician'],
      about: '', work: '', businesses: '', services: '',
      communicationStyle: '', workingHours: '', importantFacts: '', neverSay: '', confirmFirst: '',
    },
    knowledge: { items: [] },
    conversations: { chats: {}, stats: { received: 0, generated: 0, sent: 0, failed: 0 } },
    contacts: { contacts: {} },
    logs: { entries: [] },
    connections: { connections: {} },
    processed: { updateIds: [], messageKeys: [] },
  };
}
