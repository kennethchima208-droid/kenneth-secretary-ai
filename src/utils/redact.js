/** Returns a function that removes known secrets (and anything shaped like one) from text. */
export function createRedactor(secrets = []) {
  const list = secrets.filter((s) => typeof s === 'string' && s.length >= 6);
  return (value) => {
    let text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    for (const s of list) text = text.split(s).join('[hidden]');
    return text
      .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[hidden-bot-token]')
      .replace(/\bgsk_[A-Za-z0-9]{20,}\b/g, '[hidden-groq-key]');
  };
}
