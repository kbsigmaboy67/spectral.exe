// ═══════════════════════════════════════════════════════════════
// SPECTRAL.EXE — FreeDNX Studio  (spectral://FDNX)
// spectral-fdnx.js  —  load after spectral-fs.js, before spectral.js
//
// No-code visual builder for all override types:
//   redirect, github, fetch, html, html_base64, html_uri, local
// Supports image/folder/zip asset import from Editor & device
// Full JSON export / import / copy / paste
// ═══════════════════════════════════════════════════════════════
'use strict';

// ── OVERRIDE SCHEMA ────────────────────────────────────────────
// All fields any override can have:
//   match, type, target, content, display, tabTitle, tabFavicon,
//   tabImage, password, id (auto)
//
// Special compound types this builder adds:
//   image   → wraps an image in an HTML page served as blob
//   folder  → generates an HTML index of a local:// directory
//   zip     → extracts zip into local:// and serves index.html

const FDNX_TYPES = [
  { id: 'redirect',    label: 'Redirect',       icon: '🔗', desc: 'Load a real URL inside the browser frame (hides the true address)' },
  { id: 'github',      label: 'GitHub Pages',   icon: '🐙', desc: 'Serve a GitHub Pages site under a custom domain / protocol' },
  { id: 'fetch',       label: 'Fetch → Blob',   icon: '📡', desc: 'Fetch a remote URL and serve its content as a blob' },
  { id: 'html',        label: 'Inline HTML',    icon: '📄', desc: 'Write or paste HTML — served as an inline blob page' },
  { id: 'html_base64', label: 'Base64 HTML',    icon: '🔒', desc: 'Base64-encoded HTML blob — obfuscates source' },
  { id: 'html_uri',    label: 'URI HTML',       icon: '🔐', desc: 'URI-encoded HTML blob' },
  { id: 'local',       label: 'Local File',     icon: '💾', desc: 'Serve a file from the local:// filesystem' },
  { id: 'image',       label: 'Image Page',     icon: '🖼',  desc: 'Wrap an image (local:// or URL) as a full-screen page' },
  { id: 'folder',      label: 'Folder Index',   icon: '📁', desc: 'Auto-generate an HTML file browser for a local:// directory' },
];

const TYPE_COLORS = {
  redirect:'#00eeff', github:'#888', fetch:'#ff00cc',
  html:'#00ff88', html_base64:'#00ff88', html_uri:'#00ff88',
  local:'#ffcc00', image:'#ff6600', folder:'#6688ff',
};

// ── FDNX PAGE STATE ────────────────────────────────────────────
let fdnxTabId   = null;
let fdnxEditId  = null;  // id of override being edited (null = new)
let fdnxFilter  = '';
let fdnxDraftOv = null;  // current draft override object in wizard

// ── RENDER PAGE ────────────────────────────────────────────────
function renderFDNX(tabId, el) {
  fdnxTabId = tabId;
  if (typeof updateTabMeta === 'function')
    updateTabMeta(tabId, 'FreeDNX Studio — Spectral.exe', '🌐');

  if (!document.getElementById('fdnx-style')) {
    const s = document.createElement('style');
    s.id = 'fdnx-style';
    s.textContent = FDNX_CSS;
    document.head.appendChild(s);
  }

  el.innerHTML = `
<div class="fdnx-root" id="fdnx-root">

  <!-- ══ HEADER ══ -->
  <div class="fdnx-header">
    <div class="fdnx-header-left">
      <span class="fdnx-logo">🌐 FreeDNX Studio</span>
      <span class="fdnx-tagline">// no-code override builder</span>
    </div>
    <div class="fdnx-header-right">
      <button class="fdnx-btn fdnx-btn-primary" onclick="fdnxOpenWizard(null)">＋ New Override</button>
      <button class="fdnx-btn" onclick="fdnxImportUI()">⬆ Import JSON</button>
      <button class="fdnx-btn fdnx-btn-cyan" onclick="fdnxExportUI()">⬇ Export JSON</button>
      <button class="fdnx-btn" onclick="fdnxCopyAll()">📋 Copy All</button>
      <button class="fdnx-btn fdnx-btn-dim" onclick="fdnxReloadListJson()">↻ Reload list.json</button>
    </div>
  </div>

  <!-- ══ FILTER BAR ══ -->
  <div class="fdnx-filterbar">
    <input class="fdnx-search" id="fdnx-search" type="text" placeholder="🔍  Filter by match, type, display…"
      oninput="fdnxFilter=this.value;fdnxRenderList()" autocomplete="off" spellcheck="false"/>
    <div class="fdnx-type-chips" id="fdnx-type-chips">
      <span class="fdnx-chip fdnx-chip-all active" onclick="fdnxFilterType('')">All</span>
      ${FDNX_TYPES.map(t=>`<span class="fdnx-chip" data-t="${t.id}" onclick="fdnxFilterType('${t.id}')">${t.icon} ${t.label}</span>`).join('')}
    </div>
  </div>

  <!-- ══ STATS BAR ══ -->
  <div class="fdnx-statsbar" id="fdnx-statsbar"></div>

  <!-- ══ MAIN ══ -->
  <div class="fdnx-body">

    <!-- Left: override list -->
    <div class="fdnx-list-col">
      <div class="fdnx-list" id="fdnx-list"></div>
    </div>

    <!-- Right: JSON preview panel -->
    <div class="fdnx-json-col" id="fdnx-json-col">
      <div class="fdnx-json-header">
        <span class="fdnx-json-title">JSON Preview</span>
        <div style="display:flex;gap:5px">
          <button class="fdnx-btn fdnx-btn-cyan" onclick="fdnxCopyAll()">📋 Copy</button>
          <button class="fdnx-btn" onclick="fdnxExportUI()">⬇ Export</button>
        </div>
      </div>
      <textarea id="fdnx-json-preview" class="fdnx-json-textarea" readonly spellcheck="false"></textarea>
    </div>

  </div>

  <!-- ══ IMPORT MODAL placeholder ══ -->
  <div id="fdnx-import-area" style="display:none"></div>

</div>`;

  fdnxRenderStats();
  fdnxRenderList();
  fdnxRenderJsonPreview();
}

// ── FILTER BY TYPE ─────────────────────────────────────────────
let fdnxActiveType = '';
function fdnxFilterType(type) {
  fdnxActiveType = type;
  document.querySelectorAll('.fdnx-chip').forEach(c => {
    c.classList.toggle('active',
      type === '' ? c.classList.contains('fdnx-chip-all') : c.dataset.t === type);
  });
  fdnxRenderList();
}

// ── STATS ──────────────────────────────────────────────────────
function fdnxRenderStats() {
  const el = document.getElementById('fdnx-statsbar');
  if (!el) return;
  const local    = window.SpectralLO.load();
  const listjson = (window._spectralJsonOverrides || []);
  const total    = local.length + listjson.length;
  const byType   = {};
  [...local,...listjson].forEach(o => { byType[o.type] = (byType[o.type]||0)+1; });
  const chips = Object.entries(byType).map(([t,n]) =>
    `<span class="fdnx-stat-chip" style="border-color:${TYPE_COLORS[t]||'#333'};color:${TYPE_COLORS[t]||'#666'}">${t} ×${n}</span>`
  ).join('');
  el.innerHTML = `<span class="fdnx-stat-label">Local: <b>${local.length}</b></span>
    <span class="fdnx-stat-label">list.json: <b>${listjson.length}</b></span>
    <span class="fdnx-stat-label">Total: <b>${total}</b></span>
    <span class="fdnx-stat-label">Files: <b>${window.SpectralFS.list('/').length}</b></span>
    ${chips}`;
}

