/* Summary form, tag chips (meta / palette / per-item tags) and the palette color-picker dialog. */

const COLOR_NAMES = `Black #000000,Charcoal #222222,Gunmetal #2C3539,Jet Black #0A0A0A,Dark Slate #1E293B,Graphite #383838,Dim Gray #696969,Slate Gray #708090,Silver #C0C0C0,Platinum #E5E4E2,Cool Gray #94A3B8,White #FFFFFF,Ivory #FFFFF0,Snow White #FAFAFA,Bone White #F9F6EE,Parchment #F1E9D2,
Crimson Red #DC143C,Scarlet #FF2400,Ruby Red #E0115F,Burgundy #800020,Maroon #800000,Cherry Red #D2042D,Blood Orange #D9381E,Brick Red #CB4154,Rose #FF007F,Hot Pink #FF69B4,Magenta #FF00FF,Blush Pink #FFB6C1,Coral Pink #F88379,Salmon #FA8072,Dusty Rose #DCAE96,Fuchsia #C154C1,
Tangerine #F28500,Amber #FFBF00,Rust #B7410E,Terracotta #E2725B,Copper #B87333,Bronze #CD7F32,Ochre #CC7722,Sienna #A0522D,Espresso #362B28,Chocolate Brown #3D2314,Coffee #6F4E37,Chestnut #954535,Caramel #C68B59,Tan #D2B48C,Sand #C2B280,Khaki #C3B091,Beige #F5F5DC,
Canary Yellow #FFEF00,Rubber Yellow #FFE135,Lemon Yellow #FFF44F,Goldenrod #DAA520,Gold #FFD700,Mustard #FFDB58,Honey #EB9605,Wheat #F5DEB3,
Emerald Green #50C878,Forest Green #228B22,Olive Green #808000,Sage Green #9DC183,Mint Green #98FF98,Seafoam Green #9FE2BF,Hunter Green #355E3B,Pine Green #01796F,Jade #00A86B,Kelly Green #4CBB17,Moss Green #8A9A5B,Lime Green #32CD32,
Teal #008080,Cyan #00FFFF,Turquoise #40E0D0,Sky Blue #87CEEB,Cerulean Blue #007BA7,Cobalt Blue #0047AB,Navy Blue #000080,Midnight Blue #191970,Sapphire #0F52BA,Royal Blue #4169E1,Indigo #4B0082,Electric Blue #7DF9FF,Powder Blue #B0E0E6,Steel Blue #4682B4,Ocean Blue #0077BE,
Amethyst #9966CC,Lavender #E6E6FA,Lilac #C8A2C8,Plum #8E4585,Violet #8F00FF,Mauve #E0B0FF,Periwinkle #CCCCFF`
  .split(',').map(s => { s = s.trim(); const i = s.lastIndexOf(' '); return { name: s.slice(0, i), hex: s.slice(i + 1) }; });

/* ---- Summary ---- */
function toggleSummaryCollapse() {
  summaryCollapsed = !summaryCollapsed;
  $('summary-body').style.display = summaryCollapsed ? 'none' : 'flex';
  $('summary-collapse-icon').textContent = summaryCollapsed ? '▼' : '▲';
}

function syncSummaryForm() {
  $('sum-canvas').value = sceneData.summary.canvas || 'single';
  $('sum-caption').value = sceneData.summary.caption || '';
  renderTagComponent('summary.meta', $('tag-wrap-summary-meta'), sceneData.summary.meta, false);
  renderTagComponent('summary.palette', $('tag-wrap-summary-palette'), sceneData.summary.palette, true);
}

function updateSummaryField(field, val) {
  recordState(`summary-${field}`);
  sceneData.summary[field] = val;
  syncJson();
}

/* ---- Tag lists ---- */
function getTagListByGroup(groupKey) {
  if (groupKey === 'summary.meta') return sceneData.summary.meta;
  if (groupKey === 'summary.palette') return sceneData.summary.palette;
  const item = sceneData.items[parseInt(groupKey.split('.')[1])]; // "item.<idx>.tags"
  if (!item) return [];
  if (!Array.isArray(item.tags)) item.tags = [];
  return item.tags;
}

/* Inline text input that commits exactly once (Enter or blur) or cancels (Escape).
   Removing a focused input fires blur, which used to double-commit (duplicate tags, extra deletions, Escape not cancelling). */
function bindInlineEdit(input, onCommit, onCancel, selectAll = false) {
  let done = false;
  const finish = fn => { if (!done) { done = true; fn(); } };
  input.onblur = () => finish(() => onCommit(input.value));
  input.onkeydown = e => {
    if (e.key === 'Enter') finish(() => onCommit(input.value));
    else if (e.key === 'Escape') finish(onCancel);
  };
  setTimeout(() => { input.focus(); if (selectAll) input.select(); }, 20);
}

