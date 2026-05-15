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
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

// ── Loading overlay ────────────────────────────────────────────────────────
function showLoading(text = 'Wird verarbeitet…') {
  document.getElementById('loadingText').textContent = text;
  document.getElementById('loadingOverlay').style.display = 'flex';
}
function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

// ── API Key ────────────────────────────────────────────────────────────────
function getApiKey() { return localStorage.getItem('anthropicKey') || ''; }
function setApiKey(k) { localStorage.setItem('anthropicKey', k); }

function openApiKeyModal() {
  document.getElementById('apiKeyInput').value = getApiKey();
  document.getElementById('apiKeyBackdrop').style.display = 'flex';
}
function closeApiKeyModal() {
  document.getElementById('apiKeyBackdrop').style.display = 'none';
}

// ── Duration helpers ───────────────────────────────────────────────────────
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
  if (mins < 0) mins += 24 * 60;
  return formatMinutes(mins);
}

// ── CSV / JSON parsing ─────────────────────────────────────────────────────
const COLUMN_MAP = {
  datum: 'date', date: 'date', 'departure date': 'date',
  flugnummer: 'flight', flight: 'flight', 'flight number': 'flight', 'flight no': 'flight', flightnumber: 'flight',
  von: 'from', from: 'from', departure: 'from', origin: 'from', abflug: 'from', 'departure airport': 'from',
  nach: 'to', to: 'to', arrival: 'to', destination: 'to', ziel: 'to', 'arrival airport': 'to',
  abflugzeit: 'dep', dep: 'dep', 'dep time': 'dep', 'departure time': 'dep',
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
  if (f.date) f.date = normalizeDate(f.date);
  if (!f.dur && f.dep && f.arr) f.dur = calcDuration(f.dep, f.arr);
  if (f.from) f.from = f.from.toUpperCase().slice(0, 4);
  if (f.to) f.to = f.to.toUpperCase().slice(0, 4);
  if (!f.id) f.id = uid();
  return f;
}

function normalizeDate(d) {
  let m = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return d;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.flights || [];
  return arr.map(f => normalizeFlight({ ...f, id: f.id || uid() }));
}

// ── Claude AI extraction ───────────────────────────────────────────────────
const CLAUDE_PROMPT = `Analysiere dieses Dokument (Bordkarte, Buchungsbestätigung oder Flugticket) und extrahiere alle Flugdaten.

Gib NUR ein gültiges JSON-Array zurück. Jedes Objekt kann folgende Felder haben:
- date: Abflugdatum im Format YYYY-MM-DD
- flight: Flugnummer (z.B. "LH400")
- from: Abflughafen IATA-Code (3 Buchstaben, z.B. "FRA")
- to: Zielflughafen IATA-Code (3 Buchstaben, z.B. "JFK")
- dep: Abflugzeit HH:MM (24h)
- arr: Ankunftszeit HH:MM (24h)
- dur: Flugdauer (z.B. "9h 15m")
- airline: Airline-Name
- aircraft: Flugzeugtyp (z.B. "A380")
- seat: Sitzplatz (z.B. "32A")
- class: Kabinenklasse (Economy/Premium Economy/Business/First)

Nur Felder angeben die erkennbar sind. Gib [] zurück wenn keine Flugdaten gefunden. Nur das JSON-Array, kein anderer Text.`;

async function extractWithClaudeText(text) {
  const key = getApiKey();
  if (!key) { openApiKeyModal(); toast('Bitte zuerst API-Key eingeben', 'error'); return []; }

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
      max_tokens: 1024,
      messages: [{ role: 'user', content: CLAUDE_PROMPT + '\n\nDokument-Text:\n' + text }]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401) throw new Error('API-Key ungültig');
    throw new Error(err.error?.message || `Fehler ${resp.status}`);
  }

  const data = await resp.json();
  const raw = data.content?.[0]?.text || '[]';
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

async function extractWithClaude(base64, mediaType, label) {
  const key = getApiKey();
  if (!key) {
    openApiKeyModal();
    toast('Bitte zuerst API-Key eingeben', 'error');
    return [];
  }

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
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: CLAUDE_PROMPT }
        ]
      }]
    })
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    if (resp.status === 401) throw new Error('API-Key ungültig');
    throw new Error(err.error?.message || `Fehler ${resp.status}`);
  }

  const data = await resp.json();
  const text = data.content?.[0]?.text || '[]';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  return JSON.parse(match[0]);
}

// ── File to base64 ─────────────────────────────────────────────────────────
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── PDF.js init (use same file as worker to avoid CORS) ───────────────────
function initPdfJs() {
  const lib = window.pdfjsLib;
  if (!lib) throw new Error('PDF-Bibliothek nicht geladen – bitte Seite neu laden');
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  }
  return lib;
}

// ── PDF → extracted text (for text-based PDFs like Lufthansa) ─────────────
async function pdfToText(file) {
  const lib = initPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text.trim();
}

// ── PDF → images (fallback for scanned PDFs) ──────────────────────────────
async function pdfToImages(file) {
  const lib = initPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
  }
  return images;
}

// ── Handle individual file ─────────────────────────────────────────────────
async function handleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const type = file.type;

  if (ext === 'csv' || type === 'text/csv' || type === 'application/csv') {
    return handleTextFile(file, parseCSV);
  }
  if (ext === 'json' || type === 'application/json') {
    return handleTextFile(file, parseJSON);
  }
  if (ext === 'pdf' || type === 'application/pdf') {
    return handlePDFFile(file);
  }
  if (type.startsWith('image/')) {
    return handleImageFile(file);
  }
  toast(`Format nicht unterstützt: ${file.name}`, 'error');
}

