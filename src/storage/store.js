import fs from 'node:fs/promises';
import path from 'node:path';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Tiny JSON store. Each "collection" is one file in the data folder, cached in memory.
 * Writes are queued per file and are atomic (write temp file, then rename) so a crash
 * or power cut can never leave a half-written file.
 */
export class Store {
  #dir; #defaults; #data = new Map(); #queues = new Map();

  constructor(dir, defaults) { this.#dir = dir; this.#defaults = defaults; }

  #file(name) { return path.join(this.#dir, `${name}.json`); }

  async init() {
    await fs.mkdir(this.#dir, { recursive: true });
    for (const [name, def] of Object.entries(this.#defaults)) {
      const file = this.#file(name);
      let value; let needsWrite = false;
      try {
        value = JSON.parse(await fs.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') await fs.copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
        value = structuredClone(def);
        needsWrite = true;
      }
      if (isPlain(def) && isPlain(value)) value = { ...structuredClone(def), ...value };
      this.#data.set(name, value);
      if (needsWrite) await this.save(name);
    }
  }

  get(name) {
    if (!this.#data.has(name)) throw new Error(`Unknown collection: ${name}`);
    return this.#data.get(name);
  }

  save(name) {
    const json = JSON.stringify(this.get(name), null, 2);
    const prev = this.#queues.get(name) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(() => this.#write(name, json));
    this.#queues.set(name, next);
    return next;
  }

  /** Runs a synchronous mutation, then persists. */
  async update(name, fn) {
    const result = fn(this.get(name));
    await this.save(name);
    return result;
  }

  async flush() { await Promise.allSettled([...this.#queues.values()]); }

  async #write(name, json) {
    const file = this.#file(name);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, json, 'utf8');
    for (let attempt = 0; ; attempt++) {
      try { await fs.rename(tmp, file); return; }
      catch (err) {
        // Windows may briefly lock the file (antivirus, indexer). Retry a few times.
        if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) { await fs.rm(tmp, { force: true }); throw err; }
        await sleep(40 * (attempt + 1));
      }
    }
  }
}
