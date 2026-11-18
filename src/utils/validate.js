import { ACCESS_MODES, REPLY_MODES } from '../config/env.js';

export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}

export const KNOWLEDGE_TYPES = ['fact', 'business', 'faq', 'service', 'price', 'instruction'];
export const RESPONSE_STYLES = ['brief', 'balanced', 'detailed'];
export const SPEAK_AS = ['assistant', 'first_person'];

const text = (v, name, max) => {
  if (typeof v !== 'string') throw new ValidationError(`${name} must be text.`);
  if (v.length > max) throw new ValidationError(`${name} is too long (max ${max} characters).`);
  return v.trim();
};
const oneOf = (v, list, name) => {
  if (!list.includes(v)) throw new ValidationError(`${name} must be one of: ${list.join(', ')}.`);
  return v;
};
const num = (v, name, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${name} must be a number between ${min} and ${max}.`);
  return Math.round(n);
};

export function sanitizeSettings(input, current) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid settings.');
  const out = { ...current };
  if (input.replyMode !== undefined) out.replyMode = oneOf(input.replyMode, REPLY_MODES, 'replyMode');
  if (input.chatAccessMode !== undefined) out.chatAccessMode = oneOf(input.chatAccessMode, ACCESS_MODES, 'chatAccessMode');
  if (input.speakAs !== undefined) out.speakAs = oneOf(input.speakAs, SPEAK_AS, 'speakAs');
  if (input.responseStyle !== undefined) out.responseStyle = oneOf(input.responseStyle, RESPONSE_STYLES, 'responseStyle');
  if (input.personality !== undefined) out.personality = text(input.personality, 'Personality', 1500);
  if (input.systemInstructions !== undefined) out.systemInstructions = text(input.systemInstructions, 'System instructions', 5000);
  if (input.maxResponseChars !== undefined) out.maxResponseChars = num(input.maxResponseChars, 'Maximum response length', 100, 2000);
  if (input.historyLength !== undefined) out.historyLength = num(input.historyLength, 'Conversation history length', 0, 50);
  if (input.cooldownSeconds !== undefined) out.cooldownSeconds = num(input.cooldownSeconds, 'Reply cooldown', 0, 3600);
  if (input.typingIndicator !== undefined) out.typingIndicator = Boolean(input.typingIndicator);
  return out;
}

const PROFILE_TEXT_FIELDS = ['about', 'work', 'businesses', 'services', 'communicationStyle', 'workingHours', 'importantFacts', 'neverSay', 'confirmFirst'];

export function sanitizeProfile(input, current) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid profile.');
  const out = { ...current };
  if (input.name !== undefined) {
    out.name = text(input.name, 'Name', 100);
    if (!out.name) throw new ValidationError('Name cannot be empty.');
  }
  if (input.professions !== undefined) {
    const list = Array.isArray(input.professions) ? input.professions : String(input.professions).split(/[\n,]/);
    out.professions = list.map((p) => text(String(p), 'Profession', 100)).filter(Boolean).slice(0, 12);
  }
  for (const f of PROFILE_TEXT_FIELDS) if (input[f] !== undefined) out[f] = text(input[f], f, 4000);
  return out;
}

export function sanitizeKnowledgeItem(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('Invalid knowledge item.');
  const type = oneOf(input.type, KNOWLEDGE_TYPES, 'type');
  const title = text(input.title ?? '', 'Title', 200);
  const content = text(input.content ?? '', 'Content', 3000);
  if (!content) throw new ValidationError('Content cannot be empty.');
  if (type === 'faq' && !title) throw new ValidationError('A FAQ needs a question in the title field.');
  return { type, title, content };
}
