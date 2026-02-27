// ═══════════════════════════════════════════════════════════════
// SPECTRAL.EXE — Editor Engine  (spectral://editor)
// spectral-editor.js  —  load AFTER spectral-fs.js, BEFORE spectral.js
//
// Embeds the real Monaco Editor (same as VS Code) via CDN.
// Includes: code editor (20 languages), image editor, file manager,
//           import/export, copy, local:// FS integration.
// ═══════════════════════════════════════════════════════════════
'use strict';

const MONACO_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs';

// ── SUPPORTED LANGUAGES ────────────────────────────────────────
const EDITOR_LANGS = [
  { id: 'html',        label: 'HTML',        ext: '.html'  },
  { id: 'css',         label: 'CSS',         ext: '.css'   },
  { id: 'javascript',  label: 'JavaScript',  ext: '.js'    },
  { id: 'typescript',  label: 'TypeScript',  ext: '.ts'    },
  { id: 'json',        label: 'JSON',        ext: '.json'  },
  { id: 'python',      label: 'Python',      ext: '.py'    },
  { id: 'rust',        label: 'Rust',        ext: '.rs'    },
  { id: 'cpp',         label: 'C++',         ext: '.cpp'   },
  { id: 'c',           label: 'C',           ext: '.c'     },
  { id: 'java',        label: 'Java',        ext: '.java'  },
  { id: 'csharp',      label: 'C#',          ext: '.cs'    },
  { id: 'go',          label: 'Go',          ext: '.go'    },
  { id: 'php',         label: 'PHP',         ext: '.php'   },
  { id: 'ruby',        label: 'Ruby',        ext: '.rb'    },
  { id: 'shell',       label: 'Shell',       ext: '.sh'    },
  { id: 'sql',         label: 'SQL',         ext: '.sql'   },
  { id: 'xml',         label: 'XML',         ext: '.xml'   },
  { id: 'yaml',        label: 'YAML',        ext: '.yaml'  },
  { id: 'markdown',    label: 'Markdown',    ext: '.md'    },
  { id: 'plaintext',   label: 'Plain Text',  ext: '.txt'   },
];

// Language detection from file extension
function langFromExt(filename) {
  const ext = '.' + (filename.split('.').pop() || '').toLowerCase();
  return EDITOR_LANGS.find(l => l.ext === ext)?.id || 'plaintext';
}
function langFromMime(mime = '') {
  if (mime.includes('html'))       return 'html';
  if (mime.includes('css'))        return 'css';
  if (mime.includes('javascript')) return 'javascript';
  if (mime.includes('typescript')) return 'typescript';
  if (mime.includes('json'))       return 'json';
  if (mime.includes('python'))     return 'python';
  if (mime.includes('markdown'))   return 'markdown';
  if (mime.includes('xml'))        return 'xml';
  if (mime.includes('yaml'))       return 'yaml';
  if (mime.includes('x-sh') || mime.includes('bash')) return 'shell';
  return 'plaintext';
}

// ── STATE ──────────────────────────────────────────────────────
let monacoInstance  = null; // the Monaco editor instance
let monacoLoaded    = false;
let monacoLoading   = false;
let editorTabId     = null;
let editorRootEl    = null;

let currentFilePath = null;  // local:// path if editing saved file
let currentFileOrig = '';    // original content for dirty tracking
let imageEditorActive = false;

// ── LOAD MONACO ────────────────────────────────────────────────
function loadMonaco(callback) {
  if (monacoLoaded && window.monaco) { callback(); return; }
  if (monacoLoading) { window.addEventListener('spectral:monaco:ready', callback, { once: true }); return; }
  monacoLoading = true;

  // Monaco requires AMD loader
  const loaderScript = document.createElement('script');
  loaderScript.src = MONACO_CDN + '/loader.min.js';
  loaderScript.onload = () => {
    window.require.config({ paths: { vs: MONACO_CDN } });
    window.require(['vs/editor/editor.main'], () => {
      // Apply VS Code dark+ theme override to match Spectral aesthetic
      window.monaco.editor.defineTheme('spectral-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: '',              foreground: 'c8c8c8', background: '060606' },
          { token: 'comment',       foreground: '3a5a3a', fontStyle: 'italic' },
          { token: 'keyword',       foreground: '00eeff', fontStyle: 'bold' },
          { token: 'string',        foreground: '00ff88' },
          { token: 'number',        foreground: 'ff00cc' },
          { token: 'type',          foreground: '00ccff' },
          { token: 'function',      foreground: 'ffcc00' },
          { token: 'variable',      foreground: 'e0e0e0' },
          { token: 'operator',      foreground: 'ff0066' },
          { token: 'tag',           foreground: '00eeff' },
          { token: 'attribute.name',foreground: 'ffcc00' },
          { token: 'attribute.value',foreground:'00ff88' },
          { token: 'delimiter',     foreground: '555555' },
        ],
        colors: {
          'editor.background':           '#060606',
          'editor.foreground':           '#c8c8c8',
          'editorLineNumber.foreground': '#2a2a2a',
          'editorLineNumber.activeForeground': '#00eeff',
          'editor.lineHighlightBackground': '#0a0a0a',
          'editor.selectionBackground':  '#00eeff22',
          'editorCursor.foreground':     '#00eeff',
          'editor.findMatchBackground':  '#00ff4422',
          'editor.findMatchHighlightBackground': '#00ff4411',
          'editorWidget.background':     '#080808',
          'editorWidget.border':         '#1e1e1e',
          'input.background':            '#0a0a0a',
          'input.foreground':            '#c8c8c8',
          'input.border':                '#252525',
          'focusBorder':                 '#00eeff',
          'list.activeSelectionBackground': '#0d1a1a',
          'list.hoverBackground':        '#0a0a0a',
          'scrollbarSlider.background':  '#1a1a1a',
          'scrollbarSlider.hoverBackground': '#2a2a2a',
          'minimap.background':          '#040404',
          'breadcrumb.background':       '#030303',
          'statusBar.background':        '#030303',
          'statusBar.foreground':        '#333333',
          'tab.activeBackground':        '#060606',
          'tab.inactiveBackground':      '#030303',
          'tab.border':                  '#111111',
        }
      });
      window.monaco.editor.setTheme('spectral-dark');
      monacoLoaded  = true;
      monacoLoading = false;
      window.dispatchEvent(new Event('spectral:monaco:ready'));
      callback();
    });
  };
  loaderScript.onerror = () => {
    console.error('[Spectral Editor] Failed to load Monaco from CDN');
    monacoLoading = false;
  };
  document.head.appendChild(loaderScript);
}

