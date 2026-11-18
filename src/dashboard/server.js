import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { ROOT_DIR } from '../config/env.js';
import { registerRoutes } from './routes.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SESSION_MS = 12 * 60 * 60 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  }
  return out;
}

export function createDashboard(deps) {
  const { config, log } = deps;
  const app = express();
  const sessions = new Map();
  const attempts = new Map();
  let server = null;

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  // Blocks DNS-rebinding attacks when the dashboard is bound to this computer only.
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.dashboard.host);
  app.use((req, res, next) => {
    if (!loopback) return next();
    const host = String(req.headers.host ?? '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return ['127.0.0.1', 'localhost', '::1'].includes(host) ? next() : res.status(403).json({ error: 'Forbidden host.' });
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(PUBLIC_DIR));

  const authed = (req) => {
    const token = parseCookies(req.headers.cookie).ks_session;
    const exp = token && sessions.get(token);
    if (!exp) return false;
    if (exp < Date.now()) { sessions.delete(token); return false; }
    return true;
  };

  app.post('/api/login', (req, res) => {
    const ip = req.socket.remoteAddress ?? 'unknown';
    const a = attempts.get(ip);
    if (a && a.until > Date.now() && a.count >= 5) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
    const given = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!crypto.timingSafeEqual(sha(given), sha(config.dashboard.password))) {
      attempts.set(ip, { count: (a && a.until > Date.now() ? a.count : 0) + 1, until: Date.now() + 10 * 60 * 1000 });
      log.add('system', 'Failed dashboard login attempt.');
      return res.status(401).json({ error: 'Wrong password.' });
    }
    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_MS);
    res.set('Set-Cookie', `ks_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    sessions.delete(parseCookies(req.headers.cookie).ks_session);
    res.set('Set-Cookie', 'ks_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => res.json({ authenticated: authed(req), ownerName: authed(req) ? deps.store.get('profile').name : undefined }));

  app.use('/api', (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'Please sign in.' })));
  registerRoutes(app, deps);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    log.add('failed', `Dashboard error: ${err.message}`);
    res.status(500).json({ error: 'Something went wrong. See Activity Logs.' });
  });

  return {
    app,
    start: () => new Promise((resolve, reject) => {
      server = app.listen(config.dashboard.port, config.dashboard.host);
      server.once('listening', resolve);
      server.once('error', (err) => reject(err.code === 'EADDRINUSE' ? new Error(`Port ${config.dashboard.port} is already in use. Change DASHBOARD_PORT in .env.`) : err));
    }),
    port: () => server?.address()?.port,
    stop: () => new Promise((resolve) => { if (!server) return resolve(); server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
