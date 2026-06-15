import { DatabaseSync } from 'node:sqlite';
import { hashPassword, randomToken, sha256 } from './security.mjs';

export const CRM_STATUSES = ['new', 'in_progress', 'offer_sent', 'awaiting_client', 'policy_concluded', 'cancelled', 'closed_lost', 'archive'];
export const POLICY_PRODUCT_TYPES = ['Nieruchomość', 'Życie', 'OC', 'AC', 'OC+AC', 'Turystyczne', 'Rolne', 'Firma', 'Smartfon', 'GAP', 'Zdrowotne', 'NNW', 'NNW SZKOLNE', 'Medycyna Bez Granic', 'Assistance Solo', 'Flota', 'OC Zawodowe'];
export const POLICY_INSURERS = ['Aegon', 'AGRO Ubezpieczenia TUW', 'Allianz', 'Allianz Życie', 'Atradius', 'Balcia', 'Benefia', 'Compensa', 'Compensa Życie', 'Defend Insurance (GAP)', 'D.A.S.', 'ERGO Hestia', 'Europa / TU Europa', 'Euroins', 'Generali', 'Generali Życie', 'Inter Polska', 'Inter Życie', 'InterRisk', 'Leadenhall', 'LINK4', 'Lloyd’s', 'MetLife', 'mtu24', 'Nationale-Nederlanden', 'Open Life', 'Pocztowe TUW', 'Proama', 'PZU', 'PZU Życie', 'Saltus', 'Saltus Życie', 'Signal Iduna', 'Trasti', 'TUW „TUW”', 'TUZ Ubezpieczenia', 'Uniqa', 'Uniqa Życie', 'Unum', 'Vienna Life', 'Warta', 'Warta Życie', 'Wiener', 'You Can Drive'];

const PROPERTY_PRODUCT_TYPES = {
  Mieszkanie: 'Ubezpieczenie mieszkania',
  Dom: 'Ubezpieczenie domu',
  'Budynek w budowie': 'Ubezpieczenie domu w budowie',
  'Dom letniskowy': 'Ubezpieczenie domku letniskowego',
  Altana: 'Ubezpieczenie altany'
};

export function resolveSubmissionFormType(formType, data = {}) {
  const propertyType = String(data?.['Rodzaj nieruchomości'] || '').trim();
  return PROPERTY_PRODUCT_TYPES[propertyType] || String(formType || '').trim();
}

