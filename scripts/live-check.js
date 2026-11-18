// Real network checks using your .env: Groq, the AI function, and the Telegram bot token.
// Run with: npm run check:live
import path from 'node:path';
import dotenv from 'dotenv';
import { Bot } from 'grammy';
import { loadConfig, ROOT_DIR } from '../src/config/env.js';
import { createGroqClient } from '../src/ai/groq.js';
import { createAiService } from '../src/ai/service.js';
import { Store } from '../src/storage/store.js';
import { buildDefaults } from '../src/storage/defaults.js';
import { createRedactor } from '../src/utils/redact.js';
import { createStatus } from '../src/utils/status.js';
import { describeTelegramError } from '../src/telegram/errors.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
const config = loadConfig(process.env);
const redact = createRedactor([config.botToken, config.groq.apiKey, config.dashboard.password]);
let failures = 0;
const step = async (name, fn) => {
  try { console.log(`PASS  ${name}: ${redact(await fn())}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}: ${redact(e.message)}`); }
};

const groq = createGroqClient(config.groq);
const status = createStatus(config);
const store = new Store(config.dataDir, buildDefaults(config)); await store.init();
const ai = createAiService({ store, config, groq, status });

await step('Groq connection', async () => { const r = await ai.ping(); return `model ${r.model}, ${r.latencyMs} ms`; });
await step('AI reply function', async () => { const r = await ai.generateReply({ incomingText: 'Hi, are you available to fix my laptop today?', history: [], contactName: 'Test' }); return `"${r.reply}"`; });
await step('Telegram bot token', async () => {
  if (!config.botToken) throw new Error('BOT_TOKEN is empty');
  try { const me = await new Bot(config.botToken).api.getMe(); return `@${me.username}, business mode enabled in BotFather: ${me.can_connect_to_business ?? 'unknown'}`; }
  catch (e) { throw new Error(describeTelegramError(e)); }
});
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll live checks passed.');
process.exit(failures ? 1 : 0);
