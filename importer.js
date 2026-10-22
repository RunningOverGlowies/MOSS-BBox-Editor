/* Loading layouts: finds the bbox schema inside JSON / TXT / ComfyUI workflows / PNG metadata, and handles drag-and-drop. */

const PRIORITY_KEYS = ['widgets_values', 'inputs', 'text', 'prompt', 'workflow', 'nodes'];

function isConformingSchema(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.items)) return false;
  const hasMarkers = obj.bbox_coord_space === 'abs' || obj.bbox_format === 'xyxy';
  const hasValidItems = Array.isArray(obj.items[0]?.bbox) && obj.items[0].bbox.length === 4;
  return hasMarkers || (obj.summary && typeof obj.summary === 'object' && hasValidItems) || (!!obj.width && !!obj.height && hasValidItems);
}

/* Returns the substring of the {...} object that starts at `start`, honouring strings and escapes. */
function extractBalancedJsonObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start, end = Math.min(text.length, start + 2500000); i < end; i++) {
    const c = text[i];
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === '"') inString = !inString;
    else if (!inString) {
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return text.substring(start, i + 1);
    }
  }
  return null;
}

/* Looks around schema marker keys for an enclosing JSON object. Returns a conforming schema alone if found, else all candidates. */
function scanTextForJsonObjects(text) {
  const results = [];
  for (const marker of ['"bbox_coord_space"', '"bbox_format"', '"summary"', '"items"']) {
    for (let pos = text.indexOf(marker); pos !== -1; pos = text.indexOf(marker, pos + marker.length)) {
      for (let s = pos; s >= Math.max(0, pos - 25000); s--) {
        if (text[s] !== '{') continue;
        const candidate = extractBalancedJsonObject(text, s);
        if (!candidate) continue;
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object') {
            if (isConformingSchema(parsed)) return [parsed];
            results.push(parsed);
          }
        } catch { /* not valid JSON, keep scanning */ }
      }
    }
  }
  return results;
}

