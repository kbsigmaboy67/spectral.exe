// ═══════════════════════════════════════════════════════════════
// SPECTRAL.EXE — Local Filesystem (local://) + Override Gateway
// spectral-fs.js  —  loaded BEFORE spectral.js
// ═══════════════════════════════════════════════════════════════
'use strict';

/* ───────────────────────────────────────────────────────────────
   STORAGE ARCHITECTURE
   ───────────────────────────────────────────────────────────────
   localStorage has a ~5-10 MB per-key cap in most browsers.
   We split large files into 512 KB chunks:

     spectral_fs_meta          → JSON index of all files/folders
     spectral_fs_chunk_{id}_{n} → base64 data chunks (512 KB each)
     spectral_local_overrides  → JSON array of user override rules
   ─────────────────────────────────────────────────────────────── */

const FS_META_KEY      = 'spectral_fs_meta';
const FS_CHUNK_PREFIX  = 'spectral_fs_chunk_';
const LO_KEY           = 'spectral_local_overrides';   // local overrides
const CHUNK_SIZE       = 512 * 1024;                    // 512 KB in bytes (before base64)

// ── FILE-SYSTEM META STRUCTURE ────────────────────────────────
//  { version, files: { [virtualPath]: { id, name, mime, size, chunks, modified } } }

function fsMeta() {
  try {
    const raw = localStorage.getItem(FS_META_KEY);
    return raw ? JSON.parse(raw) : { version: 1, files: {} };
  } catch (_) { return { version: 1, files: {} }; }
}

function saveMeta(meta) {
  localStorage.setItem(FS_META_KEY, JSON.stringify(meta));
}

// ── WRITE FILE ────────────────────────────────────────────────
// Accepts ArrayBuffer | Uint8Array | string (text)
async function fsWrite(virtualPath, data, mimeType = 'application/octet-stream') {
  virtualPath = normPath(virtualPath);

  // Convert input to Uint8Array
  let bytes;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = 'text/plain';
    }
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else {
    throw new Error('fsWrite: unsupported data type');
  }

  const meta    = fsMeta();
  const fileId  = meta.files[virtualPath]?.id || virtualPath.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now();
  const chunks  = [];

  // Delete old chunks if file already existed
  if (meta.files[virtualPath]) {
    const old = meta.files[virtualPath];
    for (let i = 0; i < old.chunks; i++) {
      try { localStorage.removeItem(FS_CHUNK_PREFIX + old.id + '_' + i); } catch (_) {}
    }
  }

  // Write new chunks
  let offset = 0, chunkIdx = 0;
  while (offset < bytes.length) {
    const slice   = bytes.slice(offset, offset + CHUNK_SIZE);
    const b64     = uint8ToBase64(slice);
    localStorage.setItem(FS_CHUNK_PREFIX + fileId + '_' + chunkIdx, b64);
    chunks.push(chunkIdx);
    offset += CHUNK_SIZE;
    chunkIdx++;
  }

  meta.files[virtualPath] = {
    id:       fileId,
    name:     virtualPath.split('/').pop(),
    mime:     mimeType,
    size:     bytes.length,
    chunks:   chunkIdx,
    modified: Date.now(),
  };
  saveMeta(meta);
  return virtualPath;
}

