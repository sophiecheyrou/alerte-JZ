const cfg = window.APP_CONFIG || {};
const LABELS = { TOUS: 'Tous', PRESENT: 'Présents', SORTI: 'Sortis', NON_LOCALISE: 'Non localisés' };

let rooms = [];
let statuses = {};
let role = null;
let floor = 'ALL';
let filter = 'TOUS';
let supa = null;
let deferredPrompt = null;
let toastTimer = null;

const el = id => document.getElementById(id);

async function init() {
  rooms = Array.isArray(window.ROOMS_DATA)
    ? window.ROOMS_DATA
    : await fetch('rooms.json').then(r => {
        if (!r.ok) throw new Error('Liste des chambres indisponible');
        return r.json();
      });

  if (!cfg.demoMode && cfg.supabaseUrl && cfg.supabaseAnonKey) {
    supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    await loadRemote();
    subscribeRealtime();
    el('syncState').textContent = 'Synchronisation active';
  } else {
    statuses = JSON.parse(localStorage.getItem('jz-statuses') || '{}');
    normalizeStatuses();
    window.addEventListener('storage', () => {
      statuses = JSON.parse(localStorage.getItem('jz-statuses') || '{}');
      normalizeStatuses();
      renderCurrentView();
    });
  }

  document.querySelectorAll('.role-card').forEach(button => {
    button.addEventListener('click', () => openRole(button.dataset.role));
  });
  el('backBtn').addEventListener('click', showHome);
  el('homeBtn').addEventListener('click', showHome);
  el('newExerciseBtn').addEventListener('click', openResetDialog);
  el('cancelResetBtn').addEventListener('click', closeResetDialog);
  el('confirmResetBtn').addEventListener('click', resetAll);
  el('confirmDialog').addEventListener('click', event => {
    if (event.target === el('confirmDialog')) closeResetDialog();
  });

  updateHomeSummary();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

function normalizeStatuses() {
  let changed = false;
  Object.keys(statuses).forEach(roomNumber => {
    if (!['PRESENT', 'SORTI', 'NON_LOCALISE'].includes(statuses[roomNumber]?.status)) {
      statuses[roomNumber] = { ...statuses[roomNumber], status: 'NON_LOCALISE' };
      changed = true;
    }
  });
  if (changed && !supa) saveLocal();
}

function showView(id) {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  el(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showHome() {
  role = null;
  showView('home');
  updateHomeSummary();
}

function openRole(nextRole) {
  role = nextRole;
  floor = 'ALL';
  filter = role === 'DIRECTION' ? 'NON_LOCALISE' : 'TOUS';
  showView('app');
  render();
}

function statusOf(roomNumber) {
  const status = statuses[roomNumber]?.status;
  return ['PRESENT', 'SORTI', 'NON_LOCALISE'].includes(status) ? status : 'NON_LOCALISE';
}

function getCounts(sourceRooms = rooms) {
  const counts = { PRESENT: 0, SORTI: 0, NON_LOCALISE: 0 };
  sourceRooms.forEach(room => counts[statusOf(room.room)]++);
  return counts;
}

function allowedStatuses() {
  if (role === 'PAIR' || role === 'IMPAIR') return ['TOUS', 'PRESENT', 'NON_LOCALISE'];
  if (role === 'LOGE') return ['TOUS', 'SORTI', 'NON_LOCALISE'];
  return ['TOUS', 'PRESENT', 'SORTI', 'NON_LOCALISE'];
}

function scopeRooms() {
  return rooms.filter(room =>
    (role !== 'PAIR' || room.side === 'PAIR') &&
    (role !== 'IMPAIR' || room.side === 'IMPAIR')
  );
}

function visibleRooms() {
  return scopeRooms().filter(room => {
    if (floor !== 'ALL' && String(room.floor) !== String(floor)) return false;
    return filter === 'TOUS' || statusOf(room.room) === filter;
  });
}

function renderCurrentView() {
  if (role) render();
  else updateHomeSummary();
}

function render() {
  const meta = {
    PAIR: ['COUR MONTMORENCY', 'CHAMBRES PAIRES'],
    IMPAIR: ['COUR D’HONNEUR', 'CHAMBRES IMPAIRES'],
    LOGE: ['LOGE', 'ÉLÈVES SORTIS'],
    DIRECTION: ['TABLEAU DE BORD', 'SUIVI EN DIRECT']
  };
  el('roleTitle').textContent = meta[role][0];
  el('roleSubtitle').textContent = meta[role][1];

  const scope = scopeRooms();
  const counts = getCounts(scope);
  const localized = counts.PRESENT + counts.SORTI;
  const percent = scope.length ? Math.round(localized / scope.length * 100) : 0;

  el('dashboardHero').hidden = role !== 'DIRECTION';
  if (role === 'DIRECTION') {
    el('dashboardHero').innerHTML = `
      <div class="big-number">${counts.NON_LOCALISE}</div>
      <div class="big-label">CHAMBRES NON LOCALISÉES</div>
      <div class="progress-text">${localized} chambres localisées sur ${scope.length} — ${percent}%</div>`;
  }

  el('kpis').innerHTML = `
    <div class="kpi total"><b>${scope.length}</b><span>Total</span></div>
    <div class="kpi present"><b>${counts.PRESENT}</b><span>Présents</span></div>
    <div class="kpi sorti"><b>${counts.SORTI}</b><span>Sortis</span></div>
    <div class="kpi missing"><b>${counts.NON_LOCALISE}</b><span>Non localisés</span></div>`;

  const allowed = allowedStatuses();
  if (!allowed.includes(filter)) filter = 'TOUS';
  el('filters').innerHTML = allowed.map(value =>
    `<button data-filter="${value}" class="${filter === value ? 'active' : ''}">${LABELS[value]}</button>`
  ).join('');
  el('filters').querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => { filter = button.dataset.filter; render(); });
  });

  el('floorTabs').innerHTML = ['ALL', 1, 2, 3, 4, 5].map(value =>
    `<button data-floor="${value}" class="${String(floor) === String(value) ? 'active' : ''}">${value === 'ALL' ? 'Tous les étages' : `${value}e étage`}</button>`
  ).join('');
  el('floorTabs').querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => { floor = button.dataset.floor; render(); });
  });

  if (role === 'DIRECTION' && filter === 'NON_LOCALISE' && floor === 'ALL') {
    renderMissingGroups(scope);
    el('rooms').innerHTML = '';
  } else {
    el('missingGroups').hidden = true;
    renderRooms();
  }
  updateHomeSummary();
}

