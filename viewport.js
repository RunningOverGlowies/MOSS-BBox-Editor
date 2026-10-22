/* Pan / zoom, marquee selection, canvas resolution and the backdrop image. */

/* ---- Resolution ---- */
function updateResInputs() {
  $('canvas-w').value = sceneData.width;
  $('canvas-h').value = sceneData.height;
}

function applyPresetRes(val) {
  if (val) setResolution(...val.split('x').map(Number));
}

function updateResolutionManual() {
  const snap = id => Math.max(256, Math.round((parseInt($(id).value) || 1024) / 16) * 16);
  setResolution(snap('canvas-w'), snap('canvas-h'));
}

function setResolution(w, h) {
  if (w === sceneData.width && h === sceneData.height) return updateResInputs(); // also re-shows the snapped value
  recordState();
  sceneData.width = w;
  sceneData.height = h;
  sceneData.items.forEach(it => {
    if (it.locked) return;
    const b = it.bbox;
    b[0] = Math.min(b[0], w - 16);
    b[1] = Math.min(b[1], h - 16);
    b[2] = Math.min(Math.max(b[0] + 16, b[2]), w);
    b[3] = Math.min(Math.max(b[1] + 16, b[3]), h);
  });
  updateResInputs();
  renderAll();
  fitToViewport();
}

/* ---- Pan & zoom ---- */
const applyTransform = () => { container.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`; };

function zoomAt(cx, cy, newZoom) {
  const z = clamp(newZoom, 0.08, 8);
  pan.x = cx - (cx - pan.x) * (z / zoom);
  pan.y = cy - (cy - pan.y) * (z / zoom);
  zoom = z;
  applyTransform();
}

function zoomStep(factor) {
  const v = viewport.getBoundingClientRect();
  zoomAt(v.width / 2, v.height / 2, zoom * factor);
}

function resetZoom() {
  zoom = 1;
  const v = viewport.getBoundingClientRect();
  pan.x = (v.width - sceneData.width) / 2;
  pan.y = (v.height - sceneData.height) / 2;
  applyTransform();
}

function fitToViewport() {
  const v = viewport.getBoundingClientRect();
  zoom = Math.min((v.width - 50) / sceneData.width, (v.height - 50) / sceneData.height, 1.2);
  pan.x = (v.width - sceneData.width * zoom) / 2;
  pan.y = (v.height - sceneData.height * zoom) / 2;
  applyTransform();
}

function screenToCanvasCoords(e) {
  const pt = canvas.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(canvas.getScreenCTM().inverse());
}

function setupViewport() {
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? zoom * 1.12 : zoom / 1.12);
  }, { passive: false });

  viewport.addEventListener('mousedown', e => {
    const onBackground = e.target === viewport || e.target === canvas || e.target.id === 'canvas-backdrop-image';
    if (e.shiftKey && onBackground) { // Shift + drag = marquee multi-select
      e.preventDefault();
      isMarqueeSelecting = true;
      marqueeStart = screenToCanvasCoords(e);
      initMarquee(marqueeStart.x, marqueeStart.y);
      return;
    }
    if (onBackground || e.button === 1) {
      isPanning = true;
      startPan = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      if (e.button !== 1 && !e.ctrlKey && !e.metaKey && e.target !== viewport) clearSelection();
    }
  });

  window.addEventListener('mousemove', e => {
    if (isMarqueeSelecting) {
      const p = screenToCanvasCoords(e);
      updateMarquee(marqueeStart.x, marqueeStart.y, p.x, p.y);
    } else if (isPanning) {
      pan.x = e.clientX - startPan.x;
      pan.y = e.clientY - startPan.y;
      applyTransform();
    } else if (interactionMode && selectedIndices.size) {
      handleItemDrag(e);
    }
  });

  window.addEventListener('mouseup', e => {
    if (isMarqueeSelecting) { finalizeMarquee(e); isMarqueeSelecting = false; }
    isPanning = false;
    if (!interactionMode) return;
    const moved = hasMovedDuringDrag;
    interactionMode = null;
    hasMovedDuringDrag = false;
    if (moved) { pushHistory(preDragSnapshot); renderAll(); } // full render refreshes sidebar readouts too
    else syncJson();
  });
}

/* ---- Marquee selection ---- */
function initMarquee(x, y) {
  marqueeElement = svgEl('rect', { class: 'marquee-box', id: 'svg-selection-marquee', x, y, width: 0, height: 0 });
  canvas.appendChild(marqueeElement);
}

function updateMarquee(x1, y1, x2, y2) {
  if (!marqueeElement) return;
  marqueeElement.setAttribute('x', Math.min(x1, x2));
  marqueeElement.setAttribute('y', Math.min(y1, y2));
  marqueeElement.setAttribute('width', Math.abs(x2 - x1));
  marqueeElement.setAttribute('height', Math.abs(y2 - y1));
}

function finalizeMarquee(e) {
  if (!marqueeElement) return;
  const [mx, my, mw, mh] = ['x', 'y', 'width', 'height'].map(a => parseFloat(marqueeElement.getAttribute(a)) || 0);
  marqueeElement.remove();
  marqueeElement = null;
  if (mw <= 4 || mh <= 4) return;

  if (!(e.ctrlKey || e.metaKey)) selectedIndices.clear();
  sceneData.items.forEach((item, idx) => {
    const [x1, y1, x2, y2] = item.bbox;
    if (!item.hidden && x1 < mx + mw && x2 > mx && y1 < my + mh && y2 > my) selectedIndices.add(idx);
  });
  selectedIndex = [...selectedIndices][0] ?? null;
  if (selectedIndices.size) showToast(`Selected ${selectedIndices.size} bounding box(es).`, 'info');
  renderAll();
}

/* ---- Backdrop image ---- */
function setBackgroundImage(dataUrl) {
  backgroundImageDataUrl = dataUrl;
  $('backdrop-sidebar-card').style.display = 'block';
  renderAll();
}

function updateBackdropOpacity(val) {
  backgroundImageOpacity = parseFloat(val);
  $('bg-opacity-val').textContent = `${Math.round(backgroundImageOpacity * 100)}%`;
  $('canvas-backdrop-image')?.setAttribute('opacity', backgroundImageOpacity);
}

function removeBackdropImage(silent = false) {
  backgroundImageDataUrl = null;
  $('backdrop-sidebar-card').style.display = 'none';
  $('file-loader').value = '';
  $('canvas-backdrop-image')?.remove();
  if (!silent) showToast('Backdrop image removed', 'info');
}