// ── RENDER EDITOR PAGE ─────────────────────────────────────────
function renderEditor(tabId, el) {
  editorTabId  = tabId;
  editorRootEl = el;
  if (typeof updateTabMeta === 'function') updateTabMeta(tabId, 'Editor — Spectral.exe', '📝');

  // Inject CSS once
  if (!document.getElementById('sed-style')) {
    const s = document.createElement('style');
    s.id = 'sed-style';
    s.textContent = EDITOR_CSS;
    document.head.appendChild(s);
  }

  el.innerHTML = `
<div class="sed-root" id="sed-root">

  <!-- ── TOP BAR ── -->
  <div class="sed-topbar">
    <div class="sed-topbar-left">
      <span class="sed-logo">📝 SPECTRAL EDITOR</span>
      <div class="sed-tab-btns" id="sed-mode-btns">
        <button class="sed-tab-btn active" id="sed-btn-code"  onclick="sedSwitchMode('code')">⌨ Code</button>
        <button class="sed-tab-btn"        id="sed-btn-image" onclick="sedSwitchMode('image')">🖼 Image</button>
      </div>
    </div>
    <div class="sed-topbar-right">
      <!-- Code toolbar -->
      <div id="sed-code-toolbar" class="sed-toolbar">
        <select class="sed-select" id="sed-lang" onchange="sedSetLang(this.value)" title="Language">
          ${EDITOR_LANGS.map(l => `<option value="${l.id}">${l.label}</option>`).join('')}
        </select>
        <button class="sed-btn" onclick="sedNew()"           title="New file">📄 New</button>
        <button class="sed-btn" onclick="sedOpenLocal()"     title="Open from local:// filesystem">📂 Open</button>
        <button class="sed-btn" onclick="sedImportFile()"    title="Upload file from device">⬆ Import</button>
        <button class="sed-btn sed-btn-cyan" onclick="sedCopy()"    title="Copy all code to clipboard">📋 Copy</button>
        <button class="sed-btn sed-btn-cyan" onclick="sedSaveLocal()" title="Save to local:// filesystem">💾 Save</button>
        <button class="sed-btn" onclick="sedExport()"        title="Download as file">⬇ Export</button>
        <button class="sed-btn" onclick="sedPreview()"       title="Preview HTML in new tab">👁 Preview</button>
        <button class="sed-btn sed-btn-dim" onclick="sedFormat()"  title="Format document">✨ Format</button>
        <input type="file" id="sed-import-input" style="display:none" onchange="sedHandleImport(event)"/>
      </div>
      <!-- Image toolbar (hidden until image mode) -->
      <div id="sed-image-toolbar" class="sed-toolbar" style="display:none">
        <button class="sed-btn" onclick="sedImgUpload()"    title="Upload image">⬆ Upload</button>
        <button class="sed-btn" onclick="sedImgOpenLocal()" title="Open from local://">📂 Open</button>
        <button class="sed-btn sed-btn-cyan" onclick="sedImgCopy()"    title="Copy image to clipboard">📋 Copy</button>
        <button class="sed-btn sed-btn-cyan" onclick="sedImgSave()"    title="Save to local://">💾 Save</button>
        <button class="sed-btn" onclick="sedImgExport()"   title="Download image">⬇ Export</button>
        <button class="sed-btn sed-btn-dim" onclick="sedImgReset()"   title="Reset to original">↩ Reset</button>
        <input type="file" id="sed-img-input" style="display:none" accept="image/*" onchange="sedHandleImageUpload(event)"/>
      </div>
    </div>
  </div>

  <!-- ── FILE INFO BAR ── -->
  <div class="sed-infobar" id="sed-infobar">
    <span id="sed-file-label">Untitled</span>
    <span id="sed-dirty-badge" class="sed-dirty-badge" style="display:none">● unsaved</span>
    <span class="sed-infobar-sep"></span>
    <span id="sed-cursor-pos" class="sed-cursor-pos">Ln 1, Col 1</span>
    <span id="sed-char-count" class="sed-char-count">0 chars</span>
  </div>

  <!-- ── MAIN CONTENT ── -->
  <div class="sed-body">

    <!-- Code panel -->
    <div class="sed-panel" id="sed-code-panel">
      <!-- Local file browser sidebar -->
      <div class="sed-sidebar" id="sed-sidebar">
        <div class="sed-sidebar-header">
          <span class="sed-sidebar-title">FILES</span>
          <button class="sed-sidebar-toggle" onclick="sedToggleSidebar()" title="Hide sidebar">◀</button>
        </div>
        <div class="sed-fs-tree" id="sed-fs-tree"></div>
      </div>
      <!-- Monaco container -->
      <div class="sed-monaco-wrap" id="sed-monaco-wrap">
        <div class="sed-monaco-loading" id="sed-monaco-loading">
          <div class="sed-spinner"></div>
          <div>Loading Monaco Editor…</div>
        </div>
        <div id="sed-monaco" style="width:100%;height:100%;display:none"></div>
      </div>
    </div>

    <!-- Image editor panel -->
    <div class="sed-panel" id="sed-image-panel" style="display:none">
      <div class="sed-img-sidebar">
        <div class="sed-sidebar-title" style="padding:12px 14px 8px">ADJUSTMENTS</div>

        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Brightness</div>
          <input type="range" class="sed-slider" id="img-brightness" min="-100" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-brightness-val">0</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Contrast</div>
          <input type="range" class="sed-slider" id="img-contrast" min="-100" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-contrast-val">0</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Saturation</div>
          <input type="range" class="sed-slider" id="img-saturation" min="-100" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-saturation-val">0</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Hue Rotate</div>
          <input type="range" class="sed-slider" id="img-hue" min="0" max="360" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-hue-val">0°</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Blur</div>
          <input type="range" class="sed-slider" id="img-blur" min="0" max="20" value="0" step="0.5" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-blur-val">0</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Sharpen</div>
          <input type="range" class="sed-slider" id="img-sharpen" min="0" max="5" value="0" step="0.1" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-sharpen-val">0</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Opacity</div>
          <input type="range" class="sed-slider" id="img-opacity" min="0" max="100" value="100" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-opacity-val">100%</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Sepia</div>
          <input type="range" class="sed-slider" id="img-sepia" min="0" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-sepia-val">0%</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Grayscale</div>
          <input type="range" class="sed-slider" id="img-grayscale" min="0" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-grayscale-val">0%</span>
        </div>
        <div class="sed-img-tool-group">
          <div class="sed-img-tool-label">Invert</div>
          <input type="range" class="sed-slider" id="img-invert" min="0" max="100" value="0" oninput="sedImgApply()">
          <span class="sed-slider-val" id="img-invert-val">0%</span>
        </div>

        <div class="sed-sidebar-title" style="padding:12px 14px 8px">TRANSFORM</div>
        <div class="sed-img-btns">
          <button class="sed-img-btn" onclick="sedImgFlipH()">↔ Flip H</button>
          <button class="sed-img-btn" onclick="sedImgFlipV()">↕ Flip V</button>
          <button class="sed-img-btn" onclick="sedImgRotate(-90)">↺ -90°</button>
          <button class="sed-img-btn" onclick="sedImgRotate(90)">↻ +90°</button>
        </div>

        <div class="sed-sidebar-title" style="padding:12px 14px 8px">CROP / RESIZE</div>
        <div class="sed-img-crop-row">
          <input type="number" class="sed-num-input" id="img-width"  placeholder="W" title="Width"/>
          <span style="color:#333">×</span>
          <input type="number" class="sed-num-input" id="img-height" placeholder="H" title="Height"/>
          <button class="sed-img-btn" onclick="sedImgResize()">Apply</button>
        </div>

        <div class="sed-sidebar-title" style="padding:12px 14px 8px">EXPORT FORMAT</div>
        <div class="sed-img-btns">
          <select class="sed-select" id="img-format">
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/webp">WebP</option>
          </select>
          <input type="range" class="sed-slider" id="img-quality" min="0.1" max="1" value="0.92" step="0.01" style="width:80px" title="Quality (JPEG/WebP)">
        </div>
      </div>

      <div class="sed-img-canvas-wrap" id="sed-img-canvas-wrap">
        <div class="sed-img-drop" id="sed-img-drop">
          <div class="sed-img-drop-icon">🖼</div>
          <div class="sed-img-drop-text">Drop an image here, or use Upload / Open buttons above</div>
        </div>
        <canvas id="sed-canvas" style="display:none;max-width:100%;max-height:100%;object-fit:contain"></canvas>
      </div>
    </div>

  </div><!-- .sed-body -->

  <!-- ── STATUS BAR ── -->
  <div class="sed-statusbar" id="sed-statusbar">
    <span id="sed-status-msg">Ready</span>
    <span class="sed-status-right" id="sed-status-right">Spectral Editor v4.0</span>
  </div>

</div><!-- .sed-root -->`;

  // Load Monaco async
  loadMonaco(() => {
    const monacoEl  = document.getElementById('sed-monaco');
    const loadingEl = document.getElementById('sed-monaco-loading');
    if (!monacoEl) return;

    loadingEl.style.display = 'none';
    monacoEl.style.display  = 'block';

    monacoInstance = window.monaco.editor.create(monacoEl, {
      value:            '',
      language:         'html',
      theme:            'spectral-dark',
      automaticLayout:  true,
      fontSize:         14,
      fontFamily:       "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Share Tech Mono', Consolas, monospace",
      fontLigatures:    true,
      lineNumbers:      'on',
      minimap:          { enabled: true },
      wordWrap:         'off',
      scrollBeyondLastLine: false,
      smoothScrolling:  true,
      cursorBlinking:   'phase',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
      guides:           { bracketPairs: true, indentation: true },
      renderWhitespace: 'selection',
      formatOnPaste:    true,
      tabSize:          2,
      insertSpaces:     true,
      multiCursorModifier: 'alt',
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'smart',
      folding:          true,
      foldingStrategy:  'auto',
      renderLineHighlight: 'line',
      occurrencesHighlight: true,
      selectionHighlight: true,
      codeLens:         true,
      scrollbar: {
        vertical:   'auto',
        horizontal: 'auto',
        useShadows: false,
      },
    });

    // Track cursor position
    monacoInstance.onDidChangeCursorPosition(e => {
      const p = e.position;
      const el = document.getElementById('sed-cursor-pos');
      if (el) el.textContent = `Ln ${p.lineNumber}, Col ${p.column}`;
    });

    // Track content changes (dirty state)
    monacoInstance.onDidChangeModelContent(() => {
      const content = monacoInstance.getValue();
      const el = document.getElementById('sed-char-count');
      if (el) el.textContent = `${content.length} chars`;
      const dirty = document.getElementById('sed-dirty-badge');
      if (dirty) dirty.style.display = content !== currentFileOrig ? 'inline' : 'none';
    });

    // Register keyboard shortcuts
    monacoInstance.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyS, () => sedSaveLocal());
    monacoInstance.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyN, () => sedNew());
    monacoInstance.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.KeyO, () => sedOpenLocal());
    monacoInstance.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyMod.Shift | window.monaco.KeyCode.KeyC, () => sedCopy());

    // Set language select to match
    const langSel = document.getElementById('sed-lang');
    if (langSel) langSel.value = 'html';

    // Render sidebar
    sedRenderFsTree('/');
    sedStatus('Monaco Editor ready — Ctrl+S to save, Ctrl+N new, Ctrl+O open');
  });

  // Image drop zone
  const dropZone = document.getElementById('sed-img-canvas-wrap');
  if (dropZone) {
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('sed-img-drop-active'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('sed-img-drop-active'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('sed-img-drop-active');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) sedLoadImageFile(file);
    });
  }
}

