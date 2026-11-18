import { buildMessages } from './prompt.js';
import { finalizeReply } from '../utils/text.js';

/** The single AI entry point. The Telegram handler and the dashboard "Test AI" button both call generateReply(). */
export function createAiService({ store, config, groq, status, now = () => new Date() }) {
  function markOk(ms) { Object.assign(status.groq, { state: 'ok', checkedAt: new Date().toISOString(), latencyMs: ms, error: null }); }
  function markFail(err) { Object.assign(status.groq, { state: err.kind === 'config' ? 'not_configured' : 'error', checkedAt: new Date().toISOString(), error: err.message }); }

  async function generateReply({ incomingText, history = [], contactName }) {
    const settings = store.get('settings');
    const { messages, knowledgeUsed } = buildMessages({
      profile: store.get('profile'), settings, knowledge: store.get('knowledge').items,
      history, incomingText, contactName, timezone: config.timezone, now: now(),
    });
    const t0 = Date.now();
    try {
      const out = await groq.complete({ messages });
      const reply = finalizeReply(out.text, settings.maxResponseChars);
      if (!reply) throw Object.assign(new Error('Groq returned an empty reply.'), { kind: 'empty' });
      markOk(Date.now() - t0);
      return { reply, model: out.model, usage: out.usage, knowledgeUsed, elapsedMs: Date.now() - t0 };
    } catch (err) { markFail(err); throw err; }
  }

  async function ping() {
    const t0 = Date.now();
    try {
      const out = await groq.complete({ messages: [{ role: 'user', content: 'Reply with exactly: OK' }], maxTokens: 200, temperature: 0 });
      markOk(Date.now() - t0);
      return { ok: true, model: out.model, latencyMs: Date.now() - t0, reply: out.text.slice(0, 40) };
    } catch (err) { markFail(err); throw err; }
  }

  return { generateReply, ping };
}
