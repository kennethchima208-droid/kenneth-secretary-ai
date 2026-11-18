import path from 'node:path';
import dotenv from 'dotenv';
import { loadConfig, ROOT_DIR } from './config/env.js';
import { Store } from './storage/store.js';
import { buildDefaults } from './storage/defaults.js';
import { createActivityLog } from './storage/activity.js';
import { createRedactor } from './utils/redact.js';
import { createStatus } from './utils/status.js';
import { createGroqClient } from './ai/groq.js';
import { createAiService } from './ai/service.js';
import { createBusinessHandler } from './telegram/handler.js';
import { createBot } from './telegram/bot.js';
import { createDashboard } from './dashboard/server.js';

dotenv.config({ path: path.join(ROOT_DIR, '.env') });
const config = loadConfig(process.env);

if (config.errors.length) {
  console.error('\nCannot start:\n' + config.errors.map((e) => `  - ${e}`).join('\n') + '\n\nEdit the .env file (copy .env.example to .env first) and try again.');
  process.exit(1);
}

const store = new Store(config.dataDir, buildDefaults(config));
await store.init();
const redact = createRedactor([config.botToken, config.groq.apiKey, config.dashboard.password]);
const log = createActivityLog(store, redact);
const status = createStatus(config);
const groq = createGroqClient(config.groq);
const ai = createAiService({ store, config, groq, status });

let bot = null;
const handler = createBusinessHandler({ store, ai, log, getApi: () => bot?.api, getBotId: () => status.telegram.botId });
if (config.botToken) bot = createBot({ config, store, handler, log, status });

const dashboard = createDashboard({ config, store, ai, status, log, getBotApi: () => bot?.api });
try { await dashboard.start(); }
catch (err) { console.error(`\nCould not start the dashboard: ${err.message}\n`); process.exit(1); }

for (const w of config.warnings) log.add('system', `Config warning: ${w}`);
console.log(`\nDashboard: http://${config.dashboard.host}:${dashboard.port()}  (reply mode: ${store.get('settings').replyMode.toUpperCase()})\n`);
if (bot) bot.launch();

process.on('unhandledRejection', (err) => log.add('failed', `Unhandled error: ${err?.message ?? err}`));
process.on('uncaughtException', (err) => log.add('failed', `Unexpected error: ${err?.message ?? err}`));

let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  await Promise.allSettled([bot?.stop(), dashboard.stop()]);
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
