const PAGES = [['overview', 'Overview'], ['conversations', 'Conversations'], ['profile', 'Profile'], ['ai', 'AI Settings'], ['knowledge', 'Personal Knowledge'], ['testing', 'Testing'], ['logs', 'Activity Logs'], ['settings', 'Settings']];
const KNOWLEDGE_TYPES = [['fact', 'Personal fact'], ['business', 'Business information'], ['faq', 'FAQ'], ['service', 'Service'], ['price', 'Price'], ['instruction', 'Instruction']];
const state = { page: 'overview', timer: null, editing: null };
const $ = (s) => document.querySelector(s);

// Safe DOM builder: text is always inserted as text (never HTML), so Telegram messages cannot inject scripts.
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { showLogin(); throw new Error('Please sign in.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}
async function run(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}
const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
const badge = (text, kind = '') => h('span', { class: `badge ${kind}` }, text);
const stateBadge = (s) => ({ running: badge('Running', 'good'), ok: badge('Connected', 'good'), connecting: badge('Connecting…', 'warn'), untested: badge('Not tested yet', 'warn'), not_configured: badge('Not configured', 'bad'), error: badge('Error', 'bad'), stopped: badge('Stopped', 'bad') }[s] ?? badge(s));

// ---------- form helpers ----------
const field = (label, input, hint) => h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('small', {}, hint) : null);
const textInput = (name, v, ph) => h('input', { type: 'text', name, value: v ?? '', placeholder: ph ?? '' });
const numInput = (name, v, min, max) => h('input', { type: 'number', name, value: v, min, max });
const area = (name, v, rows = 4) => h('textarea', { name, rows }, v ?? '');
const select = (name, opts, v) => h('select', { name }, opts.map(([val, label]) => h('option', { value: val, selected: val === v }, label)));
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- pages ----------
const pages = {
  async overview() {
    const o = await api('/overview'); const mode = o.settings.replyMode;
    const setMode = async (m) => {
      if (m === 'auto' && !confirm('AUTO mode sends real replies from your Telegram account to allowed contacts. Continue?')) return;
      await api('/settings', { method: 'PUT', body: { replyMode: m } }); toast(`Reply mode: ${m.toUpperCase()}`); render();
    };
    const seg = (m) => h('button', { class: `seg m-${m}${mode === m ? ' active' : ''}`, onclick: (e) => run(e.target, () => setMode(m)) }, m.toUpperCase());
    const stat = (n, label) => h('div', { class: 'card stat' }, h('div', { class: 'num' }, n), h('div', { class: 'label' }, label));
    return h('div', {},
      h('div', { class: 'card' }, h('h2', {}, 'Automatic replies'),
        h('div', { class: 'seg-group' }, seg('off'), seg('preview'), seg('auto')),
        h('p', { class: 'muted' }, { off: 'OFF: nothing is generated or sent.', preview: 'PREVIEW: replies are generated and saved in Conversations, but never sent.', auto: 'AUTO: replies are generated and sent from your account to allowed contacts.' }[mode]),
        h('small', {}, `Chat access: ${o.settings.chatAccessMode === 'allowlist' ? 'only contacts you allow' : 'all private chats'}`)),
      h('div', { class: 'grid' },
        h('div', { class: 'card' }, h('h2', {}, 'Telegram bot'), stateBadge(o.telegram.state), h('p', { class: 'muted' }, o.telegram.username ? `@${o.telegram.username}` : '', o.telegram.error ?? '')),
        h('div', { class: 'card' }, h('h2', {}, 'Bot running'), o.telegram.running ? badge('Yes', 'good') : badge('No', 'bad')),
        h('div', { class: 'card' }, h('h2', {}, 'Groq API'), stateBadge(o.groq.state), h('p', { class: 'muted' }, o.groq.error ?? (o.groq.latencyMs ? `${o.groq.model} · ${o.groq.latencyMs} ms` : o.groq.model))),
        h('div', { class: 'card' }, h('h2', {}, 'Business connection'), o.connections.length ? o.connections.map((c) => h('div', {}, c.isEnabled ? badge('Connected', 'good') : badge('Disabled', 'bad'), ' ', c.canReply ? badge('can reply', 'good') : badge('cannot reply', 'bad'))) : badge('None received yet', 'warn'))),
      h('div', { class: 'grid' }, stat(o.conversations, 'Conversations'), stat(o.stats.received, 'Messages received'), stat(o.stats.generated, 'Replies generated'), stat(o.stats.sent, 'Replies sent'), stat(o.stats.failed, 'Failed responses')),
      o.warnings.length ? h('div', { class: 'card' }, h('h2', {}, 'Setup notes'), o.warnings.map((w) => h('p', { class: 'muted' }, w))) : null);
  },

  async conversations() {
    const { conversations } = await api('/conversations');
    const box = h('div', { class: 'card' });
    if (!conversations.length) box.append(h('p', { class: 'muted' }, 'No conversations yet. They appear here when someone messages your personal Telegram account while the bot is connected through Telegram Business.'));
    for (const c of conversations) {
      const toggle = (label, key) => h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: c[key], onchange: (e) => api(`/conversations/${c.key}`, { method: 'PATCH', body: { [key]: e.target.checked } }).then(() => toast('Saved')).catch((er) => { toast(er.message, true); e.target.checked = !e.target.checked; }) }), label);
      const detail = h('div', { class: 'hidden' });
      const viewBtn = h('button', { class: 'btn', onclick: async (e) => {
        if (!detail.classList.contains('hidden')) { detail.classList.add('hidden'); return; }
        await run(e.target, async () => {
          const full = await api(`/conversations/${c.key}`);
          detail.replaceChildren(...full.messages.map((m) => h('div', { class: `bubble ${m.role}` }, h('span', { class: 'tag' }, `${{ user: c.name, assistant: 'Assistant', owner: 'You' }[m.role]} · ${when(m.at)}${m.status ? ` · ${m.status === 'preview' ? 'DRAFT (not sent)' : m.status}` : ''}`), m.text)));
          detail.classList.remove('hidden');
        });
      } }, 'View messages');
      box.append(h('div', { class: 'conv' },
        h('div', { class: 'row between' }, h('strong', {}, c.name, c.username ? h('span', { class: 'meta' }, ` @${c.username}`) : null), h('span', { class: 'meta' }, `Started ${when(c.createdAt)}`)),
        h('div', { class: 'meta' }, 'Last message: ', c.lastMessage?.text ?? '—'),
        h('div', { class: 'meta' }, 'Last reply: ', c.lastReply ? `${c.lastReply.text}${c.lastReply.status === 'preview' ? ' (draft)' : c.lastReply.status === 'failed' ? ' (failed)' : ''}` : '—'),
        h('div', { class: 'row' }, toggle('Allowed to auto-reply', 'allowed'), toggle('Paused', 'paused'), viewBtn), detail));
    }
    return h('div', {}, h('div', { class: 'row between' }, h('p', { class: 'muted' }, 'Tick "Allowed" for each contact the assistant may answer (allowlist mode).'), h('button', { class: 'btn', onclick: render }, 'Refresh')), box);
  },

  async profile() {
    const p = await api('/profile');
    const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); run(e.submitter, async () => { await api('/profile', { method: 'PUT', body: formData(form) }); toast('Profile saved'); }); } },
      h('div', { class: 'form-grid' }, field('Name', textInput('name', p.name)), field('Professions (one per line)', area('professions', p.professions.join('\n'), 3))),
      field('About me', area('about', p.about)), field('My work', area('work', p.work)), field('My businesses', area('businesses', p.businesses)), field('Services I offer', area('services', p.services)),
      h('div', { class: 'form-grid' }, field('Communication style', area('communicationStyle', p.communicationStyle, 3)), field('Working hours', area('workingHours', p.workingHours, 3), 'Example: Mon-Fri 9am-5pm Lagos time')),
      field('Important personal facts', area('importantFacts', p.importantFacts)),
      field('Things the AI must never say', area('neverSay', p.neverSay, 3)), field('Things the AI must ask me to confirm', area('confirmFirst', p.confirmFirst, 3), 'Example: prices, appointments, repair deadlines'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save profile'));
    return form;
  },

  async ai() {
    const s = await api('/settings');
    const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); run(e.submitter, async () => { await api('/settings', { method: 'PUT', body: formData(form) }); toast('AI settings saved'); }); } },
      field('AI personality', area('personality', s.personality, 3)),
      field('System instructions', area('systemInstructions', s.systemInstructions, 6), 'Extra rules, for example: "Always ask for the device model when someone mentions a repair."'),
      h('div', { class: 'form-grid' },
        field('Response style', select('responseStyle', [['brief', 'Brief (1-2 sentences)'], ['balanced', 'Balanced (2-4 sentences)'], ['detailed', 'Detailed (short paragraph)']], s.responseStyle)),
        field('Speak as', select('speakAs', [['assistant', "Kenneth's assistant (recommended, honest)"], ['first_person', 'Kenneth himself (first person)']], s.speakAs)),
        field('Maximum response length (characters)', numInput('maxResponseChars', s.maxResponseChars, 100, 2000)),
        field('Conversation history length (messages)', numInput('historyLength', s.historyLength, 0, 50))),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save AI settings'));
    return form;
  },

  async knowledge() {
    const { items } = await api('/knowledge'); const editing = items.find((i) => i.id === state.editing);
    const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); run(e.submitter, async () => {
      await api(editing ? `/knowledge/${editing.id}` : '/knowledge', { method: editing ? 'PUT' : 'POST', body: formData(form) });
      state.editing = null; toast('Saved'); render();
    }); } },
      h('h2', {}, editing ? 'Edit item' : 'Add knowledge'),
      h('div', { class: 'form-grid' }, field('Type', select('type', KNOWLEDGE_TYPES, editing?.type ?? 'fact')), field('Title / question', textInput('title', editing?.title, 'e.g. Laptop screen replacement'))),
      field('Content / answer', area('content', editing?.content, 4)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, editing ? 'Update' : 'Add'), editing ? h('button', { class: 'btn', type: 'button', onclick: () => { state.editing = null; render(); } }, 'Cancel') : null));
    const list = h('div', { class: 'card' }, h('h2', {}, `Saved knowledge (${items.length})`));
    if (!items.length) list.append(h('p', { class: 'muted' }, 'Nothing yet. Add your services, prices, FAQs and facts so the AI never has to guess.'));
    for (const i of items) list.append(h('div', { class: 'conv' },
      h('div', { class: 'row between' }, h('div', {}, badge(KNOWLEDGE_TYPES.find((t) => t[0] === i.type)?.[1] ?? i.type), ' ', h('strong', {}, i.title)),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { state.editing = i.id; render(); } }, 'Edit'),
          h('button', { class: 'btn danger', onclick: (e) => confirm('Delete this item?') && run(e.target, async () => { await api(`/knowledge/${i.id}`, { method: 'DELETE' }); render(); }) }, 'Delete'))),
      h('div', { class: 'meta' }, i.content)));
    return h('div', {}, form, list);
  },

  async testing() {
    const out = h('div', { class: 'output' }, 'Results appear here.');
    const show = (text, bad) => { out.textContent = text; out.className = `output${bad ? ' bad' : ''}`; };
    const msg = h('textarea', { rows: 3, placeholder: 'Type a sample message a contact might send, e.g. "Hi, how much do you charge to fix a laptop screen?"' });
    const contact = h('input', { type: 'text', placeholder: 'Contact name (optional)' });
    const test = (label, fn) => h('button', { class: 'btn', onclick: (e) => run(e.target, async () => { show('Working…'); try { show(await fn()); } catch (er) { show(er.message, true); } }) }, label);
    return h('div', {},
      h('div', { class: 'card' }, h('h2', {}, 'Test the AI'), h('p', { class: 'muted' }, 'Uses the same AI code and prompt as the real Telegram bot. Nothing is ever sent to Telegram from here.'),
        field('Sample message', msg), field('Contact name', contact),
        h('button', { class: 'btn primary', onclick: (e) => run(e.target, async () => {
          show('Asking Groq…');
          const r = await api('/test/ai', { method: 'POST', body: { message: msg.value, contactName: contact.value } });
          r.ok ? show(`${r.reply}\n\n— ${r.model} · ${r.elapsedMs} ms · ${r.knowledgeUsed} knowledge items used`) : show(`AI test failed: ${r.error}`, true);
        }) }, 'TEST AI')),
      h('div', { class: 'card' }, h('h2', {}, 'Connection tests'), h('div', { class: 'row' },
        test('Test Groq connection', async () => { const r = await api('/test/groq', { method: 'POST' }); if (!r.ok) throw new Error(`Groq test failed: ${r.error}`); return `Groq works. Model ${r.model}, ${r.latencyMs} ms, replied "${r.reply}".`; }),
        test('Test Telegram bot token', async () => { const r = await api('/test/telegram', { method: 'POST' }); if (!r.ok) throw new Error(`Telegram test failed: ${r.error}`); return `Bot token works: @${r.username} (${r.name}).${r.supportsBusiness === false ? '\nWarning: Business Mode is not enabled for this bot in BotFather.' : ''}`; }),
        test('Business connection status', async () => { const r = await api('/test/business'); return r.stored.length ? r.stored.map((c) => `${c.userName ?? c.userId}: ${c.isEnabled ? 'enabled' : 'disabled'}, can reply: ${c.canReply ? 'yes' : 'NO'}`).join('\n') + (r.live.length ? `\n\nLive check: ${JSON.stringify(r.live)}` : '') : 'No Telegram Business connection has been received yet. Connect the bot in Telegram: Settings > Business > Chatbots.'; }))),
      h('div', { class: 'card' }, h('h2', {}, 'Result'), out));
  },

  async logs() {
    const type = state.logType ?? '';
    const { entries } = await api(`/logs?limit=200${type ? `&type=${type}` : ''}`);
    const filter = select('type', [['', 'All events'], ['incoming', 'Incoming messages'], ['ai_response', 'AI responses'], ['sent', 'Replies sent'], ['preview', 'Drafts'], ['failed', 'Failures'], ['connection', 'Telegram connection'], ['ai_error', 'AI provider errors'], ['skipped', 'Skipped'], ['system', 'System']], type);
    filter.addEventListener('change', () => { state.logType = filter.value; render(); });
    const box = h('div', { class: 'card' }, h('div', { class: 'row between' }, h('div', {}, filter), h('button', { class: 'btn', onclick: render }, 'Refresh')));
    if (!entries.length) box.append(h('p', { class: 'muted' }, 'No activity yet.'));
    for (const e of entries) box.append(h('div', { class: `log${e.level === 'error' ? ' err' : ''}` }, h('span', { class: 'meta' }, when(e.at)), badge(e.type, e.level === 'error' ? 'bad' : ''), h('span', { class: 'msg' }, e.message)));
    return box;
  },

  async settings() {
    const [s, info] = await Promise.all([api('/settings'), api('/info')]);
    const form = h('form', { class: 'card', onsubmit: (e) => { e.preventDefault(); const d = formData(form); d.typingIndicator = form.elements.typingIndicator.checked; run(e.submitter, async () => { await api('/settings', { method: 'PUT', body: d }); toast('Settings saved'); render(); }); } },
      h('h2', {}, 'Reply behaviour'),
      h('div', { class: 'form-grid' },
        field('Reply mode', select('replyMode', [['off', 'OFF - never reply'], ['preview', 'PREVIEW - save drafts only'], ['auto', 'AUTO - send replies']], s.replyMode)),
        field('Which chats may be answered', select('chatAccessMode', [['allowlist', 'Only contacts I allow (safe)'], ['all', 'All private chats']], s.chatAccessMode)),
        field('Reply cooldown (seconds)', numInput('cooldownSeconds', s.cooldownSeconds, 0, 3600), 'No second reply to the same contact within this time.')),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', name: 'typingIndicator', checked: s.typingIndicator }), 'Show "typing…" before replying'),
      h('div', {}, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')));
    const row = (k, v) => h('div', { class: 'row between conv' }, h('span', { class: 'muted' }, k), h('span', {}, v));
    return h('div', {}, form, h('div', { class: 'card' }, h('h2', {}, 'Connection information'),
      row('Dashboard address', `${info.dashboardHost}:${info.dashboardPort}`), row('Owner', info.ownerName), row('Timezone', info.timezone),
      row('Bot', info.botUsername ? `@${info.botUsername}` : 'not connected'), row('Bot token', info.botTokenSet ? 'set in .env' : 'MISSING'), row('Owner Telegram ID', info.ownerIdSet ? 'set' : 'MISSING (owner commands disabled)'),
      row('Groq key', info.groqKeySet ? 'set in .env' : 'MISSING'), row('Groq model', info.model), row('Groq endpoint', info.groqBaseUrl),
      h('small', {}, 'Keys and passwords are only ever stored in the .env file and are never shown here.')));
  },
};

// ---------- shell ----------
async function render() {
  clearInterval(state.timer);
  $('#title').textContent = PAGES.find((p) => p[0] === state.page)[1];
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === state.page));
  try {
    $('#view').replaceChildren(await pages[state.page]());
    const s = await api('/settings'); const pill = $('#mode-pill'); pill.textContent = `Replies: ${s.replyMode.toUpperCase()}`; pill.className = `pill ${s.replyMode}`;
    if (state.page === 'overview' || state.page === 'logs') state.timer = setInterval(() => { if (!document.hidden && !document.activeElement?.matches('select')) render(); }, 10000);
  } catch (e) { if (e.message !== 'Please sign in.') $('#view').replaceChildren(h('div', { class: 'card error' }, e.message)); }
}

function showLogin() { clearInterval(state.timer); $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#login-password').focus(); }
function showApp() { $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); render(); }

$('#nav').append(...PAGES.map(([id, label]) => h('button', { 'data-page': id, onclick: () => { state.page = id; render(); } }, label)));
$('#logout').addEventListener('click', async () => { await api('/logout', { method: 'POST' }).catch(() => {}); showLogin(); });
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#login-error').textContent = '';
  try { await api('/login', { method: 'POST', body: { password: $('#login-password').value } }); $('#login-password').value = ''; showApp(); }
  catch (err) { $('#login-error').textContent = err.message; }
});
api('/session').then((s) => (s.authenticated ? showApp() : showLogin())).catch(showLogin);