// ── MODE SWITCHING ─────────────────────────────────────────────
function sedSwitchMode(mode) {
  const codePanel   = document.getElementById('sed-code-panel');
  const imagePanel  = document.getElementById('sed-image-panel');
  const codeToolbar = document.getElementById('sed-code-toolbar');
  const imgToolbar  = document.getElementById('sed-image-toolbar');
  const btnCode     = document.getElementById('sed-btn-code');
  const btnImg      = document.getElementById('sed-btn-image');

  if (mode === 'code') {
    codePanel.style.display   = '';
    imagePanel.style.display  = 'none';
    codeToolbar.style.display = '';
    imgToolbar.style.display  = 'none';
    btnCode.classList.add('active');
    btnImg.classList.remove('active');
    imageEditorActive = false;
    if (monacoInstance) setTimeout(() => monacoInstance.layout(), 50);
  } else {
    codePanel.style.display   = 'none';
    imagePanel.style.display  = '';
    codeToolbar.style.display = 'none';
    imgToolbar.style.display  = '';
    btnCode.classList.remove('active');
    btnImg.classList.add('active');
    imageEditorActive = true;
  }
}

// ── LANGUAGE CONTROL ───────────────────────────────────────────
function sedSetLang(langId) {
  if (!monacoInstance || !window.monaco) return;
  const model = monacoInstance.getModel();
  if (model) window.monaco.editor.setModelLanguage(model, langId);
  sedStatus(`Language: ${EDITOR_LANGS.find(l=>l.id===langId)?.label || langId}`);
}