// ── MAIN LIST ──────────────────────────────────────────────────
function fdnxRenderList() {
  const el = document.getElementById('fdnx-list');
  if (!el) return;
  const local     = window.SpectralLO.load().map(o=>({...o,_src:'local'}));
  const listjson  = (window._spectralJsonOverrides||[]).map(o=>({...o,_src:'listjson'}));
  let all         = [...local,...listjson];

  // Filter by search
  const q = fdnxFilter.toLowerCase();
  if (q) all = all.filter(o =>
    (o.match||'').toLowerCase().includes(q) ||
    (o.type||'').toLowerCase().includes(q) ||
    (o.display||'').toLowerCase().includes(q) ||
    (o.target||'').toLowerCase().includes(q)
  );
  if (fdnxActiveType) all = all.filter(o => o.type === fdnxActiveType);

  if (!all.length) {
    el.innerHTML = `<div class="fdnx-empty">
      ${fdnxFilter || fdnxActiveType ? '// No overrides match your filter' : '// No overrides yet — click "+ New Override" to get started'}
    </div>`;
    fdnxRenderStats();
    fdnxRenderJsonPreview();
    return;
  }

  el.innerHTML = all.map(o => fdnxCardHTML(o)).join('');
  fdnxRenderStats();
  fdnxRenderJsonPreview();
}

function fdnxCardHTML(o) {
  const color   = TYPE_COLORS[o.type] || '#333';
  const typeObj = FDNX_TYPES.find(t=>t.id===o.type) || { icon:'?', label:o.type };
  const isLocal = o._src === 'local';
  const target  = o.target || (o.content ? '(inline content)' : '');
  const metaBadges = [
    o.tabTitle    && `<span class="fdnx-meta-badge">T: ${_e(o.tabTitle.slice(0,16))}</span>`,
    o.tabFavicon  && `<span class="fdnx-meta-badge">🏷 icon</span>`,
    o.tabImage    && `<span class="fdnx-meta-badge">🖼 img</span>`,
    o.password    && `<span class="fdnx-meta-badge fdnx-meta-pw">🔐 pw</span>`,
  ].filter(Boolean).join('');

  return `
  <div class="fdnx-card ${isLocal?'fdnx-card-local':''}" id="fdnx-card-${_e(o.id||o.match)}">
    <div class="fdnx-card-type" style="border-color:${color};color:${color}">${typeObj.icon} ${typeObj.label}</div>
    <div class="fdnx-card-body">
      <div class="fdnx-card-match">${_e(o.match)}</div>
      <div class="fdnx-card-target">${_e(target.slice(0,80))}${target.length>80?'…':''}</div>
      ${o.display?`<div class="fdnx-card-display">${_e(o.display)}</div>`:''}
      ${metaBadges?`<div class="fdnx-card-meta">${metaBadges}</div>`:''}
    </div>
    <div class="fdnx-card-actions">
      <button class="fdnx-action-btn" onclick="navigateTo('${_ea(o.match)}')">▶ Test</button>
      ${isLocal
        ? `<button class="fdnx-action-btn" onclick="fdnxOpenWizard('${_ea(o.id)}')">✏ Edit</button>
           <button class="fdnx-action-btn fdnx-action-del" onclick="fdnxDelete('${_ea(o.id)}')">🗑</button>`
        : `<button class="fdnx-action-btn" onclick="fdnxCloneToLocal(${JSON.stringify(JSON.stringify(o))})">⧉ Clone</button>`
      }
      <span class="fdnx-src-tag">${isLocal?'local':'list.json'}</span>
    </div>
  </div>`;
}

function fdnxDelete(id) {
  if (!confirm('Delete this override?')) return;
  window.SpectralLO.remove(id);
  fdnxRenderList();
}

function fdnxCloneToLocal(jsonStr) {
  const o = JSON.parse(jsonStr);
  delete o.id; delete o._src;
  window.SpectralLO.add(o);
  fdnxRenderList();
}

// ── JSON PREVIEW ───────────────────────────────────────────────
function fdnxRenderJsonPreview() {
  const el = document.getElementById('fdnx-json-preview');
  if (!el) return;
  const local = window.SpectralLO.load();
  el.value = JSON.stringify({ overrides: local }, null, 2);
}

function fdnxCopyAll() {
  const local = window.SpectralLO.load();
  const json  = JSON.stringify({ overrides: local }, null, 2);
  navigator.clipboard.writeText(json).then(() => fdnxToast('✓ Copied to clipboard'));
}

// ── EXPORT ─────────────────────────────────────────────────────
function fdnxExportUI() {
  const local = window.SpectralLO.load();
  const json  = JSON.stringify({ overrides: local }, null, 2);
  const a     = document.createElement('a');
  a.href      = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download  = 'spectral-overrides.json';
  a.click();
  fdnxToast('✓ Exported spectral-overrides.json');
}

