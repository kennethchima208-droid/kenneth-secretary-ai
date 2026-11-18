import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroqClient } from '../src/ai/groq.js';

const ok = (text = 'Hi') => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ model: 'm', choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
const fail = (status, message = 'nope', headers = {}) => ({ ok: false, status, headers: new Headers(headers), json: async () => ({ error: { message } }) });
const client = (responses, extra = {}) => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); const r = responses.shift(); if (r instanceof Error) throw r; return r; };
  return { calls, c: createGroqClient({ apiKey: 'gsk_testkey123456', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-20b', fetchImpl, sleep: async () => {}, ...extra }) };
};
const msgs = [{ role: 'user', content: 'hi' }];

test('sends the right request to the Groq OpenAI-compatible endpoint', async () => {
  const { c, calls } = client([ok('Hello!')]);
  const out = await c.complete({ messages: msgs });
  assert.equal(out.text, 'Hello!');
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer gsk_testkey123456');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'openai/gpt-oss-20b');
  assert.equal(body.reasoning_effort, 'low');
});
test('429 is retried, then succeeds', async () => {
  const { c, calls } = client([fail(429, 'slow down', { 'retry-after': '1' }), ok('after retry')]);
  assert.equal((await c.complete({ messages: msgs })).text, 'after retry');
  assert.equal(calls.length, 2);
});
test('503 gives up after limited retries with a clear error', async () => {
  const { c, calls } = client([fail(503), fail(503), fail(503), fail(503)]);
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'unavailable' && e.status === 503);
  assert.equal(calls.length, 3);
});
test('401 is not retried and the message does not contain the key', async () => {
  const { c, calls } = client([fail(401, 'Invalid API Key')]);
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'auth' && !e.message.includes('gsk_testkey'));
  assert.equal(calls.length, 1);
});
test('400 is not retried', async () => {
  const { c, calls } = client([fail(400, 'bad model')]);
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'bad_request');
  assert.equal(calls.length, 1);
});
test('network failure is retried then reported', async () => {
  const { c } = client([new Error('fetch failed'), new Error('fetch failed'), new Error('fetch failed')]);
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'network');
});
test('timeout aborts the request', async () => {
  const fetchImpl = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const c = createGroqClient({ apiKey: 'gsk_testkey123456', baseUrl: 'http://x', model: 'm', timeoutMs: 20, retries: 0, fetchImpl, sleep: async () => {} });
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'timeout');
});
test('empty completion is an error, never a blank reply', async () => {
  const { c } = client([ok('   ')]);
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'empty');
});
test('missing key fails fast without a network call', async () => {
  const { calls, c } = client([], { apiKey: '' });
  await assert.rejects(c.complete({ messages: msgs }), (e) => e.kind === 'config');
  assert.equal(calls.length, 0);
});