// ── FILE OPERATIONS ────────────────────────────────────────────
function sedNew() {
  if (monacoInstance && monacoInstance.getValue() !== currentFileOrig) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  currentFilePath = null;
  currentFileOrig = '';
  if (monacoInstance) monacoInstance.setValue('');
  sedSetLabel('Untitled');
  sedStatus('New file created');
}

function sedSetLabel(name) {
  const el = document.getElementById('sed-file-label');
  if (el) el.textContent = name || 'Untitled';
}

function sedStatus(msg, cls = '') {
  const el = document.getElementById('sed-status-msg');
  if (!el) return;
  el.textContent  = msg;
  el.className    = cls;
}

// Open from local:// filesystem (shows modal picker)
function sedOpenLocal() {
  sedShowFilePicker(path => {
    sedLoadLocalFile(path);
  });
}

async function sedLoadLocalFile(path) {
  const info    = window.SpectralFS.info(path);
  if (!info) { sedStatus('File not found: ' + path, 'err'); return; }

  if (info.mime.startsWith('image/')) {
    sedSwitchMode('image');
    const blob = window.SpectralFS.read(path);
    if (blob) sedLoadImageBlob(blob, path);
    return;
  }

  const text = await window.SpectralFS.readText(path);
  if (text === null) { sedStatus('Could not read: ' + path, 'err'); return; }
  currentFilePath = path;
  currentFileOrig = text;
  if (monacoInstance) {
    monacoInstance.setValue(text);
    const lang = langFromMime(info.mime) || langFromExt(info.name);
    const langSel = document.getElementById('sed-lang');
    if (langSel) langSel.value = lang;
    sedSetLang(lang);
  }
  sedSetLabel(info.name + ' (local://)');
  sedStatus(`Opened: local://${path}`);
}

function sedImportFile() { document.getElementById('sed-import-input')?.click(); }

async function sedHandleImport(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.type.startsWith('image/')) {
    sedSwitchMode('image');
    sedLoadImageFile(file);
    e.target.value = ''; return;
  }
  const text = await file.text();
  currentFilePath = null;
  currentFileOrig = text;
  if (monacoInstance) {
    monacoInstance.setValue(text);
    const lang = langFromExt(file.name);
    const langSel = document.getElementById('sed-lang');
    if (langSel) langSel.value = lang;
    sedSetLang(lang);
  }
  sedSetLabel(file.name + ' (imported)');
  sedStatus(`Imported: ${file.name}`);
  e.target.value = '';
}

async function sedSaveLocal() {
  if (!monacoInstance) return;
  const content = monacoInstance.getValue();
  let path = currentFilePath;
  if (!path) {
    const langId  = document.getElementById('sed-lang')?.value || 'plaintext';
    const ext     = EDITOR_LANGS.find(l => l.id === langId)?.ext || '.txt';
    const input   = prompt('Save as path (e.g. /myfile' + ext + '):', '/untitled' + ext);
    if (!input?.trim()) return;
    path = window.SpectralFS.normPath(input.trim());
  }
  const langId  = document.getElementById('sed-lang')?.value || 'plaintext';
  const mime    = { javascript:'text/javascript', typescript:'text/typescript', html:'text/html', css:'text/css', json:'application/json', python:'text/x-python', markdown:'text/markdown', xml:'application/xml', yaml:'text/yaml', shell:'text/x-sh', sql:'text/x-sql', rust:'text/x-rustsrc', cpp:'text/x-c++src', c:'text/x-csrc', java:'text/x-java', csharp:'text/x-csharp', go:'text/x-go', php:'text/x-php', ruby:'text/x-ruby', plaintext:'text/plain' }[langId] || 'text/plain';
  await window.SpectralFS.write(path, content, mime);
  currentFilePath = path;
  currentFileOrig = content;
  const dirty = document.getElementById('sed-dirty-badge');
  if (dirty) dirty.style.display = 'none';
  sedSetLabel(path.split('/').pop() + ' (local://)');
  sedRenderFsTree('/');
  sedStatus(`✓ Saved: local://${path}`);
}

function sedExport() {
  if (!monacoInstance) return;
  const content = monacoInstance.getValue();
  const langId  = document.getElementById('sed-lang')?.value || 'plaintext';
  const ext     = EDITOR_LANGS.find(l => l.id === langId)?.ext || '.txt';
  const name    = (currentFilePath?.split('/').pop()) || ('untitled' + ext);
  const blob    = new Blob([content], { type: 'text/plain' });
  const a       = document.createElement('a');
  a.href        = URL.createObjectURL(blob);
  a.download    = name;
  a.click();
  sedStatus(`Exported: ${name}`);
}