// ── IMPORT ─────────────────────────────────────────────────────
function fdnxImportUI() {
  const bg = document.createElement('div');
  bg.className = 'fdnx-modal-bg';
  bg.innerHTML = `
  <div class="fdnx-modal" onclick="event.stopPropagation()">
    <div class="fdnx-modal-title">⬆ Import Overrides JSON</div>
    <div class="fdnx-modal-desc">Paste a JSON object with an <code>"overrides"</code> array, or upload a <code>.json</code> file.</div>
    <textarea id="fdnx-imp-txt" class="fdnx-modal-textarea" placeholder='{ "overrides": [ ... ] }'></textarea>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="fdnx-btn" onclick="document.getElementById('fdnx-imp-file').click()">📂 Upload File</button>
      <input type="file" id="fdnx-imp-file" accept=".json,.txt" style="display:none"/>
      <span style="color:#333;font-size:11px;font-family:var(--font-mono)">or paste above</span>
    </div>
    <div class="fdnx-modal-actions">
      <button class="fdnx-btn" onclick="this.closest('.fdnx-modal-bg').remove()">Cancel</button>
      <button class="fdnx-btn" onclick="fdnxDoImport(false)">Replace All</button>
      <button class="fdnx-btn fdnx-btn-primary" onclick="fdnxDoImport(true)">Merge</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', () => bg.remove());

  document.getElementById('fdnx-imp-file')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    document.getElementById('fdnx-imp-txt').value = await f.text();
    e.target.value = '';
  });
}

function fdnxDoImport(merge) {
  const raw = document.getElementById('fdnx-imp-txt')?.value?.trim();
  if (!raw) { fdnxToast('⚠ Nothing to import', 'warn'); return; }
  try {
    const parsed = JSON.parse(raw);
    const arr    = parsed.overrides || (Array.isArray(parsed) ? parsed : [parsed]);
    if (!arr.length) { fdnxToast('⚠ No overrides found', 'warn'); return; }
    if (!merge) {
      window.SpectralLO.save([]);
      arr.forEach(o => { delete o.id; window.SpectralLO.add(o); });
    } else {
      arr.forEach(o => { delete o.id; window.SpectralLO.add(o); });
    }
    document.querySelector('.fdnx-modal-bg')?.remove();
    fdnxRenderList();
    fdnxToast(`✓ ${arr.length} override(s) ${merge?'merged':'imported'}`);
  } catch(e) {
    fdnxToast('✗ Invalid JSON: ' + e.message, 'err');
  }
}

// ── RELOAD list.json ───────────────────────────────────────────
async function fdnxReloadListJson() {
  if (typeof loadOverrides === 'function') {
    await loadOverrides();
    window._spectralJsonOverrides = window.jsonOverrides || [];
  }
  fdnxRenderList();
  fdnxToast('✓ list.json reloaded');
}

// ═══════════════════════════════════════════════════════════════
// WIZARD — New / Edit Override
// ═══════════════════════════════════════════════════════════════
function fdnxOpenWizard(id) {
  fdnxEditId  = id || null;
  fdnxDraftOv = id
    ? { ...window.SpectralLO.load().find(o=>o.id===id) }
    : { type:'redirect', match:'', target:'', display:'', tabTitle:'', tabFavicon:'', tabImage:'', password:'', content:'' };

  const bg = document.createElement('div');
  bg.className = 'fdnx-modal-bg fdnx-wizard-bg';
  bg.innerHTML = fdnxWizardHTML(fdnxDraftOv);
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });

  // Wire type change
  document.getElementById('fdnx-wiz-type')?.addEventListener('change', e => {
    fdnxDraftOv.type = e.target.value;
    fdnxWizUpdateFields();
  });

  // Live JSON preview
  const liveFields = ['fdnx-wiz-match','fdnx-wiz-target','fdnx-wiz-content',
    'fdnx-wiz-display','fdnx-wiz-tabTitle','fdnx-wiz-tabFavicon','fdnx-wiz-tabImage','fdnx-wiz-password'];
  liveFields.forEach(fid => {
    document.getElementById(fid)?.addEventListener('input', fdnxWizUpdatePreview);
  });

  fdnxWizUpdateFields();
  fdnxWizUpdatePreview();
}

function fdnxWizardHTML(o) {
  const typeSel = FDNX_TYPES.map(t =>
    `<option value="${t.id}" ${o.type===t.id?'selected':''}>${t.icon} ${t.label} — ${t.desc}</option>`
  ).join('');

  return `
  <div class="fdnx-wizard" onclick="event.stopPropagation()">
    <div class="fdnx-wiz-title">${fdnxEditId ? '✏ Edit Override' : '＋ New Override'}</div>

    <div class="fdnx-wiz-cols">

      <!-- LEFT: form -->
      <div class="fdnx-wiz-left">

        <!-- TYPE -->
        <div class="fdnx-wiz-section">// Type</div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Override Type</label>
          <select class="fdnx-input fdnx-select" id="fdnx-wiz-type">${typeSel}</select>
        </div>

        <!-- MATCH -->
        <div class="fdnx-wiz-section">// Identity</div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Match URL / Spectral Domain</label>
          <input class="fdnx-input" id="fdnx-wiz-match" type="text"
            value="${_e(o.match||'')}"
            placeholder="e.g.  http://mycoolsite.io  game://run  myapp://splash"/>
          <div class="fdnx-hint" id="fdnx-wiz-match-hint"></div>
        </div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Display Name / Tab Title</label>
          <input class="fdnx-input" id="fdnx-wiz-display" type="text"
            value="${_e(o.display||'')}" placeholder="Human-readable label shown in tab"/>
        </div>

        <!-- CONTENT FIELDS (shown/hidden based on type) -->
        <div class="fdnx-wiz-section" id="fdnx-wiz-sec-target">// Target</div>
        <div class="fdnx-form-row" id="fdnx-wiz-target-row">
          <label class="fdnx-label" id="fdnx-wiz-target-label">Target URL</label>
          <input class="fdnx-input" id="fdnx-wiz-target" type="text"
            value="${_e(o.target||'')}" placeholder="https://..."/>
          <div class="fdnx-hint" id="fdnx-wiz-target-hint"></div>
        </div>

        <div class="fdnx-form-row" id="fdnx-wiz-content-row" style="display:none">
          <label class="fdnx-label" id="fdnx-wiz-content-label">HTML Content</label>
          <div class="fdnx-content-toolbar" id="fdnx-wiz-content-toolbar">
            <button class="fdnx-tbtn" onclick="fdnxWizImportFromEditor()">📝 From Editor</button>
            <button class="fdnx-tbtn" onclick="fdnxWizImportHTMLFile()">📂 Import File</button>
            <button class="fdnx-tbtn" onclick="fdnxWizImportLocalFile()">💾 From local://</button>
            <button class="fdnx-tbtn" onclick="fdnxWizToBase64()">🔒 → Base64</button>
            <button class="fdnx-tbtn" onclick="fdnxWizFormatHTML()">✨ Format</button>
            <button class="fdnx-tbtn" onclick="fdnxWizPreview()">👁 Preview</button>
            <input type="file" id="fdnx-html-file-input" style="display:none" accept=".html,.htm,.txt"
              onchange="fdnxWizHandleHTMLFile(event)"/>
          </div>
          <textarea class="fdnx-input fdnx-textarea" id="fdnx-wiz-content"
            placeholder="Enter HTML here, or use the buttons above to import…"
          >${_e(o.content||'')}</textarea>
        </div>

        <!-- LOCAL PATH (for local & folder types) -->
        <div class="fdnx-form-row" id="fdnx-wiz-local-row" style="display:none">
          <label class="fdnx-label" id="fdnx-wiz-local-label">Local Path</label>
          <div style="display:flex;gap:6px">
            <input class="fdnx-input" id="fdnx-wiz-target" type="text" style="display:none"/>
            <input class="fdnx-input" id="fdnx-wiz-local-path" type="text"
              value="${_e(o.target||'')}" placeholder="/path/to/file"/>
            <button class="fdnx-btn" onclick="fdnxWizPickLocal()">📂 Browse</button>
          </div>
          <div class="fdnx-hint" id="fdnx-wiz-local-hint">Files must be in the local:// filesystem. Use Gateway → Filesystem or spectral://editor to upload.</div>
        </div>

        <!-- IMAGE type -->
        <div class="fdnx-form-row" id="fdnx-wiz-image-row" style="display:none">
          <label class="fdnx-label">Image Source</label>
          <div class="fdnx-img-source-tabs">
            <button class="fdnx-tbtn active" id="fdnx-img-tab-url"  onclick="fdnxImgSourceTab('url')">🌐 URL</button>
            <button class="fdnx-tbtn"        id="fdnx-img-tab-local" onclick="fdnxImgSourceTab('local')">💾 local://</button>
            <button class="fdnx-tbtn"        id="fdnx-img-tab-upload" onclick="fdnxImgSourceTab('upload')">⬆ Upload</button>
          </div>
          <input class="fdnx-input" id="fdnx-img-url-input" type="text"
            value="${_e(o.target||'')}" placeholder="https://example.com/image.png"
            oninput="fdnxWizUpdatePreview()"/>
          <div id="fdnx-img-local-wrap" style="display:none">
            <div style="display:flex;gap:6px;margin-top:6px">
              <input class="fdnx-input" id="fdnx-img-local-path" type="text" placeholder="/images/photo.png" oninput="fdnxWizUpdatePreview()"/>
              <button class="fdnx-btn" onclick="fdnxWizPickImageLocal()">📂 Browse</button>
            </div>
          </div>
          <div id="fdnx-img-upload-wrap" style="display:none">
            <button class="fdnx-btn" style="margin-top:6px" onclick="fdnxWizUploadImage()">⬆ Upload Image</button>
            <input type="file" id="fdnx-wiz-img-upload" accept="image/*" style="display:none"
              onchange="fdnxWizHandleImageUpload(event)"/>
            <div class="fdnx-hint" id="fdnx-img-upload-hint">Image will be saved to local:// filesystem</div>
          </div>
          <div class="fdnx-form-row" style="margin-top:10px">
            <label class="fdnx-label">Background Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" id="fdnx-img-bg" value="#000000" style="width:36px;height:28px;border:1px solid #222;background:transparent;cursor:pointer;border-radius:4px"/>
              <input class="fdnx-input" id="fdnx-img-bg-text" value="#000000" style="width:100px" oninput="document.getElementById('fdnx-img-bg').value=this.value;fdnxWizUpdatePreview()"/>
            </div>
          </div>
          <div class="fdnx-form-row" style="margin-top:6px">
            <label class="fdnx-label">Image Fit</label>
            <select class="fdnx-input fdnx-select" id="fdnx-img-fit" onchange="fdnxWizUpdatePreview()">
              <option value="contain">contain (letterbox)</option>
              <option value="cover">cover (crop to fill)</option>
              <option value="fill">fill (stretch)</option>
              <option value="none">none (original size)</option>
            </select>
          </div>
        </div>

        <!-- FOLDER type -->
        <div class="fdnx-form-row" id="fdnx-wiz-folder-row" style="display:none">
          <label class="fdnx-label">Directory Path</label>
          <div style="display:flex;gap:6px">
            <input class="fdnx-input" id="fdnx-wiz-folder-path" type="text"
              placeholder="/games/mygame" oninput="fdnxWizUpdatePreview()"/>
            <button class="fdnx-btn" onclick="fdnxWizPickFolder()">📁 Browse</button>
          </div>
          <div class="fdnx-hint">Spectral will generate an HTML file browser for this local:// directory.</div>
          <button class="fdnx-btn" style="margin-top:6px" onclick="fdnxWizUploadZip()">📦 Upload ZIP (auto-extract)</button>
          <input type="file" id="fdnx-zip-input" accept=".zip" style="display:none"
            onchange="fdnxWizHandleZip(event)"/>
          <div class="fdnx-hint" id="fdnx-zip-hint"></div>
        </div>

        <!-- APPEARANCE -->
        <div class="fdnx-wiz-section">// Appearance <span class="fdnx-optional">(optional)</span></div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Force Tab Title</label>
          <input class="fdnx-input" id="fdnx-wiz-tabTitle" type="text"
            value="${_e(o.tabTitle||'')}" placeholder="Overrides auto-detected page title"/>
        </div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Tab Favicon (emoji or image URL)</label>
          <div style="display:flex;gap:8px;align-items:center">
            <span id="fdnx-fav-preview" style="font-size:20px;min-width:28px;text-align:center">🌐</span>
            <input class="fdnx-input" id="fdnx-wiz-tabFavicon" type="text"
              value="${_e(o.tabFavicon||'')}" placeholder="🎮  or  https://site.com/fav.ico"
              oninput="fdnxWizFavPreview(this.value)"/>
          </div>
        </div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Tab Background Image URL</label>
          <input class="fdnx-input" id="fdnx-wiz-tabImage" type="text"
            value="${_e(o.tabImage||'')}" placeholder="https://... or local://path/to/image.png"/>
        </div>

        <!-- SECURITY -->
        <div class="fdnx-wiz-section">// Security <span class="fdnx-optional">(optional)</span></div>
        <div class="fdnx-form-row">
          <label class="fdnx-label">Password Protection</label>
          <input class="fdnx-input" id="fdnx-wiz-password" type="text"
            value="${_e(o.password||'')}" placeholder="Leave blank for no password" autocomplete="new-password"/>
        </div>

      </div><!-- fdnx-wiz-left -->

      <!-- RIGHT: live preview -->
      <div class="fdnx-wiz-right">
        <div class="fdnx-wiz-preview-title">Live Preview</div>

        <!-- Tab strip mockup -->
        <div class="fdnx-tab-mock" id="fdnx-tab-mock">
          <span class="fdnx-tab-mock-fav" id="fdnx-mock-fav">🌐</span>
          <span class="fdnx-tab-mock-title" id="fdnx-mock-title">My Override</span>
          <span class="fdnx-tab-mock-close">✕</span>
        </div>

        <!-- URL bar mockup -->
        <div class="fdnx-urlbar-mock">
          <span class="fdnx-lock" id="fdnx-mock-lock">🔒</span>
          <span class="fdnx-mock-url" id="fdnx-mock-url"></span>
        </div>

        <!-- JSON snippet -->
        <div class="fdnx-wiz-preview-title" style="margin-top:14px">JSON Snippet</div>
        <textarea id="fdnx-wiz-json" class="fdnx-json-snippet" readonly spellcheck="false"></textarea>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="fdnx-btn fdnx-btn-cyan" onclick="fdnxWizCopyJson()">📋 Copy JSON</button>
          <button class="fdnx-btn" onclick="fdnxWizTestNow()">▶ Test Now</button>
        </div>

        <!-- Image preview for image type -->
        <div id="fdnx-wiz-img-preview-wrap" style="display:none;margin-top:14px">
          <div class="fdnx-wiz-preview-title">Image Preview</div>
          <div class="fdnx-img-preview-box" id="fdnx-img-preview-box">
            <img id="fdnx-img-preview" src="" alt="" style="max-width:100%;max-height:200px;object-fit:contain"/>
          </div>
        </div>
      </div>

    </div><!-- fdnx-wiz-cols -->

    <div class="fdnx-wiz-footer">
      <button class="fdnx-btn" onclick="this.closest('.fdnx-wizard-bg').remove()">Cancel</button>
      <button class="fdnx-btn fdnx-btn-primary" onclick="fdnxWizSave()">💾 Save Override</button>
    </div>
  </div>`;
}

// ── WIZARD FIELD VISIBILITY ────────────────────────────────────
function fdnxWizUpdateFields() {
  const type = document.getElementById('fdnx-wiz-type')?.value || 'redirect';
  const rows = {
    'fdnx-wiz-target-row':  ['redirect','github','fetch'],
    'fdnx-wiz-content-row': ['html','html_base64','html_uri'],
    'fdnx-wiz-local-row':   ['local'],
    'fdnx-wiz-image-row':   ['image'],
    'fdnx-wiz-folder-row':  ['folder'],
    'fdnx-wiz-sec-target':  ['redirect','github','fetch','local'],
  };
  Object.entries(rows).forEach(([rowId, types]) => {
    const el = document.getElementById(rowId);
    if (el) el.style.display = types.includes(type) ? '' : 'none';
  });

  // Label adjustments
  const tLabel = document.getElementById('fdnx-wiz-target-label');
  if (tLabel) tLabel.textContent = { github:'GitHub Pages URL', fetch:'Fetch URL', redirect:'Redirect URL' }[type] || 'Target URL';

  const cLabel = document.getElementById('fdnx-wiz-content-label');
  if (cLabel) cLabel.textContent = { html_base64:'Base64-Encoded HTML', html_uri:'URI-Encoded HTML' }[type] || 'HTML Content';

  // Hints
  const tHint = document.getElementById('fdnx-wiz-target-hint');
  if (tHint) tHint.textContent = {
    github: 'e.g. https://username.github.io/repo  —  you can also use  username/repo  or  username.github.io/repo',
    fetch:  'The page is fetched and served as a blob — same-origin and CORS-enabled URLs work best',
    redirect: 'URL to load inside the iframe frame. The browser address bar will show your custom match domain instead.',
  }[type] || '';

  const mHint = document.getElementById('fdnx-wiz-match-hint');
  if (mHint) mHint.textContent = 'Any URL or custom protocol — e.g.  http://mygame.io   game://run   myapp://home';

  // Image preview section
  const imgWrap = document.getElementById('fdnx-wiz-img-preview-wrap');
  if (imgWrap) imgWrap.style.display = type === 'image' ? '' : 'none';

  fdnxWizUpdatePreview();
}

// ── WIZARD LIVE PREVIEW ────────────────────────────────────────
function fdnxWizUpdatePreview() {
  const type    = document.getElementById('fdnx-wiz-type')?.value || 'redirect';
  const match   = document.getElementById('fdnx-wiz-match')?.value?.trim() || '';
  const display = document.getElementById('fdnx-wiz-display')?.value?.trim() || '';
  const tabTitle= document.getElementById('fdnx-wiz-tabTitle')?.value?.trim() || '';
  const tabFav  = document.getElementById('fdnx-wiz-tabFavicon')?.value?.trim() || '';
  const tabImg  = document.getElementById('fdnx-wiz-tabImage')?.value?.trim() || '';
  const pw      = document.getElementById('fdnx-wiz-password')?.value?.trim() || '';
  const target  = (document.getElementById('fdnx-wiz-target')?.value?.trim() ||
                   document.getElementById('fdnx-wiz-local-path')?.value?.trim() ||
                   document.getElementById('fdnx-img-url-input')?.value?.trim() || '');
  const content = document.getElementById('fdnx-wiz-content')?.value || '';

  // Tab mock
  const title  = tabTitle || display || match || 'My Override';
  const fav    = tabFav || (TYPE_COLORS[type] ? (FDNX_TYPES.find(t=>t.id===type)?.icon||'🌐') : '🌐');

  const mockFav   = document.getElementById('fdnx-mock-fav');
  const mockTitle = document.getElementById('fdnx-mock-title');
  const mockUrl   = document.getElementById('fdnx-mock-url');
  const mockLock  = document.getElementById('fdnx-mock-lock');
  const tabMock   = document.getElementById('fdnx-tab-mock');

  if (mockTitle) mockTitle.textContent = title.slice(0,30);
  if (mockUrl)   mockUrl.textContent   = match || '(no match set)';
  if (mockLock)  mockLock.textContent  = (match.startsWith('https')||match.startsWith('spectral')||match.startsWith('local')) ? '🔒' : '🌐';

  // Favicon in tab mock
  if (mockFav) {
    if (tabFav && (tabFav.startsWith('http')||tabFav.startsWith('data:'))) {
      mockFav.innerHTML = `<img src="${_e(tabFav)}" style="width:14px;height:14px;object-fit:contain" onerror="this.outerHTML='🌐'">`;
    } else {
      mockFav.textContent = tabFav || (FDNX_TYPES.find(t=>t.id===type)?.icon || '🌐');
    }
  }

  // Tab background image
  if (tabMock) {
    if (tabImg) {
      tabMock.style.backgroundImage = `url(${tabImg})`;
      tabMock.style.backgroundSize  = 'cover';
    } else {
      tabMock.style.backgroundImage = '';
    }
  }

  // Build override object for JSON snippet
  const ovObj = { type, match };
  if (['redirect','github','fetch'].includes(type) && target)  ovObj.target  = target;
  if (['local'].includes(type)) {
    const lp = document.getElementById('fdnx-wiz-local-path')?.value?.trim();
    if (lp) ovObj.target = lp;
  }
  if (['image'].includes(type))   ovObj.content = fdnxBuildImageHTML();
  if (['folder'].includes(type))  ovObj.content = '(generated at save time)';
  if (['html','html_base64','html_uri'].includes(type)) {
    let c = content;
    if (type === 'html_base64') { try { c = btoa(unescape(encodeURIComponent(c))); } catch(_){} }
    if (type === 'html_uri')    { c = encodeURIComponent(c); }
    ovObj.content = c.length > 80 ? c.slice(0,77)+'…' : c;
  }
  if (display)   ovObj.display   = display;
  if (tabTitle)  ovObj.tabTitle  = tabTitle;
  if (tabFav)    ovObj.tabFavicon= tabFav;
  if (tabImg)    ovObj.tabImage  = tabImg;
  if (pw)        ovObj.password  = pw;

  const jsonEl = document.getElementById('fdnx-wiz-json');
  if (jsonEl) jsonEl.value = JSON.stringify(ovObj, null, 2);

  // Update favicon color dot on card border
  if (tabImg && tabMock) {
    tabMock.style.setProperty('--tab-mock-color', TYPE_COLORS[type]||'#444');
  }
}

function fdnxWizFavPreview(val) {
  const el = document.getElementById('fdnx-fav-preview');
  if (!el) return;
  if (val.startsWith('http')||val.startsWith('data:')) {
    el.innerHTML = `<img src="${_e(val)}" style="width:20px;height:20px;object-fit:contain" onerror="this.outerHTML='🌐'">`;
  } else {
    el.textContent = val || '🌐';
  }
  fdnxWizUpdatePreview();
}

// ── IMAGE TYPE HELPERS ─────────────────────────────────────────
let fdnxImgSourceMode = 'url';
function fdnxImgSourceTab(mode) {
  fdnxImgSourceMode = mode;
  ['url','local','upload'].forEach(m => {
    document.getElementById('fdnx-img-tab-'+m)?.classList.toggle('active', m===mode);
    document.getElementById('fdnx-img-'+m+'-wrap') && (document.getElementById('fdnx-img-'+m+'-wrap').style.display = m===mode&&m!=='url' ? '' : 'none');
  });
  document.getElementById('fdnx-img-url-input') && (document.getElementById('fdnx-img-url-input').style.display = mode==='url' ? '' : 'none');
  fdnxWizUpdatePreview();
}

function fdnxBuildImageHTML() {
  const src = fdnxImgSourceMode === 'local'
    ? ('local://' + (document.getElementById('fdnx-img-local-path')?.value?.trim()||''))
    : (document.getElementById('fdnx-img-url-input')?.value?.trim()||'');
  const bg  = document.getElementById('fdnx-img-bg-text')?.value || '#000000';
  const fit = document.getElementById('fdnx-img-fit')?.value || 'contain';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:${bg};display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden}img{max-width:100%;max-height:100%;object-fit:${fit}}</style></head><body><img src="${src.replace(/"/g,'&quot;')}" alt=""/></body></html>`;
}