function tryExtractSchemaFromString(str) {
  if (!str || typeof str !== 'string' || !/bbox|items|summary/.test(str)) return null;
  try {
    const parsed = JSON.parse(str);
    if (parsed && typeof parsed === 'object') {
      const found = deepSearchSchema(parsed);
      if (found) return found;
    }
  } catch { /* not plain JSON */ }

  const texts = str.includes('\\"') ? [str.replace(/\\"/g, '"').replace(/\\\\/g, '\\'), str] : [str]; // escaped JSON-in-JSON first
  for (const t of texts) for (const cand of scanTextForJsonObjects(t)) {
    const found = deepSearchSchema(cand);
    if (found) return found;
  }
  return null;
}

function deepSearchSchema(data, visited = new Set(), depth = 0) {
  if (!data || depth > 20) return null;
  if (typeof data === 'string') return tryExtractSchemaFromString(data);
  if (typeof data !== 'object' || visited.has(data)) return null;
  visited.add(data);
  if (isConformingSchema(data)) return data;

  const keys = Array.isArray(data) ? Object.keys(data) : [...PRIORITY_KEYS.filter(k => k in data), ...Object.keys(data).filter(k => !PRIORITY_KEYS.includes(k))];
  for (const k of keys) {
    const found = deepSearchSchema(data[k], visited, depth + 1);
    if (found) return found;
  }
  return null;
}

/* ---- PNG text chunks (tEXt / iTXt / zTXt) ---- */
async function inflate(bytes, format) {
  const ds = new DecompressionStream(format), writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

async function decompressZlib(bytes) {
  try { return await inflate(bytes, 'deflate'); }
  catch { try { return await inflate(bytes.slice(2, -4), 'deflate-raw'); } catch { return null; } }
}

async function extractMetadataFromPng(buf) {
  const view = new DataView(buf), out = [];
  if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47 || view.getUint32(4) !== 0x0D0A1A0A) return out;
  const utf8 = new TextDecoder('utf-8', { fatal: false }), latin1 = new TextDecoder('latin1');
  const nul = (bytes, from) => { let p = from; while (p < bytes.length && bytes[p] !== 0) p++; return p; };

  for (let offset = 8; offset < buf.byteLength - 8;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...new Uint8Array(buf, offset + 4, 4));
    offset += 8;
    if (offset + length > buf.byteLength) break;
    const b = new Uint8Array(buf, offset, length);

    if (type === 'tEXt') {
      const n = nul(b, 0);
      if (n < b.length) out.push({ keyword: latin1.decode(b.subarray(0, n)), text: utf8.decode(b.subarray(n + 1)) });
    } else if (type === 'iTXt') {
      const n = nul(b, 0);
      let p = n + 1;
      if (p + 2 <= b.length) {
        const compressed = b[p];
        p = nul(b, p + 2) + 1;  // skip compression method + language tag
        p = nul(b, p) + 1;      // skip translated keyword
        const text = compressed === 1 ? await decompressZlib(b.subarray(p)) : utf8.decode(b.subarray(p));
        if (text) out.push({ keyword: utf8.decode(b.subarray(0, n)), text });
      }
    } else if (type === 'zTXt') {
      const n = nul(b, 0), text = await decompressZlib(b.subarray(n + 2));
      if (text) out.push({ keyword: latin1.decode(b.subarray(0, n)), text });
    }
    offset += length + 4; // payload + CRC
    if (type === 'IEND') break;
  }
  return out;
}

async function extractSchemaFromImageBuffer(buf) {
  const texts = (await extractMetadataFromPng(buf)).sort((a, b) => (b.keyword === 'workflow') - (a.keyword === 'workflow'));
  for (const t of texts) {
    const found = deepSearchSchema(t.text);
    if (found) return found;
  }
  return tryExtractSchemaFromString(new TextDecoder('utf-8', { fatal: false }).decode(buf)); // last resort: raw byte scan
}

/* ---- File loading ---- */
const readFile = (file, method) => new Promise(res => {
  const reader = new FileReader();
  reader.onload = e => res(e.target.result);
  reader[method](file);
});

function applyLoadedSchema(schema) {
  recordState();
  sceneData = schema;
  enforceSchemaIntegrity();
  clearSelection();
  syncAll();
  fitToViewport();
}

async function processFile(file) {
  if (!file) return;
  const buf = await readFile(file, 'readAsArrayBuffer'), u8 = new Uint8Array(buf);
  const isPng = u8.length >= 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47;

  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|bmp|gif)$/i.test(file.name) || isPng) {
    const dataUrl = await readFile(file, 'readAsDataURL');
    const schema = await extractSchemaFromImageBuffer(buf);
    setBackgroundImage(dataUrl);

    if (schema) {
      applyLoadedSchema(schema);
      return showToast(`🖼️ Loaded backdrop & schema (${sceneData.width}×${sceneData.height}, ${sceneData.items.length} items)!`, 'success');
    }
    const img = new Image();
    img.onload = () => {
      const w = Math.max(256, Math.round(img.naturalWidth / 16) * 16), h = Math.max(256, Math.round(img.naturalHeight / 16) * 16);
      if (confirm(`Backdrop image loaded (${img.naturalWidth}×${img.naturalHeight}), but no prompt schema was found inside.\n\nAdjust canvas resolution to match image (${w}×${h})?`)) setResolution(w, h);
      else renderAll();
    };
    img.src = dataUrl;
    return showToast('🖼️ Image loaded as backdrop (no prompt schema found in file).', 'info');
  }

  const schema = tryExtractSchemaFromString(new TextDecoder('utf-8', { fatal: false }).decode(buf));
  if (!schema) return showToast('⚠️ Could not find a valid bounding box schema in the file.', 'warn');
  applyLoadedSchema(schema);
  showToast(`📋 Loaded scene layout (${sceneData.width}×${sceneData.height}, ${sceneData.items.length} items)!`, 'success');
}

function loadFromFile(evt) {
  processFile(evt.target.files[0]);
  evt.target.value = '';
}

function setupDragAndDrop() {
  const overlay = $('drop-overlay');
  const hasFiles = e => e.dataTransfer?.types?.includes('Files');
  let depth = 0;
  window.addEventListener('dragenter', e => { if (hasFiles(e) && ++depth === 1) overlay.style.display = 'flex'; });
  window.addEventListener('dragleave', e => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.style.display = 'none'; } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => {
    depth = 0;
    overlay.style.display = 'none';
    if (e.dataTransfer?.files?.length) { e.preventDefault(); processFile(e.dataTransfer.files[0]); }
  });
}
