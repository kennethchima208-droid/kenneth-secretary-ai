import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/storage/store.js';

const defaults = { settings: { a: 1, b: 2 }, list: { items: [] } };

test('persists, reloads, and fills in new default keys', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksai-'));
  const s1 = new Store(dir, defaults); await s1.init();
  s1.get('settings').a = 5; await s1.save('settings'); await s1.flush();
  const s2 = new Store(dir, { ...defaults, settings: { a: 1, b: 2, c: 3 } }); await s2.init();
  assert.deepEqual(s2.get('settings'), { a: 5, b: 2, c: 3 });
  assert.deepEqual((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp')), []);
  await fs.rm(dir, { recursive: true, force: true });
});
test('corrupt file is backed up and replaced by defaults (no crash)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksai-'));
  await fs.writeFile(path.join(dir, 'settings.json'), '{ broken json');
  const s = new Store(dir, defaults); await s.init();
  assert.deepEqual(s.get('settings'), { a: 1, b: 2 });
  assert.ok((await fs.readdir(dir)).some((f) => f.startsWith('settings.json.corrupt-')));
  await fs.rm(dir, { recursive: true, force: true });
});
test('many concurrent saves end with valid JSON', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ksai-'));
  const s = new Store(dir, defaults); await s.init();
  await Promise.all(Array.from({ length: 30 }, (_, i) => { s.get('list').items.push(i); return s.save('list'); }));
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'list.json'), 'utf8')).items.length, 30);
  await fs.rm(dir, { recursive: true, force: true });
});
