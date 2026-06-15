import http from 'node:http';
import { readFile, mkdir, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createCryptoBox, createTotpSecret, hashPassword, randomToken, sha256, strongPassword, verifyPassword, verifyTotp } from './lib/security.mjs';
import { createStore, CRM_STATUSES, resolveSubmissionFormType } from './lib/crm-store.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(rootDir, 'data');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';
const idleMinutes = 30;
const absoluteSessionHours = 8;
const maxBodySize = 12 * 1024 * 1024;
const maxPolicyFileSize = 8 * 1024 * 1024;

await mkdir(dataDir, { recursive: true });
const encryptionKeyPath = path.join(dataDir, 'encryption.key');
let encryptionKey;
if (process.env.DATA_ENCRYPTION_KEY) encryptionKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64');
else if (existsSync(encryptionKeyPath)) encryptionKey = Buffer.from((await readFile(encryptionKeyPath, 'utf8')).trim(), 'base64');
else {
  encryptionKey = crypto.randomBytes(32);
  await writeFile(encryptionKeyPath, encryptionKey.toString('base64'), { mode: 0o600 });
  await chmod(encryptionKeyPath, 0o600).catch(() => {});
}

const cryptoBox = createCryptoBox(encryptionKey);
const store = createStore(path.join(dataDir, 'lamkubezpieczenia.sqlite'), cryptoBox);
store.normalizeSubmissionFormTypes();
if (!store.db.prepare('SELECT COUNT(*) AS count FROM admins').get().count) {
  const initialPassword = process.env.ADMIN_PASSWORD;
  if (!strongPassword(initialPassword)) throw new Error('Przy pierwszym uruchomieniu ustaw silne ADMIN_PASSWORD: minimum 14 znaków, mała i wielka litera, cyfra oraz znak specjalny.');
  store.ensureAdmin(process.env.ADMIN_USERNAME || 'admin', initialPassword);
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self' data: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(isProduction ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
  };
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}

function sendBuffer(res, status, buffer, headers = {}) {
  res.writeHead(status, { ...securityHeaders(), 'Cache-Control': 'no-store', ...headers });
  res.end(buffer);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf('=');
    return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
  }));
}

function clientIp(req) {
  if (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodySize) throw Object.assign(new Error('Przekroczono limit danych.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('Nieprawidłowy format danych.'), { status: 400 }); }
}

const rateBuckets = new Map();
function isRateLimited(key, limit, windowMs) {
  const current = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= current) {
    rateBuckets.set(key, { count: 1, resetAt: current + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function sessionFor(req) {
  const rawToken = parseCookies(req.headers.cookie).lamk_session;
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const idleCutoff = new Date(Date.now() - idleMinutes * 60_000).toISOString();
  const session = store.getSession(tokenHash, idleCutoff);
  if (!session) {
    store.deleteSession(tokenHash);
    return null;
  }
  store.touchSession(tokenHash);
  return { ...session, rawToken };
}

function requireAdmin(req, res, { csrf = false } = {}) {
  const session = sessionFor(req);
  if (!session) {
    sendJson(res, 401, { error: 'Sesja wygasła. Zaloguj się ponownie.' });
    return null;
  }
  if (csrf && req.headers['x-csrf-token'] !== session.csrf_token) {
    sendJson(res, 403, { error: 'Token bezpieczeństwa jest nieprawidłowy.' });
    return null;
  }
  return session;
}

function validOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
}

function loginCookie(rawToken) {
  return `lamk_session=${encodeURIComponent(rawToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${absoluteSessionHours * 3600}${isProduction ? '; Secure' : ''}`;
}

async function sendNewSubmissionNotification(id, formType) {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATION_EMAIL || !process.env.NOTIFICATION_FROM) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.NOTIFICATION_FROM,
        to: [process.env.NOTIFICATION_EMAIL],
        subject: 'Otrzymano nowe zgłoszenie',
        text: `Otrzymano nowe zgłoszenie (${formType}), numer ${id}. Pełne dane są dostępne wyłącznie po zalogowaniu do panelu administratora.`
      })
    });
  } catch (error) { console.error('Nie udało się wysłać powiadomienia e-mail:', error.message); }
}

