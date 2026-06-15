const statusDefinitions = [
  ['new', 'Nowe'],
  ['in_progress', 'W obsłudze'],
  ['offer_sent', 'Oferta wysłana'],
  ['awaiting_client', 'Oczekiwanie na klienta'],
  ['policy_concluded', 'Polisa zawarta'],
  ['closed_lost', 'Zamknięte – brak zawarcia'],
  ['archive', 'Archiwum']
];
const statusLabels = Object.fromEntries(statusDefinitions);
const propertyProductTypes = [
  'Ubezpieczenie mieszkania',
  'Ubezpieczenie domu',
  'Ubezpieczenie domu w budowie',
  'Ubezpieczenie domku letniskowego',
  'Ubezpieczenie altany'
];
const policyProductTypes = ['Nieruchomość', 'Życie', 'OC', 'AC', 'OC+AC', 'Turystyczne', 'Rolne', 'Firma', 'Smartfon', 'GAP', 'Zdrowotne', 'NNW', 'NNW SZKOLNE', 'Medycyna Bez Granic', 'Assistance Solo', 'Flota', 'OC Zawodowe'];
const insurerOptions = [
  'Aegon',
  'AGRO Ubezpieczenia TUW',
  'Allianz',
  'Allianz Życie',
  'Atradius',
  'Balcia',
  'Benefia',
  'Compensa',
  'Compensa Życie',
  'Defend Insurance (GAP)',
  'D.A.S.',
  'ERGO Hestia',
  'Europa / TU Europa',
  'Euroins',
  'Generali',
  'Generali Życie',
  'Inter Polska',
  'Inter Życie',
  'InterRisk',
  'Leadenhall',
  'LINK4',
  'Lloyd’s',
  'MetLife',
  'mtu24',
  'Nationale-Nederlanden',
  'Open Life',
  'Pocztowe TUW',
  'Proama',
  'PZU',
  'PZU Życie',
  'Saltus',
  'Saltus Życie',
  'Signal Iduna',
  'Trasti',
  'TUW „TUW”',
  'TUZ Ubezpieczenia',
  'Uniqa',
  'Uniqa Życie',
  'Unum',
  'Vienna Life',
  'Warta',
  'Warta Życie',
  'Wiener',
  'You Can Drive'
];

document.querySelector('#filterInsurer').innerHTML = `<option value="">Wszystkie towarzystwa</option>${insurerOptions.map(insurer => `<option value="${escapeHtml(insurer)}">${escapeHtml(insurer)}</option>`).join('')}`;
const actionDefinitions = [
  ['offer_sent', 'Oferta wysłana'],
  ['additional_offer', 'Dosłano dodatkową ofertę'],
  ['client_replied', 'Klient odpowiedział'],
  ['awaiting_decision', 'Oczekiwanie na decyzję'],
  ['policy_concluded', 'Polisa zawarta'],
  ['client_resigned', 'Klient zrezygnował']
];
const operationLabels = {
  login_success: 'Udane logowanie', login_failed: 'Nieudane logowanie', login_2fa_failed: 'Błędny kod 2FA', logout: 'Wylogowanie',
  submission_created: 'Utworzono zgłoszenie', status_changed: 'Zmieniono status', assignment_changed: 'Zmieniono prowadzącego',
  contact_action: 'Dodano kontakt', notes_changed: 'Zmieniono notatki', policy_created: 'Utworzono polisę', policy_updated: 'Zmieniono polisę',
  policy_renewed: 'Wznowiono polisę', submission_anonymized: 'Zanonimizowano zgłoszenie', password_changed: 'Zmieniono hasło',
  renewal_status_changed: 'Zmieniono status wznowienia', policy_document_uploaded: 'Wgrano plik polisy',
  policy_sent_client: 'Wysłano polisę klientowi', policy_sent_production: 'Wysłano polisę na produkcję', deletion_notice_sent: 'Wysłano potwierdzenie usunięcia danych',
  '2fa_enabled': 'Włączono 2FA', '2fa_disabled': 'Wyłączono 2FA', post_created: 'Opublikowano wpis', post_deleted: 'Usunięto wpis'
};
Object.assign(operationLabels, {
  marketing_campaign_created: 'Utworzono kampanię marketingową',
  marketing_campaign_sending: 'Rozpoczęto kampanię marketingową',
  marketing_campaign_finished: 'Zakończono kampanię marketingową',
  marketing_consent_enabled: 'Włączono zgodę marketingową',
  marketing_consent_withdrawn: 'Wycofano zgodę marketingową',
  marketing_contact_removed: 'Usunięto kontakt z bazy marketingowej',
  marketing_deletion_requested: 'Złożono żądanie usunięcia z marketingu',
  marketing_deletion_processed: 'Obsłużono żądanie usunięcia z marketingu',
  offer_insurer_changed: 'Zmieniono towarzystwo wysłanej oferty',
  presented_insurers_changed: 'Zmieniono listę przedstawionych ofert',
  policy_inspection_changed: 'Zmieniono status inspekcji polisy',
  policy_production_status_changed: 'Zmieniono status wysyłki na produkcję',
  contact_task_created: 'Zaplanowano kontakt z klientem',
  contact_task_completed: 'Wykonano zaplanowany kontakt',
  contact_due_changed: 'Zmieniono termin kolejnego kontaktu',
  contact_due_completed: 'Wykonano kontakt ze zgłoszenia'
});

let csrfToken = '';
let sessionData = null;
let dashboardData = null;
let submissions = [];
let admins = [];
let currentSubmissionId = null;
let searchTimer = null;
let idleTimer = null;
let marketingContacts = [];
let marketingCampaigns = [];
let marketingDeletionRequests = [];
const selectedMarketingContacts = new Set();
let renewalPortfolio = [];
let issuedPolicies = [];
let archivedPolicies = [];
let contactTasks = [];
let contactTaskClients = [];

const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const drawer = document.querySelector('#drawer');
const drawerBackdrop = document.querySelector('#drawerBackdrop');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatDate(value, dateOnly = false) {
  if (!value) return 'Brak';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function toDateInput(value) { return value ? String(value).slice(0, 10) : ''; }

function normalizedSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function policyMatchesSearch(item, query) {
  if (!query) return true;
  const searchable = normalizedSearch([item.client_name, item.client_email, item.client_phone, item.policy_number].join(' '));
  const compactSearchable = searchable.replace(/[\s()+-]/g, '');
  const compactQuery = query.replace(/[\s()+-]/g, '');
  return searchable.includes(query) || (compactQuery && compactSearchable.includes(compactQuery));
}

function toast(message, error = false) {
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.textContent = message;
  document.querySelector('#toastRegion').append(item);
  setTimeout(() => item.remove(), 4200);
}

async function api(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (csrfToken && ['POST', 'PATCH', 'DELETE'].includes(options.method)) headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !loginView.classList.contains('hidden')) throw new Error(payload.error || 'Nie udało się zalogować.');
    if (response.status === 401) showLoggedOut(payload.error || 'Sesja wygasła.');
    throw new Error(payload.error || 'Nie udało się wykonać operacji.');
  }
  return payload;
}

function showLoggedOut(message = '') {
  csrfToken = '';
  sessionData = null;
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
  document.querySelector('#loginStatus').textContent = message;
  closeDrawer();
}

function resetIdleTimer() {
  if (!sessionData) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => showLoggedOut('Wylogowano automatycznie po okresie bezczynności.'), (sessionData.idle_minutes || 30) * 60_000);
}
['pointerdown', 'keydown'].forEach(eventName => document.addEventListener(eventName, resetIdleTimer, { passive: true }));

async function showApp(session) {
  sessionData = session;
  csrfToken = session.csrf_token;
  document.querySelector('#adminName').textContent = session.display_name || session.username;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  document.querySelector('#twoFactorState').textContent = session.totp_enabled ? '2FA jest aktywne na tym koncie.' : '2FA nie jest jeszcze włączone.';
  document.querySelector('#twoFactorDisabled').classList.toggle('hidden', session.totp_enabled);
  document.querySelector('#twoFactorEnabled').classList.toggle('hidden', !session.totp_enabled);
  resetIdleTimer();
  await loadCoreData();
}

document.querySelector('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#loginStatus');
  const button = event.submitter;
  status.textContent = 'Sprawdzanie danych...';
  button.disabled = true;
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: document.querySelector('#username').value.trim(), password: document.querySelector('#password').value, totp_code: document.querySelector('#totpCode').value.trim() }) });
    if (result.requires_2fa) {
      document.querySelector('#totpField').classList.remove('hidden');
      document.querySelector('#totpCode').required = true;
      document.querySelector('#totpCode').focus();
      status.textContent = 'Podaj sześciocyfrowy kod 2FA.';
      return;
    }
    status.textContent = '';
    await showApp(result);
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

function showView(name) {
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== `${name}View`));
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === name));
  document.querySelector('#sidebar').classList.remove('open');
  if (name === 'anonymizations') loadAnonymizations();
  if (name === 'audit') loadAudit();
  if (name === 'blog') loadPosts();
  if (name === 'reminders') loadRenewals();
  if (name === 'policies') loadIssuedPolicies();
  if (name === 'policyArchive') loadArchivedPolicies();
  if (name === 'marketing') loadMarketing();
  if (name === 'contactTasks') loadContactTasks();
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
document.querySelectorAll('[data-view-target]').forEach(button => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
document.querySelector('#menuButton').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
document.querySelectorAll('[data-refresh]').forEach(button => button.addEventListener('click', loadCoreData));

async function loadCoreData() {
  try {
    const [dashboard, adminResult] = await Promise.all([api(`/api/admin/dashboard?${dashboardWindowParameters()}`), api('/api/admin/admins')]);
    dashboardData = dashboard;
    admins = adminResult.admins;
    renderDashboard();
    renderAdminOptions();
    await loadSubmissions();
  } catch (error) { toast(error.message, true); }
}

function renderDashboard() {
  document.querySelector('#dashboardDate').textContent = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full' }).format(new Date());
  const board = document.querySelector('#statusBoard');
  const counts = dashboardData.status_counts || {};
  board.innerHTML = [
    ['all', 'Wszystkie zgłoszenia', dashboardData.total], ...statusDefinitions.map(([key, label]) => [key, label, counts[key] || 0])
  ].map(([key, label, count]) => `<button class="status-card" type="button" data-dashboard-status="${key}"><span>${escapeHtml(label)}</span><strong>${count}</strong><small>Otwórz listę</small></button>`).join('');
  document.querySelector('#metricNew').textContent = dashboardData.new_in_window || 0;
  document.querySelector('#metricContacts').textContent = dashboardData.contacts_due || 0;
  const newDays = dashboardData.new_days === 'all' ? 'all' : Number(dashboardData.new_days || 1);
  const contactDays = Number(dashboardData.contact_days || 1);
  document.querySelector('#metricNewCaption').textContent = newDays === 'all' ? 'cała historia nowych' : newDays === 1 ? 'z dzisiaj' : `z ostatnich ${newDays} dni`;
  document.querySelector('#metricContactsCaption').textContent = contactDays === 1 ? 'zaległe i wymagane dzisiaj' : `zaległe i wymagane w ciągu ${contactDays} dni`;
  document.querySelector('#navNewCount').textContent = counts.new || 0;
  renderRenewalWindow();
}

function normalizedWindowValue(input, maximum = null) {
  let value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value) || value < 1) value = 1;
  if (maximum) value = Math.min(maximum, value);
  input.value = String(value);
  return value;
}

function dashboardWindowParameters() {
  const newWindow = document.querySelector('#newSubmissionWindow').value;
  const params = new URLSearchParams({
    contact_days: String(normalizedWindowValue(document.querySelector('#contactWindow'), 30)),
    new_days: newWindow === 'all' ? 'all' : String(normalizedWindowValue(document.querySelector('#newSubmissionWindow')))
  });
  return params.toString();
}

