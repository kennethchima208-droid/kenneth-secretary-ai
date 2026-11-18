import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REPLY_MODES = ['off', 'preview', 'auto'];
export const ACCESS_MODES = ['allowlist', 'all'];

const str = (v, d = '') => (v ?? '').toString().trim() || d;
const int = (v, d, min, max) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const bool = (v, d) => (v === undefined || v === '' ? d : ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase()));

/** Pure function: reads an env-like object and returns a validated config. Never throws. */
export function loadConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  let replyMode = str(env.REPLY_MODE, 'preview').toLowerCase();
  if (!REPLY_MODES.includes(replyMode)) {
    warnings.push(`REPLY_MODE "${replyMode}" is not valid, using "preview".`);
    replyMode = 'preview';
  }
  let chatAccessMode = str(env.CHAT_ACCESS_MODE, 'allowlist').toLowerCase();
  if (!ACCESS_MODES.includes(chatAccessMode)) {
    warnings.push(`CHAT_ACCESS_MODE "${chatAccessMode}" is not valid, using "allowlist".`);
    chatAccessMode = 'allowlist';
  }

  let timezone = str(env.OWNER_TIMEZONE, 'Africa/Lagos');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
  catch { warnings.push(`OWNER_TIMEZONE "${timezone}" is not valid, using Africa/Lagos.`); timezone = 'Africa/Lagos'; }

  const ownerRaw = str(env.OWNER_TELEGRAM_ID);
  let ownerTelegramId = null;
  if (ownerRaw) {
    if (/^\d+$/.test(ownerRaw)) ownerTelegramId = Number(ownerRaw);
    else warnings.push('OWNER_TELEGRAM_ID must be a number. Owner commands are disabled until it is fixed.');
  } else warnings.push('OWNER_TELEGRAM_ID is empty. Owner commands (/status etc.) are disabled.');

  const botToken = str(env.BOT_TOKEN);
  if (!botToken) warnings.push('BOT_TOKEN is empty. The Telegram bot will not start (the dashboard still works).');
  const groqApiKey = str(env.GROQ_API_KEY);
  if (!groqApiKey) warnings.push('GROQ_API_KEY is empty. AI replies will fail until it is set.');

  const password = str(env.DASHBOARD_PASSWORD);
  if (!password) errors.push('DASHBOARD_PASSWORD is empty. Set a password in .env before starting.');
  else if (password.length < 8) warnings.push('DASHBOARD_PASSWORD is short. Use at least 8 characters.');

  const baseUrl = str(env.GROQ_BASE_URL, 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  try { new URL(baseUrl); } catch { errors.push('GROQ_BASE_URL is not a valid URL.'); }

  return {
    errors, warnings,
    botToken,
    ownerTelegramId,
    groq: { apiKey: groqApiKey, baseUrl, model: str(env.GROQ_MODEL, 'openai/gpt-oss-20b') },
    dashboard: { host: str(env.DASHBOARD_HOST, '127.0.0.1'), port: int(env.DASHBOARD_PORT, 3000, 0, 65535), password },
    ownerName: str(env.OWNER_NAME, 'Kenneth Chima'),
    timezone,
    replyMode, chatAccessMode,
    maxHistory: int(env.MAX_HISTORY_MESSAGES, 12, 0, 50),
    cooldownSeconds: int(env.REPLY_COOLDOWN_SECONDS, 20, 0, 3600),
    typingIndicator: bool(env.TYPING_INDICATOR, true),
    dataDir: str(env.DATA_DIR, path.join(ROOT_DIR, 'data')),
  };
}
