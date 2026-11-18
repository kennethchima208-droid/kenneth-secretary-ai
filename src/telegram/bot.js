import { Bot } from 'grammy';
import { describeTelegramError } from './errors.js';

const ALLOWED_UPDATES = ['message', 'business_connection', 'business_message', 'edited_business_message'];

const HELP = [
  'I am the assistant bot for your Telegram Business secretary.',
  '',
  'Commands (owner only):',
  '/status - show the current state',
  '/help - show this message',
  '',
  'Important: automatic replies happen for messages people send to YOUR personal Telegram account (via Telegram Business > Chatbots). Messages sent directly to this bot are not customer messages and are never answered by the AI.',
].join('\n');

export function createBot({ config, store, handler, log, status }) {
  const bot = new Bot(config.botToken);
  const isOwner = (ctx) => config.ownerTelegramId != null && ctx.from?.id === config.ownerTelegramId;
  const safe = (label, fn) => async (ctx) => {
    try { await fn(ctx); } catch (err) { log.add('failed', `${label} failed: ${describeTelegramError(err)}`); }
  };

  bot.on('business_connection', safe('Business connection update', (ctx) => handler.handleConnection(ctx.update.business_connection)));
  bot.on('business_message', safe('Business message', (ctx) => handler.handleBusinessMessage({ updateId: ctx.update.update_id, message: ctx.update.business_message })));
  bot.on('edited_business_message', safe('Edited business message', (ctx) => handler.handleEdited({ message: ctx.update.edited_business_message })));

  bot.on('message', safe('Owner command', async (ctx) => {
    if (!isOwner(ctx)) { log.add('system', 'Ignored a direct message to the bot from someone who is not the owner.', { userId: ctx.from?.id }); return; }
    const cmd = (ctx.message.text ?? '').trim().split(/[\s@]/)[0].toLowerCase();
    if (cmd === '/status') {
      const s = store.get('settings'); const conns = Object.values(store.get('connections').connections);
      const allowed = Object.values(store.get('contacts').contacts).filter((c) => c.allowed).length;
      await ctx.reply([
        `Reply mode: ${s.replyMode.toUpperCase()}`,
        `Chat access: ${s.chatAccessMode} (${allowed} allowed contact${allowed === 1 ? '' : 's'})`,
        `Business connections: ${conns.length ? conns.map((c) => `${c.isEnabled ? 'on' : 'off'}${c.canReply ? '' : ' (cannot reply)'}`).join(', ') : 'none yet'}`,
        `Groq: ${status.groq.state}${status.groq.error ? ` - ${status.groq.error}` : ''}`,
      ].join('\n'));
    } else if (cmd === '/start' || cmd === '/help') await ctx.reply(HELP);
    else await ctx.reply('Use /status or /help. Remember: AI replies are only sent through Telegram Business, not in this chat.');
  }));

  bot.catch((err) => log.add('failed', `Telegram handler error: ${describeTelegramError(err.error ?? err)}`));

  return {
    api: bot.api,
    async launch() {
      try {
        await bot.init();
      } catch (err) {
        Object.assign(status.telegram, { state: 'error', running: false, error: describeTelegramError(err) });
        log.add('failed', status.telegram.error);
        return;
      }
      Object.assign(status.telegram, { botId: bot.botInfo.id, username: bot.botInfo.username, error: null });
      bot.start({
        allowed_updates: ALLOWED_UPDATES,
        onStart: () => { Object.assign(status.telegram, { state: 'running', running: true }); log.add('system', `Bot @${bot.botInfo.username} is running and listening for Telegram Business updates.`); },
      }).catch((err) => {
        Object.assign(status.telegram, { state: 'error', running: false, error: describeTelegramError(err) });
        log.add('failed', status.telegram.error);
      });
    },
    async stop() { if (status.telegram.running) await bot.stop(); status.telegram.running = false; },
  };
}