async function refreshDashboardCounts() {
  try {
    dashboardData = await api(`/api/admin/dashboard?${dashboardWindowParameters()}`);
    renderDashboard();
  } catch (error) { toast(error.message, true); }
}

function localDateInputValue(date) {
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const savedContactWindow = localStorage.getItem('lamk_contact_window');
const savedNewWindow = localStorage.getItem('lamk_new_submission_window');
if (['1', '3', '7', '14', '30'].includes(savedContactWindow)) document.querySelector('#contactWindow').value = savedContactWindow;
if (['1', '7', '14', '30', '60', '90', '180', '365', 'all'].includes(savedNewWindow)) document.querySelector('#newSubmissionWindow').value = savedNewWindow;
document.querySelector('#contactTaskTiming option[value="dashboard"]').textContent = Number(document.querySelector('#contactWindow').value) === 1 ? 'Okres z dashboardu: dzisiaj' : `Okres z dashboardu: ${document.querySelector('#contactWindow').value} dni`;
document.querySelector('#contactWindow').addEventListener('change', async event => {
  const days = normalizedWindowValue(event.currentTarget, 30);
  localStorage.setItem('lamk_contact_window', String(days));
  document.querySelector('#contactTaskTiming option[value="dashboard"]').textContent = days === 1 ? 'Okres z dashboardu: dzisiaj' : `Okres z dashboardu: ${days} dni`;
  await refreshDashboardCounts();
  if (document.querySelector('#contactTaskTiming').value === 'dashboard') renderContactTasks();
});
document.querySelector('#newSubmissionWindow').addEventListener('change', async event => {
  const value = event.currentTarget.value;
  localStorage.setItem('lamk_new_submission_window', value);
  await refreshDashboardCounts();
});

function renderRenewalWindow() {
  if (!dashboardData) return;
  const select = document.querySelector('#renewalWindow');
  const days = Number(select.value || 30);
  document.querySelector('#metricRenewals').textContent = dashboardData.renewal_windows?.[days] || 0;
  document.querySelector('#metricRenewalCaption').textContent = `w ciągu ${days} dni`;
  const reminders = (dashboardData.reminders || []).filter(item => item.days_remaining <= days);
  const empty = document.querySelector('#dashboardReminderEmpty');
  empty.textContent = `Brak polis do wznowienia w ciągu ${days} dni.`;
  renderReminderRows(document.querySelector('#dashboardReminderRows'), empty, reminders);
}

const savedRenewalWindow = localStorage.getItem('lamk_renewal_window');
if (['7', '14', '30', '60'].includes(savedRenewalWindow)) {
  document.querySelector('#renewalWindow').value = savedRenewalWindow;
  document.querySelector('#portfolioRenewalWindow').value = savedRenewalWindow;
}
document.querySelector('#renewalWindow').addEventListener('change', event => {
  localStorage.setItem('lamk_renewal_window', event.target.value);
  document.querySelector('#portfolioRenewalWindow').value = event.target.value;
  renderRenewalWindow();
  renderRenewalPortfolio();
});

document.querySelector('#statusBoard').addEventListener('click', event => {
  const card = event.target.closest('[data-dashboard-status]');
  if (!card) return;
  document.querySelector('#filterStatus').value = card.dataset.dashboardStatus === 'all' ? '' : card.dataset.dashboardStatus;
  showView('submissions');
  loadSubmissions();
});
document.querySelector('[data-open-status]').addEventListener('click', event => {
  document.querySelector('#filterStatus').value = event.currentTarget.dataset.openStatus;
  const selectedWindow = document.querySelector('#newSubmissionWindow').value;
  const today = new Date();
  if (selectedWindow === 'all') {
    document.querySelector('#filterDateFrom').value = '';
    document.querySelector('#filterDateTo').value = '';
  } else {
    const days = normalizedWindowValue(document.querySelector('#newSubmissionWindow'));
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - days + 1);
    document.querySelector('#filterDateFrom').value = localDateInputValue(start);
    document.querySelector('#filterDateTo').value = localDateInputValue(today);
  }
  showView('submissions');
  loadSubmissions();
});
document.querySelector('[data-contact-due]').addEventListener('click', () => {
  document.querySelector('#contactTaskStatus').value = 'pending';
  document.querySelector('#contactTaskTiming').value = 'dashboard';
  showView('contactTasks');
});

async function loadContactTasks() {
  try {
    const [taskResult, clientResult] = await Promise.all([
      api('/api/admin/contact-tasks'),
      api('/api/admin/submissions')
    ]);
    contactTasks = taskResult.tasks || [];
    contactTaskClients = (clientResult.submissions || []).sort((a, b) => String(a.client_name).localeCompare(String(b.client_name), 'pl'));
    renderDirectContactClients();
    renderContactTasks();
  } catch (error) { toast(error.message, true); }
}

function directContactClientLabel(client) {
  const contact = client.client_phone || client.client_email || 'brak danych kontaktowych';
  return `${client.client_name} · ${contact} · zgłoszenie #${client.id}`;
}

function renderDirectContactClients() {
  document.querySelector('#directContactClients').innerHTML = contactTaskClients.map(client =>
    `<option value="${escapeHtml(directContactClientLabel(client))}"></option>`
  ).join('');
  document.querySelector('#directContactProducts').innerHTML = policyProductTypes.map(product =>
    `<option value="${escapeHtml(product)}"></option>`
  ).join('');
}

function selectedDirectContactClient() {
  const value = document.querySelector('#directContactClient').value.trim();
  return contactTaskClients.find(client => directContactClientLabel(client) === value)
    || contactTaskClients.find(client => value === `#${client.id}` || value === String(client.id));
}

