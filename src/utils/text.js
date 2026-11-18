const STOP = new Set('the and for you your are was were what when where how why can could would will with this that have has not but from about any our out get got please hello thanks thank'.split(' '));

export function tokenize(text) {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
}

export function clip(text, max) {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Cleans model output into a plain Telegram message within the character limit. */
export function finalizeReply(raw, maxChars) {
  let t = String(raw ?? '').replace(/\r/g, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^["“]+|["”]+$/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length > maxChars) {
    const cut = t.slice(0, maxChars);
    const idx = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('\n'));
    t = idx > maxChars * 0.5 ? cut.slice(0, idx + 1).trim() : `${cut.trim()}…`;
  }
  return t;
}