function renderTagComponent(groupKey, mountEl, list, isPalette, isLocked = false) {
  if (!mountEl) return;
  mountEl.innerHTML = '';
  if (isLocked && activeFullListEditId === groupKey) activeFullListEditId = null;
  const mk = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const cancelEdit = () => { activeFullListEditId = activeSingleTag = activeAddInputGroup = null; renderAll(); };

  if (activeFullListEditId === groupKey) {
    const input = mk('input', { type: 'text', value: (list || []).join(', '), placeholder: 'comma, separated, list...' });
    input.style.width = '100%';
    bindInlineEdit(input, v => finishFullListEdit(groupKey, v), cancelEdit);
    mountEl.appendChild(input);
    return;
  }

  const box = mk('div', { className: 'tags-container' });
  (list || []).forEach((text, idx) => {
    if (!isLocked && activeSingleTag?.group === groupKey && activeSingleTag.index === idx) {
      const input = mk('input', { type: 'text', className: 'tag-inline-input', value: text });
      bindInlineEdit(input, v => finishSingleTagEdit(groupKey, idx, v), cancelEdit, true);
      box.appendChild(input);
      return;
    }

    const tag = mk('div', { className: `tag-item${isLocked ? ' readonly' : ''}` });
    tag.appendChild(mk('span', { textContent: text }));
    const hex = isPalette && text.match(/#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3}|[0-9A-Fa-f]{8})\b/);
    if (hex) {
      const swatch = mk('span', { className: 'color-swatch', title: hex[0] });
      swatch.style.backgroundColor = hex[0];
      tag.appendChild(swatch);
    }

    if (!isLocked) {
      tag.draggable = true;
      tag.ondragstart = e => { isDraggingTag = true; tagDragSource = { group: groupKey, index: idx }; tag.classList.add('dragging'); e.dataTransfer.setData('text/plain', idx); };
      tag.ondragend = () => { tag.classList.remove('dragging'); setTimeout(() => { isDraggingTag = false; }, 60); };
      tag.ondragover = e => { e.preventDefault(); tag.classList.add('drag-over'); };
      tag.ondragleave = () => tag.classList.remove('drag-over');
      tag.ondrop = e => {
        e.preventDefault();
        tag.classList.remove('drag-over');
        const from = tagDragSource.index;
        if (tagDragSource.group !== groupKey || from === null || from === idx) return;
        recordState();
        const arr = getTagListByGroup(groupKey);
        arr.splice(idx, 0, arr.splice(from, 1)[0]);
        tagDragSource = { group: null, index: null };
        renderAll();
      };
      tag.onclick = () => { if (!isDraggingTag) { activeSingleTag = { group: groupKey, index: idx }; renderAll(); } };

      tag.appendChild(mk('span', {
        className: 'tag-del', innerHTML: '&times;', title: 'Remove tag',
        onclick: e => { e.stopPropagation(); recordState(); getTagListByGroup(groupKey).splice(idx, 1); renderAll(); }
      }));
    }
    box.appendChild(tag);
  });

  if (!isLocked) {
    if (activeAddInputGroup === groupKey) {
      const input = mk('input', { type: 'text', className: 'tag-inline-add-input', placeholder: isPalette ? 'Add color (#hex)...' : 'Type tag & Enter...' });
      bindInlineEdit(input, v => commitAddInput(groupKey, v), cancelEdit);
      box.appendChild(input);
    } else {
      box.appendChild(mk('button', { type: 'button', className: 'tag-add-btn', textContent: '+ Add', title: 'Add new tag', onclick: e => { e.stopPropagation(); activeAddInputGroup = groupKey; renderAll(); } }));
      if (isPalette) box.appendChild(mk('button', { type: 'button', className: 'tag-add-btn tag-pick-btn', textContent: '🎨 + Pick', title: 'Open Color Picker Dialog', onclick: e => { e.stopPropagation(); openColorPickerDialog(); } }));
    }
  } else if (!list?.length) {
    box.appendChild(mk('span', { className: 'no-tags', textContent: 'No tags' }));
  }
  mountEl.appendChild(box);
}

const splitList = text => text.split(',').map(s => s.trim()).filter(Boolean);

function commitAddInput(groupKey, text) {
  const added = splitList(text);
  if (added.length) { recordState(); getTagListByGroup(groupKey).push(...added); }
  activeAddInputGroup = null;
  renderAll();
}

function toggleFullListEdit(groupKey) {
  activeSingleTag = null;
  activeFullListEditId = activeFullListEditId === groupKey ? null : groupKey;
  renderAll();
}

function finishFullListEdit(groupKey, text) {
  recordState();
  getTagListByGroup(groupKey).splice(0, Infinity, ...splitList(text));
  activeFullListEditId = null;
  renderAll();
}

function finishSingleTagEdit(groupKey, index, newVal) {
  const trimmed = newVal.trim(), arr = getTagListByGroup(groupKey);
  if (arr[index] !== undefined && arr[index] !== trimmed) {
    recordState();
    if (trimmed === '') arr.splice(index, 1); else arr[index] = trimmed;
  }
  activeSingleTag = null;
  renderAll();
}

/* ---- Color picker dialog ---- */
function hexToRgb(hex) {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function getClosestColorName(hex) {
  const t = hexToRgb(hex);
  let best = 'Color', min = Infinity;
  for (const c of COLOR_NAMES) {
    const o = hexToRgb(c.hex);
    const d = 2 * (t.r - o.r) ** 2 + 4 * (t.g - o.g) ** 2 + 3 * (t.b - o.b) ** 2;
    if (d < min) { min = d; best = c.name; }
  }
  return best;
}

function setPaletteDialogColor(hex) {
  $('palette-native-color').value = hex;
  $('palette-hex-code').value = hex;
  $('palette-formatted-string').value = `${getClosestColorName(hex)} ${hex}`;
}

function openColorPickerDialog() {
  setPaletteDialogColor('#FFE135');
  $('palette-color-dialog').style.display = 'flex';
  setTimeout(() => $('palette-formatted-string').focus(), 30);
}

const closeColorPickerDialog = () => { $('palette-color-dialog').style.display = 'none'; };
const handleNativeColorPick = hex => setPaletteDialogColor(hex.toUpperCase());

function handleManualHexInput(val) {
  const hex = val.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) setPaletteDialogColor(hex.toUpperCase());
}

function commitColorPicker() {
  const val = $('palette-formatted-string').value.trim();
  if (val) {
    recordState();
    sceneData.summary.palette.push(val);
    renderAll();
    showToast(`Added color "${val}" to palette`, 'success');
  }
  closeColorPickerDialog();
}
