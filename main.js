/* App bootstrap: themes, static UI, keyboard shortcuts, JSON pane, export and init. */

const THEMES = [
  ['dark', 'Dark', '#18181b', '#27272a'], ['light', 'Light', '#f8fafc', '#cbd5e1'], ['midnight', 'Navy', '#06080e', '#1e293b'],
  ['nord', 'Nord', '#2e3440', '#88c0d0'], ['dracula', 'Drac', '#282a36', '#bd93f9'], ['warm', 'Char', '#262320', '#f97316']
];

const RES_PRESETS = {
  '1:1 Square': [['1024x1024', '1:1 Standard'], ['768x768', '1:1 Fast'], ['1152x1152', '1:1 High'], ['1280x1280', '1:1 XL']],
  '16:9 Landscape & 9:16 Portrait': [['1536x864', '16:9 HD'], ['864x1536', '9:16 Story/Reel'], ['1344x768', '16:9 Compact'], ['768x1344', '9:16 Compact'], ['1920x1088', '16:9 FHD'], ['1088x1920', '9:16 FHD']],
  '4:3 Standard & 3:4 Portrait': [['1152x864', '4:3 Standard'], ['864x1152', '3:4 Portrait'], ['1408x1056', '4:3 High'], ['1056x1408', '3:4 High'], ['1024x768', '4:3 Legacy'], ['768x1024', '3:4 Legacy']],
  '3:2 & 2:3 Photography': [['1216x832', '3:2 Photo'], ['832x1216', '2:3 Photo'], ['1536x1024', '3:2 High'], ['1024x1536', '2:3 High'], ['1152x768', '3:2 Compact'], ['768x1152', '2:3 Compact']],
  'Cinematic 21:9 & Studio 5:4': [['1536x640', '21:9 Ultrawide'], ['640x1536', '9:21 Banner'], ['1792x768', '21:9 Wide HD'], ['1280x1024', '5:4 Studio'], ['1024x1280', '4:5 Social']]
};

function buildStaticUi() {
  $('theme-options').innerHTML = THEMES.map(([key, label, bg, border]) =>
    `<button class="theme-option" onclick="setTheme('${key}')"><span class="theme-swatch" style="background:${bg}; border:1px solid ${border};"></span><span>${label}</span><span class="theme-check" id="check-${key}"></span></button>`).join('');
  $('res-presets').innerHTML = '<option value="">Presets...</option>' + Object.entries(RES_PRESETS).map(([group, list]) =>
    `<optgroup label="${escapeHtml(group)}">${list.map(([wh, label]) => `<option value="${wh}">${wh.replace('x', ' × ')} (${label})</option>`).join('')}</optgroup>`).join('');
}

/* ---- Themes & resets ---- */
function toggleThemeMenu(e) {
  e.stopPropagation();
  $('theme-menu').classList.toggle('show');
}

function applyTheme(name, save = true) {
  document.documentElement.setAttribute('data-theme', name);
  if (save) lsSet('spatial_studio_theme', name);
  THEMES.forEach(([key]) => { $(`check-${key}`).textContent = key === name ? '✓' : ''; });
}

function setTheme(name) {
  applyTheme(name);
  $('theme-menu').classList.remove('show');
  showToast(`Applied ${name[0].toUpperCase() + name.slice(1)} theme`, 'info');
}

function resetToBlank() {
  sceneData = clone(BLANK_SCHEMA);
  removeBackdropImage(true);
  selectedIndex = null;
  selectedIndices.clear();
}

function resetAllPreferences() {
  if (!confirm('Are you sure you want to reset ALL preferences, theme, and saved workspace data to factory defaults?')) return;
  try { localStorage.clear(); } catch { /* storage unavailable */ }
  applyTheme('dark', false);
  resetToBlank();
  historyStack = [];
  redoStack = [];
  $('theme-menu').classList.remove('show');
  syncAll();
  fitToViewport();
  showToast('Factory settings restored.', 'info');
}

