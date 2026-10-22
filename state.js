/* Shared helpers, global state, schema integrity, undo/redo history and toasts.
   Plain <script> files share one global scope, so the app runs straight from file:// with no build step. */

const $ = id => document.getElementById(id);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const escapeHtml = t => (t || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
};

const BLANK_SCHEMA = {
  width: 1024, height: 1024, bbox_coord_space: 'abs', bbox_format: 'xyxy',
  summary: { canvas: 'single', meta: [], palette: [], caption: '' },
  items: []
};
const LABELS = {
  character: { cls: 'char', emoji: '🧑', title: '🧑 CHARACTER' },
  object: { cls: 'obj', emoji: '📦', title: '📦 OBJECT' },
  text: { cls: 'txt', emoji: '📝', title: '📝 TEXT' }
};
const MAX_HISTORY = 40;

/* ---- Global state ---- */
let sceneData = clone(BLANK_SCHEMA);
let selectedIndex = null, selectedIndices = new Set();
let pan = { x: 0, y: 0 }, zoom = 1, isPanning = false, startPan = { x: 0, y: 0 };
let summaryCollapsed = false;
let isMarqueeSelecting = false, marqueeStart = { x: 0, y: 0 }, marqueeElement = null;
let backgroundImageDataUrl = null, backgroundImageOpacity = 0.85;
let activeFullListEditId = null, activeSingleTag = null, activeAddInputGroup = null;
let tagDragSource = { group: null, index: null }, isDraggingTag = false, cardDragSourceIdx = null;
let interactionMode = null, dragOrigin = { x: 0, y: 0 }, initialBbox = null, preDragSnapshot = null, hasMovedDuringDrag = false;
const initialMultiBboxes = new Map();
let historyStack = [], redoStack = [], lastRecordKey = null, lastRecordTime = 0;

const viewport = $('viewport'), container = $('container'), canvas = $('canvas');

/* ---- Editor-only item flags ----
   "hidden" / "locked" live on items as NON-enumerable properties so JSON.stringify never leaks them into the prompt schema. */
function attachEditorProperties(item, hidden = false, locked = false) {
  const flags = {
    hidden: item.hidden !== undefined ? !!item.hidden : !!hidden,
    locked: item.locked !== undefined ? !!item.locked : !!locked
  };
  delete item.hidden; delete item.locked;
  for (const k in flags) Object.defineProperty(item, k, { value: flags[k], writable: true, enumerable: false, configurable: true });
}

const createSnapshot = () => JSON.stringify({
  data: clone(sceneData),
  states: (sceneData.items || []).map(it => ({ hidden: !!it.hidden, locked: !!it.locked }))
});

function restoreSnapshot(str) {
  const parsed = JSON.parse(str);
  if (parsed?.data && parsed.states) {
    sceneData = parsed.data;
    (sceneData.items || []).forEach((it, i) => attachEditorProperties(it, parsed.states[i]?.hidden, parsed.states[i]?.locked));
  } else if (parsed) sceneData = parsed;
  enforceSchemaIntegrity();
}

function enforceSchemaIntegrity() {
  const snap16 = v => Math.max(256, Math.round((Number(v) || 1024) / 16) * 16);
  sceneData.width = snap16(sceneData.width);
  sceneData.height = snap16(sceneData.height);
  sceneData.bbox_coord_space = 'abs';
  sceneData.bbox_format = 'xyxy';
  const s = (sceneData.summary && typeof sceneData.summary === 'object') ? sceneData.summary : (sceneData.summary = {});
  if (!['single', 'multi_panel', 'collage'].includes(s.canvas)) s.canvas = 'single';
  if (!Array.isArray(s.meta)) s.meta = [];
  if (!Array.isArray(s.palette)) s.palette = [];
  if (typeof s.caption !== 'string') s.caption = '';
  if (!Array.isArray(sceneData.items)) sceneData.items = [];

  sceneData.items.forEach(it => {
    if (!LABELS[it.label]) it.label = 'object';
    if (typeof it.caption !== 'string') it.caption = '';
    if (!Array.isArray(it.bbox) || it.bbox.length < 4) it.bbox = [0, 0, Math.min(200, sceneData.width), Math.min(200, sceneData.height)];
    it.bbox = it.bbox.map(n => Math.round(Number(n) || 0));
    if (it.label === 'text' && typeof it.text !== 'string') it.text = it.caption || '';
    if (!Array.isArray(it.tags)) it.tags = [];
    attachEditorProperties(it, it.hidden, it.locked);
  });

  selectedIndices = new Set([...selectedIndices].filter(i => i >= 0 && i < sceneData.items.length));
  if (selectedIndex !== null && !selectedIndices.has(selectedIndex)) selectedIndex = [...selectedIndices][0] ?? null;
}

/* ---- History ---- */
function pushHistory(snapshot) {
  historyStack.push(snapshot);
  if (historyStack.length > MAX_HISTORY) historyStack.shift();
  redoStack = [];
  lastRecordKey = null;
  updateUndoRedoButtons();
}

/* Call BEFORE mutating. A repeated `key` within 1.2s (typing, slider scrubbing) collapses into one undo step. */
function recordState(key = null) {
  enforceSchemaIntegrity();
  const now = Date.now();
  if (!(key && key === lastRecordKey && now - lastRecordTime < 1200)) pushHistory(createSnapshot());
  lastRecordKey = key;
  lastRecordTime = now;
}

function undo() {
  if (!historyStack.length) return;
  redoStack.push(createSnapshot());
  restoreSnapshot(historyStack.pop());
  lastRecordKey = null;
  syncAll();
}

function redo() {
  if (!redoStack.length) return;
  historyStack.push(createSnapshot());
  restoreSnapshot(redoStack.pop());
  lastRecordKey = null;
  syncAll();
}

function updateUndoRedoButtons() {
  $('btn-undo').disabled = !historyStack.length;
  $('btn-redo').disabled = !redoStack.length;
}

const autoSave = () => lsSet('spatial_bbox_studio_save', createSnapshot());

function syncAll() {
  enforceSchemaIntegrity();
  updateUndoRedoButtons();
  updateResInputs();
  renderAll(); // also refreshes the summary form, JSON pane and autosave
}

function showToast(message, type = 'info') {
  const toast = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: message });
  $('toast-container').appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
}
