'use strict';

const VERSION = 'v1.6';

let flights = JSON.parse(localStorage.getItem('flights') || '[]');
let editId = null;
let sortCol = 'date';
let sortDir = 'desc';
let filterText = '';
let filterYear = '';

function save() {
  localStorage.setItem('flights', JSON.stringify(flights));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

function getApiKey() { return localStorage.getItem('anthropicKey') || ''; }
function setApiKey(k) { localStorage.setItem('anthropicKey', k); }

function openApiKeyModal() {
  document.getElementById('apiKeyInput').value = getApiKey();
  document.getElementById('apiKeyBackdrop').style.display = 'flex';
}
function closeApiKeyModal() {
  document.getElementById('apiKeyBackdrop').style.display = 'none';
}

function parseDurationMinutes(str) {
  if (!str) return 0;
  str = str.trim();
  let m = str.match(/^(\d+)h\s*(\d+)m?$/i);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = str.match(/^(\d+):(\d+)$/);
  if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
  m = str.match(/^(\d+)h$/i);
  if (m) return parseInt(m[1]) * 60;
  m = str.match(/^(\d+)m$/i);
  if (m) return parseInt(m[1]);
  return 0;
}

function formatMinutes(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h${m > 0 ? ' ' + m + 'm' : ''}` : `${m}m`;
}

function calcDuration(dep, arr) {
  if (!dep || !arr) return '';
  const [dh, dm] = dep.split(':').map(Number);
  let [ah, am] = arr.split(':').map(Number);
  let mins = (ah * 60 + am) - (dh * 60 + dm);
  if (mins < 0) mins += 24 * 60;
  return formatMinutes(mins);
}

const MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};

function normalizeDate(d) {
  if (!d) return d;
  d = d.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  let m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  m = d.match(/^(\d{1,2})([A-Za-z]{3})(\d{2}|\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].toUpperCase()];
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    if (mon) return `${year}-${mon}-${m[1].padStart(2,'0')}`;
  }
  return d;
}

function normalizeFlight(f) {
  if (f.date) f.date = normalizeDate(f.date);
  if (!f.dur && f.dep && f.arr) f.dur = calcDuration(f.dep, f.arr);
  if (f.from) f.from = f.from.toUpperCase().slice(0, 4).trim();
  if (f.to)   f.to   = f.to.toUpperCase().slice(0, 4).trim();
  if (!f.id)  f.id   = uid();
  return f;
}

const COLUMN_MAP = {
  datum: 'date', date: 'date', 'departure date': 'date',
  flugnummer: 'flight', flight: 'flight', 'flight number': 'flight', flightnumber: 'flight',
  von: 'from', from: 'from', departure: 'from', origin: 'from', 'departure airport': 'from',
  nach: 'to', to: 'to', arrival: 'to', destination: 'to', ziel: 'to', 'arrival airport': 'to',
  abflugzeit: 'dep', dep: 'dep', 'departure time': 'dep',
  ankunftzeit: 'arr', arr: 'arr', 'arrival time': 'arr',
  dauer: 'dur', dur: 'dur', duration: 'dur', flugzeit: 'dur', 'flight time': 'dur',
  airline: 'airline',
  flugzeug: 'aircraft', aircraft: 'aircraft', 'aircraft type': 'aircraft',
  sitz: 'seat', seat: 'seat',
  klasse: 'class', class: 'class', cabin: 'class',
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, '').trim());
  const colMap = headers.map(h => COLUMN_MAP[h.toLowerCase().trim()] || null);
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
  const result = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === sep && !inQ) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.flights || [];
  return arr.map(f => normalizeFlight({ ...f, id: f.id || uid() }));
}

const CLAUDE_PROMPT = `Analysiere dieses Dokument (Bordkarte, Reisebüro-Itinerary oder Flugticket) und extrahiere ALLE enthaltenen Flüge.

Gib NUR ein gültiges JSON-Array zurück. Jedes Objekt kann folgende Felder haben:
- date: Abflugdatum im Format YYYY-MM-DD (konvertiere z.B. "19SEP26" → "2026-09-19")
- flight: Flugnummer ohne Sonderzeichen (z.B. "LH442", nicht "LH442*")
- from: Abflughafen als 3-buchstabiger IATA-Code (aus "Munich/MUC" → "MUC")
- to: Zielflughafen als 3-buchstabiger IATA-Code (aus "Frankfurt/FRA" → "FRA")
- dep: Abflugzeit HH:MM (24h)
- arr: Ankunftszeit HH:MM (24h, falls vorhanden)
- dur: Flugdauer (z.B. "9h 15m", falls vorhanden)
- airline: Airline-Name (aus Flugnummer ableiten: LH=Lufthansa, UA=United, BA=British Airways, etc.)
- aircraft: Flugzeugtyp falls vorhanden
- seat: Sitzplatz falls vorhanden
- class: Kabinenklasse ausgeschrieben – Codes umrechnen: Z/Y/B/M/H/Q/V/S=Economy, C/J/D=Business, F/A=First, W/P=Premium Economy

Alle Flüge erfassen, nicht nur den ersten! Nur das JSON-Array, kein anderer Text. [] wenn keine Flüge.`;

function requireApiKey() {
  const key = getApiKey();
  if (!key) { openApiKeyModal(); toast('Bitte zuerst API-Key eingeben', 'error'); }
  return key;
}

function parseClaudeResponse(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

async function claudeCall(content) {
  const key = requireApiKey();
  if (!key) return [];

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-allow-browser': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content }]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401) throw new Error('API-Key ungültig – bitte prüfen');
    throw new Error(err.error?.message || `API-Fehler ${resp.status}`);
  }

  const data = await resp.json();
  return parseClaudeResponse(data.content?.[0]?.text || '[]');
}

function extractPDFText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const bin = e.target.result;
      const chunks = bin.match(/[\x20-\x7E]{4,}/g) || [];
      const text = chunks
        .filter(s => /[A-Za-z0-9]/.test(s))
        .join(' ')
        .slice(0, 12000);
      resolve(text);
    };
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsBinaryString(file);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function handleTextFile(file, parser) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parser(e.target.result);
        if (!parsed.length) { toast('Keine Flüge in der Datei gefunden', 'error'); return resolve([]); }
        addFlights(parsed);
        toast(`${parsed.length} Flug${parsed.length !== 1 ? 'e' : ''} importiert`, 'success');
        resolve(parsed);
      } catch (err) {
        toast('Lesefehler: ' + err.message, 'error');
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function handleImageFile(file) {
  try {
    const base64 = await fileToBase64(file);
    const parsed = await claudeCall([
      { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: base64 } },
      { type: 'text', text: CLAUDE_PROMPT }
    ]);
    const normalized = parsed.map(f => normalizeFlight(f));
    addFlights(normalized);
    if (normalized.length) return { count: normalized.length };
    throw new Error('Keine Flugdaten im Bild erkannt');
  } catch (err) {
    throw err;
  }
}

async function handlePDFFile(file) {
  const text = await extractPDFText(file);
  if (text.length < 30) {
    throw new Error('PDF nicht lesbar – bitte Screenshot als Foto hochladen');
  }
  const parsed = await claudeCall([{ type: 'text', text: CLAUDE_PROMPT + '\n\nDokumentinhalt:\n' + text }]);
  const normalized = parsed.map(f => normalizeFlight(f));
  addFlights(normalized);
  if (normalized.length) return { count: normalized.length };
  throw new Error('Keine Flugdaten erkannt');
}

function addFlights(list) {
  if (!list.length) return;
  flights = [...flights, ...list];
  save();
  render();
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function buildQueue(fileList) {
  const items = Array.from(fileList).map((file, i) => ({ file, id: 'q' + i + uid(), status: 'pending' }));
  const section = document.getElementById('queueSection');
  const list = document.getElementById('queueList');
  list.innerHTML = items.map(item => `
    <li class="queue-item" id="${item.id}">
      <span class="queue-item-name" title="${item.file.name}">${item.file.name}</span>
      <span class="queue-item-size">${fmtSize(item.file.size)}</span>
      <span class="queue-item-status pending">⏳ Ausstehend</span>
    </li>`).join('');
  section.style.display = '';
  return items;
}

function setQueueItemStatus(id, status, label) {
  const li = document.getElementById(id);
  if (!li) return;
  const span = li.querySelector('.queue-item-status');
  span.className = 'queue-item-status ' + status;
  span.textContent = label;
}

async function processQueue(fileList) {
  if (!fileList || !fileList.length) return;

  const key = requireApiKey();
  const needsApi = Array.from(fileList).some(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return ext === 'pdf' || f.type.startsWith('image/');
  });
  if (needsApi && !key) return;

  const items = buildQueue(fileList);
  let doneCount = 0;
  let errorCount = 0;
  let totalFlights = 0;

  for (const item of items) {
    setQueueItemStatus(item.id, 'processing', '🔄 Wird verarbeitet…');
    const ext = item.file.name.split('.').pop().toLowerCase();
    const type = item.file.type || '';
    try {
      let result;
      if (ext === 'csv' || type.includes('csv')) {
        await handleTextFile(item.file, parseCSV);
        result = { count: 0 };
        setQueueItemStatus(item.id, 'done', '✅ Importiert');
        doneCount++;
      } else if (ext === 'json' || type.includes('json')) {
        await handleTextFile(item.file, parseJSON);
        result = { count: 0 };
        setQueueItemStatus(item.id, 'done', '✅ Importiert');
        doneCount++;
      } else if (ext === 'pdf' || type === 'application/pdf') {
        result = await handlePDFFile(item.file);
        totalFlights += result.count || 0;
        setQueueItemStatus(item.id, 'done', `✅ ${result.count} Flug${result.count !== 1 ? 'e' : ''}`);
        doneCount++;
      } else if (type.startsWith('image/')) {
        result = await handleImageFile(item.file);
        totalFlights += result.count || 0;
        setQueueItemStatus(item.id, 'done', `✅ ${result.count} Flug${result.count !== 1 ? 'e' : ''}`);
        doneCount++;
      } else {
        throw new Error('Format nicht unterstützt');
      }
    } catch (err) {
      errorCount++;
      setQueueItemStatus(item.id, 'error', '❌ ' + err.message);
    }
  }

  const parts = [];
  if (totalFlights > 0) parts.push(`${totalFlights} Flug${totalFlights !== 1 ? 'e' : ''} importiert`);
  if (doneCount > 0 && totalFlights === 0) parts.push(`${doneCount} Datei${doneCount !== 1 ? 'en' : ''} verarbeitet`);
  if (errorCount > 0) parts.push(`${errorCount} Fehler`);
  if (parts.length) toast(parts.join(' · '), errorCount && !doneCount ? 'error' : 'success');
}

function sortFlights(arr) {
  return [...arr].sort((a, b) => {
    let va = sortCol === 'dur' ? parseDurationMinutes(a[sortCol]) : (a[sortCol] || '');
    let vb = sortCol === 'dur' ? parseDurationMinutes(b[sortCol]) : (b[sortCol] || '');
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
}

function filterFlights(arr) {
  let res = arr;
  if (filterYear) res = res.filter(f => (f.date || '').startsWith(filterYear));
  if (filterText) {
    const q = filterText.toLowerCase();
    res = res.filter(f => Object.values(f).some(v => String(v).toLowerCase().includes(q)));
  }
  return res;
}

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

function updateYearOptions() {
  const years = [...new Set(flights.map(f => (f.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel = document.getElementById('yearFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle Jahre</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
  if (years.includes(cur)) sel.value = cur;
}

function classBadge(cls) {
  if (!cls) return '';
  const map = { economy: 'eco', business: 'bus', first: 'fst', 'premium economy': 'pre' };
  const key = map[cls.toLowerCase()] || '';
  return `<span class="badge ${key}">${cls}</span>`;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderTable() {
  const visible = sortFlights(filterFlights(flights));
  const tableSection = document.getElementById('tableSection');
  const emptyState  = document.getElementById('emptyState');
  const filterBar   = document.getElementById('filterBar');

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

  document.getElementById('flightBody').innerHTML = visible.map(f => `
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
    </tr>`).join('');

  document.getElementById('tableCount').textContent =
    visible.length !== flights.length
      ? `${visible.length} von ${flights.length} Flügen`
      : `${flights.length} Flug${flights.length !== 1 ? 'e' : ''}`;

  document.querySelectorAll('thead th').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === sortCol) th.classList.add('sort-' + sortDir);
  });
}

function render() { renderStats(); renderTable(); }

function openModal(flight = null) {
  editId = flight ? flight.id : null;
  const form = document.getElementById('flightForm');
  document.getElementById('modalTitle').textContent = flight ? 'Flug bearbeiten' : 'Flug hinzufügen';
  form.reset();
  if (flight) Object.entries(flight).forEach(([k, v]) => { const el = form.elements[k]; if (el) el.value = v; });
  document.getElementById('modalBackdrop').style.display = 'flex';
  form.querySelector('input[name="date"]').focus();
}

function closeModal() {
  document.getElementById('modalBackdrop').style.display = 'none';
  editId = null;
}

function exportCSV() {
  const cols = ['date','flight','from','to','dep','arr','dur','airline','aircraft','seat','class'];
  const hdrs = ['Datum','Flugnummer','Von','Nach','Abflug','Ankunft','Dauer','Airline','Flugzeug','Sitz','Klasse'];
  const rows = [hdrs.join(';'), ...flights.map(f => cols.map(c => f[c] || '').join(';'))];
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' })),
    download: `flugtagebuch_${new Date().toISOString().slice(0,10)}.csv`
  });
  a.click();
}

function updateApiKeyBtn() {
  const btn = document.getElementById('apiKeyBtn');
  btn.textContent = getApiKey() ? '🔑 API-Key ✓' : '🔑 API-Key';
  btn.style.color = getApiKey() ? 'var(--success)' : '';
}

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('over');
  processQueue(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files.length) processQueue(e.target.files);
  e.target.value = '';
});

document.getElementById('pdfBtn').addEventListener('click', () => {
  document.getElementById('pdfInput').click();
});

document.getElementById('pdfInput').addEventListener('change', e => {
  if (e.target.files.length) processQueue(e.target.files);
  e.target.value = '';
});

// ── Google Drive ───────────────────────────────────────────────────────────
function extractGDriveId(url) {
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

async function handleGDriveLink() {
  const url = document.getElementById('gdriveInput').value.trim();
  if (!url) { toast('Bitte Google Drive Link einfügen', 'error'); return; }

  const id = extractGDriveId(url);
  if (!id) { toast('Link nicht erkannt – bitte "Teilen"-Link von Google Drive', 'error'); return; }

  const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;

  // Show queue with a placeholder entry
  const section = document.getElementById('queueSection');
  const list = document.getElementById('queueList');
  section.style.display = '';
  list.innerHTML = `<li class="queue-item">
    <span class="queue-item-name">Google Drive PDF</span>
    <span class="queue-item-status processing">🔄 Wird geladen…</span>
  </li>`;

  try {
    const resp = await fetch(downloadUrl);
    if (!resp.ok) throw new Error('Datei nicht abrufbar (nicht öffentlich geteilt?)');
    const blob = await resp.blob();
    const file = new File([blob], 'drive.pdf', { type: 'application/pdf' });

    list.innerHTML = `<li class="queue-item">
      <span class="queue-item-name">Google Drive PDF</span>
      <span class="queue-item-status processing">🔄 KI liest PDF…</span>
    </li>`;

    const text = await extractPDFText(file);
    if (text.length < 30) throw new Error('PDF-Inhalt nicht lesbar');

    const parsed = await claudeCall([{ type: 'text', text: CLAUDE_PROMPT + '\n\nDokumentinhalt:\n' + text }]);
    const normalized = parsed.map(f => normalizeFlight(f));

    if (normalized.length) {
      flights = [...flights, ...normalized];
      save(); render();
      list.innerHTML = `<li class="queue-item">
        <span class="queue-item-name">Google Drive PDF</span>
        <span class="queue-item-status done">✅ ${normalized.length} Flug${normalized.length !== 1 ? 'e' : ''} importiert</span>
      </li>`;
      document.getElementById('gdriveInput').value = '';
      toast(`${normalized.length} Flug${normalized.length !== 1 ? 'e' : ''} aus Google Drive importiert`, 'success');
    } else {
      throw new Error('Keine Flugdaten erkannt');
    }
  } catch (err) {
    list.innerHTML = `<li class="queue-item">
      <span class="queue-item-name">Google Drive PDF</span>
      <span class="queue-item-status error">❌ ${err.message}</span>
    </li>`;
    toast('Fehler: ' + err.message, 'error');
  }
}

document.getElementById('gdriveBtn').addEventListener('click', handleGDriveLink);
document.getElementById('gdriveInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') handleGDriveLink();
});

document.getElementById('queueClose').addEventListener('click', () => {
  document.getElementById('queueSection').style.display = 'none';
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
  if (data.from) data.from = data.from.toUpperCase();
  if (data.to)   data.to   = data.to.toUpperCase();
  if (!data.dur && data.dep && data.arr) data.dur = calcDuration(data.dep, data.arr);
  if (editId) {
    const idx = flights.findIndex(f => f.id === editId);
    if (idx !== -1) flights[idx] = { ...flights[idx], ...data };
  } else {
    flights.push({ id: uid(), ...data });
  }
  save(); render(); closeModal();
  toast(editId ? 'Flug aktualisiert' : 'Flug gespeichert', 'success');
});

document.getElementById('flightBody').addEventListener('click', e => {
  const del = e.target.closest('.delete-btn');
  if (del) {
    if (!confirm('Flug löschen?')) return;
    flights = flights.filter(f => f.id !== del.dataset.id);
    save(); render(); toast('Flug gelöscht');
    return;
  }
  const row = e.target.closest('tr[data-id]');
  if (row) { const f = flights.find(f => f.id === row.dataset.id); if (f) openModal(f); }
});

document.querySelectorAll('thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    if (th.dataset.col === sortCol) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    else { sortCol = th.dataset.col; sortDir = 'asc'; }
    render();
  });
});

document.getElementById('searchInput').addEventListener('input', e => { filterText = e.target.value; renderTable(); });
document.getElementById('yearFilter').addEventListener('change', e => { filterYear = e.target.value; renderTable(); });
document.getElementById('exportBtn').addEventListener('click', exportCSV);
document.getElementById('clearBtn').addEventListener('click', () => {
  if (!confirm(`Alle ${flights.length} Flüge wirklich löschen?`)) return;
  flights = []; save(); render(); toast('Alle Flüge gelöscht');
});

document.getElementById('apiKeyBtn').addEventListener('click', openApiKeyModal);
document.getElementById('apiKeyClose').addEventListener('click', closeApiKeyModal);
document.getElementById('apiKeyBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('apiKeyBackdrop')) closeApiKeyModal();
});
document.getElementById('apiKeySaveBtn').addEventListener('click', () => {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { toast('Bitte API-Key eingeben', 'error'); return; }
  setApiKey(val); closeApiKeyModal();
  toast('API-Key gespeichert', 'success'); updateApiKeyBtn();
});
document.getElementById('apiKeyClearBtn').addEventListener('click', () => {
  localStorage.removeItem('anthropicKey');
  document.getElementById('apiKeyInput').value = '';
  toast('API-Key gelöscht'); updateApiKeyBtn();
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeApiKeyModal(); } });

document.getElementById('version').textContent = VERSION;
updateApiKeyBtn();
render();