function renderMissingGroups(scope) {
  const missing = scope.filter(room => statusOf(room.room) === 'NON_LOCALISE');
  el('missingGroups').hidden = false;
  if (!missing.length) {
    el('missingGroups').innerHTML = '<div class="empty-state">Toutes les chambres sont localisées.</div>';
    return;
  }
  const groups = {};
  missing.forEach(room => {
    const courtyard = room.side === 'PAIR' ? 'Cour Montmorency — pair' : room.side === 'IMPAIR' ? 'Cour d’honneur — impair' : 'Secteur à classer';
    const key = `${courtyard}|${room.floor || '?'}`;
    (groups[key] ||= []).push(room.room);
  });
  el('missingGroups').innerHTML = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
    .map(([key, roomNumbers]) => {
      const [courtyard, floorName] = key.split('|');
      roomNumbers.sort((a,b) => String(a).localeCompare(String(b), 'fr', { numeric: true }));
      return `<section class="missing-section"><h2>${courtyard} · ${floorName === '?' ? 'Étage non classé' : `${floorName}e étage`}</h2><div class="missing-list">${roomNumbers.map(number => `<span class="missing-chip">${number}</span>`).join('')}</div></section>`;
    }).join('');
}

function renderRooms() {
  const readOnly = role === 'DIRECTION';
  const list = visibleRooms().sort((a,b) => String(a.room).localeCompare(String(b.room), 'fr', { numeric: true }));
  el('rooms').innerHTML = list.map(room => {
    const status = statusOf(room.room);
    let hint = LABELS[status];
    if (role === 'LOGE') hint = status === 'SORTI' ? 'Appuyer pour annuler' : 'Appuyer : sorti';
    if (role === 'PAIR' || role === 'IMPAIR') hint = status === 'PRESENT' ? 'Appuyer pour annuler' : 'Appuyer : présent';
    return `<button class="room ${status}${readOnly ? ' readonly' : ''}" data-room="${room.room}" ${readOnly ? 'disabled' : ''}>${room.room}<small>${hint}</small></button>`;
  }).join('') || '<div class="empty-state">Aucune chambre dans ce filtre.</div>';
  if (!readOnly) {
    el('rooms').querySelectorAll('.room').forEach(button => {
      button.addEventListener('click', () => toggleRoom(button.dataset.room));
    });
  }
}