function fdnxWizPickImageLocal() {
  fdnxShowLocalPicker(path => {
    if (document.getElementById('fdnx-img-local-path'))
      document.getElementById('fdnx-img-local-path').value = path;
    const prevImg = document.getElementById('fdnx-img-preview');
    if (prevImg) {
      const blob = window.SpectralFS.readUrl(path);
      if (blob) prevImg.src = blob;
    }
    fdnxWizUpdatePreview();
  }, f => f.mime.startsWith('image/'));
}

function fdnxWizUploadImage() { document.getElementById('fdnx-wiz-img-upload')?.click(); }

async function fdnxWizHandleImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const path = window.SpectralFS.normPath('/images/' + file.name);
  const buf  = await file.arrayBuffer();
  await window.SpectralFS.write(path, buf, file.type);
  if (document.getElementById('fdnx-img-local-path'))
    document.getElementById('fdnx-img-local-path').value = path;
  document.getElementById('fdnx-img-upload-hint').textContent = `✓ Saved to local://${path}`;
  fdnxImgSourceTab('local');
  e.target.value = '';
}

// ── LOCAL FILE PICKER ──────────────────────────────────────────
function fdnxShowLocalPicker(cb, filter) {
  const files = window.SpectralFS.list('/').filter(f => !filter || filter(f));
  const bg = document.createElement('div');
  bg.className = 'fdnx-modal-bg';
  const rows = files.map(f =>
    `<div class="fdnx-picker-item" data-path="${_ea(f.path)}">${_e(f.path)}<span style="color:#444;font-size:10px;margin-left:auto">${window.SpectralFS.formatSize(f.size)}</span></div>`
  ).join('') || '<div style="color:#333;padding:16px;font-size:12px;font-family:var(--font-mono)">No files in local:// filesystem</div>';
  bg.innerHTML = `
    <div class="fdnx-modal" onclick="event.stopPropagation()">
      <div class="fdnx-modal-title">📂 Open from local://</div>
      <input class="fdnx-modal-search" type="text" placeholder="Filter…"
        oninput="this.closest('.fdnx-modal').querySelectorAll('.fdnx-picker-item').forEach(e=>e.style.display=e.dataset.path.includes(this.value)?'':'none')"/>
      <div class="fdnx-picker-list">${rows}</div>
      <div class="fdnx-modal-actions"><button class="fdnx-btn" onclick="this.closest('.fdnx-modal-bg').remove()">Cancel</button></div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if(e.target===bg) bg.remove(); });
  bg.querySelectorAll('.fdnx-picker-item').forEach(el => {
    el.addEventListener('click', () => { cb(el.dataset.path); bg.remove(); });
  });
}

function fdnxWizPickLocal()  { fdnxShowLocalPicker(p => { const el=document.getElementById('fdnx-wiz-local-path'); if(el) el.value=p; fdnxWizUpdatePreview(); }); }
function fdnxWizPickFolder() {
  // Show directory picker
  const dirs = new Set();
  window.SpectralFS.list('/').forEach(f => {
    const parts = f.path.split('/').slice(0,-1);
    for (let i=1;i<=parts.length;i++) dirs.add(parts.slice(0,i).join('/') || '/');
  });
  const bg = document.createElement('div');
  bg.className = 'fdnx-modal-bg';
  const rows = [...dirs].sort().map(d =>
    `<div class="fdnx-picker-item" data-path="${_ea(d)}">📁 ${_e(d)}</div>`
  ).join('') || '<div style="color:#333;padding:16px;font-size:12px">No directories found</div>';
  bg.innerHTML = `
    <div class="fdnx-modal" onclick="event.stopPropagation()">
      <div class="fdnx-modal-title">📁 Select Directory</div>
      <div class="fdnx-picker-list">${rows}</div>
      <div class="fdnx-modal-actions"><button class="fdnx-btn" onclick="this.closest('.fdnx-modal-bg').remove()">Cancel</button></div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', e => { if(e.target===bg) bg.remove(); });
  bg.querySelectorAll('.fdnx-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const el2 = document.getElementById('fdnx-wiz-folder-path');
      if (el2) el2.value = el.dataset.path;
      bg.remove(); fdnxWizUpdatePreview();
    });
  });
}

