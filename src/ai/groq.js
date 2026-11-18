import { AiError } from './errors.js';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

function classify(status, message, retryAfterMs) {
  if (status === 401 || status === 403) return new AiError(`Groq rejected the API key (${status}). Check GROQ_API_KEY.`, 'auth', { status });
  if (status === 429) return new AiError(`Groq rate limit reached (429). ${message}`.trim(), 'rate_limit', { status, retryable: true, retryAfterMs });
  if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504)
    return new AiError(`Groq is temporarily unavailable (${status}). ${message}`.trim(), 'unavailable', { status, retryable: true, retryAfterMs });
  if (status === 400 || status === 404 || status === 413 || status === 422)
    return new AiError(`Groq rejected the request (${status}): ${message}`, 'bad_request', { status });
  return new AiError(`Groq error ${status}: ${message}`, 'unknown', { status });
}

/** Minimal client for Groq's OpenAI-compatible /chat/completions endpoint. */
export function createGroqClient({ apiKey, baseUrl, model, timeoutMs = 20000, retries = 2, fetchImpl = globalThis.fetch, sleep = defaultSleep }) {
  async function once({ messages, maxTokens, temperature }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const body = { model, messages, temperature, max_completion_tokens: maxTokens, stream: false };
    if (/gpt-oss/i.test(model)) body.reasoning_effort = 'low';
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw new AiError(`Groq did not answer within ${Math.round(timeoutMs / 1000)} seconds.`, 'timeout', { retryable: true });
      throw new AiError(`Could not reach Groq (${err?.cause?.code ?? err?.message ?? 'network error'}). Check your internet connection.`, 'network', { retryable: true });
    } finally { clearTimeout(timer); }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message ?? ''; } catch { /* ignore */ }
      const ra = Number(res.headers?.get?.('retry-after'));
      throw classify(res.status, String(detail).slice(0, 200), Number.isFinite(ra) && ra > 0 ? ra * 1000 : null);
    }
    let data;
    try { data = await res.json(); } catch { throw new AiError('Groq returned an unreadable response.', 'unknown'); }
    const choice = data?.choices?.[0];
    const text = choice?.message?.content?.trim();
    if (!text) throw new AiError(`Groq returned an empty reply (finish reason: ${choice?.finish_reason ?? 'unknown'}).`, 'empty');
    return { text, model: data.model ?? model, usage: data.usage ?? null };
  }

  async function complete({ messages, maxTokens = 1500, temperature = 0.6 }) {
    if (!apiKey) throw new AiError('GROQ_API_KEY is not set in .env.', 'config');
    for (let attempt = 0; ; attempt++) {
      try { return await once({ messages, maxTokens, temperature }); }
      catch (err) {
        if (!(err instanceof AiError) || !err.retryable || attempt >= retries) throw err;
        await sleep(Math.min(err.retryAfterMs ?? 800 * 2 ** attempt, 8000));
      }
    }
  }

  return { complete, model, isConfigured: Boolean(apiKey) };
}
