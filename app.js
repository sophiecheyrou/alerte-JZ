const cfg = window.APP_CONFIG || {};
const LABELS = { PRESENT: 'Présent', SORTI: 'Sorti', NON_LOCALISE: 'Non localisé' };

let rooms = [];
let statuses = {};
let role = null;
let supa = null;
let deferredPrompt = null;
let toastTimer = null;
let searchValue = '';

const el = id => document.getElementById(id);
const roomSort = (a,b) => String(a).localeCompare(String(b), 'fr', { numeric: true });

async function init() {
  const rawRooms = Array.isArray(window.ROOMS_DATA)
    ? window.ROOMS_DATA
    : await fetch('rooms.json').then(r => { if (!r.ok) throw new Error('Liste des chambres indisponible'); return r.json(); });

  // Source immuable et dédupliquée : une chambre ne peut exister qu'une seule fois dans l'interface.
  const seenRooms = new Set();
  rooms = rawRooms.filter(room => {
    const key = String(room.room).trim().toUpperCase();
    if (!key || seenRooms.has(key)) return false;
    seenRooms.add(key);
    return true;
  }).map(room => Object.freeze({ ...room }));
  Object.freeze(rooms);

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

  document.querySelectorAll('.role-card').forEach(button => button.addEventListener('click', () => openRole(button.dataset.role)));
  el('backBtn').addEventListener('click', showHome);
  el('homeBtn').addEventListener('click', showHome);
  el('archivesBackBtn').addEventListener('click', showHome);
  el('archiveBtn').addEventListener('click', showArchives);
  el('deleteSelectedArchivesBtn').addEventListener('click', deleteSelectedArchives);
  el('selectAllArchives').addEventListener('change', toggleSelectAllArchives);
  el('newExerciseBtn').addEventListener('click', openResetDialog);
  el('cancelResetBtn').addEventListener('click', closeResetDialog);
  el('confirmResetBtn').addEventListener('click', resetAll);
  el('saveThenResetBtn').addEventListener('click', async () => { await saveExercise(); await resetAll(); });
  el('confirmDialog').addEventListener('click', event => { if (event.target === el('confirmDialog')) closeResetDialog(); });
  el('roomSearch').addEventListener('input', event => { searchValue = event.target.value.trim().toUpperCase(); renderSearch(); });
  el('clearSearchBtn').addEventListener('click', clearSearch);
  el('saveExerciseBtn').addEventListener('click', saveExercise);
  el('emailReportBtn').addEventListener('click', () => emailReport(buildExerciseSnapshot()));

  updateHomeSummary();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

function normalizeStatuses() {
  let changed = false;
  Object.keys(statuses).forEach(roomNumber => {
    if (!['PRESENT','SORTI','NON_LOCALISE'].includes(statuses[roomNumber]?.status)) {
      statuses[roomNumber] = { ...statuses[roomNumber], status: 'NON_LOCALISE' }; changed = true;
    }
  });
  if (changed && !supa) saveLocal();
}

function showView(id) {
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  el(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showHome() { role = null; clearSearch(); showView('home'); updateHomeSummary(); }
function showArchives() { role = null; showView('archives'); renderArchives(); }

function openRole(nextRole) {
  role = nextRole; clearSearch(); showView('app'); render();
}

function statusOf(roomNumber) {
  const status = statuses[roomNumber]?.status;
  return ['PRESENT','SORTI','NON_LOCALISE'].includes(status) ? status : 'NON_LOCALISE';
}

function uniqueByRoom(sourceRooms) {
  const seen = new Set();
  return sourceRooms.filter(room => {
    const key = String(room.room).trim().toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function monitoredRooms() {
  // Périmètre officiel commun à la Loge et au Tableau de bord.
  return uniqueByRoom(rooms.filter(room => room.side === 'PAIR' || room.side === 'IMPAIR'));
}

function getCounts(sourceRooms = monitoredRooms()) {
  const counts = { PRESENT: 0, SORTI: 0, NON_LOCALISE: 0 };
  uniqueByRoom(sourceRooms).forEach(room => counts[statusOf(room.room)]++);
  return counts;
}

function scopeRooms() {
  // Chaque page est recalculée uniquement depuis la source immuable.
  // Aucun élément d'une page précédente n'est réutilisé.
  if (role === 'PAIR') {
    return uniqueByRoom(rooms.filter(room => room.side === 'PAIR' && Number(room.floor) >= 1 && Number(room.floor) <= 5));
  }
  if (role === 'IMPAIR') {
    return uniqueByRoom(rooms.filter(room => room.side === 'IMPAIR' && Number(room.floor) >= 1 && Number(room.floor) <= 5));
  }
  if (role === 'DIRECTION' || role === 'LOGE') return monitoredRooms();
  return uniqueByRoom(rooms);
}

function renderCurrentView() { if (role) render(); else updateHomeSummary(); }

function render() {
  // Nettoyage systématique avant chaque rendu : empêche tout doublon lors des allers-retours entre pages.
  el('operationalGroups').replaceChildren();
  el('missingGroups').replaceChildren();

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
  el('kpis').innerHTML = `
    <div class="kpi present"><b>${counts.PRESENT}</b><span>Présents</span></div>
    <div class="kpi sorti"><b>${counts.SORTI}</b><span>Sortis</span></div>
    <div class="kpi missing"><b>${counts.NON_LOCALISE}</b><span>Non localisés</span></div>`;

  const isDirection = role === 'DIRECTION';
  el('searchWrap').hidden = isDirection;
  el('operationalGroups').hidden = isDirection;
  el('missingGroups').hidden = !isDirection;
  el('dashboardActions').hidden = !isDirection;

  if (isDirection) renderDashboard(scope);
  else renderOperationalGroups(scope);

  renderSearch();
  updateHomeSummary();
}

function renderOperationalGroups(scope) {
  const byFloor = new Map();
  for (let f = 1; f <= 5; f++) byFloor.set(String(f), []);
  // Seule la LOGE peut afficher les chambres sans étage affecté.
  if (role === 'LOGE') byFloor.set('AUTRES', []);

  scope.forEach(room => {
    const key = room.floor >= 1 && room.floor <= 5 ? String(room.floor) : 'AUTRES';
    if (byFloor.has(key)) byFloor.get(key).push(room);
  });

  const sections = [];
  for (const [key, list] of byFloor.entries()) {
    if (!list.length) continue;
    list.sort((a,b) => roomSort(a.room,b.room));
    const label = key === 'AUTRES' ? 'Autres chambres' : `${key}${key === '1' ? 'er' : 'e'} étage`;
    const counts = getCounts(list);
    const context = role === 'LOGE' ? `${counts.SORTI} sorti${counts.SORTI > 1 ? 's' : ''}` : `${counts.PRESENT} présent${counts.PRESENT > 1 ? 's' : ''}`;
    sections.push(`<section class="floor-section"><div class="floor-head"><h2>${label}</h2><span>${context} / ${list.length}</span></div><div class="floor-room-grid">${list.map(renderRoomButton).join('')}</div></section>`);
  }
  // Une seule écriture du contenu à chaque rendu.
  const container = el('operationalGroups');
  container.innerHTML = sections.join('') || '<div class="empty-state">Aucune chambre à afficher.</div>';
  container.querySelectorAll('.room').forEach(button => button.addEventListener('click', () => toggleRoom(button.dataset.room), { once: false }));
}

function renderRoomButton(room) {
  const status = statusOf(room.room);
  return `<button class="room ${status}" data-room="${escapeHtml(room.room)}" aria-label="Chambre ${escapeHtml(room.room)}, ${LABELS[status]}">${escapeHtml(room.room)}</button>`;
}

function renderDashboard(scope) {
  const missing = scope.filter(room => statusOf(room.room) === 'NON_LOCALISE');
  if (!missing.length) {
    el('missingGroups').innerHTML = '<div class="all-clear">✓ Toutes les chambres sont localisées.</div>';
    return;
  }

  const byFloor = new Map();
  for (let f = 1; f <= 5; f++) byFloor.set(String(f), []);
  byFloor.set('AUTRES', []);

  missing.forEach(room => {
    const key = room.floor >= 1 && room.floor <= 5 ? String(room.floor) : 'AUTRES';
    byFloor.get(key).push(room.room);
  });

  const sections = [];
  for (const [key, numbers] of byFloor.entries()) {
    if (!numbers.length) continue;
    numbers.sort(roomSort);
    const label = key === 'AUTRES' ? 'Autres chambres' : `${key}${key === '1' ? 'er' : 'e'} étage`;
    sections.push(`<section class="dashboard-floor"><div class="dashboard-floor-head"><h2>${label}</h2><span>${numbers.length}</span></div><div class="dashboard-room-list">${numbers.map(n => `<span class="dashboard-room-chip" aria-label="Chambre ${escapeHtml(n)} non localisée">${escapeHtml(n)}</span>`).join('')}</div></section>`);
  }
  el('missingGroups').innerHTML = sections.join('');
}

function renderSearch() {
  if (!role || role === 'DIRECTION') return;
  const wrap = el('searchResult');
  el('clearSearchBtn').hidden = !searchValue;
  if (!searchValue) { wrap.hidden = true; wrap.innerHTML = ''; return; }

  const exact = rooms.find(r => String(r.room).toUpperCase() === searchValue);
  const partials = rooms.filter(r => String(r.room).toUpperCase().includes(searchValue)).slice(0,8);
  const matches = exact ? [exact] : partials;
  if (!matches.length) { wrap.hidden = false; wrap.innerHTML = '<div class="search-error">Aucune chambre trouvée.</div>'; return; }

  wrap.hidden = false;
  wrap.innerHTML = matches.map(room => {
    const status = statusOf(room.room);
    const floor = room.floor ? `${room.floor}${room.floor === 1 ? 'er' : 'e'} étage` : 'Étage non classé';
    const side = room.side === 'PAIR' ? 'pair' : room.side === 'IMPAIR' ? 'impair' : '';
    let actionLabel, actionClass;
    if (role === 'LOGE') {
      actionLabel = status === 'SORTI' ? 'Annuler sortie' : 'Marquer sorti';
      actionClass = status === 'SORTI' ? 'cancel' : 'sorti';
    } else {
      actionLabel = status === 'PRESENT' ? 'Annuler présence' : 'Marquer présent';
      actionClass = status === 'PRESENT' ? 'cancel' : 'present';
    }
    return `<div class="search-match"><div><div class="search-number">${escapeHtml(room.room)}</div><div class="search-meta">${floor}${side ? ` · côté ${side}` : ''} · ${LABELS[status]}</div></div><button class="search-action ${actionClass}" data-room="${escapeHtml(room.room)}">${actionLabel}</button></div>`;
  }).join('');
  wrap.querySelectorAll('.search-action').forEach(button => button.addEventListener('click', async () => {
    await toggleRoom(button.dataset.room);
    clearSearch();
    const input = el('roomSearch');
    if (input) input.focus();
  }));
}

function clearSearch() {
  searchValue = '';
  if (el('roomSearch')) el('roomSearch').value = '';
  if (el('searchResult')) { el('searchResult').hidden = true; el('searchResult').innerHTML = ''; }
  if (el('clearSearchBtn')) el('clearSearchBtn').hidden = true;
}

async function toggleRoom(roomNumber) {
  // Sécurité absolue : le Tableau de bord est une vue de consultation uniquement.
  if (role === 'DIRECTION') return;
  const current = statusOf(roomNumber);
  const next = role === 'LOGE' ? (current === 'SORTI' ? 'NON_LOCALISE' : 'SORTI') : (current === 'PRESENT' ? 'NON_LOCALISE' : 'PRESENT');
  await setStatus(roomNumber, next);
  showToast(`Chambre ${roomNumber} : ${LABELS[next]}`);
}

async function setStatus(roomNumber, status) {
  // Deuxième garde : aucune écriture n'est autorisée depuis le Tableau de bord.
  if (role === 'DIRECTION') return;
  if (supa) {
    const exerciseId = await ensureActiveExercise();
    const { error } = await supa.from('room_status_events').insert({ exercise_id: exerciseId, room_number: roomNumber, status, station: role });
    if (error) { alert('Enregistrement impossible : ' + error.message); return; }
    await loadRemote();
  } else {
    statuses[roomNumber] = { status, updated_at: new Date().toISOString(), station: role };
    saveLocal();
  }
  renderCurrentView();
}

function saveLocal() { localStorage.setItem('jz-statuses', JSON.stringify(statuses)); }
function openResetDialog() { el('confirmDialog').hidden = false; }
function closeResetDialog() { el('confirmDialog').hidden = true; }

async function resetAll() {
  el('confirmResetBtn').disabled = true; el('saveThenResetBtn').disabled = true;
  try {
    if (supa) {
      const active = await getActiveExercise();
      if (active) await supa.from('exercises').update({ is_active:false, ended_at:new Date().toISOString() }).eq('id',active.id);
      const { data:newEx,error:newErr } = await supa.from('exercises').insert({ is_active:true }).select().single();
      if (newErr) throw newErr;
      const rows = rooms.map(room => ({ exercise_id:newEx.id, room_number:room.room, status:'NON_LOCALISE', station:'NOUVEL_EXERCICE' }));
      for (let i=0;i<rows.length;i+=150) { const {error}=await supa.from('room_status_events').insert(rows.slice(i,i+150)); if(error) throw error; }
      await loadRemote();
    } else {
      statuses = {}; saveLocal(); localStorage.setItem('jz-exercise-started-at', new Date().toISOString());
    }
    closeResetDialog(); renderCurrentView(); showToast('Nouvel exercice démarré.');
  } catch(error) { alert('La remise à zéro a échoué : ' + error.message); }
  finally { el('confirmResetBtn').disabled = false; el('saveThenResetBtn').disabled = false; }
}

async function getActiveExercise() {
  if (!supa) return null;
  const {data,error}=await supa.from('exercises').select('*').eq('is_active',true).order('started_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error; return data;
}
async function ensureActiveExercise() {
  const active=await getActiveExercise(); if(active) return active.id;
  const {data,error}=await supa.from('exercises').insert({is_active:true}).select().single(); if(error) throw error; return data.id;
}

function buildExerciseSnapshot() {
  const now = new Date(); const startedRaw = localStorage.getItem('jz-exercise-started-at');
  const officialRooms = monitoredRooms();
  const counts = getCounts(officialRooms);
  const missing = officialRooms.filter(r => statusOf(r.room)==='NON_LOCALISE').map(r=>r.room).sort(roomSort);
  const present = officialRooms.filter(r => statusOf(r.room)==='PRESENT').map(r=>r.room).sort(roomSort);
  const out = officialRooms.filter(r => statusOf(r.room)==='SORTI').map(r=>r.room).sort(roomSort);
  return {
    id: `JZ-${now.toISOString().replace(/[-:TZ.]/g,'').slice(0,14)}`,
    started_at: startedRaw || null,
    saved_at: now.toISOString(),
    total: officialRooms.length,
    present_count: counts.PRESENT,
    out_count: counts.SORTI,
    missing_count: counts.NON_LOCALISE,
    present, out, missing
  };
}

async function saveExercise() {
  const snapshot = buildExerciseSnapshot();
  if (supa) {
    try {
      const active=await getActiveExercise();
      if(active) {
        const {error}=await supa.from('exercise_archives').insert({ exercise_id:active.id, snapshot });
        if(error) throw error;
      }
    } catch(error) { console.warn('Archive distante indisponible, sauvegarde locale utilisée.', error); }
  }
  const archives = JSON.parse(localStorage.getItem('jz-exercise-archives') || '[]');
  if (!archives.some(a => a.id === snapshot.id)) { archives.unshift(snapshot); localStorage.setItem('jz-exercise-archives', JSON.stringify(archives.slice(0,50))); }
  showToast('Exercice sauvegardé dans les archives.');
  return snapshot;
}

function renderArchives() {
  const archives = JSON.parse(localStorage.getItem('jz-exercise-archives') || '[]');
  const tools = el('archivesTools');
  const selectAll = el('selectAllArchives');
  const deleteBtn = el('deleteSelectedArchivesBtn');

  selectAll.checked = false;
  deleteBtn.disabled = true;

  if (!archives.length) {
    tools.hidden = true;
    el('archivesList').innerHTML = '<div class="empty-state">Aucun exercice archivé pour le moment.</div>';
    return;
  }

  tools.hidden = false;
  el('archivesList').innerHTML = archives.map((a,i) => {
    const date = new Date(a.saved_at).toLocaleString('fr-FR');
    const missing = a.missing?.length ? a.missing.join(', ') : 'Aucune';
    return `<article class="archive-card">
      <label class="archive-select" aria-label="Sélectionner l’archive du ${escapeHtml(date)}">
        <input type="checkbox" data-archive-select="${i}">
        <span>Sélectionner</span>
      </label>
      <h2>${date}</h2>
      <div class="archive-stats"><span class="green">${a.present_count} présents</span><span class="yellow">${a.out_count} sortis</span><span class="red">${a.missing_count} non localisés</span></div>
      <div class="archive-room-list"><b>Chambres non localisées :</b> ${escapeHtml(missing)}</div>
      <div class="archive-actions"><button data-email="${i}">Envoyer par mail</button><button data-download="${i}">Télécharger le compte-rendu</button><button class="archive-delete-one" data-delete="${i}">Supprimer</button></div>
    </article>`;
  }).join('');

  el('archivesList').querySelectorAll('[data-email]').forEach(b=>b.addEventListener('click',()=>emailReport(archives[Number(b.dataset.email)])));
  el('archivesList').querySelectorAll('[data-download]').forEach(b=>b.addEventListener('click',()=>downloadReport(archives[Number(b.dataset.download)])));
  el('archivesList').querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>deleteOneArchive(Number(b.dataset.delete))));
  el('archivesList').querySelectorAll('[data-archive-select]').forEach(cb=>cb.addEventListener('change', updateArchiveSelectionState));
}

function updateArchiveSelectionState() {
  const boxes = [...document.querySelectorAll('[data-archive-select]')];
  const checked = boxes.filter(cb => cb.checked);
  el('deleteSelectedArchivesBtn').disabled = checked.length === 0;
  el('selectAllArchives').checked = boxes.length > 0 && checked.length === boxes.length;
  el('selectAllArchives').indeterminate = checked.length > 0 && checked.length < boxes.length;
}

function toggleSelectAllArchives(event) {
  document.querySelectorAll('[data-archive-select]').forEach(cb => { cb.checked = event.target.checked; });
  updateArchiveSelectionState();
}

function deleteOneArchive(index) {
  const archives = JSON.parse(localStorage.getItem('jz-exercise-archives') || '[]');
  const archive = archives[index];
  if (!archive) return;
  const date = new Date(archive.saved_at).toLocaleString('fr-FR');
  if (!window.confirm(`Supprimer l’archive du ${date} ?`)) return;
  archives.splice(index, 1);
  localStorage.setItem('jz-exercise-archives', JSON.stringify(archives));
  renderArchives();
  showToast('Archive supprimée.');
}

function deleteSelectedArchives() {
  const selected = [...document.querySelectorAll('[data-archive-select]:checked')].map(cb => Number(cb.dataset.archiveSelect));
  if (!selected.length) return;
  const label = selected.length > 1 ? `${selected.length} archives` : 'cette archive';
  if (!window.confirm(`Supprimer définitivement ${label} ?`)) return;
  const selectedSet = new Set(selected);
  const archives = JSON.parse(localStorage.getItem('jz-exercise-archives') || '[]');
  const remaining = archives.filter((_, index) => !selectedSet.has(index));
  localStorage.setItem('jz-exercise-archives', JSON.stringify(remaining));
  renderArchives();
  showToast(selected.length > 1 ? `${selected.length} archives supprimées.` : 'Archive supprimée.');
}

function reportText(a) {
  const saved = new Date(a.saved_at).toLocaleString('fr-FR');
  const started = a.started_at ? new Date(a.started_at).toLocaleString('fr-FR') : 'non renseignée';
  return `INTERNAT JEAN ZAY — COMPTE-RENDU D’EXERCICE DE SÉCURITÉ\n\nDébut : ${started}\nSauvegarde : ${saved}\nEffectif chambres : ${a.total}\nPrésents : ${a.present_count}\nSortis : ${a.out_count}\nNon localisés : ${a.missing_count}\n\nCHAMBRES NON LOCALISÉES\n${a.missing?.length ? a.missing.join(', ') : 'Aucune'}\n\nCHAMBRES SORTIES\n${a.out?.length ? a.out.join(', ') : 'Aucune'}\n\nCHAMBRES PRÉSENTES\n${a.present?.length ? a.present.join(', ') : 'Aucune'}\n`;
}
function emailReport(a) {
  const subject = encodeURIComponent(`Internat Jean Zay — compte-rendu exercice ${new Date(a.saved_at).toLocaleDateString('fr-FR')}`);
  const body = encodeURIComponent(reportText(a));
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}
function downloadReport(a) {
  const blob=new Blob([reportText(a)],{type:'text/plain;charset=utf-8'}); const url=URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`compte-rendu-${a.id}.txt`; link.click(); URL.revokeObjectURL(url);
}

async function loadRemote() {
  const active = await getActiveExercise();
  statuses = {};
  if (!active) return;
  const {data,error}=await supa.from('current_room_status').select('*').eq('exercise_id',active.id);
  if(error) throw error;
  (data||[]).forEach(item=>{ statuses[item.room_number]={status:item.status,updated_at:item.updated_at,station:item.station}; });
}
function subscribeRealtime() {
  supa.channel('room-events').on('postgres_changes',{event:'INSERT',schema:'public',table:'room_status_events'},async()=>{ await loadRemote(); renderCurrentView(); }).subscribe();
}
function updateHomeSummary() {
  const counts=getCounts();
  el('homeSummary').innerHTML=`<span class="summary-item present"><b>${counts.PRESENT}</b>Présents</span><span class="summary-item sorti"><b>${counts.SORTI}</b>Sortis</span><span class="summary-item missing"><b>${counts.NON_LOCALISE}</b>Non localisés</span>`;
}
function showToast(message) { clearTimeout(toastTimer); el('toast').textContent=message; el('toast').hidden=false; toastTimer=setTimeout(()=>{el('toast').hidden=true;},2000); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

window.addEventListener('beforeinstallprompt',event=>{ event.preventDefault(); deferredPrompt=event; el('installBtn').hidden=false; });
el('installBtn').addEventListener('click',async()=>{ if(deferredPrompt) await deferredPrompt.prompt(); });
init().catch(error=>alert('Initialisation impossible : '+error.message));