function sedCopy() {
  if (!monacoInstance) return;
  navigator.clipboard.writeText(monacoInstance.getValue()).then(() => {
    sedStatus('✓ Copied to clipboard!');
    const btn = document.querySelector('.sed-btn-cyan');
    if (btn) { const orig = btn.textContent; btn.textContent = '✓ Copied!'; setTimeout(() => btn.textContent = orig, 1500); }
  });
}

function sedPreview() {
  if (!monacoInstance) return;
  const html    = monacoInstance.getValue();
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  if (typeof createTab === 'function') createTab(blobUrl);
  else window.open(blobUrl);
  sedStatus('Preview opened in new tab');
}

function sedFormat() {
  if (!monacoInstance) return;
  monacoInstance.getAction('editor.action.formatDocument')?.run();
  sedStatus('Document formatted');
}

// ── SIDEBAR TOGGLE ─────────────────────────────────────────────
let sidebarVisible = true;
function sedToggleSidebar() {
  sidebarVisible = !sidebarVisible;
  const sb  = document.getElementById('sed-sidebar');
  const btn = document.querySelector('.sed-sidebar-toggle');
  if (sb) sb.style.display = sidebarVisible ? '' : 'none';
  if (btn) btn.textContent = sidebarVisible ? '◀' : '▶';
  if (monacoInstance) setTimeout(() => monacoInstance.layout(), 50);
}

// ── FILESYSTEM TREE (sidebar) ──────────────────────────────────
let fsTreePath = '/';
function sedRenderFsTree(dirPath) {
  fsTreePath = dirPath || '/';
  const tree = document.getElementById('sed-fs-tree');
  if (!tree) return;

  const { files, dirs } = window.SpectralFS.listDir(fsTreePath);
  let html = '';

  if (fsTreePath !== '/') {
    const parent = fsTreePath.split('/').slice(0, -1).join('/') || '/';
    html += `<div class="sed-tree-item sed-tree-dir" onclick="sedRenderFsTree('${_se(parent)}')">📁 ..</div>`;
  }
  dirs.sort().forEach(d => {
    const name = d.split('/').pop();
    html += `<div class="sed-tree-item sed-tree-dir" onclick="sedRenderFsTree('${_se(d)}')">📁 ${_sh(name)}</div>`;
  });
  files.sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
    const icon = f.mime.startsWith('image/') ? '🖼' : '📄';
    html += `<div class="sed-tree-item" onclick="sedLoadLocalFile('${_se(f.path)}')" title="${_sh(f.path)}">${icon} ${_sh(f.name)}</div>`;
  });

  if (!html) html = '<div class="sed-tree-empty">No files</div>';

  // Show current path
  const pathHtml = `<div class="sed-tree-path">${_sh(fsTreePath)}</div>`;
  tree.innerHTML = pathHtml + html;
}

