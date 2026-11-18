/** Turns Telegram/grammY errors into readable text without importing grammY (keeps tests dependency-free). */
export function describeTelegramError(err) {
  const code = err?.error_code;
  if (code === 401) return 'Telegram rejected the bot token (401). Check BOT_TOKEN in .env.';
  if (code === 409) return 'Another copy of this bot is already running (409). Close the other instance.';
  if (code) return `Telegram error ${code}: ${err.description ?? err.message}`;
  if (err?.name === 'HttpError') return `Could not reach Telegram. Check your internet connection. (${err.message})`;
  return err?.message ?? String(err);
}