function formatPolicyDate(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-');
  return day && month && year ? `${day}.${month}.${year}` : String(value || '');
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeEmailForComparison(value) {
  return String(value || '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function sendEmail({ to, subject, text, html, attachments = [], idempotencyKey, headers = {}, from: customFrom }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = customFrom || process.env.POLICY_EMAIL_FROM || 'LAMKUBEZPIECZENIA.pl <kontakt@lamkubezpieczenia.pl>';
  if (!apiKey) throw Object.assign(new Error('Wysyłka e-mail nie jest jeszcze skonfigurowana. Ustaw RESEND_API_KEY i zweryfikuj adres kontakt@lamkubezpieczenia.pl.'), { status: 503 });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
    },
    body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), attachments, ...(Object.keys(headers).length ? { headers } : {}) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || 'Dostawca poczty odrzucił wiadomość.'), { status: 502 });
  return result;
}

async function handleApi(req, res, url) {
  if (!validOrigin(req)) return sendJson(res, 403, { error: 'Niedozwolone źródło żądania.' });
  const ip = clientIp(req);

  if (req.method === 'POST' && url.pathname === '/api/submissions') {
    if (isRateLimited(`submission:${ip}`, 20, 60 * 60_000)) return sendJson(res, 429, { error: 'Zbyt wiele zgłoszeń. Spróbuj ponownie później.' });
    const body = await readJson(req);
    if (body.website) return sendJson(res, 202, { ok: true });
    if (body.consents?.privacy_accepted !== true) return sendJson(res, 400, { error: 'Wymagana jest akceptacja Regulaminu i Polityki Prywatności.' });
    if (!body.form_type || typeof body.form_type !== 'string' || body.form_type.length > 100) return sendJson(res, 400, { error: 'Nieprawidłowy typ formularza.' });
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return sendJson(res, 400, { error: 'Brak danych formularza.' });
    const formType = resolveSubmissionFormType(body.form_type, body.data);
    const id = store.createSubmission({ ...body, form_type: formType }, ip, String(req.headers['user-agent'] || '').slice(0, 500));
    void sendNewSubmissionNotification(id, formType);
    return sendJson(res, 201, { ok: true, submission_id: id });
  }

  if (req.method === 'GET' && url.pathname === '/api/marketing/unsubscribe-info') {
    const token = String(url.searchParams.get('token') || '');
    const preferences = token ? store.getMarketingPreferences(token) : null;
    if (!preferences) return sendJson(res, 404, { error: 'Link preferencji jest nieprawidłowy lub nieaktualny.' });
    const [local = '', domain = ''] = preferences.email.split('@');
    const masked = domain ? `${local.slice(0, 2)}***@${domain}` : 'adres e-mail';
    return sendJson(res, 200, { ok: true, email: masked, marketing_email_consent: preferences.marketing_email_consent, marketing_sms_consent: preferences.marketing_sms_consent, marketing_phone_consent: preferences.marketing_phone_consent });
  }

  if (req.method === 'POST' && url.pathname === '/api/marketing/unsubscribe') {
    if (isRateLimited(`unsubscribe:${ip}`, 20, 60 * 60_000)) return sendJson(res, 429, { error: 'Zbyt wiele prób. Spróbuj ponownie później.' });
    const body = await readJson(req);
    const result = store.unsubscribeMarketing(String(body.token || ''), ip);
    return result ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Link rezygnacji jest nieprawidłowy lub nieaktualny.' });
  }

  if (req.method === 'PATCH' && url.pathname === '/api/marketing/preferences') {
    if (isRateLimited(`preferences:${ip}`, 30, 60 * 60_000)) return sendJson(res, 429, { error: 'Zbyt wiele prób. Spróbuj ponownie później.' });
    const body = await readJson(req);
    const result = store.updateMarketingPreferences(String(body.token || ''), body, ip);
    return result ? sendJson(res, 200, { ok: true, preferences: result }) : sendJson(res, 404, { error: 'Link preferencji jest nieprawidłowy lub nieaktualny.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/marketing/deletion-requests') {
    if (isRateLimited(`marketing-deletion:${ip}`, 5, 60 * 60_000)) return sendJson(res, 429, { error: 'Zbyt wiele zgłoszeń. Spróbuj ponownie później.' });
    const body = await readJson(req);
    if (body.website) return sendJson(res, 202, { ok: true });
    if (!validEmail(body.email)) return sendJson(res, 400, { error: 'Podaj prawidłowy adres e-mail.' });
    const result = store.createMarketingDeletionRequest(String(body.email).slice(0, 254), String(body.reason || '').slice(0, 1000), ip, req.headers['user-agent']);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 201, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (isRateLimited(`login:${ip}`, 5, 15 * 60_000)) return sendJson(res, 429, { error: 'Zbyt wiele prób logowania. Spróbuj ponownie za 15 minut.' });
    const body = await readJson(req);
    const admin = store.getAdminByUsername(String(body.username || ''));
    if (!admin || !verifyPassword(String(body.password || ''), admin.password_hash, admin.password_salt)) {
      store.audit(admin?.id || null, 'login_failed', 'session', null, { username: String(body.username || '') }, ip);
      await new Promise(resolve => setTimeout(resolve, 400));
      return sendJson(res, 401, { error: 'Nieprawidłowy login lub hasło.' });
    }
    const upgradedPassword = hashPassword(String(body.password));
    store.saveAdminPassword(admin.id, upgradedPassword.hash, upgradedPassword.salt);
    if (admin.totp_enabled) {
      if (!body.totp_code) return sendJson(res, 202, { requires_2fa: true });
      if (!verifyTotp(store.decryptTotp(admin), body.totp_code)) {
        store.audit(admin.id, 'login_2fa_failed', 'session', null, {}, ip);
        return sendJson(res, 401, { error: 'Nieprawidłowy kod uwierzytelniający.' });
      }
    }
    const rawToken = randomToken();
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + absoluteSessionHours * 60 * 60_000).toISOString();
    store.purgeSessions();
    store.createSession(sha256(rawToken), admin.id, csrfToken, String(req.headers['user-agent'] || ''), expiresAt);
    store.audit(admin.id, 'login_success', 'session', null, {}, ip);
    return sendJson(res, 200, { ok: true, username: admin.username, display_name: admin.display_name, csrf_token: csrfToken, idle_minutes: idleMinutes }, { 'Set-Cookie': loginCookie(rawToken) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/session') {
    const session = requireAdmin(req, res);
    if (!session) return;
    return sendJson(res, 200, { authenticated: true, username: session.username, display_name: session.display_name, csrf_token: session.csrf_token, idle_minutes: idleMinutes, totp_enabled: Boolean(session.totp_enabled) });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    store.audit(session.admin_id, 'logout', 'session', null, {}, ip);
    store.deleteSession(session.token_hash);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'lamk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/password') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (!strongPassword(body.new_password)) return sendJson(res, 400, { error: 'Hasło musi mieć minimum 14 znaków, małą i wielką literę, cyfrę oraz znak specjalny.' });
    const admin = store.getAdmin(session.admin_id);
    if (!verifyPassword(String(body.current_password || ''), admin.password_hash, admin.password_salt)) return sendJson(res, 400, { error: 'Obecne hasło jest nieprawidłowe.' });
    const password = hashPassword(body.new_password);
    store.saveAdminPassword(admin.id, password.hash, password.salt);
    store.deleteOtherSessions(admin.id, session.token_hash);
    store.audit(admin.id, 'password_changed', 'admin', admin.id, {}, ip);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/2fa/setup') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const secret = createTotpSecret();
    store.saveTotp(session.admin_id, cryptoBox.encrypt(secret), false);
    const issuer = 'LAMKUBEZPIECZENIA.pl';
    const account = encodeURIComponent(session.username);
    return sendJson(res, 200, { secret, otpauth_uri: `otpauth://totp/${encodeURIComponent(issuer)}:${account}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30` });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/2fa/enable') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    const admin = store.getAdmin(session.admin_id);
    const secret = store.decryptTotp(admin);
    if (!secret || !verifyTotp(secret, body.code)) return sendJson(res, 400, { error: 'Nieprawidłowy kod. Sprawdź godzinę w telefonie i spróbuj ponownie.' });
    store.saveTotp(admin.id, { encrypted: admin.totp_secret, iv: admin.totp_iv, tag: admin.totp_tag }, true);
    store.audit(admin.id, '2fa_enabled', 'admin', admin.id, {}, ip);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/2fa/disable') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    const admin = store.getAdmin(session.admin_id);
    if (!verifyPassword(String(body.password || ''), admin.password_hash, admin.password_salt) || !verifyTotp(store.decryptTotp(admin), body.code)) return sendJson(res, 400, { error: 'Hasło lub kod 2FA jest nieprawidłowy.' });
    store.saveTotp(admin.id, null, false);
    store.audit(admin.id, '2fa_disabled', 'admin', admin.id, {}, ip);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, store.dashboard(Object.fromEntries(url.searchParams.entries())));
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/renewals') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { renewals: store.listRenewals() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/policies') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { policies: store.listIssuedPolicies({ archive: url.searchParams.get('archive') === '1' }) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/marketing/contacts') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { contacts: store.listMarketingContacts(Object.fromEntries(url.searchParams.entries())) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/marketing/campaigns') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { campaigns: store.listMarketingCampaigns() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/marketing/deletion-requests') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { requests: store.listMarketingDeletionRequests() });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/marketing/campaigns') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    const ids = new Set((Array.isArray(body.submission_ids) ? body.submission_ids : []).map(Number).filter(Number.isInteger));
    const uniqueContacts = new Map();
    for (const contact of store.listMarketingContacts({ channel: 'email' })) {
      if (ids.has(contact.submission_id) && validEmail(contact.email) && !uniqueContacts.has(normalizeEmailForComparison(contact.email))) uniqueContacts.set(normalizeEmailForComparison(contact.email), contact);
    }
    const contacts = [...uniqueContacts.values()];
    if (contacts.length > 500) return sendJson(res, 400, { error: 'Jedna kampania może mieć maksymalnie 500 odbiorców.' });
    const result = store.createMarketingCampaign(body, contacts, session.admin_id, ip);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 201, result);
  }

  const marketingConsentMatch = url.pathname.match(/^\/api\/admin\/marketing\/contacts\/(\d+)\/consent$/);
  if (marketingConsentMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (!['email', 'sms', 'phone'].includes(body.channel) || typeof body.accepted !== 'boolean') return sendJson(res, 400, { error: 'Nieprawidłowa zmiana zgody.' });
    return store.updateMarketingConsent(Number(marketingConsentMatch[1]), body.channel, body.accepted, session.admin_id, ip)
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: 'Nie znaleziono klienta.' });
  }

  const marketingRemoveMatch = url.pathname.match(/^\/api\/admin\/marketing\/contacts\/(\d+)\/remove$/);
  if (marketingRemoveMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    return store.withdrawAllMarketingConsents(Number(marketingRemoveMatch[1]), session.admin_id, ip, 'admin_phone_request')
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: 'Nie znaleziono klienta.' });
  }

  const deletionRequestMatch = url.pathname.match(/^\/api\/admin\/marketing\/deletion-requests\/(\d+)\/process$/);
  if (deletionRequestMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const result = store.processMarketingDeletionRequest(Number(deletionRequestMatch[1]), session.admin_id, ip);
    return result.error ? sendJson(res, 404, result) : sendJson(res, 200, result);
  }

  const marketingSendMatch = url.pathname.match(/^\/api\/admin\/marketing\/campaigns\/(\d+)\/send$/);
  if (marketingSendMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    if (!process.env.RESEND_API_KEY) return sendJson(res, 503, { error: 'Wysyłka e-mail wymaga konfiguracji RESEND_API_KEY i zweryfikowania domeny lamkubezpieczenia.pl.' });
    if (isRateLimited(`marketing-send:${session.admin_id}`, 10, 60 * 60_000)) return sendJson(res, 429, { error: 'Przekroczono limit uruchomień kampanii. Spróbuj ponownie później.' });
    const campaignId = Number(marketingSendMatch[1]);
    const campaign = store.getMarketingCampaign(campaignId);
    if (!campaign) return sendJson(res, 404, { error: 'Nie znaleziono kampanii.' });
    if (!store.markCampaignSending(campaignId, session.admin_id, ip)) return sendJson(res, 409, { error: 'Ta kampania została już wysłana lub jest właśnie wysyłana.' });
    const currentContacts = new Map(store.listMarketingContacts({ channel: 'email' }).filter(contact => validEmail(contact.email)).map(contact => [contact.submission_id, contact]));
    const protocol = process.env.PUBLIC_BASE_URL ? '' : (String(req.headers['x-forwarded-proto'] || '').split(',')[0] || (isProduction ? 'https' : 'http'));
    const baseUrl = String(process.env.PUBLIC_BASE_URL || `${protocol}://${req.headers.host}`).replace(/\/$/, '');
    for (const recipient of campaign.recipients.filter(item => ['pending', 'failed'].includes(item.status))) {
      const contact = currentContacts.get(recipient.submission_id);
      if (!contact || normalizeEmailForComparison(contact.email) !== normalizeEmailForComparison(recipient.recipient_email)) {
        store.markCampaignRecipient(recipient.id, 'failed', '', 'Brak aktywnej zgody e-mail lub adres został zmieniony.');
        continue;
      }
      const unsubscribeUrl = `${baseUrl}/unsubscribe.html?token=${encodeURIComponent(recipient.unsubscribe_token)}`;
      const personalizedSubject = campaign.subject.replaceAll('{IMIE_NAZWISKO}', contact.client_name);
      const personalizedContent = campaign.content.replaceAll('{IMIE_NAZWISKO}', contact.client_name);
      const htmlContent = escapeHtml(personalizedContent).replace(/\r?\n/g, '<br>');
      const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:680px;margin:auto"><div style="font-weight:800;font-size:18px;margin-bottom:20px">LAMKUBEZPIECZENIA.pl</div><div>${htmlContent}</div><p style="font-size:12px;color:#6b7280;margin-top:32px">Wiadomość została wysłana na podstawie udzielonej zgody marketingowej. <a href="${escapeHtml(unsubscribeUrl)}">Zmień preferencje lub wycofaj zgody marketingowe</a>.</p></div>`;
      const text = `${personalizedContent}\n\nWiadomość marketingowa LAMKUBEZPIECZENIA.pl. Zmiana preferencji lub wycofanie zgód: ${unsubscribeUrl}`;
      try {
        const sent = await sendEmail({ to: contact.email, subject: personalizedSubject, text, html, idempotencyKey: `marketing-${campaignId}-${recipient.id}`, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` }, from: process.env.MARKETING_EMAIL_FROM || undefined });
        store.markCampaignRecipient(recipient.id, 'sent', sent.id || '');
      } catch (error) {
        store.markCampaignRecipient(recipient.id, 'failed', '', error.message);
      }
    }
    const result = store.finishMarketingCampaign(campaignId, session.admin_id, ip);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/admins') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { admins: store.listAdmins() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/submissions') {
    if (!requireAdmin(req, res)) return;
    const filters = Object.fromEntries(url.searchParams.entries());
    return sendJson(res, 200, { submissions: store.listSubmissions(filters) });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/contact-tasks') {
    if (!requireAdmin(req, res)) return;
    const filters = Object.fromEntries(url.searchParams.entries());
    return sendJson(res, 200, { tasks: store.listContactTasks(filters) });
  }

  const createContactTaskMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/contact-tasks$/);
  if (createContactTaskMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const result = store.createContactTask(Number(createContactTaskMatch[1]), await readJson(req), session.admin_id, ip);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 201, result);
  }

  const completeContactTaskMatch = url.pathname.match(/^\/api\/admin\/contact-tasks\/(custom|submission)\/(\d+)\/complete$/);
  if (completeContactTaskMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const source = completeContactTaskMatch[1];
    const id = Number(completeContactTaskMatch[2]);
    const completed = source === 'custom'
      ? store.completeContactTask(id, session.admin_id, ip)
      : store.completeSubmissionContact(id, session.admin_id, ip);
    return completed ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Przypomnienie nie istnieje albo zostało już wykonane.' });
  }

  const submissionMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)$/);
  if (submissionMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const submission = store.getSubmission(Number(submissionMatch[1]));
    return submission ? sendJson(res, 200, { submission }) : sendJson(res, 404, { error: 'Nie znaleziono zgłoszenia.' });
  }
  if (submissionMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (body.status && !CRM_STATUSES.includes(body.status)) return sendJson(res, 400, { error: 'Nieprawidłowy status.' });
    return store.updateSubmission(Number(submissionMatch[1]), body, session.admin_id, ip) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Nie znaleziono zgłoszenia.' });
  }

  const actionMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/actions$/);
  if (actionMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    return store.addContactAction(Number(actionMatch[1]), body.action, session.admin_id, body.details, ip) ? sendJson(res, 201, { ok: true }) : sendJson(res, 400, { error: 'Nieprawidłowa akcja.' });
  }

  const notesMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/notes$/);
  if (notesMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    return store.saveNotes(Number(notesMatch[1]), body.notes, session.admin_id, ip) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Nie znaleziono zgłoszenia.' });
  }

  const policyMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/policy$/);
  if (policyMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const result = store.savePolicy(Number(policyMatch[1]), await readJson(req), session.admin_id, ip);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 200, result);
  }

  const renewalMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/renew$/);
  if (renewalMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const result = store.renewPolicy(Number(renewalMatch[1]), await readJson(req), session.admin_id, ip);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 201, result);
  }

  const renewalStatusMatch = url.pathname.match(/^\/api\/admin\/policies\/(\d+)\/renewal-status$/);
  if (renewalStatusMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    return store.updateRenewalStatus(Number(renewalStatusMatch[1]), body.renewal_status, session.admin_id, ip)
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 400, { error: 'Nieprawidłowy status wznowienia lub polisa nie istnieje.' });
  }

  const inspectionStatusMatch = url.pathname.match(/^\/api\/admin\/policies\/(\d+)\/inspection$/);
  if (inspectionStatusMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (typeof body.completed !== 'boolean') return sendJson(res, 400, { error: 'Nieprawidłowy status inspekcji.' });
    return store.updatePolicyInspection(Number(inspectionStatusMatch[1]), body.completed, session.admin_id, ip)
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 404, { error: 'Nie znaleziono polisy.' });
  }

  const productionStatusMatch = url.pathname.match(/^\/api\/admin\/policies\/(\d+)\/production-status$/);
  if (productionStatusMatch && req.method === 'PATCH') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    return store.updatePolicyProductionStatus(Number(productionStatusMatch[1]), body.method, session.admin_id, ip)
      ? sendJson(res, 200, { ok: true })
      : sendJson(res, 400, { error: 'Nieprawidłowy status wysyłki lub polisa nie istnieje.' });
  }

  const documentUploadMatch = url.pathname.match(/^\/api\/admin\/policies\/(\d+)\/documents$/);
  if (documentUploadMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (body.mime_type !== 'application/pdf' || !String(body.filename || '').toLowerCase().endsWith('.pdf')) return sendJson(res, 400, { error: 'Można wgrać wyłącznie dokument PDF.' });
    if (!Number.isInteger(body.file_size) || body.file_size <= 0 || body.file_size > maxPolicyFileSize) return sendJson(res, 400, { error: 'Plik polisy może mieć maksymalnie 8 MB.' });
    if (typeof body.content_base64 !== 'string' || Buffer.from(body.content_base64, 'base64').length !== body.file_size) return sendJson(res, 400, { error: 'Plik jest nieprawidłowy lub uszkodzony.' });
    const result = store.savePolicyDocument(Number(documentUploadMatch[1]), { filename: String(body.filename).slice(0, 180), mime_type: body.mime_type, file_size: body.file_size, content_base64: body.content_base64 }, session.admin_id, ip);
    return result.error ? sendJson(res, 400, result) : sendJson(res, 201, result);
  }

  const documentDownloadMatch = url.pathname.match(/^\/api\/admin\/documents\/(\d+)$/);
  if (documentDownloadMatch && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const document = store.getPolicyDocument(Number(documentDownloadMatch[1]));
    if (!document) return sendJson(res, 404, { error: 'Nie znaleziono dokumentu.' });
    const filename = document.filename.replace(/["\r\n]/g, '_');
    return sendBuffer(res, 200, Buffer.from(document.content_base64, 'base64'), { 'Content-Type': document.mime_type, 'Content-Length': document.file_size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` });
  }

  const sendPolicyMatch = url.pathname.match(/^\/api\/admin\/policies\/(\d+)\/send-production$/);
  if (sendPolicyMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const policyId = Number(sendPolicyMatch[1]);
    const body = await readJson(req);
    const context = store.policyEmailContext(policyId);
    if (!context) return sendJson(res, 404, { error: 'Nie znaleziono polisy.' });
    const selectedDocument = context.documents.find(document => document.id === Number(body.document_id)) || context.documents[0];
    if (!selectedDocument) return sendJson(res, 400, { error: 'Najpierw wgraj plik PDF polisy.' });
    const recipient = 'produkcja@4-life.pl';
    const subject = `${context.identity.name} ${formatPolicyDate(context.policy.start_date)} (${context.policy.insurer})`;
    const text = `Dzień dobry,\n\nw załączeniu przesyłam polisę do produkcji.\n\nKlient: ${context.identity.name}\nNumer polisy: ${context.policy.policy_number}\nPoczątek ochrony: ${formatPolicyDate(context.policy.start_date)}\nTowarzystwo: ${context.policy.insurer}\n\nPozdrawiam\nRadosław Lamk\nLAMKUBEZPIECZENIA.pl`;
    const sent = await sendEmail({ to: recipient, subject, text, attachments: [{ filename: selectedDocument.filename, content: selectedDocument.content_base64 }], idempotencyKey: `policy-${policyId}-production-${Date.now()}`, from: 'LAMKUBEZPIECZENIA.pl <kontakt@lamkubezpieczenia.pl>' });
    store.recordPolicyEmail(policyId, selectedDocument.id, 'production', recipient, subject, sent.id || '', session.admin_id, ip);
    return sendJson(res, 200, { ok: true, recipient, subject, sent_at: store.now() });
  }

  const anonymizeMatch = url.pathname.match(/^\/api\/admin\/submissions\/(\d+)\/anonymize$/);
  if (anonymizeMatch && req.method === 'POST') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (body.notify_client) {
      const submission = store.getSubmission(Number(anonymizeMatch[1]));
      if (!submission) return sendJson(res, 404, { error: 'Nie znaleziono zgłoszenia.' });
      if (!validEmail(submission.client_email)) return sendJson(res, 400, { error: 'Brak prawidłowego adresu e-mail klienta. Uzupełnij go przed anonimizacją albo wyłącz powiadomienie.' });
      await sendEmail({
        to: submission.client_email,
        subject: 'Potwierdzenie usunięcia danych osobowych',
        text: `Dzień dobry,\n\npotwierdzam wykonanie żądania usunięcia danych osobowych z systemu LAMKUBEZPIECZENIA.pl, z zastrzeżeniem informacji technicznych i danych, których dalsze przechowywanie może wynikać z obowiązujących przepisów prawa.\n\nPozdrawiam\nRadosław Lamk\nLAMKUBEZPIECZENIA.pl`,
        idempotencyKey: `deletion-${submission.id}-${Date.now()}`
      });
      store.audit(session.admin_id, 'deletion_notice_sent', 'submission', submission.id, { recipient_email: submission.client_email }, ip);
    }
    return store.anonymize(Number(anonymizeMatch[1]), body.reason, session.admin_id, ip) ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Nie znaleziono zgłoszenia.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/anonymizations') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { entries: store.anonymizationLog() });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/audit') {
    if (!requireAdmin(req, res)) return;
    return sendJson(res, 200, { entries: store.auditLog() });
  }

  if (req.method === 'GET' && url.pathname === '/api/posts') {
    const posts = store.db.prepare('SELECT * FROM posts ORDER BY published_at DESC').all().map(row => ({ ...row, tags: JSON.parse(row.tags) }));
    return sendJson(res, 200, { posts });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/posts') {
    if (!requireAdmin(req, res)) return;
    const posts = store.db.prepare('SELECT * FROM posts ORDER BY published_at DESC').all().map(row => ({ ...row, tags: JSON.parse(row.tags) }));
    return sendJson(res, 200, { posts });
  }
  if (req.method === 'POST' && url.pathname === '/api/admin/posts') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const body = await readJson(req);
    if (!body.title?.trim() || !body.content?.trim()) return sendJson(res, 400, { error: 'Tytuł i treść są wymagane.' });
    const timestamp = store.now();
    const result = store.db.prepare('INSERT INTO posts (title, category, tags, image, content, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(body.title.trim(), String(body.category || 'Porady').trim(), JSON.stringify(Array.isArray(body.tags) ? body.tags : []), String(body.image || '').trim(), body.content.trim(), timestamp, timestamp);
    store.audit(session.admin_id, 'post_created', 'post', result.lastInsertRowid, { title: body.title }, ip);
    return sendJson(res, 201, { ok: true, id: Number(result.lastInsertRowid) });
  }
  const postMatch = url.pathname.match(/^\/api\/admin\/posts\/(\d+)$/);
  if (postMatch && req.method === 'DELETE') {
    const session = requireAdmin(req, res, { csrf: true });
    if (!session) return;
    const result = store.db.prepare('DELETE FROM posts WHERE id = ?').run(Number(postMatch[1]));
    if (result.changes) store.audit(session.admin_id, 'post_deleted', 'post', postMatch[1], {}, ip);
    return result.changes ? sendJson(res, 200, { ok: true }) : sendJson(res, 404, { error: 'Nie znaleziono wpisu.' });
  }

  sendJson(res, 404, { error: 'Nie znaleziono zasobu.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf' };
async function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const normalized = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.resolve(rootDir, `.${normalized}`);
  const relative = path.relative(rootDir, filePath);
  const blocked = relative.startsWith('data') || relative.startsWith('lib') || ['server.mjs', 'package.json', '.env', '.env.example', '.gitignore'].includes(relative);
  if (!filePath.startsWith(rootDir) || blocked) return sendJson(res, 403, { error: 'Brak dostępu.' });
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(content);
  } catch { sendJson(res, 404, { error: 'Nie znaleziono strony.' }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0];
    if (isProduction && process.env.TRUST_PROXY === 'true' && forwardedProto !== 'https') {
      res.writeHead(308, { Location: `https://${req.headers.host}${req.url}` });
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(res, url.pathname);
    else sendJson(res, 405, { error: 'Metoda niedozwolona.' });
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.status || !isProduction ? error.message : 'Wystąpił błąd serwera.' });
  }
});

server.listen(port, host, () => console.log(`LAMKUBEZPIECZENIA.pl CRM działa na http://${host}:${port}`));