// ── FILE PICKER MODAL ──────────────────────────────────────────
function sedShowFilePicker(callback) {
  const bg = document.createElement('div');
  bg.className = 'sed-modal-bg';

  const files = window.SpectralFS.list('/');
  const rows  = files.map(f =>
    `<div class="sed-picker-item" data-path="${_se(f.path)}">${_sh(f.path)}<span style="color:#444;font-size:10px;margin-left:auto">${window.SpectralFS.formatSize(f.size)}</span></div>`
  ).join('') || '<div style="color:#333;padding:16px;font-size:12px">No files in local:// filesystem</div>';

  bg.innerHTML = `
    <div class="sed-modal" onclick="event.stopPropagation()">
      <div class="sed-modal-title">📂 Open from local://</div>
      <input type="text" class="sed-modal-search" id="sed-picker-search" placeholder="Filter files…" oninput="sedFilterPicker(this.value)"/>
      <div class="sed-picker-list" id="sed-picker-list">${rows}</div>
      <div class="sed-modal-actions">
        <button class="sed-btn" onclick="this.closest('.sed-modal-bg').remove()">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', () => bg.remove());
  bg.querySelectorAll('.sed-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      callback(el.dataset.path);
      bg.remove();
    });
  });
  document.getElementById('sed-picker-search')?.focus();
}

function sedFilterPicker(q) {
  document.querySelectorAll('.sed-picker-item').forEach(el => {
    el.style.display = el.dataset.path.toLowerCase().includes(q.toLowerCase()) ? '' : 'none';
  });
}

// ── IMAGE EDITOR ───────────────────────────────────────────────
let imgCanvas   = null;
let imgCtx      = null;
let imgOriginal = null; // ImageData of original
let imgFlipH    = false;
let imgFlipV    = false;
let imgRotDeg   = 0;
let imgCurrentBlob = null;

function sedImgUpload() { document.getElementById('sed-img-input')?.click(); }

function sedImgOpenLocal() {
  sedShowFilePicker(path => {
    const blob = window.SpectralFS.read(path);
    if (blob && blob.type.startsWith('image/')) { sedLoadImageBlob(blob, path); }
    else alert('Not an image file: ' + path);
  });
}

function sedHandleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  sedLoadImageFile(file);
  e.target.value = '';
}

function sedLoadImageFile(file) {
  const reader = new FileReader();
  reader.onload = ev => sedLoadImageSrc(ev.target.result, file.name);
  reader.readAsDataURL(file);
}

function sedLoadImageBlob(blob, path = '') {
  const url = URL.createObjectURL(blob);
  sedLoadImageSrc(url, path.split('/').pop() || 'image');
}

function sedLoadImageSrc(src, name = 'image') {
  const img = new Image();
  img.onload = () => {
    imgCanvas = document.getElementById('sed-canvas');
    imgCtx    = imgCanvas.getContext('2d');
    imgCanvas.width  = img.naturalWidth;
    imgCanvas.height = img.naturalHeight;
    imgCtx.drawImage(img, 0, 0);
    imgOriginal = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height);
    imgFlipH = false; imgFlipV = false; imgRotDeg = 0;
    // Store current blob for save
    imgCanvas.toBlob(b => { imgCurrentBlob = b; }, 'image/png');
    document.getElementById('sed-img-drop').style.display  = 'none';
    imgCanvas.style.display = 'block';
    // Reset sliders
    ['brightness','contrast','saturation','hue','blur','sharpen','opacity','sepia','grayscale','invert'].forEach(id => {
      const el = document.getElementById('img-' + id);
      if (el) el.value = id === 'opacity' ? 100 : 0;
    });
    sedImgUpdateVals();
    sedSetLabel(name + ' (image)');
    sedStatus(`Image loaded: ${img.naturalWidth}×${img.naturalHeight}px`);
  };
  img.src = src;
}

function sedImgUpdateVals() {
  const map = { brightness: v => v, contrast: v => v, saturation: v => v, hue: v => v+'°', blur: v => v, sharpen: v => v, opacity: v => v+'%', sepia: v => v+'%', grayscale: v => v+'%', invert: v => v+'%' };
  Object.keys(map).forEach(id => {
    const el  = document.getElementById('img-' + id);
    const val = document.getElementById('img-' + id + '-val');
    if (el && val) val.textContent = map[id](el.value);
  });
}

function sedImgApply() {
  if (!imgOriginal || !imgCtx || !imgCanvas) return;
  sedImgUpdateVals();

  const b   = Number(document.getElementById('img-brightness')?.value  || 0);
  const c   = Number(document.getElementById('img-contrast')?.value    || 0);
  const s   = Number(document.getElementById('img-saturation')?.value  || 0);
  const h   = Number(document.getElementById('img-hue')?.value         || 0);
  const bl  = Number(document.getElementById('img-blur')?.value        || 0);
  const sh  = Number(document.getElementById('img-sharpen')?.value     || 0);
  const op  = Number(document.getElementById('img-opacity')?.value     || 100);
  const sep = Number(document.getElementById('img-sepia')?.value       || 0);
  const gs  = Number(document.getElementById('img-grayscale')?.value   || 0);
  const inv = Number(document.getElementById('img-invert')?.value      || 0);

  // Build CSS filter string and apply via canvas filter API
  let filterStr = '';
  if (b  !== 0)   filterStr += ` brightness(${1 + b / 100})`;
  if (c  !== 0)   filterStr += ` contrast(${1 + c / 100})`;
  if (s  !== 0)   filterStr += ` saturate(${1 + s / 100})`;
  if (h  !== 0)   filterStr += ` hue-rotate(${h}deg)`;
  if (bl > 0)     filterStr += ` blur(${bl}px)`;
  if (op !== 100) filterStr += ` opacity(${op / 100})`;
  if (sep > 0)    filterStr += ` sepia(${sep / 100})`;
  if (gs > 0)     filterStr += ` grayscale(${gs / 100})`;
  if (inv > 0)    filterStr += ` invert(${inv / 100})`;

  // Sharpness via convolution kernel (manual pixel op)
  let srcData = imgOriginal;
  if (sh > 0) {
    srcData = applySharpness(imgOriginal, imgCanvas.width, imgCanvas.height, sh);
  }

  // Apply transforms then CSS filters
  imgCtx.save();
  imgCtx.clearRect(0, 0, imgCanvas.width, imgCanvas.height);
  imgCtx.filter = filterStr.trim() || 'none';

  imgCtx.setTransform(
    (imgFlipH ? -1 : 1), 0, 0,
    (imgFlipV ? -1 : 1),
    imgFlipH ? imgCanvas.width : 0,
    imgFlipV ? imgCanvas.height : 0
  );
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width  = imgCanvas.width;
  tmpCanvas.height = imgCanvas.height;
  tmpCanvas.getContext('2d').putImageData(srcData, 0, 0);
  imgCtx.drawImage(tmpCanvas, 0, 0);
  imgCtx.restore();

  // Rotation is applied via CSS transform for display
  const rot = imgRotDeg % 360;
  imgCanvas.style.transform = rot !== 0 ? `rotate(${rot}deg)` : '';
}

function applySharpness(imageData, w, h, amount) {
  const data = new Uint8ClampedArray(imageData.data);
  const src  = imageData.data;
  const k    = amount * 0.3;
  const kernel = [0, -k, 0, -k, 1 + 4*k, -k, 0, -k, 0];
  const out = new Uint8ClampedArray(data.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        v += src[(( y-1)*w+(x-1))*4+c] * kernel[0];
        v += src[(( y-1)*w+x  )*4+c] * kernel[1];
        v += src[(( y-1)*w+(x+1))*4+c] * kernel[2];
        v += src[(y  *w+(x-1))*4+c] * kernel[3];
        v += src[(y  *w+x  )*4+c] * kernel[4];
        v += src[(y  *w+(x+1))*4+c] * kernel[5];
        v += src[((y+1)*w+(x-1))*4+c] * kernel[6];
        v += src[((y+1)*w+x  )*4+c] * kernel[7];
        v += src[((y+1)*w+(x+1))*4+c] * kernel[8];
        out[i+c] = Math.min(255, Math.max(0, v));
      }
      out[i+3] = src[i+3];
    }
  }
  return new ImageData(out, w, h);
}

function sedImgFlipH() { imgFlipH = !imgFlipH; sedImgApply(); }
function sedImgFlipV() { imgFlipV = !imgFlipV; sedImgApply(); }

function sedImgRotate(deg) {
  imgRotDeg = (imgRotDeg + deg + 360) % 360;
  // For 90/270 rotations, swap canvas dimensions
  if (Math.abs(deg) === 90 && imgOriginal) {
    const tmpC = document.createElement('canvas');
    const [w, h] = [imgCanvas.width, imgCanvas.height];
    tmpC.width  = h; tmpC.height = w;
    const tmpX  = tmpC.getContext('2d');
    tmpX.translate(h / 2, w / 2);
    tmpX.rotate(deg * Math.PI / 180);
    tmpX.drawImage(imgCanvas, -w / 2, -h / 2);
    imgCanvas.width  = h;
    imgCanvas.height = w;
    imgCtx.drawImage(tmpC, 0, 0);
    imgOriginal = imgCtx.getImageData(0, 0, imgCanvas.width, imgCanvas.height);
    imgRotDeg = 0;
    imgCanvas.style.transform = '';
    sedStatus(`Rotated ${deg > 0 ? '+' : ''}${deg}°`);
    return;
  }
  sedImgApply();
}

function sedImgResize() {
  if (!imgCanvas || !imgCtx) return;
  const newW = Number(document.getElementById('img-width')?.value);
  const newH = Number(document.getElementById('img-height')?.value);
  if (!newW || !newH || newW < 1 || newH < 1) { alert('Enter valid width and height'); return; }
  const tmpC = document.createElement('canvas');
  tmpC.width = newW; tmpC.height = newH;
  tmpC.getContext('2d').drawImage(imgCanvas, 0, 0, newW, newH);
  imgCanvas.width  = newW;
  imgCanvas.height = newH;
  imgCtx.drawImage(tmpC, 0, 0);
  imgOriginal = imgCtx.getImageData(0, 0, newW, newH);
  sedStatus(`Resized to ${newW}×${newH}px`);
}

async function sedImgSave() {
  if (!imgCanvas) { alert('No image loaded'); return; }
  const format  = document.getElementById('img-format')?.value || 'image/png';
  const quality = Number(document.getElementById('img-quality')?.value || 0.92);
  const ext     = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[format] || '.png';

  imgCanvas.toBlob(async blob => {
    if (!blob) { alert('Failed to export image'); return; }
    const input = prompt('Save as path:', '/images/image' + ext);
    if (!input?.trim()) return;
    const path = window.SpectralFS.normPath(input.trim());
    const buf  = await blob.arrayBuffer();
    await window.SpectralFS.write(path, buf, format);
    sedStatus(`✓ Image saved: local://${path}`);
    sedSetLabel(path.split('/').pop() + ' (local://)');
  }, format, quality);
}

