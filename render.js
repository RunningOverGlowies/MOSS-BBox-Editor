/* SVG canvas rendering and the sidebar element list. */

const HANDLE_POS = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };

/* Label drawn inside a box: [hidden marker][lock] emoji + (literal text | first tag | label). Multi-line text becomes tspans. */
function fillTagText(txt, item) {
  const [x1, y1] = item.bbox;
  const body = item.label === 'text' && item.text ? item.text : (item.tags?.[0] || item.label);
  const lines = `${item.hidden ? '🚫 [HIDDEN] ' : ''}${item.locked ? '🔒 ' : ''}${LABELS[item.label].emoji} ${body}`.split('\n');
  txt.textContent = '';
  txt.setAttribute('x', x1 + 6);
  txt.setAttribute('y', y1 + 16);
  lines.forEach((line, i) => {
    const span = svgEl('tspan', { x: x1 + 6 });
    if (i === 0) span.setAttribute('y', y1 + 16); else span.setAttribute('dy', '1.25em');
    span.textContent = line;
    txt.appendChild(span);
  });
}

function renderAll() {
  const { width: W, height: H } = sceneData;
  container.style.width = `${W}px`;
  container.style.height = `${H}px`;
  canvas.setAttribute('viewBox', `0 0 ${W} ${H}`);
  canvas.innerHTML = '';

  if (backgroundImageDataUrl) {
    const img = svgEl('image', { id: 'canvas-backdrop-image', href: backgroundImageDataUrl, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'none', opacity: backgroundImageOpacity });
    img.style.pointerEvents = 'none';
    canvas.appendChild(img);
  }

  $('active-count').textContent = `${sceneData.items.filter(i => !i.hidden).length}/${sceneData.items.length}`;
  syncSummaryForm();
  renderSidebarList();

  // Large boxes first so small ones stay clickable on top.
  const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  sceneData.items.map((item, idx) => ({ item, idx })).sort((a, b) => area(b.item.bbox) - area(a.item.bbox)).forEach(({ item, idx }) => {
    const [x1, y1, x2, y2] = item.bbox;
    const g = svgEl('g', { id: `group-${idx}`, class: `bbox-group${item.hidden ? ' is-hidden' : ''}${item.locked ? ' is-locked' : ''}` });
    const rect = svgEl('rect', { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1), class: `bbox-rect ${LABELS[item.label].cls}` });
    rect.addEventListener('mousedown', e => onRectMouseDown(e, idx));
    const txt = svgEl('text', { class: 'svg-tag' });
    fillTagText(txt, item);
    g.append(rect, txt);
    canvas.appendChild(g);
  });

  if (selectedIndices.size) renderActiveHandlesLayer();
  syncJson();
}

/* Cheap in-place update of one box while dragging / editing (no full re-render). */
function updateSelectedElementView(idx) {
  const item = sceneData.items[idx], g = $(`group-${idx}`);
  if (!item || !g) return;
  const [x1, y1, x2, y2] = item.bbox;
  const rect = g.querySelector('.bbox-rect');
  rect.setAttribute('x', x1);
  rect.setAttribute('y', y1);
  rect.setAttribute('width', Math.max(0, x2 - x1));
  rect.setAttribute('height', Math.max(0, y2 - y1));
  fillTagText(g.querySelector('.svg-tag'), item);
}

/* Selection outlines + 8 resize handles, drawn on top of everything. */
function renderActiveHandlesLayer() {
  $('active-handles-layer')?.remove();
  const layer = svgEl('g', { id: 'active-handles-layer' });

  selectedIndices.forEach(idx => {
    const item = sceneData.items[idx];
    if (!item) return;
    const [x1, y1, x2, y2] = item.bbox;
    layer.appendChild(svgEl('rect', { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1), class: `bbox-active-outline${item.locked ? ' is-locked' : ''}` }));
  });

  const item = selectedIndices.size === 1 ? sceneData.items[selectedIndex] : null;
  if (item && !item.locked) {
    const [x1, y1, x2, y2] = item.bbox, S = 8;
    for (const [mode, [fx, fy]] of Object.entries(HANDLE_POS)) {
      const handle = svgEl('rect', { x: x1 + (x2 - x1) * fx - S / 2, y: y1 + (y2 - y1) * fy - S / 2, width: S, height: S, class: `handle ${mode}` });
      handle.addEventListener('mousedown', e => { e.stopPropagation(); beginInteraction(mode, e, item); });
      layer.appendChild(handle);
    }
  }
  canvas.appendChild(layer);
}