function handleTextFile(file, parser) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parser(e.target.result);
        if (!parsed.length) { toast('Keine Flüge in der Datei gefunden', 'error'); resolve([]); return; }
        flights = [...flights, ...parsed];
        save();
        render();
        toast(`${parsed.length} Flug${parsed.length !== 1 ? 'e' : ''} importiert`, 'success');
        resolve(parsed);
      } catch (err) {
        toast('Fehler beim Einlesen: ' + err.message, 'error');
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function handleImageFile(file) {
  showLoading(`KI liest "${file.name}" aus…`);
  try {
    const base64 = await fileToBase64(file);
    const mediaType = file.type || 'image/jpeg';
    const parsed = await extractWithClaude(base64, mediaType, file.name);
    addExtractedFlights(parsed, file.name);
  } catch (err) {
    toast('Fehler: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

async function handlePDFFile(file) {
  showLoading('PDF wird gelesen…');
  try {
    // Try text extraction first (works for Lufthansa & most airline PDFs)
    const text = await pdfToText(file);
    let parsed = [];

    if (text.length > 50) {
      showLoading('KI analysiert PDF-Text…');
      parsed = await extractWithClaudeText(text);
    }

    // Fallback: render as image if no text found (scanned PDFs)
    if (!parsed.length) {
      showLoading('Als Bild einlesen…');
      const images = await pdfToImages(file);
      for (let i = 0; i < images.length; i++) {
        showLoading(`KI liest Seite ${i + 1} von ${images.length}…`);
        const p = await extractWithClaude(images[i], 'image/jpeg', file.name);
        parsed = [...parsed, ...p];
      }
    }

    if (parsed.length) {
      flights = [...flights, ...parsed.map(f => normalizeFlight(f))];
      save();
      render();
      toast(`${parsed.length} Flug${parsed.length !== 1 ? 'e' : ''} aus PDF importiert`, 'success');
    } else {
      toast('Keine Flugdaten erkannt – mach einen Screenshot und lade den hoch', 'error');
    }
  } catch (err) {
    console.error('PDF-Fehler:', err);
    toast('PDF-Fehler: ' + err.message, 'error');
  } finally {
    hideLoading();
  }
}

function addExtractedFlights(parsed, filename) {
  if (!parsed.length) {
    toast(`Keine Flugdaten in "${filename}" erkannt`, 'error');
    return;
  }
  const normalized = parsed.map(f => normalizeFlight(f));
  flights = [...flights, ...normalized];
  save();
  render();
  toast(`${normalized.length} Flug${normalized.length !== 1 ? 'e' : ''} erkannt`, 'success');
}

// ── Handle multiple files ──────────────────────────────────────────────────
async function handleFiles(fileList) {
  for (const file of fileList) {
    await handleFile(file);
  }
}

// ── Sorting ────────────────────────────────────────────────────────────────
function sortFlights(arr) {
  return [...arr].sort((a, b) => {
    let va = a[sortCol] || '';
    let vb = b[sortCol] || '';
    if (sortCol === 'dur') { va = parseDurationMinutes(va); vb = parseDurationMinutes(vb); }
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
    result = result.filter(f => Object.values(f).some(v => String(v).toLowerCase().includes(q)));
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

// ── Year filter ────────────────────────────────────────────────────────────
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
  handleFiles(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files.length) handleFiles(e.target.files);
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
  if (data.from) data.from = data.from.toUpperCase();
  if (data.to) data.to = data.to.toUpperCase();
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
  if (row) {
    const f = flights.find(f => f.id === row.dataset.id);
    if (f) openModal(f);
  }
});

document.querySelectorAll('thead th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    sortCol = th.dataset.col === sortCol && sortDir === 'asc' ? sortCol : th.dataset.col;
    sortDir = th.dataset.col === sortCol && sortDir === 'asc' ? 'desc' : (th.dataset.col !== sortCol ? 'asc' : sortDir === 'asc' ? 'desc' : 'asc');
    // simpler:
    if (th.dataset.col === sortCol) {
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

// API Key modal
document.getElementById('apiKeyBtn').addEventListener('click', openApiKeyModal);
document.getElementById('apiKeyClose').addEventListener('click', closeApiKeyModal);
document.getElementById('apiKeyBackdrop').addEventListener('click', e => {
  if (e.target === document.getElementById('apiKeyBackdrop')) closeApiKeyModal();
});
document.getElementById('apiKeySaveBtn').addEventListener('click', () => {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { toast('Bitte API-Key eingeben', 'error'); return; }
  setApiKey(val);
  closeApiKeyModal();
  toast('API-Key gespeichert', 'success');
  updateApiKeyBtn();
});
document.getElementById('apiKeyClearBtn').addEventListener('click', () => {
  localStorage.removeItem('anthropicKey');
  document.getElementById('apiKeyInput').value = '';
  toast('API-Key gelöscht');
  updateApiKeyBtn();
});

function updateApiKeyBtn() {
  const btn = document.getElementById('apiKeyBtn');
  btn.textContent = getApiKey() ? '🔑 API-Key ✓' : '🔑 API-Key';
  btn.style.color = getApiKey() ? 'var(--success)' : '';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeApiKeyModal(); }
});

// ── Init ───────────────────────────────────────────────────────────────────
updateApiKeyBtn();
render();
