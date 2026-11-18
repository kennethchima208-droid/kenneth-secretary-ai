import test from 'node:test';
import assert from 'node:assert/strict';
import { baseConfig, makeHarness } from './helpers.js';

let hasExpress = true;
try { await import('express'); } catch { hasExpress = false; }

test('dashboard: auth required, test-AI never touches Telegram, secrets never leak', { skip: !hasExpress && 'express is not installed (run npm install)' }, async () => {
  const { createDashboard } = await import('../src/dashboard/server.js');
  const h = await makeHarness();
  const config = { ...baseConfig, dashboard: { host: '127.0.0.1', port: 0, password: 'correct-horse-battery' }, groq: { apiKey: 'gsk_SECRETSECRETSECRET1234', model: 'm', baseUrl: 'x' }, botToken: '123456789:SECRETTOKENSECRETTOKENSECRETTOKEN12', warnings: [], ownerTelegramId: 1 };
  const status = { telegram: { state: 'running', running: true }, groq: { state: 'ok' } };
  const ai = { generateReply: async () => ({ reply: 'Test reply', model: 'm', knowledgeUsed: 0, elapsedMs: 5 }), ping: async () => ({ ok: true }) };
  const d = createDashboard({ config, store: h.store, ai, status, log: h.log, getBotApi: () => h.api });
  await d.start();
  const base = `http://127.0.0.1:${d.port()}`;
  try {
    assert.equal((await fetch(`${base}/api/overview`)).status, 401);
    assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) })).status, 401);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const get = (p) => fetch(`${base}${p}`, { headers: { cookie } });
    const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ov = await (await get('/api/overview')).text();
    assert.ok(!ov.includes('SECRET'));
    const t = await (await post('/api/test/ai', { message: 'hello' })).json();
    assert.equal(t.reply, 'Test reply');
    assert.equal(h.calls.sendMessage.length, 0);
    assert.equal((await post('/api/test/ai', { message: '' })).status, 400);
    assert.equal((await (await fetch(`${base}/api/settings`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ replyMode: 'bogus' }) })).status), 400);
  } finally { await d.stop(); await h.cleanup(); }
});