// ── ZIP HANDLER ────────────────────────────────────────────────
function fdnxWizUploadZip() { document.getElementById('fdnx-zip-input')?.click(); }

async function fdnxWizHandleZip(e) {
  const file = e.target.files[0]; if (!file) return;
  const hint = document.getElementById('fdnx-zip-hint');
  if (hint) hint.textContent = 'Extracting…';

  // Load JSZip from CDN if not already present
  if (!window.JSZip) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  try {
    const buf  = await file.arrayBuffer();
    const zip  = await window.JSZip.loadAsync(buf);
    const base = '/zips/' + file.name.replace(/\.zip$/i,'').replace(/[^a-zA-Z0-9_-]/g,'_');
    let count  = 0;

    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      if (zipEntry.dir) continue;
      const data = await zipEntry.async('arraybuffer');
      const path = window.SpectralFS.normPath(base + '/' + relativePath);
      const mime = window.SpectralFS.mimeFromName(relativePath);
      await window.SpectralFS.write(path, data, mime);
      count++;
    }

    // Set the folder path in the wizard
    const fpEl = document.getElementById('fdnx-wiz-folder-path');
    if (fpEl) fpEl.value = base;
    if (hint) hint.textContent = `✓ Extracted ${count} file(s) to local://${base}`;
    fdnxWizUpdatePreview();
  } catch(err) {
    if (hint) hint.textContent = `✗ ZIP error: ${err.message}`;
  }
  e.target.value = '';
}