function clearCanvasAndWorkflow() {
  if (!confirm('Are you sure you want to clear the entire canvas and workflow? All current bounding boxes and summary text will be reset.')) return;
  recordState();
  resetToBlank();
  syncAll();
  fitToViewport();
  showToast('Canvas and workflow cleared to blank 1024×1024.', 'info');
}

/* ---- Tabs, keyboard ---- */
function switchTab(tab) {
  ['items', 'json'].forEach((t, i) => {
    $(`tab-${t}`).style.display = t === tab ? 'flex' : 'none';
    document.querySelectorAll('.tab-btn')[i].classList.toggle('active', t === tab);
  });
  if (tab === 'json') syncJson();
}

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return; // leave native editing alone
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && key === 'y') { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIndices.size) { e.preventDefault(); deleteSelectedItems(); }
  });
}

/* ---- JSON pane, autosave, export ---- */
function syncJson() {
  autoSave();
  const input = $('json-input');
  if (document.activeElement !== input) input.value = JSON.stringify(sceneData, null, 2); // hidden/locked are non-enumerable, so not serialised
}

function handleLiveJsonInput(val) {
  const status = $('json-status');
  try {
    const parsed = JSON.parse(val), schema = deepSearchSchema(parsed) || parsed;
    if (!schema.width || !schema.height || !Array.isArray(schema.items)) throw new Error("Must contain 'width', 'height', and 'items' array.");
    const prev = sceneData.items.map(it => ({ hidden: !!it.hidden, locked: !!it.locked }));
    schema.items.forEach((it, i) => attachEditorProperties(it, prev[i]?.hidden, prev[i]?.locked)); // keep editor flags by index
    recordState('json');
    sceneData = schema;
    enforceSchemaIntegrity();
    status.className = 'json-status valid';
    status.textContent = '● Valid Schema JSON — Real-Time Synced';
    updateResInputs();
    renderAll();
  } catch (err) {
    status.className = 'json-status invalid';
    status.textContent = `● Syntax: ${err.message}`;
  }
}

/* Export omits hidden items and editor-only flags. */
function getCleanExportData() {
  const s = sceneData.summary || {};
  return {
    width: Math.round(sceneData.width),
    height: Math.round(sceneData.height),
    bbox_coord_space: 'abs',
    bbox_format: 'xyxy',
    summary: { canvas: s.canvas || 'single', meta: s.meta || [], palette: s.palette || [], caption: s.caption || '' },
    items: sceneData.items.filter(it => !it.hidden).map(it => {
      const out = { label: it.label, caption: it.caption, bbox: it.bbox.map(n => Math.round(Number(n))) };
      if (it.label === 'text') out.text = it.text || '';
      if (it.tags?.length) out.tags = it.tags;
      return out;
    })
  };
}

async function copyFinalJson() {
  const text = JSON.stringify(getCleanExportData(), null, 2);
  try { await navigator.clipboard.writeText(text); }
  catch { // clipboard API missing on insecure origins / file:// in some browsers
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) return showToast('⚠️ Clipboard unavailable — use Save instead.', 'warn');
  }
  showToast('✔ Copied clean schema JSON to clipboard!', 'success');
}

function saveToFile() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(getCleanExportData(), null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `layout_${sceneData.width}x${sceneData.height}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- Init ---- */
function init() {
  buildStaticUi();
  applyTheme(lsGet('spatial_studio_theme') || 'dark', false);
  const saved = lsGet('spatial_bbox_studio_save');
  if (saved) try { restoreSnapshot(saved); } catch { /* corrupt autosave: start blank */ }
  enforceSchemaIntegrity();
  setupViewport();
  setupKeyboardShortcuts();
  setupDragAndDrop();
  window.addEventListener('click', e => { if (!e.target.closest('#theme-dropdown-wrap')) $('theme-menu').classList.remove('show'); });
  updateUndoRedoButtons();
  updateResInputs();
  renderAll();
  setTimeout(fitToViewport, 60);
}

window.addEventListener('load', init);