async function toggleRoom(roomNumber) {
  const current = statusOf(roomNumber);
  const next = role === 'LOGE'
    ? (current === 'SORTI' ? 'NON_LOCALISE' : 'SORTI')
    : (current === 'PRESENT' ? 'NON_LOCALISE' : 'PRESENT');
  await setStatus(roomNumber, next);
  showToast(`Chambre ${roomNumber} : ${LABELS[next]}`);
}

async function setStatus(roomNumber, status) {
  if (supa) {
    const { error } = await supa.from('room_status_events').insert({ room_number: roomNumber, status, station: role });
    if (error) { alert('Enregistrement impossible : ' + error.message); return; }
    await loadRemote();
  } else {
    statuses[roomNumber] = { status, updated_at: new Date().toISOString(), station: role };
    saveLocal();
  }
  renderCurrentView();
}

function saveLocal() {
  localStorage.setItem('jz-statuses', JSON.stringify(statuses));
}

function openResetDialog() { el('confirmDialog').hidden = false; }
function closeResetDialog() { el('confirmDialog').hidden = true; }

async function resetAll() {
  el('confirmResetBtn').disabled = true;
  el('confirmResetBtn').textContent = 'Remise à zéro…';
  try {
    if (supa) {
      const now = new Date().toISOString();
      const rows = rooms.map(room => ({ room_number: room.room, status: 'NON_LOCALISE', station: 'NOUVEL_EXERCICE', created_at: now }));
      const chunkSize = 150;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const { error } = await supa.from('room_status_events').insert(rows.slice(i, i + chunkSize));
        if (error) throw error;
      }
      await loadRemote();
    } else {
      statuses = {};
      saveLocal();
      localStorage.setItem('jz-exercise-started-at', new Date().toISOString());
    }
    closeResetDialog();
    renderCurrentView();
    showToast('Nouvel exercice démarré : tous les compteurs sont à zéro.');
  } catch (error) {
    alert('La remise à zéro a échoué : ' + error.message);
  } finally {
    el('confirmResetBtn').disabled = false;
    el('confirmResetBtn').textContent = 'Remettre à zéro';
  }
}

async function loadRemote() {
  const { data, error } = await supa.from('current_room_status').select('*');
  if (error) throw error;
  statuses = {};
  (data || []).forEach(item => {
    statuses[item.room_number] = {
      status: ['PRESENT','SORTI','NON_LOCALISE'].includes(item.status) ? item.status : 'NON_LOCALISE',
      updated_at: item.updated_at,
      station: item.station
    };
  });
}

function subscribeRealtime() {
  supa.channel('room-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_status_events' }, async () => {
      await loadRemote();
      renderCurrentView();
    })
    .subscribe();
}

function updateHomeSummary() {
  const counts = getCounts();
  el('homeSummary').innerHTML = `
    <span class="summary-item present"><b>${counts.PRESENT}</b>Présents</span>
    <span class="summary-item sorti"><b>${counts.SORTI}</b>Sortis</span>
    <span class="summary-item missing"><b>${counts.NON_LOCALISE}</b>Non localisés</span>`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  el('toast').textContent = message;
  el('toast').hidden = false;
  toastTimer = setTimeout(() => { el('toast').hidden = true; }, 2200);
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); deferredPrompt = event; el('installBtn').hidden = false;
});
el('installBtn').addEventListener('click', async () => { if (deferredPrompt) await deferredPrompt.prompt(); });

init().catch(error => alert('Initialisation impossible : ' + error.message));