// ── HTML CONTENT HELPERS ───────────────────────────────────────
function fdnxWizImportFromEditor() {
  // Try to grab Monaco editor content if available
  if (window.monacoInstance && typeof window.monacoInstance.getValue === 'function') {
    const content = window.monacoInstance.getValue();
    const ta = document.getElementById('fdnx-wiz-content');
    if (ta) { ta.value = content; fdnxWizUpdatePreview(); fdnxToast('✓ Imported from Editor'); }
  } else {
    fdnxToast('⚠ Open spectral://editor and load a file first', 'warn');
  }
}

function fdnxWizImportHTMLFile() { document.getElementById('fdnx-html-file-input')?.click(); }

async function fdnxWizHandleHTMLFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  const ta   = document.getElementById('fdnx-wiz-content');
  if (ta) { ta.value = text; fdnxWizUpdatePreview(); }
  fdnxToast(`✓ Imported: ${file.name}`);
  e.target.value = '';
}

function fdnxWizImportLocalFile() {
  fdnxShowLocalPicker(async path => {
    const text = await window.SpectralFS.readText(path);
    const ta   = document.getElementById('fdnx-wiz-content');
    if (ta) { ta.value = text||''; fdnxWizUpdatePreview(); }
    fdnxToast(`✓ Loaded local://${path}`);
  });
}

function fdnxWizToBase64() {
  const ta = document.getElementById('fdnx-wiz-content');
  if (!ta?.value) return;
  const typeEl = document.getElementById('fdnx-wiz-type');
  try {
    ta.value = btoa(unescape(encodeURIComponent(ta.value)));
    if (typeEl) typeEl.value = 'html_base64';
    fdnxWizUpdateFields();
    fdnxToast('✓ Content encoded to Base64');
  } catch(e) { fdnxToast('✗ Encode failed: ' + e.message, 'err'); }
}

function fdnxWizFormatHTML() {
  const ta = document.getElementById('fdnx-wiz-content');
  if (!ta?.value) return;
  // Basic indent-based formatter (no external deps)
  try {
    let result = '', indent = 0;
    const tokens = ta.value.replace(/>\s*</g,'>\n<').split('\n');
    tokens.forEach(token => {
      const t = token.trim();
      if (!t) return;
      if (t.match(/^<\/[^>]+>/)) indent = Math.max(0, indent-1);
      result += '  '.repeat(indent) + t + '\n';
      if (t.match(/^<[^/!][^>]*[^/]>$/) && !t.match(/^<(br|hr|img|input|link|meta|area|base|col|embed|param|source|track|wbr)/i)) indent++;
    });
    ta.value = result;
    fdnxWizUpdatePreview();
  } catch(e) { fdnxToast('Format error: ' + e.message, 'err'); }
}

function fdnxWizPreview() {
  const content = document.getElementById('fdnx-wiz-content')?.value || '';
  if (!content) return;
  const blob = URL.createObjectURL(new Blob([content], {type:'text/html'}));
  if (typeof createTab === 'function') createTab(blob);
  else window.open(blob);
}

function fdnxWizCopyJson() {
  const val = document.getElementById('fdnx-wiz-json')?.value;
  if (val) navigator.clipboard.writeText(val).then(() => fdnxToast('✓ JSON copied'));
}

function fdnxWizTestNow() {
  const match = document.getElementById('fdnx-wiz-match')?.value?.trim();
  if (match && typeof navigateTo === 'function') navigateTo(match);
}

// ── SAVE OVERRIDE FROM WIZARD ──────────────────────────────────
async function fdnxWizSave() {
  const type      = document.getElementById('fdnx-wiz-type')?.value;
  const match     = document.getElementById('fdnx-wiz-match')?.value?.trim();
  const display   = document.getElementById('fdnx-wiz-display')?.value?.trim();
  const tabTitle  = document.getElementById('fdnx-wiz-tabTitle')?.value?.trim();
  const tabFav    = document.getElementById('fdnx-wiz-tabFavicon')?.value?.trim();
  const tabImg    = document.getElementById('fdnx-wiz-tabImage')?.value?.trim();
  const pw        = document.getElementById('fdnx-wiz-password')?.value?.trim();

  if (!match) { fdnxToast('⚠ Match URL is required', 'warn'); return; }
  if (!type)  { fdnxToast('⚠ Type is required', 'warn'); return; }

  const entry = { type, match };

  // Type-specific fields
  if (['redirect','github','fetch'].includes(type)) {
    const target = document.getElementById('fdnx-wiz-target')?.value?.trim();
    if (!target) { fdnxToast('⚠ Target URL is required for ' + type, 'warn'); return; }
    // Normalize GitHub URL
    if (type === 'github') {
      entry.target = target.includes('://') ? target : 'https://' + (target.includes('.github.io') ? target : target.replace('/','github.io/'));
    } else {
      entry.target = target;
    }
  }

  if (type === 'local') {
    const lp = document.getElementById('fdnx-wiz-local-path')?.value?.trim();
    if (!lp) { fdnxToast('⚠ Local path is required', 'warn'); return; }
    entry.target = lp;
  }

  if (['html','html_base64','html_uri'].includes(type)) {
    let content = document.getElementById('fdnx-wiz-content')?.value || '';
    if (!content) { fdnxToast('⚠ HTML content is required', 'warn'); return; }
    if (type === 'html_base64') { try { content = btoa(unescape(encodeURIComponent(content))); } catch(e) { fdnxToast('✗ Base64 encode failed', 'err'); return; } }
    if (type === 'html_uri')    { content = encodeURIComponent(content); }
    entry.content = content;
    entry.type = type;
  }

  if (type === 'image') {
    entry.type    = 'html';
    entry.content = fdnxBuildImageHTML();
  }

  if (type === 'folder') {
    const dirPath = document.getElementById('fdnx-wiz-folder-path')?.value?.trim();
    if (!dirPath) { fdnxToast('⚠ Folder path is required', 'warn'); return; }
    entry.type    = 'html';
    entry.content = fdnxBuildFolderIndex(dirPath, match);
    entry._folderPath = dirPath; // store for reference
  }

  if (display)   entry.display    = display;
  if (tabTitle)  entry.tabTitle   = tabTitle;
  if (tabFav)    entry.tabFavicon = tabFav;
  if (tabImg)    entry.tabImage   = tabImg;
  if (pw)        entry.password   = pw;

  // Save
  if (fdnxEditId) {
    window.SpectralLO.update(fdnxEditId, entry);
    fdnxToast('✓ Override updated');
  } else {
    window.SpectralLO.add(entry);
    fdnxToast('✓ Override saved');
  }

  document.querySelector('.fdnx-wizard-bg')?.remove();
  fdnxRenderList();
}

