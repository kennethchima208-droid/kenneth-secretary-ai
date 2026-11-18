import { randomUUID } from 'node:crypto';

const ERROR_TYPES = new Set(['failed', 'ai_error']);
const MAX_ENTRIES = 1000;

/** Activity log. Everything is passed through the redactor so secrets can never be stored or shown. */
export function createActivityLog(store, redact, { echo = true } = {}) {
  return {
    add(type, message, meta = undefined) {
      const entry = {
        id: randomUUID(), at: new Date().toISOString(), type,
        level: ERROR_TYPES.has(type) ? 'error' : 'info',
        message: redact(String(message)).slice(0, 500),
        meta: meta === undefined ? undefined : JSON.parse(redact(meta) || 'null'),
      };
      const { entries } = store.get('logs');
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
      store.save('logs').catch(() => {});
      if (echo) console.log(`[${entry.at}] ${type}: ${entry.message}`);
      return entry;
    },
    list({ limit = 200, type } = {}) {
      const all = store.get('logs').entries;
      return (type ? all.filter((e) => e.type === type) : all).slice(-limit).reverse();
    },
  };
}