/* ---- Sidebar ---- */
function renderSidebarList() {
  const list = $('items-list'), { width: W, height: H } = sceneData;
  list.innerHTML = '';

  sceneData.items.forEach((item, idx) => {
    const sel = selectedIndices.has(idx), solo = sel && selectedIndices.size === 1, locked = !!item.locked;
    const card = document.createElement('div');
    card.className = `item-card card ${LABELS[item.label].cls}${sel ? ' active' : ''}${item.hidden ? ' is-hidden' : ''}${locked ? ' is-locked' : ''}`;
    card.id = `card-${idx}`;

    card.ondragover = e => {
      if (cardDragSourceIdx === null || sceneData.items[cardDragSourceIdx]?.locked) return;
      e.preventDefault();
      card.classList.add('card-drag-over');
    };
    card.ondragleave = () => card.classList.remove('card-drag-over');
    card.ondrop = e => {
      e.preventDefault();
      card.classList.remove('card-drag-over');
      const from = cardDragSourceIdx;
      if (from === null || from === idx || sceneData.items[from]?.locked) return;
      recordState();
      sceneData.items.splice(idx, 0, sceneData.items.splice(from, 1)[0]);
      selectedIndices = new Set([idx]);
      selectedIndex = idx;
      cardDragSourceIdx = null;
      renderAll();
    };

    const dragHandle = `<span class="card-drag-handle${locked ? ' is-locked' : ''}" title="${locked ? 'Element is locked from reordering' : 'Drag to reorder elements'}" draggable="${!locked}" onclick="event.stopPropagation()">⠿</span>`;
    const actions = showBbox => `<div class="card-actions" onclick="event.stopPropagation()">
        ${showBbox ? `<span class="bbox-readout">[${item.bbox.join(',')}]</span>` : ''}
        <button class="action-btn" title="Toggle Hide" onclick="toggleItemVisibility(${idx})">${item.hidden ? '🚫' : '👁'}</button>
        <button class="action-btn" title="${locked ? 'Unlock Element' : 'Lock Element'}" onclick="toggleItemLock(${idx})">${locked ? '🔒' : '🔓'}</button>
        <button class="action-btn" title="Delete" onclick="deleteItem(${idx})" ${locked ? 'disabled' : ''}>🗑️</button>
      </div>`;

    if (!solo) {
      card.innerHTML = `
        <div class="card-header" onclick="handleCardClick(${idx}, event)">
          <div class="row">${dragHandle}<span class="card-title">${locked ? '🔒 ' : ''}${LABELS[item.label].title}${sel ? ' <span class="sel-tag">(Selected)</span>' : ''}</span></div>
          ${actions(true)}
        </div>
        <div class="card-collapsed-desc" onclick="handleCardClick(${idx}, event)">${escapeHtml(item.caption)}</div>
        ${item.label === 'text' && item.text ? `<div class="card-text-snippet" onclick="handleCardClick(${idx}, event)">${escapeHtml(item.text)}</div>` : ''}`;
    } else {
      const dis = locked ? 'disabled' : '';
      const coordRows = [['X1', W], ['Y1', H], ['X2', W], ['Y2', H]].map(([label, max], i) => `
        <div class="coord-row">
          <span class="coord-label">${label}</span>
          <input type="range" class="coord-slider" min="0" max="${max}" value="${item.bbox[i]}" ${dis} oninput="updateCoord(${idx}, ${i}, this.value)">
          <input type="number" class="coord-num" min="0" max="${max}" value="${item.bbox[i]}" ${dis} onchange="updateCoord(${idx}, ${i}, this.value)">
        </div>`).join('');
      const labelOptions = Object.entries(LABELS).map(([k, v]) => `<option value="${k}"${k === item.label ? ' selected' : ''}>${v.title}</option>`).join('');

      card.innerHTML = `
        <div class="card-header" onclick="handleCardClick(${idx}, event)">
          <div class="row">
            ${dragHandle}
            <select id="field-label-${idx}" onchange="changeItemLabel(${idx}, this.value)" onclick="event.stopPropagation()" style="font-weight:700; padding:2px 4px;" ${dis}>${labelOptions}</select>
            ${locked ? '<span class="lock-label">🔒 LOCKED</span>' : ''}
          </div>
          ${actions(false)}
        </div>
        ${locked ? '<div class="card-lock-banner"><span>🔒 This element is locked. Unlock it to move on canvas or modify bounds, text, and tags.</span></div>' : ''}
        <div class="form-body">
          <div class="form-group"><label>Bounds (Coordinates)</label>${coordRows}</div>
          ${item.label === 'text' ? `
          <div class="form-group">
            <label>text (Literal Rendered String — Multiline Supported)</label>
            <textarea rows="2" class="textarea-literal-text" placeholder="Exact wording..." ${dis} oninput="updateItemField(${idx}, 'text', this.value)">${escapeHtml(item.text || '')}</textarea>
          </div>` : ''}
          <div class="form-group">
            <label>caption (Visual Description)</label>
            <textarea rows="2" placeholder="Describe appearance, posture..." ${dis} oninput="updateItemField(${idx}, 'caption', this.value)">${escapeHtml(item.caption)}</textarea>
          </div>
          <div class="form-group">
            <div class="field-header"><label>tags</label>${locked ? '' : `<span class="tag-edit-cue" onclick="toggleFullListEdit('item.${idx}.tags')">✏️ Edit Text</span>`}</div>
            <div id="tag-wrap-item-${idx}"></div>
          </div>
        </div>`;
    }

    if (!locked) {
      const handle = card.querySelector('.card-drag-handle');
      handle.ondragstart = e => {
        cardDragSourceIdx = idx;
        card.classList.add('card-dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', idx);
      };
      handle.ondragend = () => { card.classList.remove('card-dragging'); cardDragSourceIdx = null; };
    }

    list.appendChild(card);
    if (solo) renderTagComponent(`item.${idx}.tags`, $(`tag-wrap-item-${idx}`), item.tags, false, locked);
  });
}
