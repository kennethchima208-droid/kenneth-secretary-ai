/** Shared, in-memory runtime status shown on the dashboard overview. */
export function createStatus(config) {
  return {
    startedAt: new Date().toISOString(),
    telegram: { state: config.botToken ? 'connecting' : 'not_configured', running: false, username: null, botId: null, error: null },
    groq: { state: config.groq.apiKey ? 'untested' : 'not_configured', model: config.groq.model, checkedAt: null, latencyMs: null, error: null },
  };
}