function sedImgExport() {
  if (!imgCanvas) { alert('No image loaded'); return; }
  const format  = document.getElementById('img-format')?.value || 'image/png';
  const quality = Number(document.getElementById('img-quality')?.value || 0.92);
  const ext     = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[format] || '.png';
  imgCanvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spectral-image' + ext;
    a.click();
  }, format, quality);
  sedStatus('Image exported');
}

function sedImgCopy() {
  if (!imgCanvas) { alert('No image loaded'); return; }
  imgCanvas.toBlob(async blob => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      sedStatus('✓ Image copied to clipboard');
    } catch(e) { sedStatus('Clipboard copy failed: ' + e.message, 'err'); }
  });
}

function sedImgReset() {
  if (!imgOriginal) return;
  imgCtx.putImageData(imgOriginal, 0, 0);
  imgFlipH = false; imgFlipV = false; imgRotDeg = 0;
  imgCanvas.style.transform = '';
  ['brightness','contrast','saturation','hue','blur','sharpen','sepia','grayscale','invert'].forEach(id => {
    const el = document.getElementById('img-' + id);
    if (el) el.value = 0;
  });
  const op = document.getElementById('img-opacity');
  if (op) op.value = 100;
  sedImgUpdateVals();
  sedStatus('Image reset to original');
}

