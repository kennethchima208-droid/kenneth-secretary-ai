import { randomUUID } from 'node:crypto';
import { summarize } from '../storage/conversations.js';
import { ValidationError, sanitizeKnowledgeItem, sanitizeProfile, sanitizeSettings } from '../utils/validate.js';
import { describeTelegramError } from '../telegram/errors.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

export function registerRoutes(app, { config, store, ai, status, log, getBotApi }) {
  const settings = () => store.get('settings');

  app.get('/api/overview', wrap(async (req, res) => {
    const { chats, stats } = store.get('conversations');
    res.json({
      telegram: status.telegram, groq: status.groq, stats,
      conversations: Object.keys(chats).length,
      settings: { replyMode: settings().replyMode, chatAccessMode: settings().chatAccessMode },
      connections: Object.values(store.get('connections').connections),
      warnings: config.warnings,
    });
  }));

  app.get('/api/info', wrap(async (req, res) => res.json({
    dashboardHost: config.dashboard.host, dashboardPort: config.dashboard.port, model: config.groq.model, groqBaseUrl: config.groq.baseUrl,
    timezone: config.timezone, ownerName: config.ownerName, botTokenSet: Boolean(config.botToken), groqKeySet: Boolean(config.groq.apiKey),
    ownerIdSet: config.ownerTelegramId != null, botUsername: status.telegram.username,
  })));

  // --- Conversations & per-contact permissions ---
  app.get('/api/conversations', wrap(async (req, res) => {
    const { chats } = store.get('conversations'); const { contacts } = store.get('contacts');
    const list = Object.values(chats).map((c) => summarize(c, contacts[String(c.chatId)])).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json({ conversations: list });
  }));

  app.get('/api/conversations/:key', wrap(async (req, res) => {
    const conv = store.get('conversations').chats[req.params.key];
    if (!conv) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    res.json({ ...summarize(conv, store.get('contacts').contacts[req.params.key]), messages: conv.messages.slice(-60) });
  }));

  app.patch('/api/conversations/:key', wrap(async (req, res) => {
    const contact = store.get('contacts').contacts[req.params.key];
    if (!contact) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    for (const f of ['allowed', 'paused']) {
      if (req.body?.[f] !== undefined) {
        if (typeof req.body[f] !== 'boolean') throw new ValidationError(`${f} must be true or false.`);
        contact[f] = req.body[f];
      }
    }
    await store.save('contacts');
    log.add('system', `Contact ${req.params.key}: allowed=${contact.allowed}, paused=${contact.paused}`);
    res.json({ ok: true, allowed: contact.allowed, paused: contact.paused });
  }));

  // --- Settings / profile ---
  app.get('/api/settings', wrap(async (req, res) => res.json(settings())));
  app.put('/api/settings', wrap(async (req, res) => {
    const next = sanitizeSettings(req.body, settings());
    const changedMode = next.replyMode !== settings().replyMode;
    Object.assign(settings(), next);
    await store.save('settings');
    if (changedMode) log.add('system', `Reply mode changed to ${next.replyMode.toUpperCase()}.`);
    res.json(settings());
  }));

  app.get('/api/profile', wrap(async (req, res) => res.json(store.get('profile'))));
  app.put('/api/profile', wrap(async (req, res) => {
    Object.assign(store.get('profile'), sanitizeProfile(req.body, store.get('profile')));
    await store.save('profile');
    res.json(store.get('profile'));
  }));

  // --- Knowledge base ---
  app.get('/api/knowledge', wrap(async (req, res) => res.json({ items: store.get('knowledge').items })));
  app.post('/api/knowledge', wrap(async (req, res) => {
    const items = store.get('knowledge').items;
    if (items.length >= 500) throw new ValidationError('Knowledge limit reached (500 items).');
    const item = { id: randomUUID(), ...sanitizeKnowledgeItem(req.body), updatedAt: new Date().toISOString() };
    items.push(item); await store.save('knowledge');
    res.status(201).json(item);
  }));
  app.put('/api/knowledge/:id', wrap(async (req, res) => {
    const items = store.get('knowledge').items; const i = items.findIndex((x) => x.id === req.params.id);
    if (i < 0) throw Object.assign(new Error('Item not found.'), { status: 404 });
    items[i] = { ...items[i], ...sanitizeKnowledgeItem(req.body), updatedAt: new Date().toISOString() };
    await store.save('knowledge'); res.json(items[i]);
  }));
  app.delete('/api/knowledge/:id', wrap(async (req, res) => {
    const k = store.get('knowledge'); const before = k.items.length;
    k.items = k.items.filter((x) => x.id !== req.params.id);
    if (k.items.length === before) throw Object.assign(new Error('Item not found.'), { status: 404 });
    await store.save('knowledge'); res.json({ ok: true });
  }));

  // --- Logs ---
  app.get('/api/logs', wrap(async (req, res) => {
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 200));
    res.json({ entries: log.list({ limit, type: typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined }) });
  }));

  // --- Testing. These routes only use the AI service: they have no way to send Telegram messages. ---
  app.post('/api/test/ai', wrap(async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) throw new ValidationError('Type a sample message first.');
    if (message.length > 1000) throw new ValidationError('Sample message is too long (max 1000 characters).');
    const contactName = typeof req.body?.contactName === 'string' ? req.body.contactName.trim().slice(0, 80) : '';
    try {
      const out = await ai.generateReply({ incomingText: message, history: [], contactName: contactName || 'Test Contact' });
      log.add('ai_response', `Dashboard test reply (nothing was sent to Telegram): ${out.reply.slice(0, 120)}`, { test: true });
      res.json({ ok: true, reply: out.reply, model: out.model, knowledgeUsed: out.knowledgeUsed, elapsedMs: out.elapsedMs });
    } catch (err) {
      log.add('ai_error', `Dashboard AI test failed: ${err.message}`, { test: true });
      res.status(200).json({ ok: false, error: err.message, kind: err.kind });
    }
  }));

  app.post('/api/test/groq', wrap(async (req, res) => {
    try { res.json(await ai.ping()); }
    catch (err) { log.add('ai_error', `Groq connection test failed: ${err.message}`); res.json({ ok: false, error: err.message, kind: err.kind }); }
  }));

  app.post('/api/test/telegram', wrap(async (req, res) => {
    const api = getBotApi();
    if (!api) return res.json({ ok: false, error: 'BOT_TOKEN is not set in .env.' });
    try {
      const me = await api.getMe();
      res.json({ ok: true, username: me.username, name: me.first_name, id: me.id, supportsBusiness: me.can_connect_to_business ?? null });
    } catch (err) { res.json({ ok: false, error: describeTelegramError(err) }); }
  }));

  app.get('/api/test/business', wrap(async (req, res) => {
    const conns = store.get('connections').connections; const api = getBotApi(); const live = [];
    for (const id of Object.keys(conns).slice(0, 5)) {
      try {
        const bc = await api?.getBusinessConnection(id);
        if (bc) live.push({ id, isEnabled: Boolean(bc.is_enabled), canReply: Boolean(bc.rights?.can_reply ?? bc.can_reply) });
      } catch (err) { live.push({ id, error: describeTelegramError(err) }); }
    }
    res.json({ stored: Object.values(conns), live });
  }));
}