// ── FOLDER INDEX GENERATOR ─────────────────────────────────────
function fdnxBuildFolderIndex(dirPath, matchUrl) {
  const { files, dirs } = window.SpectralFS.listDir(dirPath);
  const dirItems = dirs.sort().map(d => {
    const name = d.split('/').pop();
    // Generate a sub-index for subdirectory — use the match with path appended
    return `<li class="dir"><a href="${_e(matchUrl + '/' + name)}">📁 ${_e(name)}/</a></li>`;
  });
  const fileItems = files.sort((a,b)=>a.name.localeCompare(b.name)).map(f => {
    const icon = f.mime.startsWith('image/')?' 🖼':f.mime.includes('html')?' 🌐':f.mime.startsWith('video/')?' 🎬':f.mime.startsWith('audio/')?' 🎵':' 📄';
    return `<li><a href="local://${_e(f.path)}">${icon} ${_e(f.name)}</a><span class="sz">${window.SpectralFS.formatSize(f.size)}</span></li>`;
  });
  const allItems = [...dirItems,...fileItems].join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${_e(dirPath)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#060606;color:#b0b0b0;font-family:'Share Tech Mono',monospace;padding:32px 40px}
h1{color:#00eeff;font-size:18px;letter-spacing:2px;margin-bottom:4px}
.path{color:#2a5a2a;font-size:12px;margin-bottom:24px}
ul{list-style:none}
li{display:flex;align-items:center;padding:7px 0;border-bottom:1px solid #0d0d0d;gap:10px}
li.dir a{color:#2a7a2a}
a{color:#888;text-decoration:none;flex:1;transition:color .15s}
a:hover{color:#00eeff}
.sz{color:#252525;font-size:11px;margin-left:auto}
</style></head>
<body>
<h1>📁 Index</h1>
<div class="path">${_e(dirPath)}</div>
<ul>${allItems||'<li style="color:#333">Empty directory</li>'}</ul>
</body></html>`;
}

// ── TOAST ──────────────────────────────────────────────────────
function fdnxToast(msg, type='ok') {
  let toast = document.getElementById('fdnx-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'fdnx-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className   = 'fdnx-toast fdnx-toast-' + type + ' fdnx-toast-show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('fdnx-toast-show'), 2800);
}

// ── HELPERS ────────────────────────────────────────────────────
function _e(s)  { return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _ea(s) { return _e(s); }

// ── CSS ────────────────────────────────────────────────────────
const FDNX_CSS = `
/* Root */
.fdnx-root{display:flex;flex-direction:column;height:100%;background:#060606;color:#c8c8c8;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}

/* Header */
.fdnx-header{display:flex;align-items:center;justify-content:space-between;padding:8px 18px;background:#030303;border-bottom:1px solid #111;flex-shrink:0;gap:8px;flex-wrap:wrap}
.fdnx-header-left{display:flex;align-items:center;gap:10px}
.fdnx-header-right{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.fdnx-logo{font-family:'Orbitron',sans-serif;font-size:12px;font-weight:900;letter-spacing:2px;background:linear-gradient(90deg,#00eeff,#00ff88,#0088ff,#ff00cc);-webkit-background-clip:text;-webkit-text-fill-color:transparent;white-space:nowrap}
.fdnx-tagline{font-family:'Share Tech Mono',monospace;font-size:10px;color:#1e3a1e;letter-spacing:2px}

/* Buttons */
.fdnx-btn{background:transparent;border:1px solid #1e1e1e;border-radius:4px;color:#666;font-size:11px;font-family:inherit;padding:5px 12px;cursor:pointer;transition:all .15s;white-space:nowrap}
.fdnx-btn:hover{border-color:#444;color:#ccc}
.fdnx-btn-primary{border-color:var(--cyan,#00eeff);color:var(--cyan,#00eeff)}
.fdnx-btn-primary:hover{background:rgba(0,238,255,.08)}
.fdnx-btn-cyan{border-color:#00ff88;color:#00ff88}
.fdnx-btn-cyan:hover{background:rgba(0,255,136,.06)}
.fdnx-btn-dim{border-color:#111;color:#333}
.fdnx-btn-dim:hover{border-color:#333;color:#888}

/* Filter bar */
.fdnx-filterbar{display:flex;align-items:center;gap:10px;padding:8px 18px;background:#040404;border-bottom:1px solid #0d0d0d;flex-shrink:0;flex-wrap:wrap}
.fdnx-search{background:#080808;border:1px solid #1a1a1a;border-radius:6px;color:#c8c8c8;font-size:12px;font-family:inherit;padding:6px 12px;outline:none;min-width:220px;flex:1;max-width:320px;transition:border-color .15s}
.fdnx-search:focus{border-color:#00eeff}
.fdnx-type-chips{display:flex;gap:5px;flex-wrap:wrap}
.fdnx-chip{font-size:10px;font-family:'Share Tech Mono',monospace;padding:3px 10px;border-radius:12px;border:1px solid #1a1a1a;color:#444;cursor:pointer;transition:all .15s;white-space:nowrap}
.fdnx-chip:hover{border-color:#444;color:#888}
.fdnx-chip.active{border-color:#00eeff;color:#00eeff;background:rgba(0,238,255,.06)}
.fdnx-chip-all.active{border-color:#00ff88;color:#00ff88;background:rgba(0,255,136,.05)}

/* Stats bar */
.fdnx-statsbar{display:flex;align-items:center;gap:10px;padding:5px 18px;background:#030303;border-bottom:1px solid #080808;flex-shrink:0;font-size:11px;font-family:'Share Tech Mono',monospace;flex-wrap:wrap}
.fdnx-stat-label{color:#2a2a2a}
.fdnx-stat-label b{color:#444}
.fdnx-stat-chip{padding:1px 8px;border-radius:10px;border:1px solid;font-size:9px;letter-spacing:.5px}

/* Body */
.fdnx-body{flex:1;display:flex;overflow:hidden;gap:0}
.fdnx-list-col{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.fdnx-json-col{width:300px;flex-shrink:0;display:flex;flex-direction:column;background:#030303;border-left:1px solid #0d0d0d}
.fdnx-json-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid #0d0d0d;flex-shrink:0}
.fdnx-json-title{font-size:10px;font-family:'Orbitron',sans-serif;letter-spacing:2px;color:#333}
.fdnx-json-textarea{flex:1;background:#030303;border:none;color:#1e5a1e;font-family:'Share Tech Mono',monospace;font-size:10px;padding:12px 14px;outline:none;resize:none;line-height:1.6}

/* Override cards */
.fdnx-card{background:#080808;border:1px solid #141414;border-radius:8px;padding:12px 14px;display:grid;grid-template-columns:90px 1fr auto;gap:10px;align-items:start;transition:border-color .15s;position:relative}
.fdnx-card:hover{border-color:#222}
.fdnx-card-local{border-left:2px solid #00eeff22}
.fdnx-card-local:hover{border-left-color:#00eeff55}
.fdnx-card-type{font-size:10px;font-family:'Share Tech Mono',monospace;padding:3px 7px;border-radius:10px;border:1px solid;text-align:center;letter-spacing:.5px;line-height:1.4;align-self:start;white-space:nowrap}
.fdnx-card-body{display:flex;flex-direction:column;gap:3px;min-width:0}
.fdnx-card-match{font-family:'Share Tech Mono',monospace;font-size:13px;color:#c8c8c8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdnx-card-target{font-family:'Share Tech Mono',monospace;font-size:11px;color:#444;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdnx-card-display{font-size:11px;color:#2a5a2a;letter-spacing:.3px}
.fdnx-card-meta{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}
.fdnx-meta-badge{font-size:9px;font-family:'Share Tech Mono',monospace;padding:1px 6px;border-radius:8px;border:1px solid #1e3a1e;color:#2a5a2a;background:#030f03}
.fdnx-meta-pw{border-color:#3a1e1e;color:#5a2a2a;background:#0f0303}
.fdnx-card-actions{display:flex;flex-direction:column;gap:4px;align-items:flex-end}
.fdnx-action-btn{background:transparent;border:1px solid #1a1a1a;border-radius:4px;color:#444;font-size:10px;font-family:inherit;padding:3px 9px;cursor:pointer;transition:all .12s;white-space:nowrap}
.fdnx-action-btn:hover{border-color:#00eeff;color:#00eeff}
.fdnx-action-del:hover{border-color:var(--r,#ff0040)!important;color:var(--r,#ff0040)!important}
.fdnx-src-tag{font-size:9px;font-family:'Share Tech Mono',monospace;color:#1a1a1a;margin-top:2px;padding:1px 6px;border-radius:8px;background:#0a0a0a;border:1px solid #111}
.fdnx-empty{color:#1e1e1e;font-family:'Share Tech Mono',monospace;font-size:13px;text-align:center;padding:48px 20px}

/* Wizard */
.fdnx-wizard-bg{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:10000;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px}
.fdnx-wizard{background:#080808;border:1px solid #252525;border-radius:12px;width:980px;max-width:98vw;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 0 60px rgba(0,238,255,.07),0 30px 80px rgba(0,0,0,.95);overflow:hidden}
.fdnx-wiz-title{font-family:'Orbitron',sans-serif;font-size:14px;color:#00eeff;letter-spacing:3px;padding:18px 22px 14px;border-bottom:1px solid #111;flex-shrink:0}
.fdnx-wiz-cols{display:grid;grid-template-columns:1fr 320px;flex:1;overflow:hidden}
.fdnx-wiz-left{overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:8px;border-right:1px solid #0d0d0d}
.fdnx-wiz-right{overflow-y:auto;padding:16px;background:#040404;display:flex;flex-direction:column;gap:6px}
.fdnx-wiz-footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 20px;border-top:1px solid #111;flex-shrink:0;background:#030303}
.fdnx-wiz-section{font-size:10px;font-family:'Share Tech Mono',monospace;color:#1e3a1e;letter-spacing:3px;text-transform:uppercase;padding:10px 0 2px;border-top:1px solid #0d0d0d;margin-top:4px}
.fdnx-wiz-section:first-child{border-top:none;margin-top:0}
.fdnx-optional{color:#111;letter-spacing:1px}
.fdnx-form-row{display:flex;flex-direction:column;gap:4px}
.fdnx-label{font-size:10px;font-family:'Share Tech Mono',monospace;color:#2a5a2a;letter-spacing:1px;text-transform:uppercase}
.fdnx-input{background:#080808;border:1px solid #1a1a1a;border-radius:4px;color:#c8c8c8;font-family:'Share Tech Mono',monospace;font-size:12px;padding:7px 10px;outline:none;width:100%;transition:border-color .15s}
.fdnx-input:focus{border-color:#00eeff}
.fdnx-select{cursor:pointer;font-size:12px}
.fdnx-textarea{min-height:150px;resize:vertical;line-height:1.5;font-size:12px}
.fdnx-hint{font-size:10px;font-family:'Share Tech Mono',monospace;color:#1e3a1e;line-height:1.5;margin-top:2px}
.fdnx-content-toolbar{display:flex;gap:5px;flex-wrap:wrap;padding:6px 0}
.fdnx-tbtn{background:transparent;border:1px solid #181818;border-radius:4px;color:#444;font-size:10px;font-family:inherit;padding:4px 9px;cursor:pointer;transition:all .15s;white-space:nowrap}
.fdnx-tbtn:hover{border-color:#00eeff;color:#00eeff}
.fdnx-tbtn.active{border-color:#00ff88;color:#00ff88}
.fdnx-img-source-tabs{display:flex;gap:4px;margin-bottom:6px}

/* Tab mock in wizard */
.fdnx-wiz-preview-title{font-size:10px;font-family:'Share Tech Mono',monospace;color:#2a5a2a;letter-spacing:2px;text-transform:uppercase}
.fdnx-tab-mock{display:flex;align-items:center;gap:6px;background:#0a0a0a;border:1px solid #1e1e1e;border-bottom:none;border-radius:6px 6px 0 0;padding:6px 10px;font-size:12px;margin-top:4px;min-width:0;overflow:hidden;background-size:cover;background-position:center;position:relative}
.fdnx-tab-mock::before{content:'';position:absolute;inset:0;background:rgba(0,0,0,.5);border-radius:6px 6px 0 0;pointer-events:none}
.fdnx-tab-mock-fav,.fdnx-tab-mock-title,.fdnx-tab-mock-close{position:relative;z-index:1}
.fdnx-tab-mock-title{color:#c8c8c8;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:inherit}
.fdnx-tab-mock-close{color:#333;font-size:10px}
.fdnx-urlbar-mock{display:flex;align-items:center;gap:8px;background:#0a0a0a;border:1px solid #1e1e1e;border-radius:0 0 4px 4px;padding:5px 10px;font-family:'Share Tech Mono',monospace;font-size:11px}
.fdnx-lock{font-size:12px}
.fdnx-mock-url{color:#2a5a2a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdnx-json-snippet{background:#030303;border:1px solid #111;border-radius:4px;color:#1e5a1e;font-family:'Share Tech Mono',monospace;font-size:10px;padding:8px 10px;outline:none;resize:none;min-height:160px;width:100%;line-height:1.6;margin-top:4px}
.fdnx-img-preview-box{background:#040404;border:1px solid #111;border-radius:4px;padding:8px;display:flex;align-items:center;justify-content:center;min-height:80px}

/* Modals */
.fdnx-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:10001;display:flex;align-items:center;justify-content:center}
.fdnx-modal{background:#080808;border:1px solid #252525;border-radius:10px;padding:22px;width:520px;max-width:95vw;max-height:82vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 0 40px rgba(0,238,255,.07)}
.fdnx-modal-title{font-family:'Orbitron',sans-serif;font-size:13px;color:#00eeff;letter-spacing:2px}
.fdnx-modal-desc{font-size:12px;color:#333;line-height:1.5}
.fdnx-modal-desc code{color:#2a5a2a;background:#040404;padding:1px 5px;border-radius:3px}
.fdnx-modal-textarea{background:#040404;border:1px solid #1a1a1a;border-radius:4px;color:#888;font-family:'Share Tech Mono',monospace;font-size:11px;padding:10px;outline:none;resize:vertical;min-height:120px;width:100%}
.fdnx-modal-textarea:focus{border-color:#00eeff}
.fdnx-modal-search{background:#060606;border:1px solid #1a1a1a;border-radius:4px;color:#c8c8c8;font-family:'Share Tech Mono',monospace;font-size:12px;padding:7px 10px;outline:none;width:100%}
.fdnx-modal-search:focus{border-color:#00eeff}
.fdnx-picker-list{flex:1;overflow-y:auto;max-height:300px;display:flex;flex-direction:column;gap:2px}
.fdnx-picker-item{display:flex;align-items:center;padding:7px 10px;border-radius:4px;cursor:pointer;font-family:'Share Tech Mono',monospace;font-size:11px;color:#666;transition:all .1s;gap:8px}
.fdnx-picker-item:hover{background:#0a0a0a;color:#ccc}
.fdnx-modal-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}

/* Toast */
.fdnx-toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#0a0a0a;border:1px solid #252525;border-radius:8px;padding:9px 20px;font-family:'Share Tech Mono',monospace;font-size:12px;color:#00ff88;pointer-events:none;opacity:0;transition:all .25s;z-index:99999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.8)}
.fdnx-toast-show{opacity:1;transform:translateX(-50%) translateY(0)}
.fdnx-toast-warn{color:#ffcc00;border-color:#3a3a00}
.fdnx-toast-err{color:#ff0040;border-color:#3a0010}
`;

// ── PUBLIC API ─────────────────────────────────────────────────
window.SpectralFDNX = { render: renderFDNX };

// Bridge: expose jsonOverrides to FDNX stats
Object.defineProperty(window, '_spectralJsonOverrides', {
  get() { return typeof jsonOverrides !== 'undefined' ? jsonOverrides : []; },
  configurable: true,
});

console.log('[Spectral] FreeDNX Studio loaded — spectral://FDNX ready');