function defaultContactDateTime() {
  const date = new Date();
  date.setMinutes(0, 0, 0);
  date.setHours(date.getHours() + 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function contactTaskTiming(item) {
  const due = new Date(item.contact_due_at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const week = new Date(today);
  week.setDate(week.getDate() + 8);
  if (due < today) return 'overdue';
  if (due < tomorrow) return 'today';
  if (due < week) return 'week';
  return 'future';
}

function contactTaskInDashboardWindow(item) {
  const days = normalizedWindowValue(document.querySelector('#contactWindow'), 30);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  end.setDate(end.getDate() + days - 1);
  return new Date(item.contact_due_at) <= end;
}

function renderContactTasks() {
  const search = normalizedSearch(document.querySelector('#contactTaskSearch').value);
  const status = document.querySelector('#contactTaskStatus').value;
  const timing = document.querySelector('#contactTaskTiming').value;
  const visible = contactTasks.filter(item => {
    if (status !== 'all' && item.status !== status) return false;
    if (timing === 'dashboard' && !contactTaskInDashboardWindow(item)) return false;
    if (!['all', 'dashboard'].includes(timing) && contactTaskTiming(item) !== timing && !(timing === 'week' && contactTaskTiming(item) === 'today')) return false;
    const haystack = normalizedSearch([item.client_name, item.client_email, item.client_phone, item.product, item.notes, item.submission_id].join(' '));
    return !search || haystack.includes(search);
  });
  const rows = document.querySelector('#contactTaskRows');
  rows.innerHTML = visible.map(item => {
    const timingClass = item.status === 'completed' ? 'completed' : contactTaskTiming(item);
    const statusMarkup = item.status === 'completed'
      ? `<span class="contact-task-status completed">Wykonany</span><small>${formatDate(item.completed_at)}</small>`
      : `<span class="contact-task-status ${timingClass}">${timingClass === 'overdue' ? 'Zaległy' : timingClass === 'today' ? 'Dzisiaj' : 'Zaplanowany'}</span>`;
    const actionId = item.source === 'custom' ? item.task_id : item.submission_id;
    return `<tr class="contact-task-row ${timingClass}">
      <td><strong>${formatDate(item.contact_due_at)}</strong><small>${item.source === 'submission' ? 'Termin ze zgłoszenia' : 'Dodatkowa prośba klienta'}</small></td>
      <td><strong>${escapeHtml(item.client_name)}</strong><small>Zgłoszenie #${item.submission_id}</small></td>
      <td><span>${escapeHtml(item.client_phone || 'Brak telefonu')}</span><small>${escapeHtml(item.client_email || 'Brak e-maila')}</small></td>
      <td><strong>${escapeHtml(item.product)}</strong></td>
      <td>${item.coverage_end_date ? formatDate(item.coverage_end_date, true) : 'Nie podano'}</td>
      <td class="contact-task-note">${escapeHtml(item.notes || 'Brak notatki')}</td>
      <td><div class="contact-task-state">${statusMarkup}</div></td>
      <td><div class="contact-task-actions"><button class="button secondary small" type="button" data-open-contact="${item.submission_id}">Karta klienta</button>${item.status === 'pending' ? `<button class="button primary small" type="button" data-complete-contact="${item.source}" data-contact-id="${actionId}">Kontakt wykonany</button>` : ''}</div></td>
    </tr>`;
  }).join('');
  document.querySelector('#contactTaskCount').textContent = `${visible.length} ${visible.length === 1 ? 'pozycja' : 'pozycji'}`;
  document.querySelector('#contactTaskEmpty').classList.toggle('hidden', visible.length > 0);
}

document.querySelector('#contactTaskFilters').addEventListener('input', renderContactTasks);
document.querySelector('#refreshContactTasks').addEventListener('click', loadContactTasks);
const directContactComposer = document.querySelector('#directContactTaskComposer');
function openDirectContactTaskComposer() {
  directContactComposer.classList.remove('hidden');
  if (!document.querySelector('#directContactDue').value) document.querySelector('#directContactDue').value = defaultContactDateTime();
  document.querySelector('#directContactClient').focus();
}
function closeDirectContactTaskComposer() {
  directContactComposer.classList.add('hidden');
  document.querySelector('#directContactTaskForm').reset();
}
document.querySelector('#showDirectContactTask').addEventListener('click', openDirectContactTaskComposer);
document.querySelector('#hideDirectContactTask').addEventListener('click', closeDirectContactTaskComposer);
document.querySelector('#cancelDirectContactTask').addEventListener('click', closeDirectContactTaskComposer);
document.querySelector('#directContactTaskForm').addEventListener('submit', async event => {
  event.preventDefault();
  const client = selectedDirectContactClient();
  if (!client) return toast('Wybierz klienta z listy podpowiedzi.', true);
  const button = event.submitter;
  button.disabled = true;
  try {
    await api(`/api/admin/submissions/${client.id}/contact-tasks`, { method:'POST', body:JSON.stringify({
      product: document.querySelector('#directContactProduct').value.trim(),
      coverage_end_date: document.querySelector('#directContactCoverageEnd').value || null,
      contact_due_at: document.querySelector('#directContactDue').value,
      notes: document.querySelector('#directContactNotes').value.trim()
    }) });
    closeDirectContactTaskComposer();
    toast(`Zaplanowano kontakt z klientem: ${client.client_name}.`);
    await Promise.all([loadContactTasks(), loadCoreData()]);
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
document.querySelector('#contactTaskRows').addEventListener('click', async event => {
  const openButton = event.target.closest('[data-open-contact]');
  if (openButton) return openSubmission(openButton.dataset.openContact);
  const completeButton = event.target.closest('[data-complete-contact]');
  if (!completeButton || !confirm('Oznaczyć zaplanowany kontakt jako wykonany?')) return;
  completeButton.disabled = true;
  try {
    await api(`/api/admin/contact-tasks/${completeButton.dataset.completeContact}/${completeButton.dataset.contactId}/complete`, { method: 'PATCH' });
    toast('Kontakt został oznaczony jako wykonany.');
    await Promise.all([loadContactTasks(), loadCoreData()]);
  } catch (error) { toast(error.message, true); completeButton.disabled = false; }
});

function renderReminderRows(target, empty, reminders) {
  target.innerHTML = reminders.map(item => `<tr data-id="${item.submission_id}"><td>#${item.submission_id}</td><td>${escapeHtml(item.product_type || item.form_type)}</td><td>${escapeHtml(item.insurer)}</td><td>${formatDate(item.end_date, true)}</td><td><span class="badge ${item.days_remaining <= 3 ? 'closed_lost' : item.days_remaining <= 14 ? 'in_progress' : 'policy_concluded'}">${item.days_remaining === 0 ? 'dzisiaj' : `${item.days_remaining} dni`}${item.is_milestone ? ' · termin' : ''}</span></td></tr>`).join('');
  empty.classList.toggle('hidden', reminders.length > 0);
}

function renderAdminOptions() {
  const options = admins.map(admin => `<option value="${admin.id}">${escapeHtml(admin.display_name || admin.username)}</option>`).join('');
  document.querySelector('#filterAdmin').innerHTML = `<option value="">Każdy administrator</option>${options}`;
}

statusDefinitions.forEach(([key, label]) => document.querySelector('#filterStatus').insertAdjacentHTML('beforeend', `<option value="${key}">${label}</option>`));

function filterParameters() {
  syncSubmissionFilterUi();
  const status = document.querySelector('#filterStatus').value;
  const values = {
    search: document.querySelector('#filterSearch').value.trim(), status,
    form_type: document.querySelector('#filterType').value, admin: document.querySelector('#filterAdmin').value,
    insurer: ['new', 'in_progress'].includes(status) ? '' : document.querySelector('#filterInsurer').value.trim(), date_from: document.querySelector('#filterDateFrom').value,
    date_to: document.querySelector('#filterDateTo').value
  };
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== '') params.set(key, value); });
  return params;
}

function syncSubmissionFilterUi() {
  const status = document.querySelector('#filterStatus').value;
  const hidden = ['new', 'in_progress'].includes(status);
  document.querySelector('#filterInsurerField').classList.toggle('hidden', hidden);
  document.querySelector('#submissionsTable').classList.toggle('hide-insurer-column', hidden);
  const headings = {
    offer_sent: 'Towarzystwo wysłanej oferty',
    awaiting_client: 'Przedstawione towarzystwa',
    policy_concluded: 'Towarzystwo polisy'
  };
  const filterLabels = {
    offer_sent: 'Filtr listy po towarzystwie wysłanej oferty',
    awaiting_client: 'Filtr listy po przedstawionym towarzystwie',
    policy_concluded: 'Filtr listy po towarzystwie polisy'
  };
  document.querySelector('#filterInsurerLabel').textContent = filterLabels[status] || 'Filtr listy po towarzystwie';
  document.querySelector('#submissionInsurerHeading').textContent = headings[status] || 'Towarzystwo / przedstawione oferty';
}

async function loadSubmissions() {
  try {
    submissions = (await api(`/api/admin/submissions?${filterParameters()}`)).submissions;
    renderSubmissions();
  } catch (error) { toast(error.message, true); }
}

function renderSubmissions() {
  const rows = document.querySelector('#submissionRows');
  rows.innerHTML = submissions.map(item => `<tr data-id="${item.id}"><td><strong>#${item.id}</strong></td><td><strong>${escapeHtml(item.client_name)}</strong></td><td>${escapeHtml(item.form_type)}</td><td>${formatDate(item.submitted_at)}</td><td>${escapeHtml(item.assigned_name || 'Nieprzypisane')}</td><td><span class="badge ${item.status}">${escapeHtml(statusLabels[item.status] || item.status)}</span></td><td>${contactSummary(item)}</td><td>${submissionInsurerCell(item)}</td></tr>`).join('');
  document.querySelector('#submissionEmpty').classList.toggle('hidden', submissions.length > 0);
  document.querySelector('#resultCount').textContent = `${submissions.length} zgłoszeń`;
  const selectedType = document.querySelector('#filterType').value;
  const types = [...new Set([...propertyProductTypes, selectedType, ...submissions.map(item => item.form_type)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  document.querySelector('#filterType').innerHTML = `<option value="">Wszystkie produkty</option>${types.map(type => `<option value="${escapeHtml(type)}"${type === selectedType ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('')}`;
}

function insurerChips(value) {
  const insurers = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  return insurers.length ? `<div class="insurer-chips">${insurers.map(insurer => `<span>${escapeHtml(insurer)}</span>`).join('')}</div>` : '<span class="muted">Nie wybrano ofert</span>';
}

function submissionInsurerCell(item) {
  if (item.status === 'awaiting_client') {
    return `<div class="submission-insurer-cell">${insurerChips(item.presented_insurers)}<button class="button secondary small" type="button" data-edit-presented-insurers="${item.id}">Wybierz kilka towarzystw</button></div>`;
  }
  return escapeHtml(submissionInsurerContext(item));
}

function presentedInsurerPicker(value, expanded = false) {
  const selected = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  const selectedKnown = new Set(selected.filter(item => insurerOptions.includes(item)));
  const other = selected.filter(item => !insurerOptions.includes(item)).join(', ');
  const count = selectedKnown.size + (other ? other.split(',').filter(Boolean).length : 0);
  return `<details class="insurer-picker" id="presentedInsurerPicker"${expanded ? ' open' : ''}><summary><span>Zaznacz przedstawione towarzystwa</span><strong id="presentedInsurerSummary">${count ? `${count} wybrano` : 'Nie wybrano'}</strong></summary><div class="insurer-options">${insurerOptions.map(insurer => `<label><input type="checkbox" name="presented_insurer" value="${escapeHtml(insurer)}"${selectedKnown.has(insurer) ? ' checked' : ''} /> <span>${escapeHtml(insurer)}</span></label>`).join('')}</div><label class="field insurer-other"><span>Inne towarzystwo</span><input id="detailPresentedInsurersOther" value="${escapeHtml(other)}" placeholder="Wpisz nazwę, jeśli nie ma jej na liście" /></label></details>`;
}

function singleInsurerSelect(value) {
  const current = String(value || '').trim();
  const customOption = current && !insurerOptions.includes(current) ? `<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>` : '';
  return `<select id="detailOfferInsurer"><option value="">Wybierz towarzystwo</option>${insurerOptions.map(insurer => `<option value="${escapeHtml(insurer)}"${current === insurer ? ' selected' : ''}>${escapeHtml(insurer)}</option>`).join('')}${customOption}</select>`;
}

function policyInsurerSelect(value) {
  const current = String(value || '').trim();
  const selected = insurerOptions.includes(current) ? current : '';
  return `<select name="insurer" required><option value="">Wybierz towarzystwo ubezpieczeniowe</option>${insurerOptions.map(insurer => `<option value="${escapeHtml(insurer)}"${selected === insurer ? ' selected' : ''}>${escapeHtml(insurer)}</option>`).join('')}</select>`;
}

function selectedPresentedInsurers() {
  const selected = [...document.querySelectorAll('input[name="presented_insurer"]:checked')].map(input => input.value);
  const other = document.querySelector('#detailPresentedInsurersOther')?.value.split(',').map(item => item.trim()).filter(Boolean) || [];
  return [...new Set([...selected, ...other])].join(', ');
}

function updatePresentedInsurerSummary() {
  const count = selectedPresentedInsurers().split(',').map(item => item.trim()).filter(Boolean).length;
  const summary = document.querySelector('#presentedInsurerSummary');
  if (summary) summary.textContent = count ? `${count} wybrano` : 'Nie wybrano';
}

function submissionInsurerContext(item) {
  if (item.status === 'offer_sent') return item.offer_insurer || 'Nie wpisano';
  if (item.status === 'awaiting_client') return item.presented_insurers || item.offer_insurer || 'Nie wpisano';
  if (item.status === 'policy_concluded') return item.insurer || 'Nie wpisano';
  return item.insurer || item.offer_insurer || item.presented_insurers || '—';
}

function latestContact(item) {
  return [
    ['E-mail', item.last_email_at],
    ['SMS', item.last_sms_at],
    ['Telefon', item.last_phone_at]
  ].filter(([, value]) => value).sort((a, b) => new Date(b[1]) - new Date(a[1]))[0] || null;
}

function contactSummary(item) {
  const latest = latestContact(item);
  return latest ? `<span class="contact-summary"><strong>${latest[0]}</strong>${formatDate(latest[1])}</span>` : '<span class="muted">Brak kontaktu</span>';
}

function contactWorkButtons(item, compact = false) {
  const definitions = [
    ['email_sent', 'E-mail', item.last_email_at],
    ['sms_sent', 'SMS', item.last_sms_at],
    ['phone_call', 'Telefon', item.last_phone_at]
  ];
  return `<div class="work-contact-grid${compact ? ' compact' : ''}">${definitions.map(([action, label, value]) => `<button class="work-contact${value ? ' completed' : ''}" type="button" data-work-contact="${action}" title="Zapisz kontakt: ${label}"><span class="check-mark">${value ? '✓' : ''}</span><span><strong>${label}</strong><small>${value ? formatDate(value) : 'Nie wykonano'}</small></span></button>`).join('')}</div>`;
}

document.querySelector('#filtersForm').addEventListener('input', event => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadSubmissions, event.target.id === 'filterSearch' ? 300 : 0);
});
document.querySelector('#filtersForm').addEventListener('change', event => {
  if (event.target.id === 'filterStatus') syncSubmissionFilterUi();
  loadSubmissions();
});
document.querySelector('#filtersForm').addEventListener('reset', () => setTimeout(() => { syncSubmissionFilterUi(); loadSubmissions(); }));
document.querySelector('#submissionRows').addEventListener('click', event => {
  const insurerButton = event.target.closest('[data-edit-presented-insurers]');
  if (insurerButton) {
    event.stopPropagation();
    openSubmission(insurerButton.dataset.editPresentedInsurers);
    return;
  }
  const row = event.target.closest('[data-id]');
  if (row) openSubmission(row.dataset.id);
});
document.querySelector('#dashboardReminderRows').addEventListener('click', event => { const row = event.target.closest('[data-id]'); if (row) openSubmission(row.dataset.id); });

async function openSubmission(id, renewalPolicyId = null) {
  currentSubmissionId = Number(id);
  try {
    const item = (await api(`/api/admin/submissions/${id}`)).submission;
    renderDrawer(item);
    drawer.classList.remove('hidden');
    drawerBackdrop.classList.remove('hidden');
    if (renewalPolicyId) openPolicyHistoryForm(item, Number(renewalPolicyId));
  } catch (error) { toast(error.message, true); }
}

function adminOptions(selected) {
  return `<option value="">Nieprzypisane</option>${admins.map(admin => `<option value="${admin.id}"${Number(selected) === admin.id ? ' selected' : ''}>${escapeHtml(admin.display_name || admin.username)}</option>`).join('')}`;
}

const policyLifecycleLabels = {
  active: ['AKTYWNA', 'active'],
  upcoming: ['OCZEKUJE NA START', 'upcoming'],
  renewed: ['WZNOWIONA', 'renewed'],
  expired: ['WYGASŁA', 'expired'],
  archived: ['ARCHIWALNA', 'archived']
};

function formatMoney(value) {
  return new Intl.NumberFormat('pl-PL', { style:'currency', currency:'PLN' }).format(Number(value || 0));
}

function policyHistoryMarkup(item) {
  if (!item.policies.length) return '<div class="empty policy-empty">Klient nie ma jeszcze zapisanej polisy.</div>';
  return item.policies.map(policy => {
    const [label, className] = policyLifecycleLabels[policy.lifecycle_status] || policyLifecycleLabels.archived;
    const documents = policy.documents?.length ? `<div class="policy-card-documents">${policy.documents.map(document => `<a href="/api/admin/documents/${document.id}" target="_blank">${escapeHtml(document.filename)}</a>`).join('')}</div>` : '';
    const currentLabel = policy.is_current && ['active', 'upcoming'].includes(policy.lifecycle_status) ? ' (AKTUALNA)' : '';
    return `<article class="policy-history-card ${className}"><div class="policy-card-head"><div><span>POLISA ${policy.period_number}${currentLabel}</span><h4>${escapeHtml(policy.insurer)}</h4></div><span class="policy-state ${className}">${label}</span></div><div class="policy-card-period">${formatDate(policy.start_date,true)} – ${formatDate(policy.end_date,true)}</div><div class="policy-card-grid"><div><span>Numer polisy</span><strong>${escapeHtml(policy.policy_number)}</strong></div><div><span>Rodzaj ubezpieczenia</span><strong>${escapeHtml(policy.product_type)}</strong></div><div><span>Składka</span><strong>${formatMoney(policy.premium)}</strong></div><div><span>Numer klienta w TU</span><strong>${escapeHtml(policy.client_number || '—')}</strong></div><div><span>Numer oferty</span><strong>${escapeHtml(policy.offer_number || '—')}</strong></div><div><span>Dodano</span><strong>${formatDate(policy.created_at)}</strong></div></div>${policy.notes ? `<p class="policy-card-notes">${escapeHtml(policy.notes)}</p>` : ''}${documents}<div class="policy-card-actions">${policy.is_current ? `<button class="button secondary small" type="button" data-renew-policy="${policy.id}">Wznowienie</button>` : ''}</div></article>`;
  }).join('');
}

function policyFormMarkup(item, source = null) {
  const start = source ? nextDay(source.end_date) : '';
  const end = source ? nextYearEnd(source.end_date) : '';
  const selectedProduct = normalizePolicyProductType(source?.product_type || item.form_type);
  return `<form class="policy-form policy-create-form" id="policyHistoryForm" data-source-policy-id="${source?.id || ''}"><div class="policy-form-heading wide"><div><p class="eyebrow">${source ? 'Wznowienie polisy' : 'Nowa polisa'}</p><h3>${source ? `Nowy okres po polisie ${escapeHtml(source.policy_number)}` : 'Dodaj nową polisę'}</h3></div><button class="icon-button" id="closePolicyForm" type="button" aria-label="Zamknij">×</button></div><label class="field"><span>Towarzystwo ubezpieczeniowe</span>${policyInsurerSelect(source?.insurer)}</label><label class="field"><span>Numer polisy</span><input name="policy_number" value="" required /></label><label class="field"><span>Rodzaj ubezpieczenia</span><select name="product_type" required><option value="">Wybierz rodzaj ubezpieczenia</option>${policyProductTypes.map(product => `<option value="${escapeHtml(product)}"${selectedProduct === product ? ' selected' : ''}>${escapeHtml(product)}</option>`).join('')}</select></label><label class="field"><span>Składka</span><input name="premium" type="number" min="0" step="0.01" value="${escapeHtml(source?.premium || '')}" /></label><label class="field"><span>Data początku</span><input name="start_date" type="date" value="${start}" required /></label><label class="field"><span>Data końca</span><input name="end_date" type="date" value="${end}" required /></label><label class="field"><span>Numer klienta w TU</span><input name="client_number" value="${escapeHtml(source?.client_number || '')}" /></label><label class="field"><span>Numer oferty (opcjonalnie)</span><input name="offer_number" value="" /></label><label class="field wide"><span>Uwagi</span><textarea name="notes" placeholder="Dodatkowe informacje dotyczące tej polisy"></textarea></label><div class="policy-actions wide"><button class="button primary" type="submit">Zapisz nową polisę</button><button class="button secondary" id="cancelPolicyForm" type="button">Anuluj</button></div></form>`;
}

function normalizePolicyProductType(value) {
  const source = String(value || '').toLocaleLowerCase('pl');
  if (policyProductTypes.includes(value)) return value;
  if (source.includes('oc zawod')) return 'OC Zawodowe';
  if (source.includes('nnw szkol')) return 'NNW SZKOLNE';
  if (source.includes('medycyna bez granic')) return 'Medycyna Bez Granic';
  if (source.includes('assistance')) return 'Assistance Solo';
  if (source.includes('nieruch') || source.includes('mieszkan') || source.includes('dom') || source.includes('altan')) return 'Nieruchomość';
  if (source.includes('życi') || source.includes('zyci')) return 'Życie';
  if (source.includes('turyst')) return 'Turystyczne';
  if (source.includes('roln')) return 'Rolne';
  if (source.includes('firm')) return 'Firma';
  if (source.includes('smartfon') || source.includes('telefon')) return 'Smartfon';
  if (source.includes('gap')) return 'GAP';
  if (source.includes('zdrow')) return 'Zdrowotne';
  if (source.includes('flot')) return 'Flota';
  if (source.includes('nnw')) return 'NNW';
  if (source.includes('oc+ac') || (source.includes('oc') && source.includes('ac'))) return 'OC+AC';
  if (/\bac\b/.test(source)) return 'AC';
  if (/\boc\b/.test(source)) return 'OC';
  return '';
}

function policyModuleMarkup(item) {
  return `<section class="drawer-section" id="policyHistorySection"><div class="drawer-section-head"><div><h3>Historia polis klienta</h3><span class="muted">Każdy okres jest zapisywany jako osobny rekord</span></div><button class="button primary small" id="addPolicyButton" type="button">+ Dodaj nową polisę</button></div><div class="policy-form-shell hidden" id="policyFormShell"></div><div class="policy-history-list" id="policyHistoryList">${policyHistoryMarkup(item)}</div></section>`;
}

function openPolicyHistoryForm(item, sourcePolicyId = null) {
  const source = sourcePolicyId ? item.policies.find(policy => policy.id === Number(sourcePolicyId)) : null;
  const shell = document.querySelector('#policyFormShell');
  shell.innerHTML = policyFormMarkup(item, source);
  shell.classList.remove('hidden');
  shell.scrollIntoView({ behavior:'smooth', block:'nearest' });
  const close = () => { shell.classList.add('hidden'); shell.innerHTML = ''; };
  document.querySelector('#closePolicyForm').addEventListener('click', close);
  document.querySelector('#cancelPolicyForm').addEventListener('click', close);
  document.querySelector('#policyHistoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (source) body.renewed_from_policy_id = source.id;
    try {
      await api(`/api/admin/submissions/${item.id}/policy`, { method:'POST', body:JSON.stringify(body) });
      toast(source ? 'Nowa polisa została utworzona. Poprzednia pozostaje w historii jako wznowiona.' : 'Nowa polisa została dodana do historii klienta.');
      await Promise.all([loadCoreData(), loadRenewals(), openSubmission(item.id)]);
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });
}

function renderDrawer(item) {
  document.querySelector('#drawerNumber').textContent = `Zgłoszenie #${item.id}`;
  document.querySelector('#drawerTitle').textContent = item.form_type;
  document.querySelector('#drawerDates').textContent = `Utworzono ${formatDate(item.submitted_at)} · Ostatnia edycja ${formatDate(item.updated_at)}`;
  const dataItems = Object.entries(item.data || {}).map(([key, value]) => `<div class="detail-item"><span>${escapeHtml(key)}</span><strong>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</strong></div>`).join('');
  const contacts = item.contacts.length ? item.contacts.map(entry => `<div class="history-item"><time>${formatDate(entry.created_at)}</time><div><strong>${escapeHtml(entry.label)}</strong><p>${escapeHtml(entry.admin_name)}${entry.details ? ` · ${escapeHtml(entry.details)}` : ''}</p></div></div>`).join('') : '<p class="muted">Brak zapisanych kontaktów.</p>';
  const noteHistory = item.note_history.length ? item.note_history.map(entry => `<div class="history-item"><time>${formatDate(entry.created_at)}</time><div><strong>${escapeHtml(entry.admin_name)}</strong><p>${escapeHtml(entry.new_value || 'Notatka została wyczyszczona')}</p></div></div>`).join('') : '<p class="muted">Brak wcześniejszych wersji.</p>';
  const currentPolicy = item.policies.find(policy => policy.is_current);
  const contactDates = {
    last_email_at: item.contacts.find(entry => entry.action_type === 'email_sent')?.created_at || '',
    last_sms_at: item.contacts.find(entry => entry.action_type === 'sms_sent')?.created_at || '',
    last_phone_at: item.contacts.find(entry => entry.action_type === 'phone_call')?.created_at || ''
  };
  const contactTaskList = (item.contact_tasks || []).length ? item.contact_tasks.map(task => {
    const actionId = task.source === 'custom' ? task.task_id : task.submission_id;
    return `<article class="client-contact-card ${task.status}"><div><span>${task.source === 'submission' ? 'Termin obsługi zgłoszenia' : escapeHtml(task.product)}</span><strong>${formatDate(task.contact_due_at)}</strong><p>${task.coverage_end_date ? `Koniec obecnej ochrony: ${formatDate(task.coverage_end_date, true)}. ` : ''}${escapeHtml(task.notes || '')}</p></div><div>${task.status === 'completed' ? `<span class="contact-task-status completed">Wykonany</span>` : `<button class="button secondary small" type="button" data-complete-drawer-contact="${task.source}" data-contact-id="${actionId}">Kontakt wykonany</button>`}</div></article>`;
  }).join('') : '<p class="muted">Nie zapisano jeszcze dodatkowych terminów kontaktu.</p>';
  const policyVisible = item.status === 'policy_concluded' || item.policies.length > 0;
  const policies = item.policies.length ? item.policies.map(policy => `<div class="policy-period${policy.is_current ? ' current' : ''}"><div><strong>${escapeHtml(policy.policy_number || 'Brak numeru')}</strong><p class="muted">${escapeHtml(policy.insurer)} · ${formatDate(policy.start_date, true)} – ${formatDate(policy.end_date, true)} · okres ${policy.period_number}</p></div><span class="badge ${policy.is_current ? 'policy_concluded' : 'archive'}">${policy.is_current ? 'Aktywna' : 'Poprzednia'}</span></div>`).join('') : '';
  const consent = item.consent_history[0] || item;
  document.querySelector('#drawerContent').innerHTML = `
    <section class="drawer-section"><div class="drawer-section-head"><h3>Obsługa zgłoszenia</h3><span class="badge ${item.status}">${escapeHtml(statusLabels[item.status] || item.status)}</span></div><div class="management-grid"><label class="field"><span>Imię i nazwisko klienta</span><input id="detailClientName" value="${escapeHtml(item.client_name || '')}" placeholder="Imię i nazwisko" /></label><label class="field"><span>Status</span><select id="detailStatus">${statusDefinitions.map(([key,label]) => `<option value="${key}"${item.status === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>Administrator prowadzący</span><select id="detailAdmin">${adminOptions(item.assigned_admin_id)}</select></label><label class="field"><span>Termin kolejnego kontaktu</span><input id="detailContactDue" type="datetime-local" value="${item.contact_due_at ? item.contact_due_at.slice(0,16) : ''}" /></label><label class="field"><span>E-mail klienta</span><input id="detailClientEmail" type="email" value="${escapeHtml(item.client_email || '')}" placeholder="adres klienta" /></label><label class="field hidden" id="detailOfferInsurerField"><span>Towarzystwo oferty wysłanej z systemu TU</span>${singleInsurerSelect(item.offer_insurer)}</label><div class="field wide hidden" id="detailPresentedInsurersField"><span>Towarzystwa, których oferty przedstawiono klientowi</span><small class="field-hint">Możesz zaznaczyć dowolną liczbę ofert, np. PZU, Warta i Uniqa.</small>${presentedInsurerPicker(item.presented_insurers, item.status === 'awaiting_client')}</div><div class="field"><span>&nbsp;</span><button class="button primary" id="saveManagement" type="button">Zapisz obsługę</button></div></div></section>
    <section class="drawer-section"><div class="drawer-section-head"><h3>Kontakt z klientem</h3><span class="muted">Kliknięcie zapisuje aktualną datę i godzinę</span></div>${contactWorkButtons(contactDates)}</section>
    <section class="drawer-section"><div class="drawer-section-head"><div><h3>Przypomnienia o kontakcie</h3><span class="muted">Także dla produktów, których klient jeszcze nie ma w systemie</span></div></div><div class="client-contact-list">${contactTaskList}</div><details class="contact-task-create"><summary>Dodaj kolejną prośbę o kontakt</summary><form class="contact-task-form" id="contactTaskForm"><label class="field wide"><span>Produkt lub powód kontaktu</span><input id="contactTaskProduct" list="contactTaskProducts" required placeholder="Np. OC zawodowe, ubezpieczenie firmy" /><datalist id="contactTaskProducts">${policyProductTypes.map(product => `<option value="${escapeHtml(product)}"></option>`).join('')}</datalist></label><label class="field"><span>Kiedy kończy się obecna ochrona (opcjonalnie)</span><input id="contactTaskCoverageEnd" type="date" /></label><label class="field"><span>Kiedy mam się skontaktować</span><input id="contactTaskDue" type="datetime-local" required /></label><label class="field wide"><span>Notatka</span><textarea id="contactTaskNotes" rows="3" placeholder="Np. klient prosi o telefon miesiąc przed końcem umowy"></textarea></label><div class="wide"><button class="button primary" type="submit">Zapisz przypomnienie</button></div></form></details></section>
    ${policyModuleMarkup(item)}
    <section class="drawer-section"><div class="drawer-section-head"><h3>Szybkie akcje</h3><span class="muted">Jeden klik zapisuje historię</span></div><div class="quick-actions">${actionDefinitions.filter(([key]) => key !== 'offer_sent' || ['in_progress','offer_sent','awaiting_client'].includes(item.status)).map(([key,label]) => `<button class="quick-action" type="button" data-contact-action="${key}">${escapeHtml(label)}</button>`).join('')}</div></section>
    <section class="drawer-section"><div class="drawer-section-head"><h3>Dane formularza</h3></div><div class="detail-grid">${dataItems || '<p class="muted">Dane zostały zanonimizowane.</p>'}</div></section>
    <section class="drawer-section"><div class="drawer-section-head"><h3>Notatki wewnętrzne</h3></div><textarea id="internalNotes" placeholder="Ustalenia, potrzeby klienta, kolejny krok...">${escapeHtml(item.internal_notes || '')}</textarea><div class="notes-actions"><button class="button primary" id="saveNotes" type="button">Zapisz notatkę</button></div><details><summary>Historia zmian notatek (${item.note_history.length})</summary><div class="history-list">${noteHistory}</div></details></section>
    <section class="drawer-section${policyVisible ? '' : ' hidden'}" id="policySection"><div class="drawer-section-head"><h3>Dane polisy</h3><span class="badge policy_concluded">Polisa zawarta</span></div><form class="policy-form" id="policyForm"><label class="field"><span>Numer polisy</span><input id="policyNumber" value="${escapeHtml(currentPolicy?.policy_number || '')}" required /></label><label class="field"><span>Towarzystwo</span><input id="policyInsurer" value="${escapeHtml(currentPolicy?.insurer || '')}" required /></label><label class="field"><span>Składka</span><input id="policyPremium" type="number" min="0" step="0.01" value="${escapeHtml(currentPolicy?.premium || '')}" /></label><label class="field"><span>Numer klienta</span><input id="policyClientNumber" value="${escapeHtml(currentPolicy?.client_number || '')}" /></label><label class="field"><span>Data początku</span><input id="policyStart" type="date" value="${toDateInput(currentPolicy?.start_date)}" required /></label><label class="field"><span>Data końca</span><input id="policyEnd" type="date" value="${toDateInput(currentPolicy?.end_date)}" required /></label><label class="field wide"><span>Rodzaj produktu</span><input id="policyProduct" value="${escapeHtml(currentPolicy?.product_type || item.form_type)}" required /></label><div class="policy-actions wide"><button class="button primary" type="submit">Zapisz polisę</button></div></form>${currentPolicy ? `<details><summary>Polisa wznowiona</summary><form class="policy-form" id="renewalForm"><label class="field"><span>Nowy numer polisy</span><input id="renewPolicyNumber" required /></label><label class="field"><span>Towarzystwo</span><input id="renewInsurer" value="${escapeHtml(currentPolicy.insurer)}" required /></label><label class="field"><span>Nowa składka</span><input id="renewPremium" type="number" min="0" step="0.01" value="${escapeHtml(currentPolicy.premium)}" /></label><label class="field"><span>Numer klienta</span><input id="renewClientNumber" value="${escapeHtml(currentPolicy.client_number)}" /></label><label class="field"><span>Początek nowego okresu</span><input id="renewStart" type="date" value="${nextDay(currentPolicy.end_date)}" required /></label><label class="field"><span>Koniec nowego okresu</span><input id="renewEnd" type="date" value="${nextYearEnd(currentPolicy.end_date)}" required /></label><label class="field wide"><span>Rodzaj produktu</span><input id="renewProduct" value="${escapeHtml(currentPolicy.product_type)}" /></label><div class="policy-actions wide"><button class="button primary" type="submit">Potwierdź wznowienie</button></div></form></details>` : ''}<details${item.policies.length ? '' : ' class="hidden"'}><summary>Historia okresów ochrony (${item.policies.length})</summary>${policies}</details></section>
    <section class="drawer-section"><div class="drawer-section-head"><h3>Historia kontaktu</h3><span class="muted">${item.contacts.length} wpisów</span></div><div class="history-list">${contacts}</div></section>
    <section class="drawer-section"><div class="drawer-section-head"><h3>Historia zgód</h3><span class="muted">Wersja ${escapeHtml(consent.consent_version)}</span></div><div class="consent-grid"><div class="consent-item"><span>Regulamin i prywatność</span><strong class="${consent.privacy_accepted ? 'yes' : 'no'}">${consent.privacy_accepted ? 'TAK' : 'NIE'}</strong></div><div class="consent-item"><span>Marketing e-mail</span><strong class="${consent.marketing_email_consent ? 'yes' : 'no'}">${consent.marketing_email_consent ? 'TAK' : 'NIE'}</strong></div><div class="consent-item"><span>Marketing SMS</span><strong class="${consent.marketing_sms_consent ? 'yes' : 'no'}">${consent.marketing_sms_consent ? 'TAK' : 'NIE'}</strong></div><div class="consent-item"><span>Marketing telefon</span><strong class="${consent.marketing_phone_consent ? 'yes' : 'no'}">${consent.marketing_phone_consent ? 'TAK' : 'NIE'}</strong></div><div class="consent-item"><span>Data i godzina</span><strong>${formatDate(consent.consent_timestamp)}</strong></div><div class="consent-item"><span>IP</span><strong>${escapeHtml(consent.consent_ip)}</strong></div><div class="consent-item wide"><span>User-Agent</span><strong>${escapeHtml(consent.consent_user_agent)}</strong></div></div></section>
    <section class="drawer-section"><div class="danger-zone"><h3>Archiwizacja i anonimizacja danych</h3><p>Operacja przenosi sprawę do archiwum, trwale usuwa dane osobowe oraz pliki polis i zachowuje wyłącznie techniczny rejestr wykonania operacji.</p><label class="field"><span>Powód anonimizacji</span><input id="anonymizationReason" placeholder="np. żądanie klienta" /></label><label class="legal-delete-check"><input id="notifyDeletion" type="checkbox" checked /> Wyślij klientowi automatyczne potwierdzenie usunięcia danych na ${escapeHtml(item.client_email || 'uzupełniony adres e-mail')}</label><button class="button danger" id="anonymizeSubmission" type="button">Archiwizuj i anonimizuj klienta</button></div></section>`;
  document.querySelector('#policySection').classList.add('hidden');
  if (currentPolicy) {
    const documentRows = currentPolicy.documents.length ? currentPolicy.documents.map(document => `<div class="document-row"><div><a href="/api/admin/documents/${document.id}" target="_blank">${escapeHtml(document.filename)}</a><span>${Math.ceil(document.file_size/1024)} KB · ${formatDate(document.uploaded_at)}</span></div><span>PDF</span></div>`).join('') : '<p class="muted">Nie wgrano jeszcze pliku polisy.</p>';
    const documentOptions = currentPolicy.documents.map(document => `<option value="${document.id}">${escapeHtml(document.filename)}</option>`).join('');
    const emailHistory = currentPolicy.email_history.filter(entry=>entry.recipient_type==='production').length ? currentPolicy.email_history.filter(entry=>entry.recipient_type==='production').map(entry => `<div class="history-item"><time>${formatDate(entry.sent_at)}</time><div><strong>Wysłana na produkcję</strong><p>${escapeHtml(entry.recipient_email)} · ${escapeHtml(entry.subject)}</p></div></div>`).join('') : '<p class="muted">Polisa nie została jeszcze wysłana na produkcję.</p>';
    document.querySelector('#policyHistorySection').insertAdjacentHTML('beforeend', `<div class="policy-document-section"><div class="drawer-section-head"><h3>Plik aktualnej polisy i wysyłka na produkcję</h3><span class="muted">PDF do 8 MB</span></div><div class="document-list">${documentRows}</div><div class="upload-box"><label class="field"><span>Wgraj plik polisy</span><input id="policyFile" type="file" accept="application/pdf,.pdf" /></label><button class="button secondary" id="uploadPolicyFile" type="button">Wgraj bezpiecznie do bazy</button></div>${currentPolicy.documents.length?`<label class="field"><span>Dokument do wysyłki</span><select id="sendDocumentId">${documentOptions}</select></label><p class="email-note">Odbiorca: produkcja@4-life.pl<br>Temat: ${escapeHtml(item.client_name)} ${formatPolicyDateClient(currentPolicy.start_date)} (${escapeHtml(currentPolicy.insurer)})</p><div class="email-actions"><button class="button primary" id="sendPolicyProduction" type="button">Wyślij na produkcję</button></div>`:''}<div class="history-list">${emailHistory}</div></div>`);
  }
  bindDrawerActions(item);
}

function formatPolicyDateClient(value){const [year,month,day]=String(value||'').slice(0,10).split('-');return day&&month&&year?`${day}.${month}.${year}`:'';}

function nextDay(dateValue) { const date = new Date(`${dateValue}T00:00:00`); date.setDate(date.getDate()+1); return date.toISOString().slice(0,10); }
function nextYearEnd(dateValue) { const date = new Date(`${dateValue}T00:00:00`); date.setDate(date.getDate()+1); date.setFullYear(date.getFullYear()+1); date.setDate(date.getDate()-1); return date.toISOString().slice(0,10); }

function bindDrawerActions(item) {
  const currentPolicy = item.policies.find(policy => policy.is_current);
  const syncOfferDetailFields = () => {
    const status = document.querySelector('#detailStatus').value;
    document.querySelector('#detailOfferInsurerField').classList.toggle('hidden', status !== 'offer_sent');
    document.querySelector('#detailPresentedInsurersField').classList.toggle('hidden', status !== 'awaiting_client');
    if (status === 'awaiting_client') document.querySelector('#presentedInsurerPicker').open = true;
  };
  document.querySelector('#detailStatus').addEventListener('change', syncOfferDetailFields);
  document.querySelector('#presentedInsurerPicker').addEventListener('change', updatePresentedInsurerSummary);
  document.querySelector('#detailPresentedInsurersOther').addEventListener('input', updatePresentedInsurerSummary);
  syncOfferDetailFields();
  document.querySelector('#addPolicyButton').addEventListener('click', () => openPolicyHistoryForm(item));
  document.querySelectorAll('[data-renew-policy]').forEach(button => button.addEventListener('click', () => openPolicyHistoryForm(item, Number(button.dataset.renewPolicy))));
  document.querySelector('#saveManagement').addEventListener('click', async () => {
    await api(`/api/admin/submissions/${item.id}`, { method:'PATCH', body:JSON.stringify({ status:document.querySelector('#detailStatus').value, assigned_admin_id:document.querySelector('#detailAdmin').value, contact_due_at:document.querySelector('#detailContactDue').value || null, client_name_override:document.querySelector('#detailClientName').value.trim(), client_email_override:document.querySelector('#detailClientEmail').value.trim(), offer_insurer:document.querySelector('#detailOfferInsurer').value.trim(), presented_insurers:selectedPresentedInsurers() }) });
    toast('Obsługa zgłoszenia została zapisana.');
    await refreshAfterChange(item.id);
  });
  document.querySelector('#contactTaskForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      await api(`/api/admin/submissions/${item.id}/contact-tasks`, { method:'POST', body:JSON.stringify({
        product: document.querySelector('#contactTaskProduct').value.trim(),
        coverage_end_date: document.querySelector('#contactTaskCoverageEnd').value || null,
        contact_due_at: document.querySelector('#contactTaskDue').value,
        notes: document.querySelector('#contactTaskNotes').value.trim()
      }) });
      toast('Przypomnienie o kontakcie zostało zapisane.');
      await refreshAfterChange(item.id);
    } catch (error) { toast(error.message, true); button.disabled = false; }
  });
  document.querySelectorAll('[data-complete-drawer-contact]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Oznaczyć zaplanowany kontakt jako wykonany?')) return;
    button.disabled = true;
    try {
      await api(`/api/admin/contact-tasks/${button.dataset.completeDrawerContact}/${button.dataset.contactId}/complete`, { method:'PATCH' });
      toast('Kontakt został oznaczony jako wykonany.');
      await refreshAfterChange(item.id);
    } catch (error) { toast(error.message, true); button.disabled = false; }
  }));
  document.querySelectorAll('[data-contact-action]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try { await api(`/api/admin/submissions/${item.id}/actions`, { method:'POST', body:JSON.stringify({ action:button.dataset.contactAction }) }); toast(`Zapisano: ${button.textContent}`); await refreshAfterChange(item.id); }
    catch(error){ toast(error.message,true); button.disabled=false; }
  }));
  document.querySelectorAll('#drawerContent [data-work-contact]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/admin/submissions/${item.id}/actions`, { method:'POST', body:JSON.stringify({ action:button.dataset.workContact }) });
      toast(`Zapisano kontakt: ${button.querySelector('strong').textContent}.`);
      await refreshAfterChange(item.id);
    } catch (error) { toast(error.message, true); button.disabled = false; }
  }));
  document.querySelector('#saveNotes').addEventListener('click', async () => { await api(`/api/admin/submissions/${item.id}/notes`, { method:'POST', body:JSON.stringify({ notes:document.querySelector('#internalNotes').value }) }); toast('Notatka została zapisana.'); await refreshAfterChange(item.id); });
  document.querySelector('#uploadPolicyFile')?.addEventListener('click', async () => {
    const file = document.querySelector('#policyFile').files[0];
    if (!file) return toast('Wybierz plik PDF polisy.',true);
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) return toast('Można wgrać wyłącznie plik PDF.',true);
    if (file.size > 8*1024*1024) return toast('Plik może mieć maksymalnie 8 MB.',true);
    const content_base64 = await fileToBase64(file);
    await api(`/api/admin/policies/${currentPolicy.id}/documents`,{method:'POST',body:JSON.stringify({filename:file.name,mime_type:file.type,file_size:file.size,content_base64})});
    toast('Plik polisy został zaszyfrowany i zapisany.');
    await refreshAfterChange(item.id);
  });
  document.querySelector('#sendPolicyProduction')?.addEventListener('click', async () => {
    if(!confirm('Wysłać polisę na adres produkcja@4-life.pl?'))return;
    const result=await api(`/api/admin/policies/${currentPolicy.id}/send-production`,{method:'POST',body:JSON.stringify({document_id:Number(document.querySelector('#sendDocumentId').value)})});
    toast(`Polisa została wysłana do ${result.recipient}.`);await refreshAfterChange(item.id);
  });
  document.querySelector('#anonymizeSubmission').addEventListener('click', async () => {
    const reason = document.querySelector('#anonymizationReason').value.trim();
    if (!reason) return toast('Podaj powód anonimizacji.', true);
    if (!confirm(`Czy trwale zanonimizować zgłoszenie #${item.id}? Tej operacji nie można cofnąć.`)) return;
    const notify_client=document.querySelector('#notifyDeletion').checked;
    await saveEmailOverride(item.id,document.querySelector('#detailClientEmail').value.trim());
    await api(`/api/admin/submissions/${item.id}/anonymize`, { method:'POST', body:JSON.stringify({ reason, notify_client }) });
    toast('Zgłoszenie zostało zanonimizowane.');
    closeDrawer();
    await loadCoreData();
  });
}

function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Nie udało się odczytać pliku.'));reader.readAsDataURL(file);});}
async function saveEmailOverride(id,email){await api(`/api/admin/submissions/${id}`,{method:'PATCH',body:JSON.stringify({client_email_override:email})});}

function policyFormData(prefix) {
  const isRenew = prefix === 'renew';
  const id = name => document.querySelector(`#${prefix}${name}`).value;
  return { policy_number:id(isRenew?'PolicyNumber':'Number'), insurer:id('Insurer'), premium:id('Premium'), client_number:id('ClientNumber'), start_date:id('Start'), end_date:id('End'), product_type:id('Product') };
}

async function refreshAfterChange(id) { await Promise.all([loadCoreData(), loadContactTasks(), openSubmission(id)]); }
function closeDrawer() { drawer.classList.add('hidden'); drawerBackdrop.classList.add('hidden'); currentSubmissionId=null; }
document.querySelector('#closeDrawer').addEventListener('click', closeDrawer);
drawerBackdrop.addEventListener('click', closeDrawer);

const renewalLabels = { pending:'Oczekuje na kontakt', contacted:'Kontakt wykonany', offer_sent:'Oferta wysłana', awaiting_client:'Oczekiwanie na klienta', resigned:'Klient zrezygnował', renewed:'Wznowiona' };

async function loadRenewals() {
  try {
    renewalPortfolio = (await api('/api/admin/renewals')).renewals;
    renderRenewalPortfolio();
  } catch(error) { toast(error.message,true); }
}

function renderRenewalPortfolio() {
  const days = Number(document.querySelector('#portfolioRenewalWindow').value || 30);
  const query = normalizedSearch(document.querySelector('#renewalSearch').value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const renewals = renewalPortfolio.filter(item => {
    const end = new Date(`${String(item.end_date).slice(0, 10)}T00:00:00`);
    const remaining = Math.ceil((end - today) / 86_400_000);
    return item.lifecycle_status !== 'upcoming' && remaining >= 0 && remaining <= days && policyMatchesSearch(item, query);
  });
  document.querySelector('#reminderRows').innerHTML = renewals.map(item => {
    const renewed = item.renewal_status === 'renewed';
    const badgeClass = renewed ? 'policy_concluded' : item.renewal_status === 'resigned' ? 'closed_lost' : item.renewal_status === 'pending' ? 'archive' : 'in_progress';
    const controls = renewed ? '<span class="muted">Nowa polisa utworzona</span>' : `<div class="renewal-controls"><button class="button primary small" type="button" data-open-renewal="${item.id}">Wznowienie</button><select data-renewal-select="${item.id}">${Object.entries(renewalLabels).filter(([key]) => key !== 'renewed').map(([key,label])=>`<option value="${key}"${item.renewal_status===key?' selected':''}>${label}</option>`).join('')}</select><button class="button secondary small" type="button" data-save-renewal="${item.id}">Zapisz</button></div>`;
    return `<tr class="renewal-row ${item.renewal_status}" data-id="${item.submission_id}"><td>${formatDate(item.end_date,true)}</td><td><strong>${escapeHtml(item.client_name)}</strong></td><td>${escapeHtml(item.policy_number)}</td><td>${escapeHtml(item.product_type||item.form_type)}</td><td>${escapeHtml(item.insurer)}</td><td>${contactWorkButtons(item, true)}</td><td><span class="badge ${badgeClass}">${escapeHtml(renewalLabels[item.renewal_status]||item.renewal_status)}</span></td><td>${controls}</td></tr>`;
  }).join('');
  document.querySelector('#renewalResultCount').textContent = `${renewals.length} ${renewals.length === 1 ? 'polisa' : renewals.length > 1 && renewals.length < 5 ? 'polisy' : 'polis'}`;
  document.querySelector('#renewalWindowDescription').textContent = `Kończące się w ciągu ${days} dni.`;
  const empty = document.querySelector('#reminderEmpty');
  empty.textContent = `Brak polis kończących się w ciągu ${days} dni.`;
  empty.classList.toggle('hidden', renewals.length > 0);
}

async function loadIssuedPolicies() {
  try {
    issuedPolicies = (await api('/api/admin/policies')).policies;
    renderPolicyCollection(false);
  } catch(error) { toast(error.message,true); }
}

async function loadArchivedPolicies() {
  try {
    archivedPolicies = (await api('/api/admin/policies?archive=1')).policies;
    renderPolicyCollection(true);
  } catch(error) { toast(error.message,true); }
}

function comparePolicyValues(a, b, mode) {
  if (mode === 'start_asc') return String(a.start_date).localeCompare(String(b.start_date));
  if (mode === 'start_desc') return String(b.start_date).localeCompare(String(a.start_date));
  if (mode === 'end_asc') return String(a.end_date).localeCompare(String(b.end_date));
  if (mode === 'end_desc') return String(b.end_date).localeCompare(String(a.end_date));
  if (mode === 'product_asc') return String(a.product_type).localeCompare(String(b.product_type), 'pl');
  if (mode === 'insurer_asc') return String(a.insurer).localeCompare(String(b.insurer), 'pl');
  if (mode === 'production_unsent') return Number(Boolean(a.sent_to_production_at)) - Number(Boolean(b.sent_to_production_at));
  if (mode === 'production_sent') return Number(Boolean(b.sent_to_production_at)) - Number(Boolean(a.sent_to_production_at));
  return 0;
}

function policyInspectionControl(item) {
  const completed = Boolean(item.inspection_completed);
  return `<div class="inspection-state ${completed ? 'completed' : 'missing'}"><span aria-hidden="true">${completed ? '✓' : '!'}</span><select data-policy-inspection="${item.id}" aria-label="Status inspekcji polisy ${escapeHtml(item.policy_number)}"><option value="0"${completed ? '' : ' selected'}>Niewykonana</option><option value="1"${completed ? ' selected' : ''}>Wykonana</option></select></div>`;
}

function policyProductionControl(item) {
  const method = item.production_delivery_method || (item.sent_to_production_at ? 'automatic' : 'none');
  const automatic = method === 'automatic';
  const manual = method === 'manual';
  const status = automatic ? 'TAK - AUTOMAT' : manual ? 'TAK - RĘCZNIE' : 'NIE WYSŁANA';
  const statusClass = automatic ? 'automatic' : manual ? 'manual' : 'missing';
  const sendButton = item.document_count
    ? `<button class="button primary small production-send-button" type="button" data-send-production="${item.id}">WYŚLIJ NA PRODUKCJĘ</button>`
    : '<button class="button secondary small production-send-button" type="button" disabled title="Najpierw wgraj plik PDF w karcie klienta">BRAK PLIKU PDF</button>';
  return `<div class="production-control"><span class="production-status ${statusClass}">${escapeHtml(status)}</span>${item.sent_to_production_at ? `<small>${formatDate(item.sent_to_production_at)}</small>` : ''}<select data-production-status="${item.id}" aria-label="Ręczny status wysyłki polisy ${escapeHtml(item.policy_number)}"><option value="none"${!manual && !automatic ? ' selected' : ''}>NIE WYSŁANA</option><option value="manual"${manual ? ' selected' : ''}>TAK - RĘCZNIE</option>${automatic ? '<option value="automatic" selected>TAK - AUTOMAT</option>' : ''}</select>${sendButton}</div>`;
}

function policyRowMarkup(item) {
  return `<tr data-id="${item.submission_id}" data-policy-id="${item.id}"><td>${formatDate(item.start_date,true)}</td><td>${formatDate(item.end_date,true)}</td><td><strong>${escapeHtml(item.client_name)}</strong></td><td>${escapeHtml(item.policy_number)}</td><td>${escapeHtml(item.product_type)}</td><td>${escapeHtml(item.insurer)}</td><td>${policyInspectionControl(item)}</td><td>${item.document_count?`<span class="badge policy_concluded">${item.document_count} PDF</span>`:'<span class="badge archive">brak</span>'}</td><td>${policyProductionControl(item)}</td></tr>`;
}

function renderPolicyCollection(archive) {
  const source = archive ? archivedPolicies : issuedPolicies;
  const sort = document.querySelector(archive ? '#archivePolicySort' : '#policySort').value;
  const production = document.querySelector(archive ? '#archiveProductionFilter' : '#policyProductionFilter').value;
  const query = normalizedSearch(document.querySelector(archive ? '#archivePolicySearch' : '#policySearch').value);
  const policies = source.filter(item => (production === 'all' || (production === 'sent') === Boolean(item.sent_to_production_at)) && policyMatchesSearch(item, query)).sort((a, b) => comparePolicyValues(a, b, sort) || Number(b.id) - Number(a.id));
  const rows = document.querySelector(archive ? '#archivePolicyRows' : '#policyRows');
  const empty = document.querySelector(archive ? '#archivePolicyEmpty' : '#policyEmpty');
  const count = document.querySelector(archive ? '#archivePolicyCount' : '#policyCount');
  rows.innerHTML = policies.map(policyRowMarkup).join('');
  empty.classList.toggle('hidden', policies.length > 0);
  count.textContent = `${policies.length} ${policies.length === 1 ? 'polisa' : policies.length > 1 && policies.length < 5 ? 'polisy' : 'polis'}`;
}

document.querySelector('#refreshRenewals').addEventListener('click',loadRenewals);
document.querySelector('#portfolioRenewalWindow').addEventListener('change', event => {
  localStorage.setItem('lamk_renewal_window', event.target.value);
  document.querySelector('#renewalWindow').value = event.target.value;
  renderRenewalWindow();
  renderRenewalPortfolio();
});
document.querySelector('#renewalSearch').addEventListener('input', renderRenewalPortfolio);
document.querySelector('#refreshPolicies').addEventListener('click',loadIssuedPolicies);
document.querySelector('#refreshPolicyArchive').addEventListener('click',loadArchivedPolicies);
document.querySelector('#policyControls').addEventListener('change', () => renderPolicyCollection(false));
document.querySelector('#archivePolicyControls').addEventListener('change', () => renderPolicyCollection(true));
document.querySelector('#policySearch').addEventListener('input', () => renderPolicyCollection(false));
document.querySelector('#archivePolicySearch').addEventListener('input', () => renderPolicyCollection(true));
document.querySelector('#reminderRows').addEventListener('click',async event=>{
  const renewal=event.target.closest('[data-open-renewal]');
  if(renewal){event.stopPropagation();const row=renewal.closest('[data-id]');await openSubmission(row.dataset.id,renewal.dataset.openRenewal);return;}
  const contact=event.target.closest('[data-work-contact]');
  if(contact){event.stopPropagation();const row=contact.closest('[data-id]');contact.disabled=true;try{await api(`/api/admin/submissions/${row.dataset.id}/actions`,{method:'POST',body:JSON.stringify({action:contact.dataset.workContact})});toast(`Zapisano kontakt: ${contact.querySelector('strong').textContent}.`);await loadRenewals();}catch(error){toast(error.message,true);contact.disabled=false;}return;}
  const save=event.target.closest('[data-save-renewal]');
  if(save){event.stopPropagation();const id=save.dataset.saveRenewal;const renewal_status=document.querySelector(`[data-renewal-select="${id}"]`).value;await api(`/api/admin/policies/${id}/renewal-status`,{method:'PATCH',body:JSON.stringify({renewal_status})});toast('Status wznowienia został zapisany.');loadRenewals();return;}
  const row=event.target.closest('[data-id]');if(row)openSubmission(row.dataset.id);
});
async function handlePolicyTableInteraction(event, archive) {
  const sendButton = event.target.closest('[data-send-production]');
  if (sendButton) {
    event.stopPropagation();
    if (event.type !== 'click') return;
    if (!confirm('Wysłać załączony plik PDF z adresu kontakt@lamkubezpieczenia.pl na produkcja@4-life.pl?')) return;
    sendButton.disabled = true;
    sendButton.textContent = 'WYSYŁANIE...';
    try {
      await api(`/api/admin/policies/${sendButton.dataset.sendProduction}/send-production`, { method:'POST', body:JSON.stringify({}) });
      toast('Polisa została wysłana na produkcję. Status ustawiono: TAK - AUTOMAT.');
      if (archive) await loadArchivedPolicies(); else await loadIssuedPolicies();
    } catch (error) { toast(error.message, true); sendButton.disabled = false; sendButton.textContent = 'WYŚLIJ NA PRODUKCJĘ'; }
    return;
  }
  const productionStatus = event.target.closest('[data-production-status]');
  if (productionStatus) {
    event.stopPropagation();
    if (event.type !== 'change') return;
    if (productionStatus.value === 'automatic') return;
    productionStatus.disabled = true;
    try {
      await api(`/api/admin/policies/${productionStatus.dataset.productionStatus}/production-status`, { method:'PATCH', body:JSON.stringify({ method:productionStatus.value }) });
      toast(productionStatus.value === 'manual' ? 'Status ustawiono: TAK - RĘCZNIE.' : 'Status ustawiono: NIE WYSŁANA.');
      if (archive) await loadArchivedPolicies(); else await loadIssuedPolicies();
    } catch (error) { toast(error.message, true); productionStatus.disabled = false; }
    return;
  }
  const inspection = event.target.closest('[data-policy-inspection]');
  if (inspection) {
    event.stopPropagation();
    if (event.type !== 'change') return;
    inspection.disabled = true;
    try {
      await api(`/api/admin/policies/${inspection.dataset.policyInspection}/inspection`, { method:'PATCH', body:JSON.stringify({ completed:inspection.value === '1' }) });
      toast(inspection.value === '1' ? 'Inspekcja została oznaczona jako wykonana.' : 'Inspekcja została oznaczona jako niewykonana.');
      if (archive) await loadArchivedPolicies(); else await loadIssuedPolicies();
    } catch (error) { toast(error.message, true); inspection.disabled = false; }
    return;
  }
  const row = event.target.closest('[data-id]');
  if (row) openSubmission(row.dataset.id);
}
document.querySelector('#policyRows').addEventListener('click', event => handlePolicyTableInteraction(event, false));
document.querySelector('#policyRows').addEventListener('change', event => handlePolicyTableInteraction(event, false));
document.querySelector('#archivePolicyRows').addEventListener('click', event => handlePolicyTableInteraction(event, true));
document.querySelector('#archivePolicyRows').addEventListener('change', event => handlePolicyTableInteraction(event, true));

function filteredMarketingContacts() {
  const search = document.querySelector('#marketingSearch').value.trim().toLowerCase();
  const channel = document.querySelector('#marketingChannel').value;
  return marketingContacts.filter(contact => {
    if (channel === 'email' && !contact.marketing_email_consent) return false;
    if (channel === 'sms' && !contact.marketing_sms_consent) return false;
    if (channel === 'phone' && !contact.marketing_phone_consent) return false;
    return !search || `${contact.client_name} ${contact.email} ${contact.phone} ${contact.submission_id}`.toLowerCase().includes(search);
  });
}

function updateMarketingSelection() {
  const eligible = marketingContacts.filter(contact => contact.marketing_email_consent && selectedMarketingContacts.has(contact.submission_id));
  document.querySelector('#marketingSelectionCount').textContent = `${eligible.length} wybranych`;
  document.querySelector('#campaignRecipientCount').textContent = eligible.length;
  const visibleEligible = filteredMarketingContacts().filter(contact => contact.marketing_email_consent);
  document.querySelector('#selectAllMarketing').checked = visibleEligible.length > 0 && visibleEligible.every(contact => selectedMarketingContacts.has(contact.submission_id));
}

function renderMarketingContacts() {
  const contacts = filteredMarketingContacts();
  document.querySelector('#marketingRows').innerHTML = contacts.map(contact => {
    const consentButtons = [
      ['email', 'E', contact.marketing_email_consent],
      ['sms', 'SMS', contact.marketing_sms_consent],
      ['phone', 'TEL', contact.marketing_phone_consent]
    ];
    return `<tr><td class="check-cell"><input type="checkbox" data-marketing-select="${contact.submission_id}" aria-label="Wybierz ${escapeHtml(contact.client_name)}" ${contact.marketing_email_consent ? '' : 'disabled'} ${selectedMarketingContacts.has(contact.submission_id) ? 'checked' : ''}></td><td><strong>${escapeHtml(contact.client_name)}</strong><span>Zgłoszenie #${contact.submission_id}</span></td><td><strong>${escapeHtml(contact.email || 'Brak e-mail')}</strong><span>${escapeHtml(contact.phone || 'Brak telefonu')}</span></td><td><div class="consent-badges">${consentButtons.map(([,label,active]) => `<span class="consent-channel${active ? ' active' : ''}">${label}</span>`).join('')}</div></td><td>${formatDate(contact.consent_timestamp)}<br><span class="muted">wersja ${escapeHtml(contact.consent_version)}</span></td><td><div class="consent-actions">${consentButtons.filter(([, , active]) => active).map(([channel,label]) => `<button type="button" data-withdraw-consent="${contact.submission_id}" data-channel="${channel}" title="Wycofaj zgodę ${label}">Wycofaj ${label}</button>`).join('')}<button class="remove-all" type="button" data-remove-marketing="${contact.submission_id}">Usuń z bazy</button></div></td></tr>`;
  }).join('');
  document.querySelector('#marketingEmpty').classList.toggle('hidden', contacts.length > 0);
  updateMarketingSelection();
}

function renderMarketingCampaigns() {
  const labels = { draft: 'Gotowa do wysłania', sending: 'Wysyłanie', sent: 'Wysłana', partial: 'Częściowo wysłana' };
  document.querySelector('#campaignRows').innerHTML = marketingCampaigns.map(campaign => `<tr><td>${formatDate(campaign.created_at)}</td><td><strong>${escapeHtml(campaign.name)}</strong><br><span class="muted">${escapeHtml(campaign.admin_name)}</span></td><td>${escapeHtml(campaign.subject)}</td><td>${campaign.recipient_count}</td><td>${campaign.sent_count} wysłanych${campaign.failed_count ? ` · ${campaign.failed_count} błędów` : ''}</td><td><span class="campaign-status-pill ${campaign.status}">${escapeHtml(labels[campaign.status] || campaign.status)}</span></td><td>${['draft','partial'].includes(campaign.status) ? `<button class="button primary small" type="button" data-send-campaign="${campaign.id}" data-recipient-count="${campaign.recipient_count}">${campaign.status === 'partial' ? 'Ponów błędy' : 'Wyślij'}</button>` : ''}</td></tr>`).join('');
  document.querySelector('#campaignEmpty').classList.toggle('hidden', marketingCampaigns.length > 0);
}

function renderMarketingDeletionRequests() {
  document.querySelector('#marketingDeletionRows').innerHTML = marketingDeletionRequests.map(item => `<tr><td>${formatDate(item.created_at)}</td><td><strong>${escapeHtml(item.email)}</strong></td><td>${escapeHtml(item.reason || 'Brak dodatkowej informacji')}</td><td><span class="campaign-status-pill ${item.status === 'processed' ? 'sent' : 'partial'}">${item.status === 'processed' ? 'Obsłużone' : 'Do weryfikacji'}</span></td><td>${item.processed_at ? `${escapeHtml(item.admin_name || 'Administrator')}<br><span class="muted">${formatDate(item.processed_at)}</span>` : '—'}</td><td>${item.status === 'pending' ? `<button class="button danger small" type="button" data-process-deletion="${item.id}" data-email="${escapeHtml(item.email)}">Wycofaj wszystkie zgody</button>` : ''}</td></tr>`).join('');
  document.querySelector('#marketingDeletionEmpty').classList.toggle('hidden', marketingDeletionRequests.length > 0);
}

function renderMarketing() {
  const counts = {
    all: marketingContacts.length,
    email: marketingContacts.filter(contact => contact.marketing_email_consent).length,
    sms: marketingContacts.filter(contact => contact.marketing_sms_consent).length,
    phone: marketingContacts.filter(contact => contact.marketing_phone_consent).length
  };
  document.querySelector('#marketingMetrics').innerHTML = [['all','Wszyscy w bazie'],['email','Zgoda e-mail'],['sms','Zgoda SMS'],['phone','Zgoda telefon']].map(([key,label]) => `<div class="marketing-metric"><span>${label}</span><strong>${counts[key]}</strong></div>`).join('');
  renderMarketingContacts();
  renderMarketingCampaigns();
  renderMarketingDeletionRequests();
}

async function loadMarketing() {
  try {
    const [contactResult, campaignResult, deletionResult] = await Promise.all([api('/api/admin/marketing/contacts'), api('/api/admin/marketing/campaigns'), api('/api/admin/marketing/deletion-requests')]);
    marketingContacts = contactResult.contacts;
    marketingCampaigns = campaignResult.campaigns;
    marketingDeletionRequests = deletionResult.requests;
    const availableIds = new Set(marketingContacts.filter(contact => contact.marketing_email_consent).map(contact => contact.submission_id));
    for (const id of selectedMarketingContacts) if (!availableIds.has(id)) selectedMarketingContacts.delete(id);
    renderMarketing();
  } catch (error) { toast(error.message, true); }
}

document.querySelector('#refreshMarketing').addEventListener('click', loadMarketing);
document.querySelector('#marketingFilters').addEventListener('input', renderMarketingContacts);
document.querySelector('#marketingFilters').addEventListener('change', renderMarketingContacts);
document.querySelector('#selectAllMarketing').addEventListener('change', event => {
  for (const contact of filteredMarketingContacts().filter(item => item.marketing_email_consent)) {
    if (event.target.checked) selectedMarketingContacts.add(contact.submission_id);
    else selectedMarketingContacts.delete(contact.submission_id);
  }
  renderMarketingContacts();
});
document.querySelector('#marketingRows').addEventListener('change', event => {
  const checkbox = event.target.closest('[data-marketing-select]');
  if (!checkbox) return;
  const id = Number(checkbox.dataset.marketingSelect);
  if (checkbox.checked) selectedMarketingContacts.add(id); else selectedMarketingContacts.delete(id);
  updateMarketingSelection();
});
document.querySelector('#marketingRows').addEventListener('click', async event => {
  const removeButton = event.target.closest('[data-remove-marketing]');
  if (removeButton) {
    if (!confirm('Wycofać wszystkie zgody i usunąć tego klienta z bazy marketingowej? Dane zgłoszenia i polis pozostaną w CRM zgodnie z zasadami ich przechowywania.')) return;
    try {
      await api(`/api/admin/marketing/contacts/${removeButton.dataset.removeMarketing}/remove`, { method:'POST', body:'{}' });
      toast('Klient został usunięty z bazy marketingowej.');
      await loadMarketing();
    } catch (error) { toast(error.message, true); }
    return;
  }
  const button = event.target.closest('[data-withdraw-consent]');
  if (!button) return;
  const channelLabels = { email: 'e-mail', sms: 'SMS', phone: 'telefoniczną' };
  if (!confirm(`Wycofać zgodę ${channelLabels[button.dataset.channel]} dla tego klienta?`)) return;
  try {
    await api(`/api/admin/marketing/contacts/${button.dataset.withdrawConsent}/consent`, { method:'PATCH', body:JSON.stringify({ channel:button.dataset.channel, accepted:false }) });
    toast('Zgoda została wycofana i zapisana w historii.');
    await loadMarketing();
  } catch (error) { toast(error.message, true); }
});
document.querySelector('#marketingDeletionRows').addEventListener('click', async event => {
  const button = event.target.closest('[data-process-deletion]');
  if (!button) return;
  if (!confirm(`Potwierdzić weryfikację i wycofać wszystkie zgody marketingowe powiązane z adresem ${button.dataset.email}?`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/marketing/deletion-requests/${button.dataset.processDeletion}/process`, { method:'POST', body:'{}' });
    toast(`Żądanie obsłużone. Usunięto ${result.removed} rekordów z bazy marketingowej.`);
    await loadMarketing();
  } catch (error) { toast(error.message, true); button.disabled = false; }
});
document.querySelector('#campaignForm').addEventListener('submit', async event => {
  event.preventDefault();
  const status = document.querySelector('#campaignStatus');
  const submissionIds = marketingContacts.filter(contact => contact.marketing_email_consent && selectedMarketingContacts.has(contact.submission_id)).map(contact => contact.submission_id);
  if (!submissionIds.length) { status.textContent = 'Wybierz co najmniej jednego odbiorcę ze zgodą e-mail.'; return; }
  status.textContent = 'Zapisywanie kampanii...';
  try {
    await api('/api/admin/marketing/campaigns', { method:'POST', body:JSON.stringify({ name:document.querySelector('#campaignName').value, subject:document.querySelector('#campaignSubject').value, content:document.querySelector('#campaignContent').value, submission_ids:submissionIds }) });
    event.target.reset();
    selectedMarketingContacts.clear();
    status.style.color = 'var(--success)';
    status.textContent = 'Kampania jest gotowa. Użyj przycisku „Wyślij” w historii kampanii.';
    await loadMarketing();
  } catch (error) { status.style.color = 'var(--danger)'; status.textContent = error.message; }
});
document.querySelector('#campaignRows').addEventListener('click', async event => {
  const button = event.target.closest('[data-send-campaign]');
  if (!button) return;
  if (!confirm(`Wysłać tę kampanię do ${button.dataset.recipientCount} odbiorców z aktywną zgodą e-mail?`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/admin/marketing/campaigns/${button.dataset.sendCampaign}/send`, { method:'POST', body:'{}' });
    toast(`Kampania zakończona: ${result.sent} wysłanych, ${result.failed} błędów.`);
    await loadMarketing();
  } catch (error) { toast(error.message, true); button.disabled = false; }
});

async function loadAnonymizations() {
  try { const entries=(await api('/api/admin/anonymizations')).entries; document.querySelector('#anonymizationRows').innerHTML=entries.map(item=>`<tr><td>${formatDate(item.created_at)}</td><td>#${item.submission_reference}</td><td>${escapeHtml(item.form_type)}</td><td>${escapeHtml(statusLabels[item.previous_status]||item.previous_status)}</td><td>${escapeHtml(item.admin_name)}</td><td>${escapeHtml(item.reason||'—')}</td></tr>`).join(''); document.querySelector('#anonymizationEmpty').classList.toggle('hidden',entries.length>0); }
  catch(error){toast(error.message,true);}
}

async function loadAudit() {
  try { const entries=(await api('/api/admin/audit')).entries; document.querySelector('#auditRows').innerHTML=entries.map(item=>`<tr><td>${formatDate(item.created_at)}</td><td>${escapeHtml(item.admin_name)}</td><td>${escapeHtml(operationLabels[item.operation]||item.operation)}</td><td>${escapeHtml(item.entity_type)}${item.entity_id?` #${escapeHtml(item.entity_id)}`:''}</td><td>${escapeHtml(item.ip||'—')}</td></tr>`).join(''); document.querySelector('#auditEmpty').classList.toggle('hidden',entries.length>0); }
  catch(error){toast(error.message,true);}
}

async function loadPosts() {
  try { const posts=(await api('/api/admin/posts')).posts; document.querySelector('#postsList').innerHTML=posts.map(post=>`<article class="post-row"><img src="${escapeHtml(post.image||'')}" alt="" /><div><h3>${escapeHtml(post.title)}</h3><div class="post-meta">${escapeHtml(post.category)} · ${formatDate(post.published_at)} · ${escapeHtml(post.tags.join(', '))}</div><p>${escapeHtml(post.content)}</p></div><button class="icon-button" type="button" data-delete-post="${post.id}" aria-label="Usuń wpis">×</button></article>`).join(''); document.querySelector('#postsEmpty').classList.toggle('hidden',posts.length>0); }
  catch(error){toast(error.message,true);}
}

document.querySelector('#postForm').addEventListener('submit', async event => { event.preventDefault(); const status=document.querySelector('#postStatus'); try { await api('/api/admin/posts',{method:'POST',body:JSON.stringify({title:document.querySelector('#postTitle').value,category:document.querySelector('#postCategory').value,tags:document.querySelector('#postTags').value.split(',').map(tag=>tag.trim()).filter(Boolean),image:document.querySelector('#postImage').value,content:document.querySelector('#postContent').value})}); event.target.reset(); status.style.color='var(--success)'; status.textContent='Wpis został opublikowany.'; loadPosts(); } catch(error){status.style.color='var(--danger)';status.textContent=error.message;} });
document.querySelector('#postsList').addEventListener('click',async event=>{const button=event.target.closest('[data-delete-post]');if(!button||!confirm('Usunąć ten wpis?'))return;await api(`/api/admin/posts/${button.dataset.deletePost}`,{method:'DELETE'});loadPosts();});

document.querySelector('#passwordForm').addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('#passwordStatus');const password=document.querySelector('#newPassword').value;if(password!==document.querySelector('#repeatPassword').value){status.textContent='Nowe hasła nie są takie same.';return;}try{await api('/api/admin/password',{method:'POST',body:JSON.stringify({current_password:document.querySelector('#currentPassword').value,new_password:password})});event.target.reset();status.style.color='var(--success)';status.textContent='Hasło zostało zmienione.';}catch(error){status.style.color='var(--danger)';status.textContent=error.message;}});

document.querySelector('#setup2faButton').addEventListener('click',async()=>{try{const result=await api('/api/admin/2fa/setup',{method:'POST',body:'{}'});document.querySelector('#totpSecret').textContent=result.secret;document.querySelector('#totpLink').href=result.otpauth_uri;document.querySelector('#twoFactorSetup').classList.remove('hidden');}catch(error){document.querySelector('#twoFactorStatus').textContent=error.message;}});
document.querySelector('#enable2faButton').addEventListener('click',async()=>{const status=document.querySelector('#twoFactorStatus');try{await api('/api/admin/2fa/enable',{method:'POST',body:JSON.stringify({code:document.querySelector('#enableTotpCode').value})});status.style.color='var(--success)';status.textContent='2FA zostało włączone.';sessionData.totp_enabled=true;document.querySelector('#twoFactorDisabled').classList.add('hidden');document.querySelector('#twoFactorEnabled').classList.remove('hidden');document.querySelector('#twoFactorState').textContent='2FA jest aktywne na tym koncie.';}catch(error){status.style.color='var(--danger)';status.textContent=error.message;}});
document.querySelector('#twoFactorEnabled').addEventListener('submit',async event=>{event.preventDefault();const status=document.querySelector('#twoFactorStatus');try{await api('/api/admin/2fa/disable',{method:'POST',body:JSON.stringify({password:document.querySelector('#disableTotpPassword').value,code:document.querySelector('#disableTotpCode').value})});event.target.reset();status.style.color='var(--success)';status.textContent='2FA zostało wyłączone.';sessionData.totp_enabled=false;document.querySelector('#twoFactorDisabled').classList.remove('hidden');document.querySelector('#twoFactorEnabled').classList.add('hidden');document.querySelector('#twoFactorState').textContent='2FA nie jest jeszcze włączone.';}catch(error){status.style.color='var(--danger)';status.textContent=error.message;}});

api('/api/admin/session').then(showApp).catch(()=>{});
