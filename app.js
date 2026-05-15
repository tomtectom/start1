'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let flights = JSON.parse(localStorage.getItem('flights') || '[]');
let editId = null;
let sortCol = 'date';
let sortDir = 'desc';
let filterText = '';
let filterYear = '';

// ── Persist ────────────────────────────────────────────────────────────────
function save() {
  localStorage.setItem('flights', JSON.stringify(flights));
}

// ── ID ─────────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3000);
}

// ── Duration helpers ───────────────────────────────────────────────────────
function parseDurationMinutes(str) {
  if (!str) return 0;
  str = str.trim();
  // formats: "9h 15m", "9:15", "9h15", "555", "9h", "15m"
  let m = str.match(/^(\d+)h\s*(\d+)m?$/i);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = str.match(/^(\d+):(\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = str.match(/^(\d+)h$/i);
  if (m) return parseInt(m[1]) * 60;
  m = str.match(/^(\d+)m$/i);
  if (m) return parseInt(m[1]);
  m = str.match(/^(\d+)$/);
  if (m) return parseInt(m[1]);
  return 0;
}

function formatMinutes(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m > 0 ? m + 'm' : ''}`.trim() : `${m}m`;
}

function calcDuration(dep, arr) {
  if (!dep || !arr) return '';
  const [dh, dm] = dep.split(':').map(Number);
  let [ah, am] = arr.split(':').map(Number);
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60; // next day
  return formatMinutes(mins);
}

// ── CSV / JSON parsing ─────────────────────────────────────────────────────
const COLUMN_MAP = {
  datum: 'date', date: 'date', 'departure date': 'date',
  flugnummer: 'flight', flight: 'flight', 'flight number': 'flight', 'flight no': 'flight', flightnumber: 'flight',
  von: 'from', from: 'from', departure: 'from', origin: 'from', abflug: 'from', 'departure airport': 'from',
  nach: 'to', to: 'to', arrival: 'to', destination: 'to', ziel: 'to', 'arrival airport': 'to',
  abflugzeit: 'dep', dep: 'dep', 'dep time': 'dep', 'departure time': 'dep', abflugzeit: 'dep',
  ankunft: 'arr', arr: 'arr', 'arr time': 'arr', 'arrival time': 'arr', ankunftzeit: 'arr',
  dauer: 'dur', dur: 'dur', duration: 'dur', flugzeit: 'dur', 'flight time': 'dur',
  airline: 'airline',
  flugzeug: 'aircraft', aircraft: 'aircraft', plane: 'aircraft', 'aircraft type': 'aircraft',
  sitz: 'seat', seat: 'seat',
  klasse: 'class', class: 'class', cabin: 'class',
};

function mapHeader(h) {
  return COLUMN_MAP[h.toLowerCase().trim()] || null;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
  const colMap = headers.map(mapHeader);

  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = splitCSVLine(line, sep);
    const f = { id: uid() };
    colMap.forEach((key, i) => {
      if (key) f[key] = (vals[i] || '').replace(/^"|"$/g, '').trim();
    });
    return normalizeFlight(f);
  });
}

function splitCSVLine(line, sep) {
  const result = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function normalizeFlight(f) {
  // Normalize date: accept DD.MM.YYYY, YYYY-MM-DD, MM/DD/YYYY
  if (f.date) {
    f.date = normalizeDate(f.date);
  }
  // Auto-calc duration if missing
  if (!f.dur && f.dep && f.arr) {
    f.dur = calcDuration(f.dep, f.arr);
  }
  // Uppercase airports
  if (f.from) f.from = f.from.toUpperCase();
  if (f.to) f.to = f.to.toUpperCase();
  return f;
}

function normalizeDate(d) {
  // DD.MM.YYYY
  let m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // MM/DD/YYYY
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return d;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.flights || [];
  return arr.map(f => normalizeFlight({ ...f, id: f.id || uid() }));
}

// ── File handling ──────────────────────────────────────────────────────────
function handleFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      let parsed;
      if (file.name.endsWith('.json')) {
        parsed = parseJSON(e.target.result);
      } else {
        parsed = parseCSV(e.target.result);
      }
      if (!parsed.length) { toast('Keine Flüge gefunden', 'error'); return; }
      flights = [...flights, ...parsed];
      save();
      render();
      toast(`${parsed.length} Flug${parsed.length !== 1 ? 'e' : ''} importiert`, 'success');
    } catch (err) {
      toast('Fehler beim Einlesen: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

// ── Sorting ────────────────────────────────────────────────────────────────
function sortFlights(arr) {
  return [...arr].sort((a, b) => {
    let va = a[sortCol] || '';
    let vb = b[sortCol] || '';
    if (sortCol === 'dur') {
      va = parseDurationMinutes(va);
      vb = parseDurationMinutes(vb);
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Filter ─────────────────────────────────────────────────────────────────
function filterFlights(arr) {
  let result = arr;
  if (filterYear) result = result.filter(f => (f.date || '').startsWith(filterYear));
  if (filterText) {
    const q = filterText.toLowerCase();
    result = result.filter(f =>
      Object.values(f).some(v => String(v).toLowerCase().includes(q))
    );
  }
  return result;
}

// ── Stats ──────────────────────────────────────────────────────────────────
function renderStats() {
  const el = document.getElementById('stats');
  if (!flights.length) { el.innerHTML = ''; return; }
  const totalMins = flights.reduce((s, f) => s + parseDurationMinutes(f.dur), 0);
  const airports = new Set(flights.flatMap(f => [f.from, f.to].filter(Boolean))).size;
  el.innerHTML = `
    <div class="stat-item"><div class="stat-value">${flights.length}</div><div class="stat-label">Flüge</div></div>
    <div class="stat-item"><div class="stat-value">${airports}</div><div class="stat-label">Airports</div></div>
    <div class="stat-item"><div class="stat-value">${formatMinutes(totalMins) || '–'}</div><div class="stat-label">Flugzeit</div></div>
  `;
}

// ── Year filter options ────────────────────────────────────────────────────
function updateYearOptions() {
  const years = [...new Set(flights.map(f => (f.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('yearFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle Jahre</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  if (years.includes(cur)) sel.value = cur;
}

// ── Class badge ────────────────────────────────────────────────────────────
function classBadge(cls) {
  if (!cls) return '';
  const map = { 'economy': 'eco', 'business': 'bus', 'first': 'fst', 'premium economy': 'pre' };
  const key = map[cls.toLowerCase()] || '';
  return `<span class="badge ${key}">${cls}</span>`;
}

// ── Format display date ─────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Table ──────────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('flightBody');
  const visible = sortFlights(filterFlights(flights));
  const tableSection = document.getElementById('tableSection');
  const emptyState = document.getElementById('emptyState');
  const filterBar = document.getElementById('filterBar');

  if (!flights.length) {
    tableSection.style.display = 'none';
    filterBar.style.display = 'none';
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  filterBar.style.display = 'flex';
  tableSection.style.display = '';

  updateYearOptions();

  tbody.innerHTML = visible.map(f => `
    <tr data-id="${f.id}">
      <td class="muted">${fmtDate(f.date)}</td>
      <td class="muted">${f.flight || ''}</td>
      <td class="airport">${f.from || ''}</td>
      <td class="airport">${f.to || ''}</td>
      <td class="muted">${f.dep || ''}</td>
      <td class="muted">${f.arr || ''}</td>
      <td>${f.dur || ''}</td>
      <td>${f.airline || ''}</td>
      <td class="muted">${f.aircraft || ''}</td>
      <td class="muted">${f.seat || ''}</td>
      <td>${classBadge(f.class)}</td>
      <td><button class="delete-btn" data-id="${f.id}" title="Löschen">✕</button></td>
    </tr>
  `).join('');

  document.getElementById('tableCount').textContent =
    visible.length !== flights.length
      ? `${visible.length} von ${flights.length} Flügen`
      : `${flights.length} Flug${flights.length !== 1 ? 'e' : ''}`;

  // Sort header indicators
  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) th.classList.add('sort-' + sortDir);
  });
}

function render() {
  renderStats();
  renderTable();
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(flight = null) {
  editId = flight ? flight.id : null;
  const form = document.getElementById('flightForm');
  document.getElementById('modalTitle').textContent = flight ? 'Flug bearbeiten' : 'Flug hinzufügen';
  form.reset();
  if (flight) {
    Object.entries(flight).forEach(([k, v]) => {
      const el = form.elements[k];
      if (el) el.value = v;
    });
  }
  document.getElementById('modalBackdrop').style.display = 'flex';
  form.querySelector('input[name="date"]').focus();
}

function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
  editId = null;
}

// ── Export ─────────────────────────────────────────────────────────────────
function exportCSV() {
  const cols = ['date','flight','from','to','dep','arr','dur','airline','aircraft','seat','class'];
  const headers = ['Datum','Flugnummer','Von','Nach','Abflug','Ankunft','Dauer','Airline','Flugzeug','Sitz','Klasse'];
  const rows = [headers.join(';'), ...flights.map(f => cols.map(c => f[c] || '').join(';'))];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flugtagebuch_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ── Events ─────────────────────────────────────────────────────────────────
const dropZone = document.getElementById('dropZone');

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('addBtn').addEventListener('click', () => openModal());
document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
document.getElementById('modalBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('modalBackdrop')) closeModal();
});

document.getElementById('flightForm').addEventListener('submit', e => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  // Uppercase airports
  if (data.from) data.from = data.from.toUpperCase();
  if (data.to) data.to = data.to.toUpperCase();
  // Auto-calc duration
  if (!data.dur && data.dep && data.arr) data.dur = calcDuration(data.dep, data.arr);
  if (editId) {
    const idx = flights.findIndex(f => f.id === editId);
    if (idx !== -1) flights[idx] = { ...flights[idx], ...data };
  } else {
    flights.push({ id: uid(), ...data });
  }
  save();
  render();
  closeModal();
  toast(editId ? 'Flug aktualisiert' : 'Flug gespeichert', 'success');
});

document.getElementById('flightBody').addEventListener('click', e => {
  const del = e.target.closest('.delete-btn');
  if (del) {
    if (!confirm('Flug löschen?')) return;
    flights = flights.filter(f => f.id !== del.dataset.id);
    save();
    render();
    toast('Flug gelöscht');
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row && !e.target.closest('.delete-btn')) {
    const f = flights.find(f => f.id === row.dataset.id);
    if (f) openModal(f);
  }
});

document.querySelectorAll('thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (sortCol === th.dataset.col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = th.dataset.col;
      sortDir = 'asc';
    }
    render();
  });
});

document.getElementById('searchInput').addEventListener('input', e => {
  filterText = e.target.value;
  renderTable();
});

document.getElementById('yearFilter').addEventListener('change', e => {
  filterYear = e.target.value;
  renderTable();
});

document.getElementById('exportBtn').addEventListener('click', exportCSV);

document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm(`Alle ${flights.length} Flüge wirklich löschen?`)) return;
  flights = [];
  save();
  render();
  toast('Alle Flüge gelöscht');
});

// Keyboard shortcut: Escape closes modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Init ───────────────────────────────────────────────────────────────────
render();
