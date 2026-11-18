export class AiError extends Error {
  /** kind: config | auth | rate_limit | unavailable | timeout | network | bad_request | empty | unknown */
  constructor(message, kind, { status = null, retryable = false, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}