function addColumn(db, table, definition) {
  const name = definition.trim().split(/\s+/)[0];
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function createStore(databasePath, cryptoBox) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      csrf_token TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_type TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      payload_iv TEXT NOT NULL,
      payload_tag TEXT NOT NULL,
      privacy_accepted INTEGER NOT NULL,
      marketing_email_consent INTEGER NOT NULL DEFAULT 0,
      marketing_sms_consent INTEGER NOT NULL DEFAULT 0,
      marketing_phone_consent INTEGER NOT NULL DEFAULT 0,
      consent_timestamp TEXT NOT NULL,
      consent_ip TEXT NOT NULL,
      consent_user_agent TEXT,
      consent_version TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      image TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      published_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  addColumn(db, 'admins', "display_name TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'admins', 'totp_secret TEXT');
  addColumn(db, 'admins', 'totp_iv TEXT');
  addColumn(db, 'admins', 'totp_tag TEXT');
  addColumn(db, 'admins', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'sessions', 'last_activity_at TEXT');
  addColumn(db, 'submissions', 'assigned_admin_id INTEGER');
  addColumn(db, 'submissions', "internal_notes TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'submissions', 'contact_due_at TEXT');
  addColumn(db, 'submissions', 'anonymized_at TEXT');
  addColumn(db, 'submissions', "client_email_override TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'submissions', "client_name_override TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'submissions', "offer_insurer TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'submissions', "presented_insurers TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      admin_id INTEGER,
      action_type TEXT NOT NULL,
      label TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS note_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      admin_id INTEGER,
      previous_value TEXT NOT NULL DEFAULT '',
      new_value TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      policy_number TEXT NOT NULL,
      insurer TEXT NOT NULL,
      premium REAL NOT NULL DEFAULT 0,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      client_number TEXT NOT NULL DEFAULT '',
      product_type TEXT NOT NULL,
      period_number INTEGER NOT NULL DEFAULT 1,
      renewed_from_policy_id INTEGER,
      is_current INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(renewed_from_policy_id) REFERENCES policies(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS consent_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      privacy_accepted INTEGER NOT NULL,
      marketing_email_consent INTEGER NOT NULL,
      marketing_sms_consent INTEGER NOT NULL,
      marketing_phone_consent INTEGER NOT NULL,
      consent_timestamp TEXT NOT NULL,
      consent_ip TEXT NOT NULL,
      consent_user_agent TEXT,
      consent_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS anonymization_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_reference INTEGER NOT NULL,
      form_type TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      admin_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      operation TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS policy_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      policy_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      encrypted_content TEXT NOT NULL,
      content_iv TEXT NOT NULL,
      content_tag TEXT NOT NULL,
      uploaded_by INTEGER,
      uploaded_at TEXT NOT NULL,
      FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(uploaded_by) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS email_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      policy_id INTEGER,
      document_id INTEGER,
      admin_id INTEGER,
      recipient_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      provider_message_id TEXT NOT NULL DEFAULT '',
      delivery_status TEXT NOT NULL DEFAULT 'sent',
      sent_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE SET NULL,
      FOREIGN KEY(document_id) REFERENCES policy_documents(id) ON DELETE SET NULL,
      FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY(created_by) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      submission_id INTEGER NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_message_id TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      unsubscribe_token TEXT NOT NULL UNIQUE,
      sent_at TEXT,
      FOREIGN KEY(campaign_id) REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS marketing_suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_email TEXT NOT NULL,
      channel TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'system',
      created_at TEXT NOT NULL,
      UNIQUE(normalized_email, channel)
    );
    CREATE TABLE IF NOT EXISTS marketing_deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_hash TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      payload_iv TEXT NOT NULL,
      payload_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      processed_at TEXT,
      processed_by INTEGER,
      FOREIGN KEY(processed_by) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS contact_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      product TEXT NOT NULL,
      coverage_end_date TEXT,
      contact_due_at TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_by INTEGER,
      completed_by INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
      FOREIGN KEY(created_by) REFERENCES admins(id) ON DELETE SET NULL,
      FOREIGN KEY(completed_by) REFERENCES admins(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);
    CREATE INDEX IF NOT EXISTS idx_submissions_submitted ON submissions(submitted_at);
    CREATE INDEX IF NOT EXISTS idx_policies_end_date ON policies(end_date, is_current);
    CREATE INDEX IF NOT EXISTS idx_contact_submission ON contact_history(submission_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_policy_documents_policy ON policy_documents(policy_id);
    CREATE INDEX IF NOT EXISTS idx_email_log_policy ON email_log(policy_id, sent_at);
    CREATE INDEX IF NOT EXISTS idx_campaign_status ON marketing_campaigns(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_campaign_recipient ON marketing_campaign_recipients(campaign_id, status);
    CREATE INDEX IF NOT EXISTS idx_marketing_deletion_status ON marketing_deletion_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_contact_tasks_due ON contact_tasks(status, contact_due_at);
    CREATE INDEX IF NOT EXISTS idx_contact_tasks_submission ON contact_tasks(submission_id, created_at);
  `);
  addColumn(db, 'policies', "renewal_status TEXT NOT NULL DEFAULT 'pending'");
  addColumn(db, 'policies', 'renewal_updated_at TEXT');
  addColumn(db, 'policies', 'sent_to_client_at TEXT');
  addColumn(db, 'policies', 'sent_to_production_at TEXT');
  addColumn(db, 'policies', "last_client_email TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'policies', "offer_number TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'policies', "notes TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'policies', 'inspection_completed INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'policies', 'inspection_completed_at TEXT');
  addColumn(db, 'policies', "production_delivery_method TEXT NOT NULL DEFAULT ''");
  addColumn(db, 'policies', 'canceled_at TEXT');
  addColumn(db, 'policies', "cancellation_reason TEXT NOT NULL DEFAULT ''");
  db.prepare("UPDATE policies SET production_delivery_method = 'automatic' WHERE sent_to_production_at IS NOT NULL AND sent_to_production_at <> '' AND production_delivery_method = ''").run();
  db.prepare("UPDATE submissions SET status = 'closed_lost' WHERE status = 'closed'").run();
  db.prepare("UPDATE submissions SET status = 'in_progress' WHERE status = 'contacted'").run();
  db.prepare("UPDATE admins SET display_name = 'Radosław Lamk' WHERE username = 'radoslaw' AND display_name = ''").run();

  function now() { return new Date().toISOString(); }
  function todayLocal() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function audit(adminId, operation, entityType, entityId, metadata = {}, ip = '') {
    db.prepare('INSERT INTO audit_log (admin_id, operation, entity_type, entity_id, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(adminId || null, operation, entityType, entityId == null ? null : String(entityId), JSON.stringify(metadata), ip, now());
  }
  function adminName(id) {
    if (!id) return 'System';
    const admin = db.prepare('SELECT display_name, username FROM admins WHERE id = ?').get(id);
    return admin ? admin.display_name || admin.username : 'Usunięty administrator';
  }
  function decryptSubmission(row) {
    return cryptoBox.decrypt(row.encrypted_payload, row.payload_iv, row.payload_tag);
  }
  function cleanValue(value) {
    return String(value ?? '').trim().toLowerCase();
  }
  function normalizeEmail(value) {
    return cleanValue(value);
  }
  function searchableText(data) {
    return Object.entries(data || {}).flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(' ') : value]).join(' ').toLowerCase();
  }
  function normalizeKey(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function firstMatchingValue(data, patterns) {
    for (const [key, value] of Object.entries(data || {})) {
      const normalized = normalizeKey(key);
      if (patterns.some(pattern => normalized.includes(pattern)) && value) return Array.isArray(value) ? String(value[0]) : String(value);
    }
    return '';
  }
  function clientIdentity(data, overrideEmail = '', overrideName = '') {
    const fullName = firstMatchingValue(data, ['imie i nazwisko', 'imie ubezpieczajacego', 'imie klienta']);
    const firstName = firstMatchingValue(data, ['imie']);
    const lastName = firstMatchingValue(data, ['nazwisko']);
    return {
      name: overrideName || fullName || [firstName, lastName].filter(Boolean).join(' ') || 'Nieuzupełnione imię i nazwisko',
      email: overrideEmail || firstMatchingValue(data, ['e-mail', 'email', 'adres e mail']),
      phone: firstMatchingValue(data, ['telefon', 'numer telefonu', 'tel.'])
    };
  }
  function policyLifecycle(policy) {
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (policy.canceled_at) return 'cancelled';
    if (String(policy.end_date).slice(0, 10) < today) return 'expired';
    if (policy.renewal_status === 'renewed') return 'renewed';
    if (String(policy.start_date).slice(0, 10) > today) return 'upcoming';
    if (policy.is_current) return 'active';
    return 'archived';
  }

  return {
    db,
    now,
    audit,
    ensureAdmin(username, password) {
      if (db.prepare('SELECT COUNT(*) AS count FROM admins').get().count) return;
      const result = hashPassword(password);
      db.prepare('INSERT INTO admins (username, display_name, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(username, 'Radosław Lamk', result.hash, result.salt, now());
    },
    getAdminByUsername(username) { return db.prepare('SELECT * FROM admins WHERE username = ?').get(username); },
    getAdmin(id) { return db.prepare('SELECT * FROM admins WHERE id = ?').get(id); },
    listAdmins() { return db.prepare('SELECT id, username, display_name FROM admins ORDER BY display_name, username').all(); },
    saveAdminPassword(id, passwordHash, passwordSalt) { db.prepare('UPDATE admins SET password_hash = ?, password_salt = ? WHERE id = ?').run(passwordHash, passwordSalt, id); },
    saveTotp(id, encrypted, enabled) { db.prepare('UPDATE admins SET totp_secret = ?, totp_iv = ?, totp_tag = ?, totp_enabled = ? WHERE id = ?').run(encrypted?.encrypted || null, encrypted?.iv || null, encrypted?.tag || null, enabled ? 1 : 0, id); },
    decryptTotp(admin) { return admin.totp_secret ? cryptoBox.decrypt(admin.totp_secret, admin.totp_iv, admin.totp_tag) : null; },
    createSession(tokenHash, adminId, csrfToken, userAgent, expiresAt) {
      const timestamp = now();
      db.prepare('INSERT INTO sessions (token_hash, admin_id, csrf_token, user_agent, created_at, expires_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(tokenHash, adminId, csrfToken, userAgent, timestamp, expiresAt, timestamp);
    },
    getSession(tokenHash, idleCutoff) {
      return db.prepare(`SELECT sessions.*, admins.username, admins.display_name, admins.totp_enabled FROM sessions JOIN admins ON admins.id = sessions.admin_id WHERE token_hash = ? AND expires_at > ? AND COALESCE(sessions.last_activity_at, sessions.created_at) > ?`).get(tokenHash, now(), idleCutoff);
    },
    touchSession(tokenHash) { db.prepare('UPDATE sessions SET last_activity_at = ? WHERE token_hash = ?').run(now(), tokenHash); },
    deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); },
    deleteOtherSessions(adminId, tokenHash) { db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?').run(adminId, tokenHash); },
    purgeSessions() { db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now()); },
    createSubmission(body, ip, userAgent) {
      const timestamp = now();
      const encrypted = cryptoBox.encrypt(body.data);
      const formType = resolveSubmissionFormType(body.form_type, body.data);
      const result = db.prepare(`INSERT INTO submissions (form_type, encrypted_payload, payload_iv, payload_tag, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, submitted_at, status, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, '1.0', ?, 'new', ?)`)
        .run(formType, encrypted.encrypted, encrypted.iv, encrypted.tag, body.consents.marketing_email_consent ? 1 : 0, body.consents.marketing_sms_consent ? 1 : 0, body.consents.marketing_phone_consent ? 1 : 0, timestamp, ip, userAgent, timestamp, timestamp);
      const id = Number(result.lastInsertRowid);
      db.prepare('INSERT INTO consent_history (submission_id, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, body.consents.marketing_email_consent ? 1 : 0, body.consents.marketing_sms_consent ? 1 : 0, body.consents.marketing_phone_consent ? 1 : 0, timestamp, ip, userAgent, '1.0', timestamp);
      audit(null, 'submission_created', 'submission', id, { form_type: formType }, ip);
      return id;
    },
    normalizeSubmissionFormTypes() {
      const rows = db.prepare("SELECT * FROM submissions WHERE form_type = 'Ubezpieczenie nieruchomości' AND anonymized_at IS NULL").all();
      let updated = 0;
      for (const row of rows) {
        const resolved = resolveSubmissionFormType(row.form_type, decryptSubmission(row));
        if (resolved === row.form_type) continue;
        db.prepare('UPDATE submissions SET form_type = ?, updated_at = ? WHERE id = ?').run(resolved, now(), row.id);
        updated += 1;
      }
      return updated;
    },
    listMarketingContacts(filters = {}) {
      const suppressions = new Set(db.prepare("SELECT normalized_email FROM marketing_suppressions WHERE channel = 'email'").all().map(row => row.normalized_email));
      const search = cleanValue(filters.search);
      const channel = String(filters.channel || 'all');
      return db.prepare(`SELECT * FROM submissions WHERE anonymized_at IS NULL AND (marketing_email_consent = 1 OR marketing_sms_consent = 1 OR marketing_phone_consent = 1) ORDER BY consent_timestamp DESC`).all().map(row => {
        const identity = clientIdentity(decryptSubmission(row), row.client_email_override, row.client_name_override);
        const emailSuppressed = suppressions.has(normalizeEmail(identity.email));
        return {
          id: row.id,
          submission_id: row.id,
          client_name: identity.name,
          email: identity.email,
          phone: identity.phone,
          marketing_email_consent: Boolean(row.marketing_email_consent) && Boolean(identity.email) && !emailSuppressed,
          marketing_sms_consent: Boolean(row.marketing_sms_consent) && Boolean(identity.phone),
          marketing_phone_consent: Boolean(row.marketing_phone_consent) && Boolean(identity.phone),
          email_suppressed: emailSuppressed,
          consent_timestamp: row.consent_timestamp,
          consent_version: row.consent_version,
          form_type: row.form_type
        };
      }).filter(contact => {
        if (channel === 'email' && !contact.marketing_email_consent) return false;
        if (channel === 'sms' && !contact.marketing_sms_consent) return false;
        if (channel === 'phone' && !contact.marketing_phone_consent) return false;
        if (search && !`${contact.client_name} ${contact.email} ${contact.phone} ${contact.submission_id}`.toLowerCase().includes(search)) return false;
        return true;
      });
    },
    updateMarketingConsent(submissionId, channel, accepted, adminId, ip, source = 'admin') {
      const columns = { email: 'marketing_email_consent', sms: 'marketing_sms_consent', phone: 'marketing_phone_consent' };
      const column = columns[channel];
      if (!column) return false;
      const current = db.prepare('SELECT * FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(submissionId);
      if (!current) return false;
      const data = decryptSubmission(current);
      const identity = clientIdentity(data, current.client_email_override, current.client_name_override);
      const timestamp = now();
      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE submissions SET ${column} = ?, updated_at = ? WHERE id = ?`).run(accepted ? 1 : 0, timestamp, submissionId);
        if (channel === 'email' && identity.email) {
          const normalized = normalizeEmail(identity.email);
          if (accepted) db.prepare("DELETE FROM marketing_suppressions WHERE normalized_email = ? AND channel = 'email'").run(normalized);
          else db.prepare("INSERT INTO marketing_suppressions (normalized_email, channel, reason, source, created_at) VALUES (?, 'email', ?, ?, ?) ON CONFLICT(normalized_email, channel) DO UPDATE SET reason = excluded.reason, source = excluded.source, created_at = excluded.created_at")
            .run(normalized, 'Wycofanie zgody marketingowej', source, timestamp);
        }
        const updated = db.prepare('SELECT * FROM submissions WHERE id = ?').get(submissionId);
        db.prepare('INSERT INTO consent_history (submission_id, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(submissionId, updated.privacy_accepted, updated.marketing_email_consent, updated.marketing_sms_consent, updated.marketing_phone_consent, timestamp, ip || updated.consent_ip, updated.consent_user_agent || '', updated.consent_version, timestamp);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      audit(adminId, accepted ? 'marketing_consent_enabled' : 'marketing_consent_withdrawn', 'submission', submissionId, { channel, source }, ip);
      return true;
    },
    withdrawAllMarketingConsents(submissionId, adminId, ip, source = 'admin_manual') {
      const current = db.prepare('SELECT * FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(submissionId);
      if (!current) return false;
      const identity = clientIdentity(decryptSubmission(current), current.client_email_override, current.client_name_override);
      const timestamp = now();
      db.exec('BEGIN');
      try {
        db.prepare('UPDATE submissions SET marketing_email_consent = 0, marketing_sms_consent = 0, marketing_phone_consent = 0, updated_at = ? WHERE id = ?').run(timestamp, submissionId);
        if (identity.email) db.prepare("INSERT INTO marketing_suppressions (normalized_email, channel, reason, source, created_at) VALUES (?, 'email', ?, ?, ?) ON CONFLICT(normalized_email, channel) DO UPDATE SET reason = excluded.reason, source = excluded.source, created_at = excluded.created_at")
          .run(normalizeEmail(identity.email), 'Wycofanie wszystkich zgód marketingowych', source, timestamp);
        db.prepare('INSERT INTO consent_history (submission_id, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, created_at) VALUES (?, ?, 0, 0, 0, ?, ?, ?, ?, ?)')
          .run(submissionId, current.privacy_accepted, timestamp, ip || current.consent_ip, current.consent_user_agent || '', current.consent_version, timestamp);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      audit(adminId, 'marketing_contact_removed', 'submission', submissionId, { source }, ip);
      return true;
    },
    getMarketingPreferences(token) {
      const recipient = db.prepare('SELECT * FROM marketing_campaign_recipients WHERE unsubscribe_token = ?').get(token);
      if (!recipient) return null;
      const submission = db.prepare('SELECT * FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(recipient.submission_id);
      if (!submission) return null;
      const identity = clientIdentity(decryptSubmission(submission), submission.client_email_override, submission.client_name_override);
      return {
        submission_id: submission.id,
        email: identity.email || recipient.recipient_email,
        marketing_email_consent: Boolean(submission.marketing_email_consent),
        marketing_sms_consent: Boolean(submission.marketing_sms_consent),
        marketing_phone_consent: Boolean(submission.marketing_phone_consent)
      };
    },
    updateMarketingPreferences(token, preferences, ip = '') {
      const current = this.getMarketingPreferences(token);
      if (!current) return null;
      if (preferences.remove_all === true) {
        this.withdrawAllMarketingConsents(current.submission_id, null, ip, 'preference_link');
      } else {
        if (preferences.marketing_email_consent === false && current.marketing_email_consent) this.updateMarketingConsent(current.submission_id, 'email', false, null, ip, 'preference_link');
        if (preferences.marketing_sms_consent === false && current.marketing_sms_consent) this.updateMarketingConsent(current.submission_id, 'sms', false, null, ip, 'preference_link');
        if (preferences.marketing_phone_consent === false && current.marketing_phone_consent) this.updateMarketingConsent(current.submission_id, 'phone', false, null, ip, 'preference_link');
      }
      return this.getMarketingPreferences(token);
    },
    createMarketingDeletionRequest(email, reason, ip, userAgent) {
      const normalized = normalizeEmail(email);
      if (!normalized) return { error: 'Podaj adres e-mail.' };
      const existing = db.prepare("SELECT id FROM marketing_deletion_requests WHERE email_hash = ? AND status = 'pending'").get(sha256(normalized));
      if (existing) return { ok: true, id: existing.id, duplicate: true };
      const timestamp = now();
      const encrypted = cryptoBox.encrypt({ email: String(email).trim(), reason: String(reason || '').trim(), ip, user_agent: String(userAgent || '').slice(0, 500) });
      const result = db.prepare('INSERT INTO marketing_deletion_requests (email_hash, encrypted_payload, payload_iv, payload_tag, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(sha256(normalized), encrypted.encrypted, encrypted.iv, encrypted.tag, timestamp);
      audit(null, 'marketing_deletion_requested', 'marketing_deletion_request', Number(result.lastInsertRowid), {}, ip);
      return { ok: true, id: Number(result.lastInsertRowid) };
    },
    listMarketingDeletionRequests() {
      return db.prepare(`SELECT r.*, a.display_name, a.username FROM marketing_deletion_requests r LEFT JOIN admins a ON a.id = r.processed_by ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 500`).all().map(row => {
        const payload = cryptoBox.decrypt(row.encrypted_payload, row.payload_iv, row.payload_tag);
        return { id: row.id, email: payload.email, reason: payload.reason, status: row.status, created_at: row.created_at, processed_at: row.processed_at, admin_name: row.display_name || row.username || '' };
      });
    },
    processMarketingDeletionRequest(id, adminId, ip) {
      const request = db.prepare("SELECT * FROM marketing_deletion_requests WHERE id = ? AND status = 'pending'").get(id);
      if (!request) return { error: 'Nie znaleziono aktywnego żądania.' };
      const payload = cryptoBox.decrypt(request.encrypted_payload, request.payload_iv, request.payload_tag);
      const normalized = normalizeEmail(payload.email);
      const matching = db.prepare('SELECT * FROM submissions WHERE anonymized_at IS NULL').all().filter(row => {
        const identity = clientIdentity(decryptSubmission(row), row.client_email_override, row.client_name_override);
        return normalizeEmail(identity.email) === normalized;
      });
      let removed = 0;
      for (const row of matching) if (this.withdrawAllMarketingConsents(row.id, adminId, ip, 'service_request')) removed += 1;
      db.prepare("UPDATE marketing_deletion_requests SET status = 'processed', processed_at = ?, processed_by = ? WHERE id = ?").run(now(), adminId, id);
      audit(adminId, 'marketing_deletion_processed', 'marketing_deletion_request', id, { matched_records: matching.length, removed_records: removed }, ip);
      return { ok: true, removed };
    },
    createMarketingCampaign(body, contacts, adminId, ip) {
      const name = String(body.name || '').trim();
      const subject = String(body.subject || '').trim();
      const content = String(body.content || '').trim();
      if (!name || !subject || !content || !contacts.length) return { error: 'Uzupełnij kampanię i wybierz odbiorców ze zgodą e-mail.' };
      const timestamp = now();
      db.exec('BEGIN');
      try {
        const result = db.prepare('INSERT INTO marketing_campaigns (name, subject, content, created_by, recipient_count, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(name, subject, content, adminId, contacts.length, timestamp);
        const campaignId = Number(result.lastInsertRowid);
        const insert = db.prepare('INSERT INTO marketing_campaign_recipients (campaign_id, submission_id, recipient_email, recipient_name, unsubscribe_token) VALUES (?, ?, ?, ?, ?)');
        for (const contact of contacts) insert.run(campaignId, contact.submission_id, contact.email, contact.client_name, randomToken(24));
        db.exec('COMMIT');
        audit(adminId, 'marketing_campaign_created', 'marketing_campaign', campaignId, { recipient_count: contacts.length }, ip);
        return { ok: true, id: campaignId };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listMarketingCampaigns() {
      return db.prepare(`SELECT c.*, a.display_name, a.username FROM marketing_campaigns c LEFT JOIN admins a ON a.id = c.created_by ORDER BY c.created_at DESC LIMIT 200`).all()
        .map(row => ({ ...row, admin_name: row.display_name || row.username || 'System' }));
    },
    getMarketingCampaign(id) {
      const campaign = db.prepare('SELECT * FROM marketing_campaigns WHERE id = ?').get(id);
      if (!campaign) return null;
      const recipients = db.prepare('SELECT * FROM marketing_campaign_recipients WHERE campaign_id = ? ORDER BY id').all(id);
      return { ...campaign, recipients };
    },
    markCampaignSending(id, adminId, ip) {
      const campaign = db.prepare("SELECT * FROM marketing_campaigns WHERE id = ? AND status IN ('draft', 'partial')").get(id);
      if (!campaign) return false;
      db.prepare("UPDATE marketing_campaigns SET status = 'sending' WHERE id = ?").run(id);
      audit(adminId, 'marketing_campaign_sending', 'marketing_campaign', id, {}, ip);
      return true;
    },
    markCampaignRecipient(recipientId, status, providerMessageId = '', errorMessage = '') {
      db.prepare('UPDATE marketing_campaign_recipients SET status = ?, provider_message_id = ?, error_message = ?, sent_at = ? WHERE id = ?')
        .run(status, providerMessageId, String(errorMessage || '').slice(0, 500), status === 'sent' ? now() : null, recipientId);
    },
    finishMarketingCampaign(id, adminId, ip) {
      const counts = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM marketing_campaign_recipients WHERE campaign_id = ?`).get(id);
      const status = Number(counts.failed || 0) > 0 ? 'partial' : 'sent';
      db.prepare('UPDATE marketing_campaigns SET status = ?, sent_count = ?, failed_count = ?, sent_at = ? WHERE id = ?')
        .run(status, Number(counts.sent || 0), Number(counts.failed || 0), now(), id);
      audit(adminId, 'marketing_campaign_finished', 'marketing_campaign', id, { sent: Number(counts.sent || 0), failed: Number(counts.failed || 0) }, ip);
      return { sent: Number(counts.sent || 0), failed: Number(counts.failed || 0), status };
    },
    unsubscribeMarketing(token, ip = '') {
      const recipient = db.prepare(`SELECT r.*, c.subject FROM marketing_campaign_recipients r JOIN marketing_campaigns c ON c.id = r.campaign_id WHERE r.unsubscribe_token = ?`).get(token);
      if (!recipient) return null;
      this.updateMarketingConsent(recipient.submission_id, 'email', false, null, ip, 'unsubscribe_link');
      db.prepare("UPDATE marketing_campaign_recipients SET status = CASE WHEN status = 'pending' THEN 'unsubscribed' ELSE status END WHERE id = ?").run(recipient.id);
      return { email: recipient.recipient_email, subject: recipient.subject };
    },
    listSubmissions(filters = {}) {
      const rows = db.prepare(`SELECT s.*, a.display_name AS assigned_name, a.username AS assigned_username, p.insurer, p.policy_number, p.end_date,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'email_sent') AS last_email_at,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'sms_sent') AS last_sms_at,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'phone_call') AS last_phone_at
        FROM submissions s LEFT JOIN admins a ON a.id = s.assigned_admin_id LEFT JOIN policies p ON p.submission_id = s.id AND p.is_current = 1 WHERE s.anonymized_at IS NULL ORDER BY s.submitted_at DESC LIMIT 1000`).all();
      const search = cleanValue(filters.search);
      return rows.map(row => {
        const data = decryptSubmission(row);
        const identity = clientIdentity(data, row.client_email_override, row.client_name_override);
        return { ...row, data, client_name: identity.name, assigned_name: row.assigned_name || row.assigned_username || '' };
      }).filter(row => {
        if (filters.status && row.status !== filters.status) return false;
        if (filters.form_type && row.form_type !== filters.form_type) return false;
        if (filters.admin && String(row.assigned_admin_id || '') !== String(filters.admin)) return false;
        if (filters.insurer && !cleanValue(`${row.insurer || ''} ${row.offer_insurer || ''} ${row.presented_insurers || ''}`).includes(cleanValue(filters.insurer))) return false;
        if (filters.consent_email !== undefined && filters.consent_email !== '' && Boolean(row.marketing_email_consent) !== (filters.consent_email === '1')) return false;
        if (filters.consent_sms !== undefined && filters.consent_sms !== '' && Boolean(row.marketing_sms_consent) !== (filters.consent_sms === '1')) return false;
        if (filters.consent_phone !== undefined && filters.consent_phone !== '' && Boolean(row.marketing_phone_consent) !== (filters.consent_phone === '1')) return false;
        if (filters.date_from && row.submitted_at.slice(0, 10) < filters.date_from) return false;
        if (filters.date_to && row.submitted_at.slice(0, 10) > filters.date_to) return false;
        if (search && !`${row.id} ${row.client_name} ${row.form_type} ${row.policy_number || ''} ${searchableText(row.data)}`.toLowerCase().includes(search)) return false;
        return true;
      }).map(row => ({
        id: row.id, form_type: row.form_type, submitted_at: row.submitted_at, updated_at: row.updated_at,
        status: row.status, assigned_admin_id: row.assigned_admin_id, assigned_name: row.assigned_name,
        marketing_email_consent: row.marketing_email_consent, marketing_sms_consent: row.marketing_sms_consent,
        marketing_phone_consent: row.marketing_phone_consent, insurer: row.insurer || '', offer_insurer: row.offer_insurer || '',
        presented_insurers: row.presented_insurers || '', policy_number: row.policy_number || '',
        end_date: row.end_date || '', client_name: row.client_name, client_email: row.data ? clientIdentity(row.data, row.client_email_override, row.client_name_override).email : '',
        client_phone: row.data ? clientIdentity(row.data, row.client_email_override, row.client_name_override).phone : '',
        last_email_at: row.last_email_at || '', last_sms_at: row.last_sms_at || '', last_phone_at: row.last_phone_at || ''
      }));
    },
    listContactTasks(filters = {}) {
      const customTasks = db.prepare(`SELECT t.*, s.form_type, s.client_email_override, s.client_name_override,
        creator.display_name AS creator_display_name, creator.username AS creator_username,
        completer.display_name AS completer_display_name, completer.username AS completer_username
        FROM contact_tasks t
        JOIN submissions s ON s.id = t.submission_id
        LEFT JOIN admins creator ON creator.id = t.created_by
        LEFT JOIN admins completer ON completer.id = t.completed_by
        WHERE s.anonymized_at IS NULL`).all().map(row => {
          const submission = db.prepare('SELECT encrypted_payload, payload_iv, payload_tag FROM submissions WHERE id = ?').get(row.submission_id);
          const identity = clientIdentity(decryptSubmission(submission), row.client_email_override, row.client_name_override);
          return {
            id: `custom-${row.id}`, task_id: row.id, source: 'custom', submission_id: row.submission_id,
            client_name: identity.name, client_email: identity.email, client_phone: identity.phone,
            product: row.product, form_type: row.form_type, coverage_end_date: row.coverage_end_date || '',
            contact_due_at: row.contact_due_at, notes: row.notes || '', status: row.status,
            created_at: row.created_at, completed_at: row.completed_at || '',
            created_by_name: row.creator_display_name || row.creator_username || 'System',
            completed_by_name: row.completer_display_name || row.completer_username || ''
          };
        });
      const submissionTasks = db.prepare(`SELECT s.*, p.end_date AS policy_end_date
        FROM submissions s
        LEFT JOIN policies p ON p.submission_id = s.id AND p.is_current = 1
        WHERE s.anonymized_at IS NULL AND s.contact_due_at IS NOT NULL AND s.contact_due_at <> ''`).all().map(row => {
          const identity = clientIdentity(decryptSubmission(row), row.client_email_override, row.client_name_override);
          return {
            id: `submission-${row.id}`, task_id: null, source: 'submission', submission_id: row.id,
            client_name: identity.name, client_email: identity.email, client_phone: identity.phone,
            product: row.form_type, form_type: row.form_type, coverage_end_date: row.policy_end_date || '',
            contact_due_at: row.contact_due_at, notes: 'Termin kolejnego kontaktu w obsłudze zgłoszenia lub wznowienia.',
            status: 'pending', created_at: row.updated_at, completed_at: '', created_by_name: row.assigned_admin_id ? adminName(row.assigned_admin_id) : 'System', completed_by_name: ''
          };
        });
      const search = cleanValue(filters.search);
      return [...submissionTasks, ...customTasks].filter(item => {
        if (filters.submission_id && String(item.submission_id) !== String(filters.submission_id)) return false;
        if (filters.status && item.status !== filters.status) return false;
        if (search && !cleanValue(`${item.client_name} ${item.client_email} ${item.client_phone} ${item.product} ${item.notes} ${item.submission_id}`).includes(search)) return false;
        return true;
      }).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
        return String(a.contact_due_at).localeCompare(String(b.contact_due_at));
      });
    },
    getSubmission(id) {
      const row = db.prepare(`SELECT s.*, a.display_name AS assigned_name, a.username AS assigned_username FROM submissions s LEFT JOIN admins a ON a.id = s.assigned_admin_id WHERE s.id = ?`).get(id);
      if (!row) return null;
      const contacts = db.prepare(`SELECT c.*, a.display_name, a.username FROM contact_history c LEFT JOIN admins a ON a.id = c.admin_id WHERE c.submission_id = ? ORDER BY c.created_at DESC`).all(id).map(item => ({ ...item, admin_name: item.display_name || item.username || 'System' }));
      const notes = db.prepare(`SELECT n.*, a.display_name, a.username FROM note_history n LEFT JOIN admins a ON a.id = n.admin_id WHERE n.submission_id = ? ORDER BY n.created_at DESC`).all(id).map(item => ({ ...item, admin_name: item.display_name || item.username || 'System' }));
      const policies = db.prepare(`SELECT p.*, a.display_name, a.username FROM policies p LEFT JOIN admins a ON a.id = p.created_by WHERE p.submission_id = ? ORDER BY p.period_number DESC, p.created_at DESC`).all(id).map(item => ({ ...item, lifecycle_status: policyLifecycle(item), admin_name: item.display_name || item.username || 'System' }));
      for (const policy of policies) {
        policy.documents = db.prepare('SELECT id, filename, mime_type, file_size, uploaded_at FROM policy_documents WHERE policy_id = ? ORDER BY uploaded_at DESC').all(policy.id);
        policy.email_history = db.prepare('SELECT id, recipient_type, recipient_email, subject, delivery_status, sent_at FROM email_log WHERE policy_id = ? ORDER BY sent_at DESC').all(policy.id);
      }
      const consents = db.prepare('SELECT * FROM consent_history WHERE submission_id = ? ORDER BY created_at DESC').all(id);
      const data = row.anonymized_at ? {} : decryptSubmission(row);
      const identity = clientIdentity(data, row.client_email_override, row.client_name_override);
      const contactTasks = row.anonymized_at ? [] : this.listContactTasks({ submission_id: id });
      return { ...row, assigned_name: row.assigned_name || row.assigned_username || '', data, client_name: identity.name, client_email: identity.email, client_phone: identity.phone, contacts, contact_tasks: contactTasks, note_history: notes, policies, consent_history: consents, encrypted_payload: undefined, payload_iv: undefined, payload_tag: undefined };
    },
    createContactTask(submissionId, body, adminId, ip) {
      if (!db.prepare('SELECT id FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(submissionId)) return { error: 'Nie znaleziono klienta.' };
      const product = String(body.product || '').trim().slice(0, 160);
      const contactDueAt = String(body.contact_due_at || '').trim();
      const coverageEndDate = String(body.coverage_end_date || '').trim().slice(0, 10) || null;
      const notes = String(body.notes || '').trim().slice(0, 1200);
      if (!product) return { error: 'Wpisz produkt lub powód kontaktu.' };
      if (!contactDueAt || Number.isNaN(new Date(contactDueAt).getTime())) return { error: 'Wybierz prawidłowy termin kontaktu.' };
      if (coverageEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(coverageEndDate)) return { error: 'Data końca ochrony jest nieprawidłowa.' };
      const timestamp = now();
      const result = db.prepare(`INSERT INTO contact_tasks (submission_id, product, coverage_end_date, contact_due_at, notes, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(submissionId, product, coverageEndDate, contactDueAt, notes, adminId || null, timestamp, timestamp);
      const label = `Zaplanowano kontakt: ${product}`;
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(submissionId, adminId, 'contact_task_created', label, `${contactDueAt}${notes ? ` · ${notes}` : ''}`, timestamp);
      audit(adminId, 'contact_task_created', 'contact_task', result.lastInsertRowid, { submission_id: submissionId, product, contact_due_at: contactDueAt }, ip);
      return { id: Number(result.lastInsertRowid) };
    },
    createManualContactTask(body, adminId, ip) {
      const clientName = String(body.client_name || '').trim().slice(0, 180);
      const clientPhone = String(body.client_phone || '').trim().slice(0, 60);
      const clientEmail = String(body.client_email || '').trim().slice(0, 180);
      const product = String(body.product || '').trim().slice(0, 160);
      const contactDueAt = String(body.contact_due_at || '').trim();
      const coverageEndDate = String(body.coverage_end_date || '').trim().slice(0, 10) || null;
      const notes = String(body.notes || '').trim().slice(0, 1200);
      if (!clientName) return { error: 'Wpisz imię i nazwisko klienta.' };
      if (!clientPhone && !clientEmail) return { error: 'Wpisz numer telefonu lub adres e-mail klienta.' };
      if (!product) return { error: 'Wpisz produkt lub powód kontaktu.' };
      if (!contactDueAt || Number.isNaN(new Date(contactDueAt).getTime())) return { error: 'Wybierz prawidłowy termin kontaktu.' };
      if (coverageEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(coverageEndDate)) return { error: 'Data końca ochrony jest nieprawidłowa.' };
      const timestamp = now();
      const encrypted = cryptoBox.encrypt({
        'Imię i nazwisko': clientName,
        'Telefon': clientPhone,
        'E-mail': clientEmail,
        'Źródło': 'Wpis ręczny administratora'
      });
      let submissionId;
      let taskId;
      db.exec('BEGIN');
      try {
        const submission = db.prepare(`INSERT INTO submissions (form_type, encrypted_payload, payload_iv, payload_tag, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, submitted_at, status, updated_at, assigned_admin_id)
          VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 'Wpis ręczny administratora', '1.0', ?, 'new', ?, ?)`)
          .run(product, encrypted.encrypted, encrypted.iv, encrypted.tag, timestamp, ip, timestamp, timestamp, adminId || null);
        submissionId = Number(submission.lastInsertRowid);
        db.prepare(`INSERT INTO consent_history (submission_id, privacy_accepted, marketing_email_consent, marketing_sms_consent, marketing_phone_consent, consent_timestamp, consent_ip, consent_user_agent, consent_version, created_at)
          VALUES (?, 0, 0, 0, 0, ?, ?, 'Wpis ręczny administratora', '1.0', ?)`).run(submissionId, timestamp, ip, timestamp);
        const task = db.prepare(`INSERT INTO contact_tasks (submission_id, product, coverage_end_date, contact_due_at, notes, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(submissionId, product, coverageEndDate, contactDueAt, notes, adminId || null, timestamp, timestamp);
        taskId = Number(task.lastInsertRowid);
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(submissionId, adminId, 'contact_task_created', `Ręcznie dodano klienta do kontaktu: ${product}`, notes, timestamp);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      audit(adminId, 'manual_contact_created', 'submission', submissionId, { task_id: taskId, product, contact_due_at: contactDueAt }, ip);
      return { submission_id: submissionId, task_id: taskId };
    },
    completeContactTask(taskId, adminId, ip) {
      const task = db.prepare("SELECT * FROM contact_tasks WHERE id = ? AND status = 'pending'").get(taskId);
      if (!task) return false;
      const timestamp = now();
      db.prepare("UPDATE contact_tasks SET status = 'completed', completed_by = ?, completed_at = ?, updated_at = ? WHERE id = ?")
        .run(adminId || null, timestamp, timestamp, taskId);
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(task.submission_id, adminId, 'contact_task_completed', `Kontakt wykonany: ${task.product}`, task.notes || '', timestamp);
      audit(adminId, 'contact_task_completed', 'contact_task', taskId, { submission_id: task.submission_id }, ip);
      return true;
    },
    completeSubmissionContact(submissionId, adminId, ip) {
      const submission = db.prepare("SELECT contact_due_at FROM submissions WHERE id = ? AND anonymized_at IS NULL AND contact_due_at IS NOT NULL AND contact_due_at <> ''").get(submissionId);
      if (!submission) return false;
      const timestamp = now();
      db.prepare('UPDATE submissions SET contact_due_at = NULL, updated_at = ? WHERE id = ?').run(timestamp, submissionId);
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(submissionId, adminId, 'contact_due_completed', 'Wykonano zaplanowany kontakt', submission.contact_due_at, timestamp);
      audit(adminId, 'contact_due_completed', 'submission', submissionId, { scheduled_for: submission.contact_due_at }, ip);
      return true;
    },
    updateSubmission(id, body, adminId, ip) {
      const current = db.prepare('SELECT * FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(id);
      if (!current) return { error: 'Nie znaleziono zgłoszenia.' };
      const status = CRM_STATUSES.includes(body.status) ? body.status : current.status;
      if (status === 'policy_concluded' && current.status !== 'policy_concluded') {
        return { error: 'Status „Polisa zawarta” jest nadawany automatycznie dopiero po zapisaniu nowej polisy w bazie.' };
      }
      if (status === 'cancelled') {
        const policy = db.prepare('SELECT id, canceled_at FROM policies WHERE submission_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1').get(id);
        if (!policy) return { error: 'Nie można oznaczyć sprawy jako anulowanej, ponieważ klient nie ma zapisanej polisy.' };
        if (!policy.canceled_at) db.prepare('UPDATE policies SET canceled_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), policy.id);
      }
      const assigned = body.assigned_admin_id === undefined ? current.assigned_admin_id : (body.assigned_admin_id === '' || body.assigned_admin_id == null ? null : Number(body.assigned_admin_id));
      const dueAt = body.contact_due_at === undefined ? current.contact_due_at : (body.contact_due_at || null);
      const emailOverride = body.client_email_override === undefined ? current.client_email_override : String(body.client_email_override || '').trim();
      const nameOverride = body.client_name_override === undefined ? current.client_name_override : String(body.client_name_override || '').trim();
      const offerInsurer = body.offer_insurer === undefined ? current.offer_insurer : String(body.offer_insurer || '').trim().slice(0, 300);
      const presentedInsurers = body.presented_insurers === undefined ? current.presented_insurers : String(body.presented_insurers || '').trim().slice(0, 1000);
      const timestamp = now();
      db.prepare('UPDATE submissions SET status = ?, assigned_admin_id = ?, contact_due_at = ?, client_email_override = ?, client_name_override = ?, offer_insurer = ?, presented_insurers = ?, updated_at = ? WHERE id = ?').run(status, assigned, dueAt, emailOverride, nameOverride, offerInsurer, presentedInsurers, timestamp, id);
      if (status !== current.status) {
        const label = `Status zmieniony: ${current.status} → ${status}`;
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(id, adminId, 'status_change', label, now());
        audit(adminId, 'status_changed', 'submission', id, { from: current.status, to: status }, ip);
      }
      if (String(current.assigned_admin_id || '') !== String(assigned || '')) audit(adminId, 'assignment_changed', 'submission', id, { assigned_admin_id: assigned }, ip);
      if (String(current.contact_due_at || '') !== String(dueAt || '')) {
        const label = dueAt ? `Ustawiono termin kolejnego kontaktu: ${dueAt}` : 'Usunięto termin kolejnego kontaktu';
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(id, adminId, 'contact_due_changed', label, timestamp);
        audit(adminId, 'contact_due_changed', 'submission', id, { from: current.contact_due_at, to: dueAt }, ip);
      }
      if (offerInsurer !== current.offer_insurer) {
        const label = offerInsurer ? `Towarzystwo oferty wysłanej: ${offerInsurer}` : 'Usunięto informację o towarzystwie oferty wysłanej';
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(id, adminId, 'offer_insurer_changed', label, timestamp);
        audit(adminId, 'offer_insurer_changed', 'submission', id, { value: offerInsurer }, ip);
      }
      if (presentedInsurers !== current.presented_insurers) {
        const label = presentedInsurers ? `Oferty przedstawione klientowi: ${presentedInsurers}` : 'Usunięto informację o przedstawionych ofertach';
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(id, adminId, 'presented_insurers_changed', label, timestamp);
        audit(adminId, 'presented_insurers_changed', 'submission', id, { value: presentedInsurers }, ip);
      }
      return { ok: true };
    },
    addContactAction(id, action, adminId, details, ip) {
      const definitions = {
        offer_sent: ['Oferta wysłana', 'offer_sent'], email_sent: ['Kontakt e-mail wykonany', null], sms_sent: ['Kontakt SMS wykonany', null], phone_call: ['Kontakt telefoniczny wykonany', null],
        additional_offer: ['Dosłano dodatkową ofertę', 'offer_sent'], client_replied: ['Klient odpowiedział', 'in_progress'],
        awaiting_decision: ['Oczekiwanie na decyzję', 'awaiting_client'], client_resigned: ['Klient zrezygnował', 'closed_lost']
      };
      const definition = definitions[action];
      if (!definition) return false;
      const submission = db.prepare('SELECT status FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(id);
      if (!submission) return false;
      if (action === 'offer_sent' && !['in_progress', 'offer_sent', 'awaiting_client'].includes(submission.status)) return false;
      const timestamp = now();
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, adminId, action, definition[0], String(details || ''), timestamp);
      if (definition[1]) db.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?').run(definition[1], timestamp, id);
      audit(adminId, 'contact_action', 'submission', id, { action, label: definition[0] }, ip);
      return true;
    },
    saveNotes(id, value, adminId, ip) {
      const current = db.prepare('SELECT internal_notes FROM submissions WHERE id = ?').get(id);
      if (!current) return false;
      db.prepare('UPDATE submissions SET internal_notes = ?, updated_at = ? WHERE id = ?').run(String(value || ''), now(), id);
      db.prepare('INSERT INTO note_history (submission_id, admin_id, previous_value, new_value, created_at) VALUES (?, ?, ?, ?, ?)').run(id, adminId, current.internal_notes || '', String(value || ''), now());
      audit(adminId, 'notes_changed', 'submission', id, {}, ip);
      return true;
    },
    savePolicy(id, body, adminId, ip) {
      const required = ['policy_number', 'insurer', 'start_date', 'end_date', 'product_type'];
      if (required.some(field => !String(body[field] || '').trim())) return { error: 'Uzupełnij wymagane dane polisy.' };
      if (!POLICY_PRODUCT_TYPES.includes(String(body.product_type || '').trim())) return { error: 'Wybierz rodzaj ubezpieczenia z dostępnej listy.' };
      if (!POLICY_INSURERS.includes(String(body.insurer || '').trim())) return { error: 'Wybierz towarzystwo ubezpieczeniowe z dostępnej listy.' };
      if (String(body.end_date) < String(body.start_date)) return { error: 'Data końca ochrony nie może być wcześniejsza niż data początku.' };
      if (!db.prepare('SELECT id FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(id)) return { error: 'Nie znaleziono klienta.' };
      const sourcePolicyId = Number(body.renewed_from_policy_id || 0) || null;
      const source = sourcePolicyId ? db.prepare('SELECT * FROM policies WHERE id = ? AND submission_id = ? AND is_current = 1').get(sourcePolicyId, id) : null;
      if (sourcePolicyId && !source) return { error: 'Wybrana polisa nie może zostać wznowiona.' };
      const timestamp = now();
      const periodNumber = Number(db.prepare('SELECT COALESCE(MAX(period_number), 0) AS value FROM policies WHERE submission_id = ?').get(id).value) + 1;
      let policyId;
      db.exec('BEGIN');
      try {
        if (source) db.prepare("UPDATE policies SET is_current = 0, renewal_status = 'renewed', renewal_updated_at = ? WHERE id = ?").run(timestamp, source.id);
        const result = db.prepare("INSERT INTO policies (submission_id, policy_number, insurer, premium, start_date, end_date, client_number, product_type, offer_number, notes, period_number, renewed_from_policy_id, is_current, renewal_status, renewal_updated_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?, ?)")
          .run(id, body.policy_number.trim(), body.insurer.trim(), Number(body.premium || 0), body.start_date, body.end_date, String(body.client_number || '').trim(), body.product_type.trim(), String(body.offer_number || '').trim(), String(body.notes || '').trim(), periodNumber, source?.id || null, timestamp, adminId, timestamp, timestamp);
        policyId = Number(result.lastInsertRowid);
        if (source) db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, adminId, 'policy_renewed', 'Utworzono nową polisę w ramach wznowienia', `Poprzednia polisa: ${source.policy_number}; nowa polisa: ${body.policy_number}`, timestamp);
        db.prepare("UPDATE submissions SET status = 'policy_concluded', updated_at = ? WHERE id = ?").run(timestamp, id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      audit(adminId, source ? 'policy_renewed' : 'policy_created', 'policy', policyId, { submission_id: id, previous_policy_id: source?.id || null, insurer: body.insurer, end_date: body.end_date }, ip);
      return { ok: true, id: policyId };
    },
    renewPolicy(id, body, adminId, ip) {
      const current = db.prepare('SELECT * FROM policies WHERE submission_id = ? AND is_current = 1').get(id);
      if (!current) return { error: 'Brak aktywnej polisy do wznowienia.' };
      return this.savePolicy(id, { ...body, renewed_from_policy_id: current.id }, adminId, ip);
    },
    anonymize(id, reason, adminId, ip) {
      const current = db.prepare('SELECT * FROM submissions WHERE id = ? AND anonymized_at IS NULL').get(id);
      if (!current) return false;
      const identity = clientIdentity(decryptSubmission(current), current.client_email_override, current.client_name_override);
      const anonymous = cryptoBox.encrypt({ anonymized: true });
      const timestamp = now();
      const policyIds = db.prepare('SELECT id FROM policies WHERE submission_id = ?').all(id).map(row => String(row.id));
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO anonymization_log (submission_reference, form_type, previous_status, reason, admin_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, current.form_type, current.status, String(reason || ''), adminId, timestamp);
        db.prepare("UPDATE submissions SET encrypted_payload = ?, payload_iv = ?, payload_tag = ?, internal_notes = '', client_name_override = '', client_email_override = '', consent_ip = 'zanonimizowano', consent_user_agent = '', status = 'archive', anonymized_at = ?, updated_at = ? WHERE id = ?")
          .run(anonymous.encrypted, anonymous.iv, anonymous.tag, timestamp, timestamp, id);
        db.prepare("UPDATE policies SET policy_number = '', client_number = '', offer_number = '', notes = '', premium = 0, insurer = 'zanonimizowano', last_client_email = '', updated_at = ? WHERE submission_id = ?").run(timestamp, id);
        db.prepare("UPDATE contact_history SET details = '' WHERE submission_id = ?").run(id);
        db.prepare("UPDATE note_history SET previous_value = '', new_value = '' WHERE submission_id = ?").run(id);
        db.prepare("UPDATE consent_history SET consent_ip = 'zanonimizowano', consent_user_agent = '' WHERE submission_id = ?").run(id);
        db.prepare("UPDATE email_log SET recipient_email = 'zanonimizowano', subject = 'zanonimizowano' WHERE submission_id = ?").run(id);
        db.prepare("UPDATE marketing_campaign_recipients SET recipient_email = 'zanonimizowano', recipient_name = 'zanonimizowano', unsubscribe_token = ? WHERE submission_id = ?").run(randomToken(24), id);
        if (identity.email) db.prepare('DELETE FROM marketing_suppressions WHERE normalized_email = ?').run(normalizeEmail(identity.email));
        db.prepare('DELETE FROM policy_documents WHERE submission_id = ?').run(id);
        db.prepare("UPDATE audit_log SET metadata = '{}' WHERE entity_type = 'submission' AND entity_id = ?").run(String(id));
        for (const policyId of policyIds) db.prepare("UPDATE audit_log SET metadata = '{}' WHERE entity_type = 'policy' AND entity_id = ?").run(policyId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      audit(adminId, 'submission_anonymized', 'submission', id, {}, ip);
      return true;
    },
    dashboard(options = {}) {
      const parsedContactDays = Number.parseInt(options.contact_days, 10);
      const allNewHistory = options.new_days === 'all';
      const parsedNewDays = Number.parseInt(options.new_days, 10);
      const contactDays = Math.min(30, Math.max(1, Number.isFinite(parsedContactDays) ? parsedContactDays : 1));
      const newDays = allNewHistory ? 'all' : Math.max(1, Number.isFinite(parsedNewDays) ? parsedNewDays : 1);
      const statusRows = db.prepare('SELECT status, COUNT(*) AS count FROM submissions WHERE anonymized_at IS NULL GROUP BY status').all();
      const statusCounts = Object.fromEntries(CRM_STATUSES.map(status => [status, 0]));
      for (const row of statusRows) statusCounts[row.status] = row.count;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const contactEnd = new Date(today);
      contactEnd.setDate(contactEnd.getDate() + contactDays - 1);
      const contactEndLocal = `${contactEnd.getFullYear()}-${String(contactEnd.getMonth() + 1).padStart(2, '0')}-${String(contactEnd.getDate()).padStart(2, '0')}T23:59:59.999`;
      const newStart = new Date(today);
      if (!allNewHistory) newStart.setDate(newStart.getDate() - newDays + 1);
      const newStartIso = allNewHistory || Number.isNaN(newStart.getTime()) ? '0000-01-01T00:00:00.000Z' : newStart.toISOString();
      const newInWindow = db.prepare("SELECT COUNT(*) AS count FROM submissions WHERE anonymized_at IS NULL AND status = 'new' AND submitted_at >= ?").get(newStartIso).count;
      const policies = db.prepare('SELECT p.*, s.form_type FROM policies p JOIN submissions s ON s.id = p.submission_id WHERE p.is_current = 1 AND p.canceled_at IS NULL AND s.anonymized_at IS NULL ORDER BY p.end_date').all();
      const futurePolicies = policies.map(policy => {
        const end = new Date(`${policy.end_date}T00:00:00`);
        const days = Math.ceil((end - today) / 86_400_000);
        return { ...policy, days_remaining: days };
      }).filter(policy => policy.days_remaining >= 0 && String(policy.start_date).slice(0, 10) <= todayIso && !['renewed', 'not_due', 'resigned'].includes(policy.renewal_status));
      const reminders = futurePolicies.filter(policy => policy.days_remaining <= 60);
      const renewalWindows = Object.fromEntries([7, 14, 30, 60].map(days => [days, futurePolicies.filter(policy => policy.days_remaining <= days).length]));
      const milestones = new Set([30, 21, 14, 7, 3, 0]);
      const dueReminders = reminders.map(item => ({ ...item, is_milestone: milestones.has(item.days_remaining) }));
      const contactDue = db.prepare(`SELECT COUNT(*) AS count FROM (
        SELECT s.id AS submission_id FROM submissions s
        WHERE s.anonymized_at IS NULL AND s.contact_due_at IS NOT NULL AND s.contact_due_at <> '' AND s.contact_due_at <= ?
        UNION
        SELECT t.submission_id FROM contact_tasks t JOIN submissions s ON s.id = t.submission_id
        WHERE s.anonymized_at IS NULL AND t.status = 'pending' AND t.contact_due_at <= ?
      )`).get(contactEndLocal, contactEndLocal).count;
      return {
        total: Object.values(statusCounts).reduce((sum, value) => sum + value, 0), status_counts: statusCounts,
        renewal_windows: renewalWindows, contacts_due: contactDue, contact_days: contactDays,
        new_in_window: newInWindow, new_days: newDays,
        reminders: dueReminders.slice(0, 100)
      };
    },
    listRenewals() {
      return db.prepare(`SELECT p.*, s.form_type, s.client_email_override, s.client_name_override,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'email_sent') AS last_email_at,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'sms_sent') AS last_sms_at,
        (SELECT MAX(created_at) FROM contact_history c WHERE c.submission_id = s.id AND c.action_type = 'phone_call') AS last_phone_at
        FROM policies p JOIN submissions s ON s.id = p.submission_id WHERE p.canceled_at IS NULL AND ((p.is_current = 1 AND p.renewal_status <> 'not_due') OR p.renewal_status = 'renewed') AND s.anonymized_at IS NULL ORDER BY date(p.end_date) ASC, p.id ASC`).all().map(row => {
        const payload = db.prepare('SELECT encrypted_payload, payload_iv, payload_tag FROM submissions WHERE id = ?').get(row.submission_id);
        const identity = clientIdentity(decryptSubmission(payload), row.client_email_override, row.client_name_override);
        return { ...row, lifecycle_status: policyLifecycle(row), client_name: identity.name, client_email: identity.email, client_phone: identity.phone };
      });
    },
    listIssuedPolicies(options = {}) {
      const archive = Boolean(options.archive);
      const today = todayLocal();
      const cancellationCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      return db.prepare(`SELECT p.*, s.form_type, s.client_email_override, s.client_name_override, (SELECT COUNT(*) FROM policy_documents d WHERE d.policy_id = p.id) AS document_count FROM policies p JOIN submissions s ON s.id = p.submission_id WHERE s.anonymized_at IS NULL ORDER BY date(p.start_date) DESC, p.id DESC`).all().filter(row => {
        const canceledArchived = Boolean(row.canceled_at && row.canceled_at < cancellationCutoff);
        const expired = row.end_date < today;
        return archive ? expired || canceledArchived : !expired && !canceledArchived;
      }).map(row => {
        const payload = db.prepare('SELECT encrypted_payload, payload_iv, payload_tag FROM submissions WHERE id = ?').get(row.submission_id);
        const identity = clientIdentity(decryptSubmission(payload), row.client_email_override, row.client_name_override);
        return { ...row, lifecycle_status: policyLifecycle(row), client_name: identity.name, client_email: identity.email, client_phone: identity.phone };
      });
    },
    updatePolicyLifecycleStatus(policyId, status, adminId, ip) {
      if (!['active', 'cancelled'].includes(status)) return { error: 'Nieprawidłowy status polisy.' };
      const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
      if (!policy) return { error: 'Nie znaleziono polisy.' };
      const timestamp = now();
      if (status === 'cancelled') {
        const canceledAt = policy.canceled_at || timestamp;
        db.prepare('UPDATE policies SET canceled_at = ?, updated_at = ? WHERE id = ?').run(canceledAt, timestamp, policyId);
        db.prepare("UPDATE submissions SET status = 'cancelled', updated_at = ? WHERE id = ?").run(timestamp, policy.submission_id);
      } else {
        db.prepare("UPDATE policies SET canceled_at = NULL, cancellation_reason = '', updated_at = ? WHERE id = ?").run(timestamp, policyId);
        db.prepare("UPDATE submissions SET status = 'policy_concluded', updated_at = ? WHERE id = ?").run(timestamp, policy.submission_id);
      }
      const label = status === 'cancelled' ? 'Polisa oznaczona jako anulowana' : 'Cofnięto anulowanie polisy';
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(policy.submission_id, adminId, 'policy_lifecycle_changed', label, timestamp);
      audit(adminId, 'policy_lifecycle_changed', 'policy', policyId, { status, canceled_at: status === 'cancelled' ? policy.canceled_at || timestamp : null }, ip);
      return { ok: true };
    },
    updatePolicyInspection(policyId, completed, adminId, ip) {
      const policy = db.prepare('SELECT id, submission_id, inspection_completed FROM policies WHERE id = ?').get(policyId);
      if (!policy) return false;
      const value = completed ? 1 : 0;
      const timestamp = now();
      db.prepare('UPDATE policies SET inspection_completed = ?, inspection_completed_at = ?, updated_at = ? WHERE id = ?')
        .run(value, value ? timestamp : null, timestamp, policyId);
      if (value !== Number(policy.inspection_completed || 0)) {
        const label = value ? 'Inspekcja oznaczona jako wykonana' : 'Inspekcja oznaczona jako niewykonana';
        db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(policy.submission_id, adminId, 'policy_inspection_changed', label, timestamp);
        audit(adminId, 'policy_inspection_changed', 'policy', policyId, { inspection_completed: Boolean(value) }, ip);
      }
      return true;
    },
    updatePolicyProductionStatus(policyId, method, adminId, ip) {
      const allowed = new Set(['none', 'manual']);
      if (!allowed.has(method)) return false;
      const policy = db.prepare('SELECT id, submission_id, sent_to_production_at, production_delivery_method FROM policies WHERE id = ?').get(policyId);
      if (!policy) return false;
      const timestamp = now();
      const sentAt = method === 'manual' ? timestamp : null;
      const storedMethod = method === 'manual' ? 'manual' : '';
      db.prepare('UPDATE policies SET sent_to_production_at = ?, production_delivery_method = ?, updated_at = ? WHERE id = ?').run(sentAt, storedMethod, timestamp, policyId);
      const label = method === 'manual' ? 'Wysyłka na produkcję oznaczona ręcznie' : 'Cofnięto oznaczenie wysyłki na produkcję';
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(policy.submission_id, adminId, 'policy_production_status_changed', label, method, timestamp);
      audit(adminId, 'policy_production_status_changed', 'policy', policyId, { method }, ip);
      return true;
    },
    updateRenewalStatus(policyId, renewalStatus, adminId, ip) {
      const allowed = new Set(['pending', 'contacted', 'offer_sent', 'awaiting_client', 'resigned']);
      if (!allowed.has(renewalStatus)) return false;
      const policy = db.prepare('SELECT * FROM policies WHERE id = ? AND is_current = 1').get(policyId);
      if (!policy) return false;
      const timestamp = now();
      db.prepare('UPDATE policies SET renewal_status = ?, renewal_updated_at = ?, updated_at = ? WHERE id = ?').run(renewalStatus, timestamp, timestamp, policyId);
      const labels = { pending: 'Wznowienie oczekuje', contacted: 'Kontakt w sprawie wznowienia wykonany', offer_sent: 'Oferta wznowieniowa wysłana', awaiting_client: 'Oczekiwanie na decyzję klienta', resigned: 'Klient zrezygnował ze wznowienia' };
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, created_at) VALUES (?, ?, ?, ?, ?)').run(policy.submission_id, adminId, `renewal_${renewalStatus}`, labels[renewalStatus], timestamp);
      audit(adminId, 'renewal_status_changed', 'policy', policyId, { renewal_status: renewalStatus }, ip);
      return true;
    },
    savePolicyDocument(policyId, document, adminId, ip) {
      const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
      if (!policy) return { error: 'Nie znaleziono polisy.' };
      const encrypted = cryptoBox.encrypt(document.content_base64);
      const result = db.prepare('INSERT INTO policy_documents (policy_id, submission_id, filename, mime_type, file_size, encrypted_content, content_iv, content_tag, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(policyId, policy.submission_id, document.filename, document.mime_type, document.file_size, encrypted.encrypted, encrypted.iv, encrypted.tag, adminId, now());
      audit(adminId, 'policy_document_uploaded', 'policy', policyId, { document_id: Number(result.lastInsertRowid), filename: document.filename }, ip);
      return { ok: true, id: Number(result.lastInsertRowid) };
    },
    getPolicyDocument(documentId) {
      const row = db.prepare('SELECT * FROM policy_documents WHERE id = ?').get(documentId);
      if (!row) return null;
      return { ...row, content_base64: cryptoBox.decrypt(row.encrypted_content, row.content_iv, row.content_tag), encrypted_content: undefined, content_iv: undefined, content_tag: undefined };
    },
    policyEmailContext(policyId) {
      const policy = db.prepare('SELECT p.*, s.client_email_override, s.client_name_override, s.anonymized_at FROM policies p JOIN submissions s ON s.id = p.submission_id WHERE p.id = ?').get(policyId);
      if (!policy || policy.anonymized_at) return null;
      const payload = db.prepare('SELECT encrypted_payload, payload_iv, payload_tag FROM submissions WHERE id = ?').get(policy.submission_id);
      const identity = clientIdentity(decryptSubmission(payload), policy.client_email_override, policy.client_name_override);
      const documents = db.prepare('SELECT * FROM policy_documents WHERE policy_id = ? ORDER BY uploaded_at DESC').all(policyId).map(row => ({ ...row, content_base64: cryptoBox.decrypt(row.encrypted_content, row.content_iv, row.content_tag) }));
      return { policy, identity, documents };
    },
    recordPolicyEmail(policyId, documentId, recipientType, recipientEmail, subject, providerMessageId, adminId, ip) {
      const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
      if (!policy) return false;
      const timestamp = now();
      db.prepare('INSERT INTO email_log (submission_id, policy_id, document_id, admin_id, recipient_type, recipient_email, subject, provider_message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(policy.submission_id, policyId, documentId || null, adminId, recipientType, recipientEmail, subject, providerMessageId || '', timestamp);
      if (recipientType === 'client') db.prepare('UPDATE policies SET sent_to_client_at = ?, last_client_email = ?, updated_at = ? WHERE id = ?').run(timestamp, recipientEmail, timestamp, policyId);
      if (recipientType === 'production') db.prepare("UPDATE policies SET sent_to_production_at = ?, production_delivery_method = 'automatic', updated_at = ? WHERE id = ?").run(timestamp, timestamp, policyId);
      db.prepare('INSERT INTO contact_history (submission_id, admin_id, action_type, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(policy.submission_id, adminId, `policy_sent_${recipientType}`, recipientType === 'client' ? 'Polisa wysłana do klienta' : 'Polisa wysłana na produkcję', recipientEmail, timestamp);
      audit(adminId, `policy_sent_${recipientType}`, 'policy', policyId, { recipient_email: recipientEmail, subject }, ip);
      return true;
    },
    anonymizationLog() {
      return db.prepare(`SELECT l.*, a.display_name, a.username FROM anonymization_log l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.created_at DESC LIMIT 500`).all().map(row => ({ ...row, admin_name: row.display_name || row.username || 'System' }));
    },
    auditLog() {
      return db.prepare(`SELECT l.*, a.display_name, a.username FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.created_at DESC LIMIT 1000`).all().map(row => ({ ...row, admin_name: row.display_name || row.username || 'System', metadata: JSON.parse(row.metadata || '{}') }));
    }
  };
}
