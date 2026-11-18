# Kenneth Secretary AI

A personal AI secretary for Telegram. It answers private messages sent to **your personal Telegram account** (through **Telegram Business → Chatbots**), using Groq for the AI and a dashboard on your own laptop to control it.

Replies are sent through the official Bot API with your `business_connection_id`, so they appear as sent **from your account**. There is no userbot, QR login or password login.

> **Important:** messaging the bot directly does **not** test the Telegram Business feature. The bot's own chat is only for owner commands (`/start`, `/status`, `/help`). Real AI replies only happen when *someone else* messages *your personal account*. To test the AI without another phone, use **Testing → TEST AI** in the dashboard.

## What you need

- Windows 10/11 and **Node.js 20 or newer** (Node 24 works) — check with `node -v`
- A **Telegram Premium** account (Telegram Business / Chatbots is a Premium feature)
- A free **Groq API key** from <https://console.groq.com/keys>

## 1. Install (PowerShell)

```powershell
cd path\to\kenneth-secretary-ai
npm install
Copy-Item .env.example .env
notepad .env
```

If PowerShell says scripts are disabled, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd install` instead.

## 2. Create the bot (BotFather)

1. In Telegram, open **@BotFather** and send `/newbot`. Pick a name and a username ending in `bot`.
2. Copy the token it gives you into `BOT_TOKEN=` in `.env`.
3. Send `/mybots` → choose your bot → **Bot Settings** → **Business Mode** → turn it **on**.
4. Get your own numeric Telegram ID from **@userinfobot** and put it in `OWNER_TELEGRAM_ID=`.

## 3. Fill in `.env`

Required: `BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `GROQ_API_KEY`, `DASHBOARD_PASSWORD` (choose a strong one). Leave the rest as is unless you know why to change it. Never share or commit `.env` (it is already in `.gitignore`).

## 4. Start the app

```powershell
npm start
```

Open **http://127.0.0.1:3000** and sign in with `DASHBOARD_PASSWORD`. The dashboard only listens on your laptop unless you change `DASHBOARD_HOST`.

For development with auto-restart: `npm run dev`.

## 5. Connect the bot to your Telegram account

On your phone: **Settings → Telegram Business → Chatbots** → enter the bot's username → choose which chats it may access → make sure **"Reply to messages"** is enabled → save.

Telegram then sends a *business connection* to the bot. Check **Overview** (Business connection should say *Connected, can reply*) or **Testing → Business connection status**.

## 6. Test safely, then go live

1. **Testing** page → *Test Groq connection*, *Test Telegram bot token*, then type a sample message and press **TEST AI**. This never sends anything to Telegram.
2. Fill in **Profile** and **Personal Knowledge** (services, prices, FAQs). The AI only states prices and facts you have entered; otherwise it says you will confirm.
3. The app starts in **PREVIEW** mode: replies are generated and saved as drafts (Conversations → View messages) but **not sent**.
4. Ask a friend to message you. The conversation appears in **Conversations**. Tick **Allowed to auto-reply** for that contact (the default access mode is *allowlist*).
5. When the drafts look right, switch to **AUTO** on the Overview page. Use **Paused** on a contact to silence one chat, or **OFF** to stop everything.

Reply cooldown (default 20 s) means a contact who sends several messages in a row gets one reply, not many.

## Reply modes

| Mode | What happens |
|---|---|
| OFF | Messages are recorded; nothing is generated or sent |
| PREVIEW | Reply is generated and saved as a draft; not sent |
| AUTO | Reply is generated and sent from your account (allowed contacts only) |

## Tests

```powershell
npm test            # automated tests (Node's built-in runner, mock Telegram API)
npm run check       # verifies every import resolves
npm run check:live  # REAL checks: Groq, AI reply function, Telegram bot token (needs .env + internet)
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "DASHBOARD_PASSWORD is empty" on start | Set it in `.env` |
| Overview shows Telegram **Error: 401** | `BOT_TOKEN` is wrong; copy it again from BotFather |
| Error **409** | Another copy of the bot is running (close other terminals) |
| No Business connection appears | Enable Business Mode in BotFather, then re-add the bot in Telegram → Settings → Business → Chatbots |
| "cannot reply" | In Chatbots settings enable **Reply to messages** |
| Messages appear but no replies | Contact not allowed (allowlist), contact paused, mode is OFF/PREVIEW, or cooldown. Check **Activity Logs → Skipped** |
| Groq **401** | `GROQ_API_KEY` is wrong |
| Groq **429** | Rate limit; the app retries briefly, then logs the error and sends nothing |
| Port in use | Change `DASHBOARD_PORT` in `.env` |
| Bot answers `/status` but not customers | Expected. Customers must message your personal account, not the bot |

## Notes and limits

- Only **text** (and captions) get replies. Photos, voice notes and stickers are logged and skipped.
- The assistant speaks as *Kenneth's assistant* by default (honest and safer). You can switch to first person under **AI Settings → Speak as**. In either mode it will not claim to be human if sincerely asked.
- If Groq fails, **no reply is sent**; the error is recorded in Activity Logs.
- Data is stored as JSON files in `data/` (written atomically). API keys and tokens are only in `.env` and are redacted from logs.

## Project layout

```
src/index.js        entry point
src/config/         .env parsing and validation
src/telegram/       grammY bot, business-message filters and handler
src/ai/             Groq client, prompt builder, AI service
src/dashboard/      Express server, auth, API routes
src/storage/        JSON store, activity log, conversations
src/utils/          validation, redaction, text helpers
public/             dashboard frontend (HTML, CSS, vanilla JS)
tests/              node:test suites
scripts/            import checker, live checks
```