// ── READ FILE → Blob ──────────────────────────────────────────
function fsRead(virtualPath) {
  virtualPath = normPath(virtualPath);
  const meta = fsMeta();
  const file = meta.files[virtualPath];
  if (!file) return null;

  const parts = [];
  for (let i = 0; i < file.chunks; i++) {
    const b64 = localStorage.getItem(FS_CHUNK_PREFIX + file.id + '_' + i);
    if (b64 === null) throw new Error(`Missing chunk ${i} for ${virtualPath}`);
    parts.push(base64ToUint8(b64));
  }

  // Concatenate all chunks
  const total  = parts.reduce((s, a) => s + a.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { merged.set(p, off); off += p.length; }

  return new Blob([merged], { type: file.mime });
}

// ── READ FILE → ObjectURL ──────────────────────────────────────
function fsReadUrl(virtualPath) {
  const blob = fsRead(virtualPath);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

// ── READ FILE → Text ──────────────────────────────────────────
async function fsReadText(virtualPath) {
  const blob = fsRead(virtualPath);
  if (!blob) return null;
  return await blob.text();
}

// ── DELETE FILE ───────────────────────────────────────────────
function fsDelete(virtualPath) {
  virtualPath = normPath(virtualPath);
  const meta = fsMeta();
  const file = meta.files[virtualPath];
  if (!file) return false;
  for (let i = 0; i < file.chunks; i++) {
    try { localStorage.removeItem(FS_CHUNK_PREFIX + file.id + '_' + i); } catch (_) {}
  }
  delete meta.files[virtualPath];
  saveMeta(meta);
  return true;
}

// ── RENAME FILE ───────────────────────────────────────────────
function fsRename(oldPath, newPath) {
  oldPath = normPath(oldPath);
  newPath = normPath(newPath);
  const meta = fsMeta();
  if (!meta.files[oldPath]) return false;
  meta.files[newPath] = { ...meta.files[oldPath], name: newPath.split('/').pop(), modified: Date.now() };
  delete meta.files[oldPath];
  saveMeta(meta);
  return true;
}

// ── LIST FILES ────────────────────────────────────────────────
function fsList(dirPath = '/') {
  dirPath = normPath(dirPath);
  const meta  = fsMeta();
  const prefix = dirPath === '/' ? '/' : dirPath + '/';
  return Object.keys(meta.files)
    .filter(p => p === dirPath || p.startsWith(prefix))
    .map(p => ({ path: p, ...meta.files[p] }));
}

function fsListDir(dirPath = '/') {
  dirPath = normPath(dirPath);
  const meta   = fsMeta();
  const prefix = (dirPath === '/' ? '' : dirPath) + '/';
  const result = { files: [], dirs: new Set() };

  for (const p of Object.keys(meta.files)) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (!rel) continue;
    const slash = rel.indexOf('/');
    if (slash === -1) {
      result.files.push({ path: p, ...meta.files[p] });
    } else {
      result.dirs.add(prefix + rel.slice(0, slash));
    }
  }
  result.dirs = [...result.dirs];
  return result;
}

// ── FILE INFO ─────────────────────────────────────────────────
function fsInfo(virtualPath) {
  virtualPath = normPath(virtualPath);
  const meta = fsMeta();
  return meta.files[virtualPath] || null;
}

// ── EXPORT ALL (as encoded JSON) ──────────────────────────────
async function fsExportAll(encoding = 'base64') {
  const meta  = fsMeta();
  const files = {};

  for (const [path, info] of Object.entries(meta.files)) {
    const blob    = fsRead(path);
    const arrBuf  = await blob.arrayBuffer();
    const u8      = new Uint8Array(arrBuf);
    files[path]   = {
      ...info,
      data: encoding === 'hex' ? uint8ToHex(u8) : uint8ToBase64(u8),
      encoding,
    };
  }
  const json = JSON.stringify({ version: 1, exportedAt: Date.now(), encoding, files });
  return json;
}

// ── IMPORT ALL (from encoded JSON) ────────────────────────────
async function fsImportAll(jsonStr, merge = false) {
  const data = JSON.parse(jsonStr);
  if (!merge) {
    // Wipe existing
    const meta = fsMeta();
    for (const [p, f] of Object.entries(meta.files)) {
      for (let i = 0; i < f.chunks; i++) {
        try { localStorage.removeItem(FS_CHUNK_PREFIX + f.id + '_' + i); } catch (_) {}
      }
    }
    saveMeta({ version: 1, files: {} });
  }

  for (const [path, file] of Object.entries(data.files || {})) {
    let u8;
    if (file.encoding === 'hex') u8 = hexToUint8(file.data);
    else u8 = base64ToUint8(file.data);
    await fsWrite(path, u8, file.mime || 'application/octet-stream');
  }
  return Object.keys(data.files || {}).length;
}

// ── FORMAT HELPER ─────────────────────────────────────────────
function fsFormatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ── LOCAL OVERRIDES ───────────────────────────────────────────
// Stacks ON TOP of list.json overrides. Same schema.

function loLoad() {
  try {
    const raw = localStorage.getItem(LO_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function loSave(arr) {
  localStorage.setItem(LO_KEY, JSON.stringify(arr));
}

function loAdd(entry) {
  const arr = loLoad();
  if (!entry.id) entry.id = 'lo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  arr.push(entry);
  loSave(arr);
  return entry.id;
}

function loUpdate(id, patch) {
  const arr = loLoad();
  const idx = arr.findIndex(e => e.id === id);
  if (idx === -1) return false;
  arr[idx] = { ...arr[idx], ...patch };
  loSave(arr);
  return true;
}

function loRemove(id) {
  loSave(loLoad().filter(e => e.id !== id));
}

function loExport(encoding = 'base64') {
  const arr  = loLoad();
  const json = JSON.stringify({ version: 1, exportedAt: Date.now(), encoding, overrides: arr });
  return encoding === 'hex' ? strToHex(json) : btoa(unescape(encodeURIComponent(json)));
}

function loImport(encoded, encoding = 'base64', merge = false) {
  let json;
  if (encoding === 'hex') json = hexToStr(encoded);
  else json = decodeURIComponent(escape(atob(encoded)));
  const data = JSON.parse(json);
  const arr  = data.overrides || [];
  if (merge) {
    const existing = loLoad();
    const ids = new Set(existing.map(e => e.id));
    for (const e of arr) { if (!ids.has(e.id)) existing.push(e); }
    loSave(existing);
  } else {
    loSave(arr);
  }
  return arr.length;
}

// ── PATH UTILS ────────────────────────────────────────────────
function normPath(p) {
  p = p.trim().replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  // Collapse double slashes, no trailing slash
  p = p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  return p;
}

function localUrlToPath(url) {
  // local://path/to/file  →  /path/to/file
  return normPath(url.replace(/^local:\/\//i, ''));
}

// ── BASE64 / HEX UTILS ────────────────────────────────────────
function uint8ToBase64(u8) {
  let bin = '';
  const len = u8.length;
  // Process in blocks to avoid stack overflow on large arrays
  const BLOCK = 0x8000;
  for (let i = 0; i < len; i += BLOCK) {
    bin += String.fromCharCode(...u8.subarray(i, i + BLOCK));
  }
  return btoa(bin);
}

function base64ToUint8(b64) {
  const bin = atob(b64);
  const u8  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function uint8ToHex(u8) {
  return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8(hex) {
  const u8 = new Uint8Array(hex.length / 2);
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return u8;
}

function strToHex(str) {
  return uint8ToHex(new TextEncoder().encode(str));
}

function hexToStr(hex) {
  return new TextDecoder().decode(hexToUint8(hex));
}

// ── MIME DETECTION ────────────────────────────────────────────
function mimeFromName(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
    json: 'application/json', txt: 'text/plain', md: 'text/markdown',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', bmp: 'image/bmp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm',
    pdf: 'application/pdf',
    zip: 'application/zip',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    xml: 'application/xml', csv: 'text/csv',
  };
  return map[ext] || 'application/octet-stream';
}

// Expose globally so spectral.js and the page UI can access
window.SpectralFS = {
  write: fsWrite, read: fsRead, readUrl: fsReadUrl, readText: fsReadText,
  delete: fsDelete, rename: fsRename, list: fsList, listDir: fsListDir,
  info: fsInfo, exportAll: fsExportAll, importAll: fsImportAll,
  formatSize: fsFormatSize, normPath, localUrlToPath, mimeFromName,
  uint8ToBase64, base64ToUint8, uint8ToHex, hexToUint8, strToHex, hexToStr,
};

window.SpectralLO = {
  load: loLoad, save: loSave, add: loAdd, update: loUpdate, remove: loRemove,
  export: loExport, import: loImport,
};