// ── HELPERS ────────────────────────────────────────────────────
function _sh(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _se(s) { return String(s).replace(/'/g,"\\'"); }

// ── EDITOR CSS ─────────────────────────────────────────────────
const EDITOR_CSS = `
/* Root */
.sed-root { display:flex; flex-direction:column; height:100%; background:#060606; color:#c8c8c8; font-family:'Segoe UI',system-ui,sans-serif; overflow:hidden; }

/* Top bar */
.sed-topbar { display:flex; align-items:center; justify-content:space-between; padding:6px 12px; background:#030303; border-bottom:1px solid #111; flex-shrink:0; gap:8px; flex-wrap:wrap; min-height:44px; }
.sed-topbar-left { display:flex; align-items:center; gap:10px; }
.sed-topbar-right { display:flex; align-items:center; }
.sed-logo { font-family:'Orbitron',sans-serif; font-size:10px; font-weight:900; letter-spacing:2px; background:linear-gradient(90deg,#ff0040,#ff00cc,#0088ff,#00eeff); -webkit-background-clip:text; -webkit-text-fill-color:transparent; white-space:nowrap; flex-shrink:0; }
.sed-tab-btns { display:flex; gap:2px; }
.sed-tab-btn { background:transparent; border:1px solid #1e1e1e; border-radius:4px; color:#555; font-size:11px; font-family:inherit; padding:4px 12px; cursor:pointer; transition:all .15s; }
.sed-tab-btn:hover { border-color:#333; color:#999; }
.sed-tab-btn.active { border-color:var(--cyan,#00eeff); color:var(--cyan,#00eeff); background:rgba(0,238,255,.05); }
.sed-toolbar { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
.sed-btn { background:transparent; border:1px solid #1e1e1e; border-radius:4px; color:#666; font-size:11px; font-family:inherit; padding:4px 10px; cursor:pointer; transition:all .15s; white-space:nowrap; }
.sed-btn:hover { border-color:#444; color:#ccc; }
.sed-btn-cyan { border-color:#00eeff; color:#00eeff; }
.sed-btn-cyan:hover { background:rgba(0,238,255,.08); }
.sed-btn-dim { border-color:#111; color:#333; }
.sed-btn-dim:hover { border-color:#333; color:#888; }
.sed-select { background:#080808; border:1px solid #1e1e1e; border-radius:4px; color:#888; font-size:11px; font-family:'Share Tech Mono',monospace; padding:4px 8px; outline:none; cursor:pointer; }
.sed-select:focus { border-color:#00eeff; }

/* Info bar */
.sed-infobar { display:flex; align-items:center; gap:10px; padding:3px 14px; background:#030303; border-bottom:1px solid #0d0d0d; flex-shrink:0; font-size:11px; font-family:'Share Tech Mono',monospace; }
#sed-file-label { color:#666; }
.sed-dirty-badge { color:#ffcc00; font-size:10px; }
.sed-infobar-sep { flex:1; }
.sed-cursor-pos { color:#333; }
.sed-char-count { color:#252525; }

/* Body */
.sed-body { flex:1; display:flex; overflow:hidden; }
.sed-panel { display:flex; flex:1; overflow:hidden; }

/* Sidebar */
.sed-sidebar { width:180px; flex-shrink:0; background:#030303; border-right:1px solid #0d0d0d; display:flex; flex-direction:column; overflow:hidden; }
.sed-sidebar-header { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; border-bottom:1px solid #0d0d0d; flex-shrink:0; }
.sed-sidebar-title { font-size:10px; font-family:'Orbitron',sans-serif; letter-spacing:2px; color:#333; }
.sed-sidebar-toggle { background:transparent; border:none; color:#333; cursor:pointer; font-size:11px; padding:2px 6px; border-radius:3px; transition:color .15s; }
.sed-sidebar-toggle:hover { color:#00eeff; }
.sed-fs-tree { flex:1; overflow-y:auto; padding:4px 0; }
.sed-tree-path { font-family:'Share Tech Mono',monospace; font-size:9px; color:#1e3a1e; padding:4px 10px 4px; letter-spacing:1px; border-bottom:1px solid #080808; }
.sed-tree-item { padding:5px 12px; font-size:12px; font-family:'Share Tech Mono',monospace; color:#555; cursor:pointer; transition:all .12s; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sed-tree-item:hover { background:#0a0a0a; color:#aaa; }
.sed-tree-dir { color:#2a5a2a; }
.sed-tree-dir:hover { color:#00ff41; }
.sed-tree-empty { padding:16px 12px; font-size:11px; font-family:'Share Tech Mono',monospace; color:#1e1e1e; }

/* Monaco wrap */
.sed-monaco-wrap { flex:1; display:flex; flex-direction:column; overflow:hidden; position:relative; }
.sed-monaco-loading { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; font-family:'Share Tech Mono',monospace; font-size:13px; color:#2a5a2a; z-index:5; }
.sed-spinner { width:32px; height:32px; border:2px solid #0d0d0d; border-top-color:#00ff41; border-radius:50%; animation:spin 0.8s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }

/* Image editor */
.sed-img-sidebar { width:220px; flex-shrink:0; background:#030303; border-right:1px solid #0d0d0d; overflow-y:auto; display:flex; flex-direction:column; padding-bottom:16px; }
.sed-img-tool-group { padding:6px 14px; display:flex; flex-direction:column; gap:3px; }
.sed-img-tool-label { font-size:10px; font-family:'Share Tech Mono',monospace; color:#2a5a2a; letter-spacing:1px; }
.sed-slider { width:100%; accent-color:#00eeff; cursor:pointer; }
.sed-slider-val { font-size:10px; font-family:'Share Tech Mono',monospace; color:#444; text-align:right; }
.sed-img-btns { display:flex; flex-wrap:wrap; gap:4px; padding:4px 14px; }
.sed-img-btn { background:transparent; border:1px solid #1a1a1a; border-radius:4px; color:#555; font-size:10px; font-family:inherit; padding:4px 8px; cursor:pointer; transition:all .15s; }
.sed-img-btn:hover { border-color:#00eeff; color:#00eeff; }
.sed-img-crop-row { display:flex; align-items:center; gap:6px; padding:4px 14px; }
.sed-num-input { background:#080808; border:1px solid #1a1a1a; border-radius:4px; color:#888; font-size:11px; font-family:'Share Tech Mono',monospace; padding:4px 6px; width:60px; outline:none; }
.sed-num-input:focus { border-color:#00eeff; }
.sed-img-canvas-wrap { flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; background:#040404; position:relative; }
.sed-img-drop { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; pointer-events:none; }
.sed-img-drop-icon { font-size:64px; opacity:.15; }
.sed-img-drop-text { font-size:13px; font-family:'Share Tech Mono',monospace; color:#1e1e1e; text-align:center; max-width:320px; }
.sed-img-canvas-wrap.sed-img-drop-active { outline:2px dashed #00eeff; }

/* Status bar */
.sed-statusbar { display:flex; align-items:center; justify-content:space-between; padding:3px 14px; background:#030303; border-top:1px solid #0d0d0d; flex-shrink:0; font-size:11px; font-family:'Share Tech Mono',monospace; color:#2a5a2a; }
.sed-status-right { color:#1a1a1a; }
#sed-status-msg.err { color:#ff0040; }

/* Modals */
.sed-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:10000; display:flex; align-items:center; justify-content:center; }
.sed-modal { background:#080808; border:1px solid #252525; border-radius:10px; padding:24px; width:500px; max-width:95vw; max-height:80vh; display:flex; flex-direction:column; gap:12px; box-shadow:0 0 40px rgba(0,238,255,.06); }
.sed-modal-title { font-family:'Orbitron',sans-serif; font-size:13px; color:#00eeff; letter-spacing:2px; }
.sed-modal-search { background:#050505; border:1px solid #1e1e1e; border-radius:4px; color:#c8c8c8; font-family:'Share Tech Mono',monospace; font-size:12px; padding:7px 10px; outline:none; width:100%; }
.sed-modal-search:focus { border-color:#00eeff; }
.sed-picker-list { flex:1; overflow-y:auto; max-height:360px; display:flex; flex-direction:column; gap:2px; }
.sed-picker-item { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:4px; cursor:pointer; font-family:'Share Tech Mono',monospace; font-size:12px; color:#777; transition:all .12s; border:1px solid transparent; }
.sed-picker-item:hover { background:#0a0a0a; border-color:#1e1e1e; color:#ccc; }
.sed-modal-actions { display:flex; justify-content:flex-end; gap:8px; }
`;

// ── PUBLIC API ─────────────────────────────────────────────────
window.SpectralEditor = {
  render: renderEditor,
};

console.log('[Spectral] Editor engine loaded — spectral://editor ready');
