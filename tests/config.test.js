import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';

test('defaults: starts in preview + allowlist mode', () => {
  const c = loadConfig({ DASHBOARD_PASSWORD: 'longenough' });
  assert.equal(c.replyMode, 'preview');
  assert.equal(c.chatAccessMode, 'allowlist');
  assert.equal(c.groq.model, 'openai/gpt-oss-20b');
  assert.equal(c.groq.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(c.dashboard.host, '127.0.0.1');
  assert.equal(c.errors.length, 0);
});
test('invalid reply mode falls back to preview', () => {
  const c = loadConfig({ DASHBOARD_PASSWORD: 'longenough', REPLY_MODE: 'yolo' });
  assert.equal(c.replyMode, 'preview');
  assert.ok(c.warnings.some((w) => w.includes('REPLY_MODE')));
});
test('missing dashboard password is a fatal error', () => {
  assert.ok(loadConfig({}).errors.some((e) => e.includes('DASHBOARD_PASSWORD')));
});
test('owner id parsing and numeric clamping', () => {
  const c = loadConfig({ DASHBOARD_PASSWORD: 'longenough', OWNER_TELEGRAM_ID: '12345', MAX_HISTORY_MESSAGES: '999', REPLY_COOLDOWN_SECONDS: 'abc' });
  assert.equal(c.ownerTelegramId, 12345);
  assert.equal(c.maxHistory, 50);
  assert.equal(c.cooldownSeconds, 20);
});
