/* Selection, dragging / resizing boxes on the canvas, and element CRUD. */

/* ---- Selection ---- */
function selectItem(index) {
  selectedIndices = new Set(index === null ? [] : [index]);
  selectedIndex = index;
  renderAll();
  if (index !== null) $(`card-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function toggleSelect(index) {
  if (!selectedIndices.delete(index)) selectedIndices.add(index);
  selectedIndex = selectedIndices.has(index) ? index : ([...selectedIndices].pop() ?? null);
  renderAll();
}

const clearSelection = () => selectItem(null);
const handleCardClick = (idx, e) => (e.ctrlKey || e.metaKey) ? toggleSelect(idx) : selectItem(idx);

/* ---- Canvas interaction ---- */
function beginInteraction(mode, e, item) {
  interactionMode = mode;
  hasMovedDuringDrag = false;
  dragOrigin = screenToCanvasCoords(e);
  initialBbox = [...item.bbox];
  preDragSnapshot = createSnapshot();
}

function onRectMouseDown(e, idx) {
  e.stopPropagation();
  if (e.ctrlKey || e.metaKey) return toggleSelect(idx);

  if (!selectedIndices.has(idx)) selectedIndices = new Set([idx]);
  selectedIndex = idx;
  const item = sceneData.items[idx];
  if (item.locked) return renderAll();

  initialMultiBboxes.clear(); // only unlocked selected items move
  selectedIndices.forEach(i => { const it = sceneData.items[i]; if (it && !it.locked) initialMultiBboxes.set(i, [...it.bbox]); });
  beginInteraction('move', e, item);
  renderAll();
}

function syncCardCoords(idx) {
  const rows = $(`card-${idx}`)?.querySelectorAll('.coord-row');
  if (rows?.length !== 4) return;
  sceneData.items[idx].bbox.forEach((v, i) => {
    rows[i].querySelector('.coord-slider').value = v;
    rows[i].querySelector('.coord-num').value = v;
  });
}

function handleItemDrag(e) {
  const p = screenToCanvasCoords(e);
  const dx = Math.round(p.x - dragOrigin.x), dy = Math.round(p.y - dragOrigin.y);
  const { width: W, height: H } = sceneData;
  if (dx || dy) hasMovedDuringDrag = true; // a bare click must not create an undo step

  if (interactionMode === 'move') { // single or group move, clamped so every moving box stays inside the canvas
    if (!initialMultiBboxes.size) return;
    let loX = -Infinity, hiX = Infinity, loY = -Infinity, hiY = Infinity;
    initialMultiBboxes.forEach(b => { loX = Math.max(loX, -b[0]); hiX = Math.min(hiX, W - b[2]); loY = Math.max(loY, -b[1]); hiY = Math.min(hiY, H - b[3]); });
    const mx = clamp(dx, loX, hiX), my = clamp(dy, loY, hiY);
    initialMultiBboxes.forEach((b, idx) => {
      sceneData.items[idx].bbox = [b[0] + mx, b[1] + my, b[2] + mx, b[3] + my];
      updateSelectedElementView(idx);
      syncCardCoords(idx);
    });
    return renderActiveHandlesLayer();
  }

  const item = sceneData.items[selectedIndex];
  if (!item || item.locked) return;
  const m = interactionMode, b = item.bbox, [bx1, by1, bx2, by2] = initialBbox;
  const origW = Math.max(1, bx2 - bx1), origH = Math.max(1, by2 - by1), aspect = origW / origH;
  const hasE = m.includes('e'), hasS = m.includes('s'), isCorner = m.length === 2;

  if (!e.shiftKey) { // free resize
    if (m.includes('w')) b[0] = clamp(bx1 + dx, 0, bx2 - 16);
    if (hasE) b[2] = clamp(bx2 + dx, bx1 + 16, W);
    if (m.includes('n')) b[1] = clamp(by1 + dy, 0, by2 - 16);
    if (hasS) b[3] = clamp(by2 + dy, by1 + 16, H);
  } else if (isCorner) { // proportional resize anchored on the opposite corner
    const rawW = Math.max(16, hasE ? bx2 + dx - bx1 : bx2 - (bx1 + dx));
    const rawH = Math.max(16, hasS ? by2 + dy - by1 : by2 - (by1 + dy));
    const scale = Math.min(Math.max(rawW / origW, rawH / origH), (hasE ? W - bx1 : bx2) / origW, (hasS ? H - by1 : by2) / origH);
    if (hasE) b[2] = Math.round(bx1 + origW * scale); else b[0] = Math.round(bx2 - origW * scale);
    if (hasS) b[3] = Math.round(by1 + origH * scale); else b[1] = Math.round(by2 - origH * scale);
  } else if (m === 'e' || m === 'w') { // proportional edge resize, re-centred on the other axis
    const rw = Math.max(16, Math.min(m === 'e' ? W - bx1 : bx2, m === 'e' ? bx2 + dx - bx1 : bx2 - (bx1 + dx)));
    const cy = (by1 + by2) / 2, rh = rw / aspect;
    if (m === 'e') b[2] = bx1 + rw; else b[0] = bx2 - rw;
    b[1] = Math.round(Math.max(0, cy - rh / 2));
    b[3] = Math.round(Math.min(H, cy + rh / 2));
  } else { // 'n' | 's'
    const rh = Math.max(16, Math.min(m === 's' ? H - by1 : by2, m === 's' ? by2 + dy - by1 : by2 - (by1 + dy)));
    const cx = (bx1 + bx2) / 2, rw = rh * aspect;
    if (m === 's') b[3] = by1 + rh; else b[1] = by2 - rh;
    b[0] = Math.round(Math.max(0, cx - rw / 2));
    b[2] = Math.round(Math.min(W, cx + rw / 2));
  }

  updateSelectedElementView(selectedIndex);
  renderActiveHandlesLayer();
  syncCardCoords(selectedIndex);
}

/* ---- Element operations ---- */
function addNewItem() {
  recordState();
  const { width: W, height: H } = sceneData;
  const item = { label: 'object', caption: 'New bounding box item.', bbox: [Math.round(W * 0.3), Math.round(H * 0.3), Math.round(W * 0.7), Math.round(H * 0.7)], tags: [] };
  attachEditorProperties(item);
  sceneData.items.push(item);
  selectItem(sceneData.items.length - 1);
}

function changeItemLabel(idx, newLabel) {
  const item = sceneData.items[idx];
  if (item?.locked) return;
  recordState();
  item.label = newLabel;
  if (newLabel !== 'text') delete item.text;
  else if (item.text === undefined) item.text = item.caption || 'SAMPLE TEXT';
  renderAll();
}

/* Sidebar slider / number edit of one coordinate (index 0..3 = x1,y1,x2,y2). */
function updateCoord(idx, ci, val) {
  const item = sceneData.items[idx];
  if (!item || item.locked) return;
  recordState(`coord-${idx}-${ci}`);
  const b = item.bbox, v = parseInt(val) || 0, { width: W, height: H } = sceneData;
  if (ci === 0) b[0] = clamp(v, 0, b[2] - 16);
  else if (ci === 1) b[1] = clamp(v, 0, b[3] - 16);
  else if (ci === 2) b[2] = clamp(v, b[0] + 16, W);
  else b[3] = clamp(v, b[1] + 16, H);
  updateSelectedElementView(idx);
  syncCardCoords(idx);
  renderActiveHandlesLayer();
  syncJson();
}

function updateItemField(idx, field, val) {
  const item = sceneData.items[idx];
  if (item?.locked) return;
  recordState(`field-${idx}-${field}`);
  item[field] = val;
  if (field === 'text') updateSelectedElementView(idx);
  syncJson();
}

function deleteItem(idx) {
  if (sceneData.items[idx]?.locked) return showToast('Element is locked and cannot be deleted.', 'warn');
  recordState();
  sceneData.items.splice(idx, 1);
  selectedIndices = new Set([...selectedIndices].filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
  selectedIndex = [...selectedIndices][0] ?? null;
  renderAll();
}

function deleteSelectedItems() {
  if (!selectedIndices.size) return;
  const doomed = [...selectedIndices].filter(i => !sceneData.items[i]?.locked).sort((a, b) => b - a);
  if (!doomed.length) return showToast('Selected item(s) are locked and cannot be deleted.', 'warn');
  recordState();
  doomed.forEach(i => sceneData.items.splice(i, 1));
  selectedIndices.clear();
  selectedIndex = null;
  renderAll();
  showToast('Deleted selected bounding box(es).', 'info');
}

function toggleItemVisibility(idx) {
  recordState();
  sceneData.items[idx].hidden = !sceneData.items[idx].hidden;
  renderAll();
}

function toggleItemLock(idx) {
  if (!sceneData.items[idx]) return;
  recordState();
  const item = sceneData.items[idx];
  item.locked = !item.locked;
  renderAll();
  showToast(item.locked ? '🔒 Element locked' : '🔓 Element unlocked', 'info');
}
