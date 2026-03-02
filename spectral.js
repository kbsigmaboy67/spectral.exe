// ═══════════════════════════════════════════════════════════════
// SPECTRAL.EXE — Browser Engine v4.0
// Requires: spectral-fs.js loaded first
// ═══════════════════════════════════════════════════════════════
'use strict';

// ── CONSTANTS ──────────────────────────────────────────────────
const STORAGE_KEY = 'spectral_state';
const LIST_URL    = './list.json';

// Google/Bing embed-friendly URL normalization map
// Any of the LHS inputs get rewritten to the RHS iframe src
const SEARCH_EMBED_MAP = [
  // Google variants
  { test: /^https?:\/\/(www\.)?google\.com\/?(\?.*)?$/i,       to: 'https://www.google.com/webhp?igu=1' },
  { test: /^https?:\/\/(www\.)?google\.com\/webhp(\?(?!igu).*)?$/i, to: 'https://www.google.com/webhp?igu=1' },
  { test: /^google:\/\/$/i,                                     to: 'https://www.google.com/webhp?igu=1' },
  { test: /^google:\/\/search$/i,                               to: 'https://www.google.com/webhp?igu=1' },
  // Bing variants
  { test: /^https?:\/\/(www\.)?bing\.com\/?(\?.*)?$/i,         to: 'https://www.bing.com/webhp?igu=1' },
  { test: /^https?:\/\/(www\.)?bing\.com\/webhp(\?(?!igu).*)?$/i, to: 'https://www.bing.com/webhp?igu=1' },
  { test: /^bing:\/\/$/i,                                       to: 'https://www.bing.com/webhp?igu=1' },
  { test: /^bing:\/\/search$/i,                                 to: 'https://www.bing.com/webhp?igu=1' },
];

function applySearchEmbed(url) {
  for (const { test, to } of SEARCH_EMBED_MAP) {
    if (test.test(url)) return to;
  }
  return url;
}

const DEFAULT_BOOKMARKS = [
  { id: 1, url: 'https://www.google.com/webhp?igu=1',   title: 'Google' },
  { id: 2, url: 'https://efly.108-181-32-77.sslip.io/', title: 'RammerHead' },
  { id: 3, url: 'https://tubmledxeni.viar3d.com',       title: 'PeteZah Games' },
  { id: 4, url: 'https://92850.vercel.app',             title: 'Interstellar' },
];

const DEFAULT_SETTINGS = {
  homepage:     'spectral://welcome_page',
  searchEngine: 'https://www.google.com/search?q=',
  bookmarksBar: true,
};

const SHORTCUTS = [
  { label: 'Google',       url: 'https://www.google.com/webhp?igu=1', icon: '🔍' },
  { label: 'RammerHead',   url: 'https://efly.108-181-32-77.sslip.io/', icon: '🐏' },
  { label: 'PeteZah',      url: 'https://tubmledxeni.viar3d.com',      icon: '🎮' },
  { label: 'Interstellar', url: 'https://92850.vercel.app',            icon: '🚀' },
  { label: 'Terminal',     url: 'spectral://terminal',                 icon: '💻' },
  { label: 'Editor',      url: 'spectral://editor',                   icon: '📝' },
  { label: 'FreeDNX',     url: 'spectral://FDNX',                     icon: '🌐' },
  { label: 'Overrides',   url: 'spectral://overrides_gateway_list',   icon: '🔧' },
  { label: 'Settings',    url: 'spectral://settings',                 icon: '⚙️' },
];

// ── STATE ──────────────────────────────────────────────────────
let tabs         = [];
let activeTabId  = null;
let tabCounter   = 0;
let bookmarks    = [];
let settings     = { ...DEFAULT_SETTINGS };
let jsonOverrides = [];

// Per-tab metadata: tabMeta[tabId] = { title, favicon, tabImage, password, locked }
// This is session-only (not persisted since it can be large)
const tabMeta = {};

// ── OVERRIDE LOOKUP ────────────────────────────────────────────
function allOverrides() {
  return [...window.SpectralLO.load(), ...jsonOverrides];
}

// Build a list of candidate forms of a URL to check against override matches.
// e.g. "macvg.io"           → ["macvg.io", "https://macvg.io", "http://macvg.io"]
//      "https://macvg.io"   → ["https://macvg.io", "macvg.io", "http://macvg.io"]
//      "http://macvg.io/x"  → ["http://macvg.io/x", "macvg.io/x", "https://macvg.io/x"]
//      "game://run"         → ["game://run"]  (custom schemes — exact only)
function urlCandidates(url) {
  const candidates = [url];
  const httpStrip  = url.replace(/^https?:\/\//i, '');
  if (httpStrip !== url) {
    // Had http/https — also check without scheme
    candidates.push(httpStrip);
  } else if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(url)) {
    // Bare domain — also check with both schemes
    candidates.push('https://' + url);
    candidates.push('http://'  + url);
  }
  return candidates;
}

function findOverride(rawUrl) {
  const ovs = allOverrides();
  const candidates = urlCandidates(rawUrl);
  for (const candidate of candidates) {
    const found = ovs.find(o =>
      o.match && (
        candidate === o.match ||
        candidate.startsWith(o.match + '/') ||
        candidate.startsWith(o.match + '?') ||
        // Also allow the override's match to be the bare domain and the URL to have scheme
        rawUrl === o.match ||
        rawUrl.startsWith(o.match + '/') ||
        rawUrl.startsWith(o.match + '?')
      )
    );
    if (found) return found;
  }
  return undefined;
}

// ── PERSISTENCE ────────────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tabs: tabs.map(t => ({
        id: t.id, title: t.title, url: t.url,
        favicon: t.favicon, tabImage: t.tabImage || null,
        historyBack: t.historyBack, historyFwd: t.historyFwd,
      })),
      activeTabId, bookmarks, settings, tabCounter,
    }));
  } catch (e) { console.warn('[Spectral] save failed:', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    tabs        = d.tabs        || [];
    activeTabId = d.activeTabId ?? null;
    bookmarks   = d.bookmarks   || [];
    settings    = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    tabCounter  = d.tabCounter  || 0;
    return tabs.length > 0;
  } catch (_) { return false; }
}

// ── OVERRIDE LIST ──────────────────────────────────────────────
async function loadOverrides() {
  try {
    const res = await fetch(LIST_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    jsonOverrides = (json.overrides || []).filter(o => o.match && o.type);
    console.log(`[Spectral] ${jsonOverrides.length} overrides from list.json`);
  } catch (e) {
    console.warn('[Spectral] list.json unavailable:', e.message);
    jsonOverrides = [];
  }
}

// ── URL RESOLUTION ─────────────────────────────────────────────
function resolveUrl(raw) {
  raw = raw.trim();

  // ── 1. Check overrides FIRST on the raw input (before any normalization)
  //    This catches bare domains like "macvg.io", custom schemes "game://run",
  //    and fully-qualified URLs alike.
  const ovRaw = findOverride(raw);
  if (ovRaw) return { spectralOverride: ovRaw, resolved: raw };

  // ── 2. Apply Google/Bing embed normalization
  const embedded = applySearchEmbed(raw);
  if (embedded !== raw) {
    const ovEmbed = findOverride(embedded);
    if (ovEmbed) return { spectralOverride: ovEmbed, resolved: embedded };
    return { resolved: embedded };
  }

  // ── 3. Known spectral/local/blob schemes — pass through
  if (raw.startsWith('spectral://'))       return { resolved: raw };
  if (raw.startsWith('local://'))          return { resolved: raw };
  if (raw.startsWith('about:'))            return { resolved: raw };
  if (raw.startsWith('blob:'))             return { resolved: raw };
  if (raw.startsWith('data:'))             return { resolved: raw };
  if (raw.startsWith('html://'))           return { resolved: raw };
  if (raw.startsWith('fetch://'))          return { resolved: raw };

  // ── 4. Fully-qualified http/https
  if (/^https?:\/\//i.test(raw))           return { resolved: raw };

  // ── 5. Bare domain (e.g. "macvg.io") — check override again with https:// form,
  //       in case the override was stored as "https://macvg.io"
  if (/^[a-z0-9-]+\.[a-z]{2,}/i.test(raw)) {
    const withScheme = 'https://' + raw;
    const ovScheme   = findOverride(withScheme);
    if (ovScheme) return { spectralOverride: ovScheme, resolved: withScheme };
    return { resolved: withScheme };
  }

  // ── 6. Anything else — search
  return { resolved: settings.searchEngine + encodeURIComponent(raw) };
}

// ═══════════════════════════════════════════════════════════════
// TAB TRACKING — Iframe relay approach
// We inject a tiny <script> into same-origin blobs.
// For cross-origin iframes we rely on MutationObserver on the tab
// element + polling via a safe message bridge.
// ═══════════════════════════════════════════════════════════════

// Tracking intervals per tab: trackIntervals[tabId] = intervalId
const trackIntervals = {};

/**
 * Start polling a cross-origin iframe for title/favicon changes.
 * We can't read contentDocument for cross-origin, so we:
 *  1. Try contentDocument (works for same-origin blob/data URLs)
 *  2. Try fetching the favicon from the resolved domain
 *  3. Use the override-defined title/favicon if available
 *  4. Keep what we already have if nothing else works
 */
function startTabTracking(tabId, iframeEl, overrideMeta) {
  // Clear previous interval for this tab
  if (trackIntervals[tabId]) { clearInterval(trackIntervals[tabId]); delete trackIntervals[tabId]; }

  // If the override has a forced title or favicon, apply immediately
  if (overrideMeta) {
    const { tabTitle, tabFavicon, tabImage } = overrideMeta;
    const tab = getTab(tabId);
    if (tab) {
      if (tabTitle)   { tab.title   = tabTitle;   }
      if (tabFavicon) { tab.favicon = tabFavicon;  }
      if (tabImage)   { tab.tabImage = tabImage;   }
      renderTabEl(tabId);
      save();
    }
    // If forced values exist, still try real title underneath but don't override them again
    if (tabTitle && tabFavicon) return;
  }

  // Poll every 800ms
  let attempts = 0;
  trackIntervals[tabId] = setInterval(() => {
    attempts++;
    if (attempts > 25) { clearInterval(trackIntervals[tabId]); delete trackIntervals[tabId]; return; }

    const el = iframeEl;
    if (!el || !el.isConnected) { clearInterval(trackIntervals[tabId]); delete trackIntervals[tabId]; return; }

    // Try same-origin access (blob:, data:, local://)
    try {
      const doc = el.contentDocument;
      if (doc && doc.readyState !== 'loading') {
        const realTitle = doc.title?.trim();
        const linkEl    = doc.querySelector('link[rel*="icon"]');
        const linkHref  = linkEl?.href;

        const tab = getTab(tabId);
        if (!tab) return;

        if (realTitle && !overrideMeta?.tabTitle) {
          tab.title = realTitle;
          renderTabEl(tabId);
        }
        if (linkHref && !overrideMeta?.tabFavicon) {
          tab.favicon = linkHref;
          renderTabEl(tabId);
        }
        if (realTitle || linkHref) {
          save();
          clearInterval(trackIntervals[tabId]);
          delete trackIntervals[tabId];
          return;
        }
      }
    } catch (_) { /* cross-origin — skip */ }

    // Cross-origin: try to infer favicon from URL
    if (!overrideMeta?.tabFavicon) {
      try {
        const tab = getTab(tabId);
        if (!tab) return;
        const src  = el.src;
        if (!src || src === 'about:blank') return;
        if (src.startsWith('blob:') || src.startsWith('data:')) return;
        const u    = new URL(src);
        const fav  = u.origin + '/favicon.ico';
        const img  = new Image();
        img.onload  = () => {
          if (!overrideMeta?.tabFavicon) { tab.favicon = fav; renderTabEl(tabId); save(); }
        };
        img.onerror = () => {};
        img.src = fav;
      } catch (_) {}
    }

  }, 800);
}

/** Render the tab strip element for a given tabId */
function renderTabEl(tabId) {
  const tab = getTab(tabId);
  if (!tab) return;
  const el = document.querySelector(`.tab[data-id="${tabId}"]`);
  if (!el) return;

  const favEl   = el.querySelector('.tab-favicon');
  const titleEl = el.querySelector('.tab-title');

  // Favicon: can be emoji, URL, or data URI
  if (tab.favicon && tab.favicon.startsWith('http')) {
    favEl.innerHTML = `<img src="${escAttr(tab.favicon)}" style="width:14px;height:14px;object-fit:contain;vertical-align:middle" onerror="this.outerHTML='🌐'">`;
  } else {
    favEl.textContent = tab.favicon || '🌐';
  }

  // Tab background image (optional)
  if (tab.tabImage) {
    el.style.backgroundImage = `url(${tab.tabImage})`;
    el.style.backgroundSize  = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.setProperty('--tab-img-overlay', '1');
  } else {
    el.style.backgroundImage = '';
    el.style.setProperty('--tab-img-overlay', '0');
  }

  titleEl.textContent = tab.title || 'New Tab';
}

// ── TAB MANAGEMENT ─────────────────────────────────────────────
function createTab(url = 'spectral://new_tab', activate = true) {
  const id = ++tabCounter;
  const tab = { id, title: 'New Tab', url, favicon: '🌐', tabImage: null, historyBack: [], historyFwd: [] };
  tabs.push(tab);
  const tabEl = buildTabEl(tab);
  document.getElementById('tab-strip').insertBefore(tabEl, document.getElementById('new-tab-btn'));
  const contentEl = document.createElement('div');
  contentEl.className  = 'tab-content';
  contentEl.dataset.id = id;
  document.getElementById('content').appendChild(contentEl);
  if (activate) switchTab(id);
  navigateTo(url, true, id);
  save();
  return id;
}

function buildTabEl(tab) {
  const el = document.createElement('div');
  el.className  = 'tab';
  el.dataset.id = tab.id;
  el.innerHTML  = `<span class="tab-favicon">🌐</span><span class="tab-title">${escHtml(tab.title)}</span><span class="tab-close" title="Close">✕</span>`;
  el.addEventListener('click', e => { if (!e.target.classList.contains('tab-close')) switchTab(tab.id); });
  el.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id); });
  return el;
}

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(e => e.classList.remove('active'));
  activeTabId = id;
  document.querySelector(`.tab[data-id="${id}"]`)?.classList.add('active');
  document.querySelector(`.tab[data-id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  document.querySelector(`.tab-content[data-id="${id}"]`)?.classList.add('active');
  const tab = getTab(id);
  if (tab) {
    document.getElementById('url-bar').value = tab.url;
    updateNavBtns(tab);
    updateBookmarkBtn(tab.url);
    updateLock(tab.url);
  }
  save();
}

function closeTab(id) {
  if (trackIntervals[id]) { clearInterval(trackIntervals[id]); delete trackIntervals[id]; }
  const idx = tabs.findIndex(t => t.id === id);
  if (tabs.length === 1) createTab('spectral://new_tab', true);
  tabs.splice(idx, 1);
  document.querySelector(`.tab[data-id="${id}"]`)?.remove();
  document.querySelector(`.tab-content[data-id="${id}"]`)?.remove();
  delete tabMeta[id];
  if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    if (next) switchTab(next.id);
  }
  save();
}

function getTab(id)  { return tabs.find(t => t.id === id); }
function activeTab() { return getTab(activeTabId); }

function updateTabMeta(tabId, title, favicon, tabImage) {
  const tab = getTab(tabId);
  if (!tab) return;
  if (title    !== undefined && title    !== null) tab.title    = title;
  if (favicon  !== undefined && favicon  !== null) tab.favicon  = favicon;
  if (tabImage !== undefined && tabImage !== null) tab.tabImage = tabImage;
  renderTabEl(tabId);
  save();
}

// ── PASSWORD PROTECTION ────────────────────────────────────────
// Returns true if we should proceed, false if blocked by password
function checkPassword(ov, contentEl, tabId, proceedFn) {
  if (!ov?.password) { proceedFn(); return; }

  const saved = sessionStorage.getItem('spectral_pw_' + tabId + '_' + ov.match);
  if (saved === ov.password) { proceedFn(); return; }

  // Show password gate
  const tab = getTab(tabId);
  if (tab) { tab.title = ov.display || 'Protected'; tab.favicon = '🔐'; renderTabEl(tabId); }

  let pageEl = contentEl.querySelector('.spectral-page');
  let iframeEl = contentEl.querySelector('iframe');
  if (iframeEl) iframeEl.style.display = 'none';
  if (!pageEl) { pageEl = document.createElement('div'); pageEl.className = 'spectral-page'; contentEl.appendChild(pageEl); }
  pageEl.style.display = 'block';

  pageEl.innerHTML = `
    <div class="pw-gate">
      <div class="pw-gate-icon">🔐</div>
      <div class="pw-gate-title">${escHtml(ov.display || ov.match)}</div>
      <div class="pw-gate-sub">This page is password protected</div>
      <div class="pw-gate-form">
        <input type="password" id="pw-input" class="pw-input" placeholder="Enter password…" autocomplete="current-password"/>
        <button class="pw-btn" id="pw-submit">Unlock</button>
      </div>
      <div class="pw-error" id="pw-error"></div>
    </div>`;

  hideLoading();

  const submit = () => {
    const val = document.getElementById('pw-input')?.value;
    if (val === ov.password) {
      sessionStorage.setItem('spectral_pw_' + tabId + '_' + ov.match, val);
      proceedFn();
    } else {
      const errEl = document.getElementById('pw-error');
      if (errEl) { errEl.textContent = 'Incorrect password'; errEl.style.opacity = '1'; }
      document.getElementById('pw-input').value = '';
      document.getElementById('pw-input').focus();
    }
  };
  document.getElementById('pw-submit')?.addEventListener('click', submit);
  document.getElementById('pw-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  document.getElementById('pw-input')?.focus();
}

// ── NAVIGATION ─────────────────────────────────────────────────
function navigateTo(rawUrl, replace = false, tabId = null) {
  rawUrl = rawUrl.trim();

  // Only apply Google/Bing embed normalization if it's actually one of those —
  // do NOT pre-normalize bare domains here because resolveUrl needs to see
  // the original form to match overrides like { match: "macvg.io" }.
  const displayUrl = applySearchEmbed(rawUrl);

  const id  = tabId ?? activeTabId;
  const tab = getTab(id);
  if (!tab) return;

  if (!replace && tab.url !== displayUrl) { tab.historyBack.push(tab.url); tab.historyFwd = []; }
  tab.url = displayUrl;

  if (id === activeTabId) {
    document.getElementById('url-bar').value = displayUrl;
    updateNavBtns(tab);
    updateLock(displayUrl);
    updateBookmarkBtn(displayUrl);
  }

  showLoading();
  // Pass the original rawUrl to resolveUrl so override matching sees it unmodified
  const { resolved, spectralOverride } = resolveUrl(rawUrl);
  renderContent(id, resolved, displayUrl, spectralOverride);
  save();
}

// ── CONTENT RENDERING ──────────────────────────────────────────
function renderContent(tabId, resolved, rawUrl, override) {
  const contentEl = document.querySelector(`.tab-content[data-id="${tabId}"]`);
  if (!contentEl) return;

  let iframeEl = contentEl.querySelector('iframe');
  let pageEl   = contentEl.querySelector('.spectral-page');

  // Build override metadata for tab display
  const overrideMeta = override ? {
    tabTitle:   override.tabTitle   || override.display || null,
    tabFavicon: override.tabFavicon || null,
    tabImage:   override.tabImage   || null,
    password:   override.password   || null,
  } : null;

  function useIframe(src, skipTracking = false) {
    if (!iframeEl) {
      iframeEl = document.createElement('iframe');
      iframeEl.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock');
      iframeEl.setAttribute('referrerpolicy', 'no-referrer');
      iframeEl.setAttribute('allowfullscreen', '');
      contentEl.appendChild(iframeEl);
    }
    if (pageEl) pageEl.style.display = 'none';
    iframeEl.style.display = 'block';

    const doLoad = () => {
      const prevSrc = iframeEl.getAttribute('data-spectral-src');
      if (prevSrc !== src) {
        iframeEl.setAttribute('data-spectral-src', src);
        iframeEl.src = src;
      } else {
        // Force reload if same src
        iframeEl.src = '';
        requestAnimationFrame(() => { iframeEl.src = src; });
      }

      iframeEl.onload = () => {
        hideLoading();
        if (!skipTracking) startTabTracking(tabId, iframeEl, overrideMeta);
        // Apply forced meta immediately on load
        if (overrideMeta?.tabTitle || overrideMeta?.tabFavicon || overrideMeta?.tabImage) {
          updateTabMeta(tabId,
            overrideMeta.tabTitle   || getTab(tabId)?.title,
            overrideMeta.tabFavicon || getTab(tabId)?.favicon,
            overrideMeta.tabImage   || getTab(tabId)?.tabImage
          );
        }
      };
      iframeEl.onerror = () => hideLoading();
    };

    doLoad();
  }

  function useSpectralPage(renderer) {
    if (iframeEl) iframeEl.style.display = 'none';
    if (!pageEl) { pageEl = document.createElement('div'); pageEl.className = 'spectral-page'; contentEl.appendChild(pageEl); }
    pageEl.style.display = 'block';
    renderer(pageEl);
    hideLoading();
  }

  // Handle override with password check
  if (override) {
    checkPassword(override, contentEl, tabId, () => {
      handleOverride(override, tabId, useIframe, useSpectralPage, overrideMeta);
    });
    return;
  }

  if (rawUrl.startsWith('spectral://')) { useSpectralPage(el => renderSpectralPage(tabId, rawUrl, el)); return; }
  if (rawUrl.startsWith('local://'))    { handleLocalScheme(rawUrl, tabId, useIframe, useSpectralPage); return; }
  if (rawUrl.startsWith('about:'))      { useIframe(rawUrl); return; }
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:')) { useIframe(rawUrl); return; }
  if (rawUrl.startsWith('html://'))     { useIframe(htmlSchemeToBlobUrl(rawUrl)); updateTabMeta(tabId, 'html:// page', '📄'); return; }
  if (rawUrl.startsWith('fetch://'))    { fetchToBlobUrl(rawUrl.slice(8), tabId, useIframe, useSpectralPage); return; }
  if (isGithubPage(resolved))           { useIframe(resolved); updateTabMeta(tabId, extractGithubDisplay(resolved), '🐙'); return; }
  useIframe(resolved);
}

// ── LOCAL:// SCHEME ────────────────────────────────────────────
function handleLocalScheme(rawUrl, tabId, useIframe, useSpectralPage) {
  const path   = window.SpectralFS.localUrlToPath(rawUrl);
  const blobUrl = window.SpectralFS.readUrl(path);
  if (blobUrl) {
    useIframe(blobUrl);
    const info = window.SpectralFS.info(path);
    updateTabMeta(tabId, info?.name || path, '💾');
  } else {
    useSpectralPage(el => renderErrorPage(el, `local:// — File not found: ${path}`, rawUrl));
  }
}

// ── OVERRIDE HANDLER ───────────────────────────────────────────
function handleOverride(ov, tabId, useIframe, useSpectralPage, overrideMeta) {
  const title   = overrideMeta?.tabTitle   || ov.display || null;
  const favicon = overrideMeta?.tabFavicon || null;
  const img     = overrideMeta?.tabImage   || null;

  const setMeta = (defaultTitle, defaultFavicon) => {
    updateTabMeta(tabId,
      title   || defaultTitle,
      favicon || defaultFavicon,
      img
    );
  };

  switch (ov.type) {
    case 'redirect':
      useIframe(ov.target);
      setMeta(ov.display || ov.target, '🔗'); break;
    case 'html':
      useIframe(htmlStringToBlobUrl(ov.content || ''));
      setMeta(ov.display || 'Inline Page', '📄'); break;
    case 'html_base64': {
      let html = ''; try { html = atob(ov.content || ''); } catch (_) { html = ov.content || ''; }
      useIframe(htmlStringToBlobUrl(html));
      setMeta(ov.display || 'Base64 Page', '📄'); break;
    }
    case 'html_uri':
      useIframe(htmlStringToBlobUrl(decodeURIComponent(ov.content || '')));
      setMeta(ov.display || 'URI Page', '📄'); break;
    case 'fetch':
      fetchToBlobUrl(ov.target, tabId, useIframe, useSpectralPage, title || ov.display);
      if (favicon || img) updateTabMeta(tabId, null, favicon, img);
      break;
    case 'local': {
      const blobUrl = window.SpectralFS.readUrl(window.SpectralFS.normPath(ov.target || ''));
      if (blobUrl) { useIframe(blobUrl); setMeta(ov.display || ov.target, '💾'); }
      else useSpectralPage(el => renderErrorPage(el, 'local file not found: ' + ov.target, ov.match));
      break;
    }
    case 'github':
      useIframe(ov.target);
      setMeta(ov.display || extractGithubDisplay(ov.target), '🐙'); break;
    default:
      useSpectralPage(el => renderErrorPage(el, 'Unknown override type: ' + ov.type, ov.match));
  }
}

// ── HTML:// SCHEME ─────────────────────────────────────────────
function htmlSchemeToBlobUrl(rawUrl) {
  const part = rawUrl.slice(7);
  let html = part;
  if (part.startsWith('base64,'))  { try { html = atob(part.slice(7)); }        catch (_) {} }
  else if (part.startsWith('uri,')) { html = decodeURIComponent(part.slice(4)); }
  return htmlStringToBlobUrl(html);
}
function htmlStringToBlobUrl(html) {
  return URL.createObjectURL(new Blob([html], { type: 'text/html' }));
}

// ── FETCH:// SCHEME ────────────────────────────────────────────
async function fetchToBlobUrl(url, tabId, useIframe, useSpectralPage, displayName) {
  try {
    const blob = await fetchWithFallback(url);
    useIframe(URL.createObjectURL(blob));
    updateTabMeta(tabId, displayName || 'fetch:// page', '📡');
  } catch (err) {
    useSpectralPage(el => renderErrorPage(el, `fetch:// failed: ${err.message}`, url));
    hideLoading();
  }
}
async function fetchWithFallback(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (primaryErr) {
    if (typeof window.spectralFetch === 'function') {
      try {
        const res = await window.spectralFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
      } catch (fbErr) {
        throw new Error(`Primary: ${primaryErr.message} | Fallback: ${fbErr.message}`);
      }
    }
    throw primaryErr;
  }
}

// ── GITHUB PAGE UTILS ──────────────────────────────────────────
function isGithubPage(url) { return /^https?:\/\/[^/]+\.github\.io(\/|$)/i.test(url); }
function extractGithubDisplay(url) {
  try { const u = new URL(url); return u.hostname.replace(/\.github\.io$/, '') + u.pathname.replace(/\/$/, ''); }
  catch (_) { return 'GitHub Page'; }
}

// ── SPECTRAL PAGES ─────────────────────────────────────────────
function renderSpectralPage(tabId, url, el) {
  el.innerHTML = '';
  if (url === 'spectral://welcome_page')               { renderWelcomePage(tabId, el); }
  else if (url === 'spectral://new_tab')               { renderNewTabPage(tabId, el); }
  else if (url === 'spectral://settings')              { renderSettingsPage(tabId, el); }
  else if (url === 'spectral://overrides_gateway_list'){ renderGatewayPage(tabId, el); }
  else if (url === 'spectral://terminal')              { window.SpectralTerminal.render(tabId, el); }
  else if (url === 'spectral://editor')               { window.SpectralEditor.render(tabId, el); }
  else if (url === 'spectral://fdnx' || url === 'spectral://FDNX') { window.SpectralFDNX.render(tabId, el); }
  else renderErrorPage(el, 'Unknown spectral:// page', url);
}

function renderErrorPage(el, message, url) {
  el.innerHTML = `<div class="error-page"><div class="error-code">ERR</div><div class="error-msg">${escHtml(message)}</div><div class="error-url">${escHtml(url || '')}</div></div>`;
}

// ── WELCOME PAGE ───────────────────────────────────────────────
function renderWelcomePage(tabId, el) {
  el.innerHTML = `
    <div class="welcome-wrap">
      <div class="welcome-logo">Spectral.exe</div>
      <div class="welcome-tagline">// cybernetic_gateway.init() //</div>
      <div class="welcome-search">
        <input id="ws-input" type="text" spellcheck="false" placeholder="Search or enter URL…" autocomplete="off"/>
        <button onclick="wsGo()">&#10148;</button>
      </div>
      <div class="welcome-shortcuts" id="ws-shortcuts"></div>
    </div>`;
  document.getElementById('ws-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') wsGo(); });
  renderShortcuts('ws-shortcuts');
  updateTabMeta(tabId, 'Welcome — Spectral.exe', '🌈');
}

function renderNewTabPage(tabId, el) {
  el.innerHTML = `
    <div class="newtab-wrap">
      <div class="newtab-clock" id="nt-clock">00:00:00</div>
      <div class="newtab-date" id="nt-date"></div>
      <div class="welcome-search" style="margin-top:24px;max-width:480px;width:100%">
        <input id="nt-input" type="text" spellcheck="false" placeholder="Search or enter URL…" autocomplete="off"/>
        <button onclick="ntGo()">&#10148;</button>
      </div>
    </div>`;
  document.getElementById('nt-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') ntGo(); });
  updateTabMeta(tabId, 'New Tab', '✨');
  startClock();
}

function renderSettingsPage(tabId, el) {
  const loCount = window.SpectralLO.load().length;
  const fsCount = window.SpectralFS.list('/').length;
  el.innerHTML = `
    <div class="settings-wrap">
      <div class="settings-title">⚙ Settings</div>
      <div class="settings-section">
        <h3>// General</h3>
        <div class="settings-row"><div><label>Homepage</label><small>${escHtml(settings.homepage)}</small></div><button class="settings-action-btn" onclick="changeHomepage()">Change</button></div>
        <div class="settings-row"><div><label>Search Engine</label><small>${escHtml(settings.searchEngine)}</small></div><button class="settings-action-btn" onclick="changeSearchEngine()">Change</button></div>
      </div>
      <div class="settings-section">
        <h3>// Appearance</h3>
        <div class="settings-row"><label>Bookmarks Bar</label><div class="toggle ${settings.bookmarksBar ? 'on' : ''}" id="bm-toggle" onclick="toggleBookmarksBar(this)"></div></div>
      </div>
      <div class="settings-section">
        <h3>// Override System</h3>
        <div class="settings-row"><div><label>list.json overrides</label><small>${jsonOverrides.length} loaded</small></div><button class="settings-action-btn" onclick="reloadOverrides()">Reload</button></div>
        <div class="settings-row"><div><label>Local overrides</label><small>${loCount} active — stack on top of list.json</small></div><button class="settings-action-btn" onclick="navigateTo('spectral://overrides_gateway_list')">Manage</button></div>
      </div>
      <div class="settings-section">
        <h3>// Filesystem (local://)</h3>
        <div class="settings-row"><div><label>Files stored</label><small>${fsCount} file(s)</small></div><button class="settings-action-btn" onclick="navigateTo('spectral://overrides_gateway_list')">Browse</button></div>
      </div>
      <div class="settings-section">
        <h3>// Data</h3>
        <div class="settings-row"><label>Clear Browser Data</label><button class="settings-action-btn danger" onclick="clearData()">Clear</button></div>
      </div>
      <div class="settings-section">
        <h3>// About</h3>
        <div class="settings-row"><label>Version</label><span style="color:#2a2a2a;font-size:12px;font-family:var(--font-mono)">Spectral.exe v4.0.0</span></div>
        <div class="settings-row"><label>Engine</label><span style="color:#2a2a2a;font-size:12px;font-family:var(--font-mono)">HTML5 / Blob / local://</span></div>
      </div>
    </div>`;
  updateTabMeta(tabId, 'Settings — Spectral.exe', '⚙️');
}

// ═══════════════════════════════════════════════════════════════
// GATEWAY PAGE
// ═══════════════════════════════════════════════════════════════
function renderGatewayPage(tabId, el) {
  updateTabMeta(tabId, 'Gateway — Spectral.exe', '🔧');
  el.innerHTML = `
<div class="gw-root">
  <div class="gw-sidebar">
    <div class="gw-sidebar-title">GATEWAY</div>
    <nav class="gw-nav">
      <div class="gw-nav-item active" data-panel="overrides"    onclick="gwPanel(this,'overrides')">⚡ Overrides</div>
      <div class="gw-nav-item"        data-panel="filesystem"   onclick="gwPanel(this,'filesystem')">💾 Filesystem</div>
      <div class="gw-nav-item"        data-panel="editor"       onclick="gwPanel(this,'editor')">✏️ Editor</div>
      <div class="gw-nav-item"        data-panel="import-export" onclick="gwPanel(this,'import-export')">📦 Import/Export</div>
    </nav>
    <div class="gw-sidebar-stats" id="gw-stats"></div>
  </div>
  <div class="gw-main">

    <!-- OVERRIDES -->
    <div class="gw-panel active" id="gw-panel-overrides">
      <div class="gw-panel-header">
        <span class="gw-panel-title">⚡ Local Overrides</span>
        <div class="gw-panel-actions">
          <button class="gw-btn gw-btn-primary" onclick="gwOvNew()">+ New Override</button>
          <button class="gw-btn" id="gw-listjson-btn" onclick="gwToggleListJson()" title="list.json overrides — Spectral Dev only">🔒 list.json</button>
        </div>
      </div>
      <div class="gw-tip">Local overrides have priority over <code>list.json</code>. Use any protocol as match key. Each override supports optional <code>tabTitle</code>, <code>tabFavicon</code>, <code>tabImage</code>, and <code>password</code>.</div>
      <div id="gw-ov-list" class="gw-list"></div>
      <div id="gw-listjson-panel" style="display:none;border-top:1px solid #111;flex-shrink:0;overflow-y:auto;max-height:45%"></div>
    </div>

    <!-- FILESYSTEM -->
    <div class="gw-panel" id="gw-panel-filesystem">
      <div class="gw-panel-header">
        <span class="gw-panel-title">💾 local:// Filesystem</span>
        <div class="gw-panel-actions">
          <button class="gw-btn" onclick="gwFsUpload()">⬆ Upload</button>
          <button class="gw-btn gw-btn-primary" onclick="gwFsNewFolder()">📁 New Folder</button>
        </div>
      </div>
      <div class="gw-tip">Files stored in chunked localStorage. Access via <code>local:///path/to/file</code></div>
      <div class="gw-breadcrumb" id="gw-fs-bread">/</div>
      <div id="gw-fs-list" class="gw-list"></div>
      <input type="file" id="gw-file-input" multiple style="display:none"/>
    </div>

    <!-- EDITOR -->
    <div class="gw-panel" id="gw-panel-editor">
      <div class="gw-panel-header">
        <span class="gw-panel-title" id="gw-editor-title">✏️ Editor</span>
        <div class="gw-panel-actions">
          <select class="gw-select" id="gw-editor-mime">
            <option value="text/html">HTML</option>
            <option value="text/css">CSS</option>
            <option value="text/javascript">JavaScript</option>
            <option value="application/json">JSON</option>
            <option value="text/plain">Plain Text</option>
            <option value="text/markdown">Markdown</option>
          </select>
          <button class="gw-btn" onclick="gwEditorPreview()">👁 Preview</button>
          <button class="gw-btn gw-btn-primary" onclick="gwEditorSave()">💾 Save</button>
        </div>
      </div>
      <div class="gw-tip" id="gw-editor-path-tip">No file open. Type to create, or open from the Filesystem panel.</div>
      <textarea id="gw-editor-area" class="gw-editor" spellcheck="false" placeholder="// Enter HTML, JS, CSS, JSON, or any text here..."></textarea>
    </div>

    <!-- IMPORT/EXPORT -->
    <div class="gw-panel" id="gw-panel-import-export">
      <div class="gw-panel-header">
        <span class="gw-panel-title">📦 Import / Export</span>
      </div>
      <div class="gw-ie-grid">
        <div class="gw-ie-card">
          <div class="gw-ie-card-title">Export Overrides</div>
          <div class="gw-ie-card-desc">Export all local overrides as an encoded JSON bundle.</div>
          <div class="gw-row"><select class="gw-select" id="gw-ov-enc"><option value="base64">Base64</option><option value="hex">Hexadecimal</option></select><button class="gw-btn gw-btn-primary" onclick="gwExportOverrides()">Export</button></div>
        </div>
        <div class="gw-ie-card">
          <div class="gw-ie-card-title">Import Overrides</div>
          <div class="gw-ie-card-desc">Paste an encoded override bundle to restore or merge.</div>
          <textarea id="gw-ov-import-txt" class="gw-ie-textarea" placeholder="Paste base64 or hex encoded bundle…"></textarea>
          <div class="gw-row" style="gap:6px;margin-top:6px"><select class="gw-select" id="gw-ov-imp-enc"><option value="base64">Base64</option><option value="hex">Hexadecimal</option></select><button class="gw-btn" onclick="gwImportOverrides(false)">Replace</button><button class="gw-btn gw-btn-primary" onclick="gwImportOverrides(true)">Merge</button></div>
        </div>
        <div class="gw-ie-card">
          <div class="gw-ie-card-title">Export Filesystem</div>
          <div class="gw-ie-card-desc">Export all local:// files as a single encoded archive.</div>
          <div class="gw-row"><select class="gw-select" id="gw-fs-enc"><option value="base64">Base64</option><option value="hex">Hexadecimal</option></select><button class="gw-btn gw-btn-primary" onclick="gwExportFS()">Export</button></div>
        </div>
        <div class="gw-ie-card">
          <div class="gw-ie-card-title">Import Filesystem</div>
          <div class="gw-ie-card-desc">Paste or upload an archive to restore files.</div>
          <textarea id="gw-fs-import-txt" class="gw-ie-textarea" placeholder="Paste encoded filesystem archive…"></textarea>
          <div class="gw-row" style="gap:6px;margin-top:6px"><select class="gw-select" id="gw-fs-imp-enc"><option value="base64">Base64</option><option value="hex">Hexadecimal</option></select><button class="gw-btn" onclick="gwImportFSFromFile()">📂 File</button><button class="gw-btn" onclick="gwImportFS(false)">Replace</button><button class="gw-btn gw-btn-primary" onclick="gwImportFS(true)">Merge</button></div>
          <input type="file" id="gw-fs-import-input" accept=".json,.txt" style="display:none"/>
        </div>
        <div class="gw-ie-card gw-ie-card-full">
          <div class="gw-ie-card-title">Output</div>
          <div class="gw-ie-card-desc" id="gw-output-desc">Export result will appear here.</div>
          <textarea id="gw-output-txt" class="gw-ie-textarea gw-ie-output" readonly placeholder="// Export output…"></textarea>
          <div class="gw-row" style="margin-top:6px;gap:6px"><button class="gw-btn gw-btn-primary" onclick="gwCopyOutput()">📋 Copy</button><button class="gw-btn" onclick="gwDownloadOutput()">⬇ Download</button></div>
        </div>
      </div>
    </div>

  </div>
</div>`;

  if (!document.getElementById('gw-style')) {
    const s = document.createElement('style');
    s.id = 'gw-style';
    s.textContent = GW_CSS;
    document.head.appendChild(s);
  }

  gwRefreshStats();
  gwRenderOverrides();
  gwRenderFS('/');
  gwFsCurrentPath = '/';
  document.getElementById('gw-file-input')?.addEventListener('change', gwHandleUpload);
  document.getElementById('gw-fs-import-input')?.addEventListener('change', gwHandleFSImportFile);
}

// ── GATEWAY CSS ────────────────────────────────────────────────
const GW_CSS = `
.gw-root { display:flex; height:100%; background:#000; color:#c8c8c8; font-family:var(--font-ui); overflow:hidden; }
.gw-sidebar { width:180px; flex-shrink:0; background:#040404; border-right:1px solid #111; display:flex; flex-direction:column; padding:16px 0; }
.gw-sidebar-title { font-family:var(--font-logo); font-size:10px; font-weight:900; letter-spacing:4px; padding:0 16px 16px; background:linear-gradient(90deg,var(--cyan),var(--b)); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.gw-nav { flex:1; }
.gw-nav-item { padding:9px 16px; font-size:12px; font-weight:500; cursor:pointer; color:#444; transition:all .15s; border-left:2px solid transparent; letter-spacing:.5px; }
.gw-nav-item:hover { color:#888; background:#0a0a0a; }
.gw-nav-item.active { color:var(--cyan); border-left-color:var(--cyan); background:rgba(0,238,255,.04); }
.gw-sidebar-stats { font-family:var(--font-mono); font-size:10px; color:#1e3a1e; padding:12px 16px; line-height:1.8; border-top:1px solid #0d0d0d; }
.gw-main { flex:1; overflow:hidden; display:flex; flex-direction:column; }
.gw-panel { display:none; flex-direction:column; height:100%; overflow:hidden; }
.gw-panel.active { display:flex; }
.gw-panel-header { display:flex; align-items:center; justify-content:space-between; padding:14px 20px 10px; border-bottom:1px solid #111; flex-shrink:0; gap:8px; flex-wrap:wrap; }
.gw-panel-title { font-family:var(--font-logo); font-size:13px; font-weight:700; color:#888; letter-spacing:1px; }
.gw-panel-actions { display:flex; gap:6px; flex-wrap:wrap; }
.gw-tip { font-family:var(--font-mono); font-size:11px; color:#1e3a1e; padding:7px 20px; border-bottom:1px solid #0a0a0a; flex-shrink:0; animation:matrixPulse 4s ease-in-out infinite; }
.gw-tip code { color:#2a5a2a; background:#060606; padding:1px 4px; border-radius:2px; }
.gw-breadcrumb { font-family:var(--font-mono); font-size:11px; color:#333; padding:6px 20px; flex-shrink:0; background:#030303; border-bottom:1px solid #0d0d0d; }
.gw-list { flex:1; overflow-y:auto; padding:8px 12px; }
.gw-btn { padding:5px 12px; font-size:12px; font-family:var(--font-ui); font-weight:500; background:transparent; border:1px solid #252525; border-radius:4px; color:#666; cursor:pointer; transition:all .15s; white-space:nowrap; letter-spacing:.3px; }
.gw-btn:hover { border-color:#444; color:#ccc; }
.gw-btn.gw-btn-primary { border-color:var(--cyan); color:var(--cyan); }
.gw-btn.gw-btn-primary:hover { background:rgba(0,238,255,.08); }
.gw-btn.gw-btn-danger { border-color:var(--r); color:var(--r); }
.gw-btn.gw-btn-danger:hover { background:rgba(255,0,64,.08); }
.gw-input { background:#080808; border:1px solid #1e1e1e; border-radius:4px; color:#c8c8c8; font-family:var(--font-mono); font-size:12px; padding:6px 10px; outline:none; width:100%; transition:border-color .15s; }
.gw-input:focus { border-color:var(--cyan); }
.gw-select { background:#080808; border:1px solid #1e1e1e; border-radius:4px; color:#888; font-family:var(--font-mono); font-size:11px; padding:5px 8px; outline:none; cursor:pointer; }
.gw-select:focus { border-color:var(--cyan); }
.gw-ov-item { background:#060606; border:1px solid #141414; border-radius:6px; padding:12px 14px; margin-bottom:6px; display:grid; grid-template-columns:1fr auto; gap:8px; align-items:start; transition:border-color .15s; }
.gw-ov-item:hover { border-color:#222; }
.gw-ov-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:4px; }
.gw-ov-badge { font-size:10px; font-family:var(--font-mono); padding:2px 7px; border-radius:10px; border:1px solid; white-space:nowrap; letter-spacing:.5px; }
.gw-ov-badge-redirect { color:var(--cyan); border-color:var(--cyan); }
.gw-ov-badge-html,.gw-ov-badge-html_base64,.gw-ov-badge-html_uri { color:var(--g); border-color:var(--g); }
.gw-ov-badge-fetch { color:var(--magenta); border-color:var(--magenta); }
.gw-ov-badge-github { color:#888; border-color:#333; }
.gw-ov-badge-local { color:var(--yellow); border-color:var(--yellow); }
.gw-ov-match { font-family:var(--font-mono); font-size:12px; color:#aaa; }
.gw-ov-target { font-family:var(--font-mono); font-size:11px; color:#444; }
.gw-ov-meta-tags { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; }
.gw-ov-meta-tag { font-size:9px; font-family:var(--font-mono); color:#2a5a2a; background:#030f03; padding:1px 6px; border-radius:8px; border:1px solid #1a3a1a; }
.gw-ov-actions { display:flex; gap:4px; }
.gw-fs-item { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:5px; cursor:pointer; transition:background .12s; border:1px solid transparent; margin-bottom:2px; }
.gw-fs-item:hover { background:#0a0a0a; border-color:#181818; }
.gw-fs-icon { font-size:16px; flex-shrink:0; width:24px; text-align:center; }
.gw-fs-name { font-size:13px; font-weight:500; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gw-fs-meta { font-family:var(--font-mono); font-size:10px; color:#333; flex-shrink:0; }
.gw-fs-actions { display:flex; gap:4px; opacity:0; transition:opacity .15s; }
.gw-fs-item:hover .gw-fs-actions { opacity:1; }
.gw-fs-action-btn { padding:2px 7px; font-size:10px; background:transparent; border:1px solid #222; border-radius:3px; color:#555; cursor:pointer; font-family:var(--font-mono); transition:all .1s; white-space:nowrap; }
.gw-fs-action-btn:hover { border-color:var(--cyan); color:var(--cyan); }
.gw-fs-action-btn.del:hover { border-color:var(--r); color:var(--r); }
.gw-editor { flex:1; background:#030303; border:none; border-top:1px solid #0d0d0d; color:#c8c8c8; font-family:var(--font-mono); font-size:13px; padding:16px 20px; outline:none; resize:none; line-height:1.6; tab-size:2; }
.gw-editor:focus { border-top-color:var(--cyan); }
.gw-ie-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:16px; overflow-y:auto; flex:1; }
.gw-ie-card { background:#060606; border:1px solid #141414; border-radius:8px; padding:14px 16px; display:flex; flex-direction:column; gap:8px; }
.gw-ie-card-full { grid-column:1/-1; }
.gw-ie-card-title { font-family:var(--font-logo); font-size:12px; color:#666; letter-spacing:1px; }
.gw-ie-card-desc { font-size:12px; color:#333; line-height:1.5; }
.gw-ie-textarea { background:#030303; border:1px solid #1a1a1a; border-radius:4px; color:#888; font-family:var(--font-mono); font-size:11px; padding:8px 10px; outline:none; resize:vertical; min-height:80px; width:100%; transition:border-color .15s; }
.gw-ie-textarea:focus { border-color:var(--cyan); }
.gw-ie-output { min-height:120px; color:#0f5a0f; }
.gw-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.gw-modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:10000; display:flex; align-items:center; justify-content:center; }
.gw-modal { background:#080808; border:1px solid #252525; border-radius:10px; padding:24px; width:600px; max-width:95vw; max-height:88vh; overflow-y:auto; display:flex; flex-direction:column; gap:14px; box-shadow:0 0 40px rgba(0,238,255,.08),0 20px 60px rgba(0,0,0,.9); }
.gw-modal-title { font-family:var(--font-logo); font-size:14px; color:var(--cyan); letter-spacing:2px; }
.gw-form-row { display:flex; flex-direction:column; gap:5px; }
.gw-form-label { font-size:11px; font-family:var(--font-mono); color:#444; letter-spacing:1px; text-transform:uppercase; }
.gw-form-row textarea.gw-input { min-height:120px; resize:vertical; line-height:1.5; }
.gw-form-section { font-size:10px; font-family:var(--font-mono); color:#1e3a1e; letter-spacing:3px; text-transform:uppercase; padding:8px 0 4px; border-top:1px solid #111; margin-top:4px; }
.gw-modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:4px; }
.gw-tab-preview { width:100%; height:36px; border-radius:4px; border:1px solid #222; display:flex; align-items:center; gap:8px; padding:0 10px; background:#060606; font-size:12px; }
.gw-tab-preview-fav { font-size:14px; }
.gw-tab-preview-title { font-family:var(--font-ui); font-size:12px; color:#888; flex:1; }
.gw-tab-preview-img { width:36px; height:36px; object-fit:cover; border-radius:3px; opacity:.4; }
/* Password gate */
.pw-gate { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:16px; font-family:var(--font-ui); padding:40px; text-align:center; }
.pw-gate-icon { font-size:56px; }
.pw-gate-title { font-family:var(--font-logo); font-size:20px; color:#888; letter-spacing:2px; }
.pw-gate-sub { font-size:13px; color:#333; font-family:var(--font-mono); }
.pw-gate-form { display:flex; gap:8px; margin-top:8px; }
.pw-input { background:#0a0a0a; border:1px solid #252525; border-radius:6px; color:#ccc; font-family:var(--font-mono); font-size:14px; padding:10px 16px; outline:none; width:240px; transition:border-color .2s; }
.pw-input:focus { border-color:var(--cyan); box-shadow:0 0 8px rgba(0,238,255,.15); }
.pw-btn { background:linear-gradient(135deg,var(--b),var(--cyan)); border:none; border-radius:6px; color:#000; font-family:var(--font-logo); font-size:12px; font-weight:700; padding:10px 20px; cursor:pointer; letter-spacing:1px; transition:opacity .15s; }
.pw-btn:hover { opacity:.85; }
.pw-error { font-family:var(--font-mono); font-size:12px; color:var(--r); opacity:0; transition:opacity .2s; height:16px; }
/* Tab image overlay for dark text readability */
.tab[style*="background-image"] .tab-title { text-shadow:0 1px 3px rgba(0,0,0,.9); }
.tab[style*="background-image"]::before { content:''; position:absolute; inset:0; background:rgba(0,0,0,.45); border-radius:6px 6px 0 0; pointer-events:none; z-index:0; }
.tab[style*="background-image"] .tab-favicon,
.tab[style*="background-image"] .tab-title,
.tab[style*="background-image"] .tab-close { position:relative; z-index:1; }
`;

// ── GATEWAY STATE ──────────────────────────────────────────────
let gwFsCurrentPath    = '/';
let gwEditorCurrentPath = null;
let gwOutputData       = '';
let gwOutputFilename   = 'spectral-export.json';

// ── GATEWAY PANEL ──────────────────────────────────────────────
function gwPanel(navEl, panelId) {
  document.querySelectorAll('.gw-nav-item').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.gw-panel').forEach(e => e.classList.remove('active'));
  navEl.classList.add('active');
  document.getElementById('gw-panel-' + panelId)?.classList.add('active');
  if (panelId === 'filesystem') gwRenderFS(gwFsCurrentPath);
  if (panelId === 'overrides')  gwRenderOverrides();
  gwRefreshStats();
}

function gwRefreshStats() {
  const el = document.getElementById('gw-stats');
  if (!el) return;
  el.innerHTML = `overrides: ${window.SpectralLO.load().length}<br>files: ${window.SpectralFS.list('/').length}<br>list.json: ${jsonOverrides.length}`;
}

// ── OVERRIDES UI ───────────────────────────────────────────────
function gwRenderOverrides() {
  const el = document.getElementById('gw-ov-list');
  if (!el) return;
  const arr = window.SpectralLO.load();
  if (!arr.length) {
    el.innerHTML = `<div style="color:#222;font-family:var(--font-mono);font-size:12px;padding:24px 8px;text-align:center">// No local overrides. Click "+ New Override" to add one.</div>`;
    return;
  }
  el.innerHTML = arr.map(ov => {
    const badgeCls = `gw-ov-badge-${(ov.type || 'redirect').replace(/_/g,'')}`;
    const target   = escHtml(ov.target || ov.content?.slice(0, 70) || '');
    const metaTags = [
      ov.tabTitle   && `<span class="gw-ov-meta-tag">tabTitle: ${escHtml(ov.tabTitle.slice(0,20))}</span>`,
      ov.tabFavicon && `<span class="gw-ov-meta-tag">tabFavicon</span>`,
      ov.tabImage   && `<span class="gw-ov-meta-tag">tabImage</span>`,
      ov.password   && `<span class="gw-ov-meta-tag">🔐 password</span>`,
    ].filter(Boolean).join('');
    return `
    <div class="gw-ov-item">
      <div>
        <div class="gw-ov-row">
          <span class="gw-ov-badge ${badgeCls}">${escHtml(ov.type)}</span>
          <span class="gw-ov-match">${escHtml(ov.match)}</span>
          ${ov.display ? `<span style="font-size:11px;color:#444">${escHtml(ov.display)}</span>` : ''}
        </div>
        <div class="gw-ov-target">${target}${ov.content?.length > 70 ? '…' : ''}</div>
        ${metaTags ? `<div class="gw-ov-meta-tags">${metaTags}</div>` : ''}
      </div>
      <div class="gw-ov-actions">
        <button class="gw-btn" style="font-size:11px" onclick="navigateTo('${escAttr(ov.match)}')">▶ Test</button>
        <button class="gw-btn" style="font-size:11px" onclick="gwOvEdit('${escAttr(ov.id)}')">✏️ Edit</button>
        <button class="gw-btn gw-btn-danger" style="font-size:11px" onclick="gwOvDelete('${escAttr(ov.id)}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function gwOvNew()    { gwOvModal(null); }
function gwOvEdit(id) { const ov = window.SpectralLO.load().find(e => e.id === id); if (ov) gwOvModal(ov); }
function gwOvDelete(id) { if (confirm('Delete this override?')) { window.SpectralLO.remove(id); gwRenderOverrides(); gwRefreshStats(); } }

// ── list.json panel — gated behind dev auth ─────────────────────
let listJsonPanelOpen = false;
function gwToggleListJson() {
  if (listJsonPanelOpen) {
    listJsonPanelOpen = false;
    const panel = document.getElementById('gw-listjson-panel');
    const btn   = document.getElementById('gw-listjson-btn');
    if (panel) panel.style.display = 'none';
    if (btn)   btn.innerHTML = '🔒 list.json';
    return;
  }
  requireDevAuth(() => {
    listJsonPanelOpen = true;
    gwRenderListJson();
    const btn = document.getElementById('gw-listjson-btn');
    if (btn) btn.innerHTML = '🔓 list.json';
  });
}

function gwRenderListJson() {
  const panel = document.getElementById('gw-listjson-panel');
  if (!panel) return;
  panel.style.display = 'block';
  const arr = jsonOverrides;
  if (!arr.length) {
    panel.innerHTML = `<div style="color:#1e3a1e;font-family:var(--font-mono);font-size:11px;padding:16px 20px">// list.json is empty or not loaded</div>`;
    return;
  }
  panel.innerHTML = `
    <div style="padding:8px 20px 4px;font-family:var(--font-logo);font-size:10px;letter-spacing:3px;color:#1e3a1e;border-bottom:1px solid #0a0a0a;background:#020202">
      🔓 list.json — ${arr.length} override${arr.length!==1?'s':''} — dev view
    </div>
    <div style="padding:8px 12px">
    ${arr.map(ov => {
      const badgeCls = `gw-ov-badge-${(ov.type||'redirect').replace(/_/g,'')}`;
      const target   = escHtml(ov.target || ov.content?.slice(0,70) || '');
      return `
      <div class="gw-ov-item" style="opacity:.75;border-color:#0d0d0d">
        <div>
          <div class="gw-ov-row">
            <span class="gw-ov-badge ${badgeCls}">${escHtml(ov.type)}</span>
            <span class="gw-ov-match">${escHtml(ov.match)}</span>
            ${ov.display?`<span style="font-size:11px;color:#444">${escHtml(ov.display)}</span>`:''}
          </div>
          <div class="gw-ov-target">${target}${(ov.content?.length||0)>70?'…':''}</div>
        </div>
        <div class="gw-ov-actions">
          <button class="gw-btn" style="font-size:11px" onclick="navigateTo('${escAttr(ov.match)}')">▶ Test</button>
          <button class="gw-btn" style="font-size:11px" onclick="gwCloneFromListJson('${escAttr(ov.match)}')">⧉ Clone</button>
        </div>
      </div>`;
    }).join('')}
    </div>`;
}

function gwCloneFromListJson(match) {
  const ov = jsonOverrides.find(o => o.match === match);
  if (!ov) return;
  const clone = { ...ov }; delete clone.id;
  window.SpectralLO.add(clone);
  gwRenderOverrides();
  gwRefreshStats();
  showDlToast('✓ Cloned to local overrides');
}

function gwOvModal(existing) {
  const isNew = !existing;
  const ov    = existing || { type: 'redirect', match: '', target: '', display: '', content: '', tabTitle: '', tabFavicon: '', tabImage: '', password: '' };

  const bg = document.createElement('div');
  bg.className = 'gw-modal-bg';
  bg.innerHTML = `
  <div class="gw-modal" onclick="event.stopPropagation()">
    <div class="gw-modal-title">${isNew ? '⚡ New Override' : '✏️ Edit Override'}</div>

    <div class="gw-form-section">// Core</div>

    <div class="gw-form-row">
      <label class="gw-form-label">Type</label>
      <select class="gw-input gw-select" id="gw-ov-type" onchange="gwOvTypeChange()">
        <option value="redirect"    ${ov.type==='redirect'    ?'selected':''}>redirect — iframe real URL (URL hidden)</option>
        <option value="html"        ${ov.type==='html'        ?'selected':''}>html — plain HTML → blob</option>
        <option value="html_base64" ${ov.type==='html_base64' ?'selected':''}>html_base64 — base64 HTML → blob</option>
        <option value="html_uri"    ${ov.type==='html_uri'    ?'selected':''}>html_uri — URI-encoded HTML → blob</option>
        <option value="fetch"       ${ov.type==='fetch'       ?'selected':''}>fetch — fetch URL → blob</option>
        <option value="local"       ${ov.type==='local'       ?'selected':''}>local — serve from local:// filesystem</option>
        <option value="github"      ${ov.type==='github'      ?'selected':''}>github — GitHub Pages (URL hidden)</option>
      </select>
    </div>

    <div class="gw-form-row">
      <label class="gw-form-label">Match URL / Protocol (any scheme works)</label>
      <input type="text" class="gw-input" id="gw-ov-match" value="${escAttr(ov.match)}" placeholder="e.g. myapp://game  cool://site  https://example.com"/>
    </div>

    <div class="gw-form-row" id="gw-ov-target-row">
      <label class="gw-form-label" id="gw-ov-target-label">Target URL</label>
      <input type="text" class="gw-input" id="gw-ov-target" value="${escAttr(ov.target || '')}" placeholder="https://...  or  /local/path"/>
    </div>

    <div class="gw-form-row" id="gw-ov-content-row" style="display:none">
      <label class="gw-form-label" id="gw-ov-content-label">HTML Content</label>
      <textarea class="gw-input" id="gw-ov-content" placeholder="Enter HTML here…">${escHtml(ov.content || '')}</textarea>
    </div>

    <div class="gw-form-section">// Tab Appearance (optional)</div>

    <div class="gw-form-row">
      <label class="gw-form-label">Display Name / Tab Title override</label>
      <input type="text" class="gw-input" id="gw-ov-display" value="${escAttr(ov.display || '')}" placeholder="Label shown in tab and address bar"/>
    </div>

    <div class="gw-form-row">
      <label class="gw-form-label">Tab Title (overrides auto-detected title)</label>
      <input type="text" class="gw-input" id="gw-ov-tabTitle" value="${escAttr(ov.tabTitle || '')}" placeholder="Force a specific tab title"/>
    </div>

    <div class="gw-form-row">
      <label class="gw-form-label">Tab Favicon (emoji or image URL)</label>
      <input type="text" class="gw-input" id="gw-ov-tabFavicon" value="${escAttr(ov.tabFavicon || '')}" placeholder="🎮  or  https://site.com/favicon.ico  or  data:image/..."/>
    </div>

    <div class="gw-form-row">
      <label class="gw-form-label">Tab Background Image URL (optional — shown behind tab label)</label>
      <input type="text" class="gw-input" id="gw-ov-tabImage" value="${escAttr(ov.tabImage || '')}" placeholder="https://... or data:image/... or local://path/to/image.png"/>
    </div>

    <div id="gw-tab-preview-wrap" style="display:none">
      <label class="gw-form-label">Tab Preview</label>
      <div class="gw-tab-preview" id="gw-tab-preview">
        <span class="gw-tab-preview-fav" id="gw-prev-fav">🌐</span>
        <span class="gw-tab-preview-title" id="gw-prev-title">Tab Title</span>
      </div>
    </div>

    <div class="gw-form-section">// Security (optional)</div>

    <div class="gw-form-row">
      <label class="gw-form-label">Password (leave blank for no protection)</label>
      <input type="text" class="gw-input" id="gw-ov-password" value="${escAttr(ov.password || '')}" placeholder="Password required before page loads" autocomplete="new-password"/>
    </div>

    <div class="gw-modal-actions">
      <button class="gw-btn" onclick="this.closest('.gw-modal-bg').remove()">Cancel</button>
      <button class="gw-btn gw-btn-primary" onclick="gwOvSave('${escAttr(ov.id || '')}')">💾 Save</button>
    </div>
  </div>`;
  document.body.appendChild(bg);
  bg.addEventListener('click', () => bg.remove());
  gwOvTypeChange();

  // Live tab preview
  const updatePreview = () => {
    const fav   = document.getElementById('gw-ov-tabFavicon')?.value?.trim();
    const title = document.getElementById('gw-ov-display')?.value?.trim() ||
                  document.getElementById('gw-ov-tabTitle')?.value?.trim() ||
                  document.getElementById('gw-ov-match')?.value?.trim() || 'Tab';
    const img   = document.getElementById('gw-ov-tabImage')?.value?.trim();

    const prevWrap = document.getElementById('gw-tab-preview-wrap');
    if (prevWrap) prevWrap.style.display = (fav || img) ? '' : 'none';

    const prevFav = document.getElementById('gw-prev-fav');
    if (prevFav) {
      if (fav?.startsWith('http') || fav?.startsWith('data:')) {
        prevFav.innerHTML = `<img src="${escAttr(fav)}" style="width:16px;height:16px;object-fit:contain" onerror="this.outerHTML='🌐'">`;
      } else {
        prevFav.textContent = fav || '🌐';
      }
    }
    const prevTitle = document.getElementById('gw-prev-title');
    if (prevTitle) prevTitle.textContent = title;

    const prevWrapEl = document.getElementById('gw-tab-preview');
    if (prevWrapEl && img) {
      prevWrapEl.style.backgroundImage = `url(${img})`;
      prevWrapEl.style.backgroundSize  = 'cover';
    } else if (prevWrapEl) {
      prevWrapEl.style.backgroundImage = '';
    }
  };

  ['gw-ov-tabFavicon','gw-ov-tabImage','gw-ov-display','gw-ov-tabTitle','gw-ov-match'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updatePreview);
  });
  updatePreview();
}

function gwOvTypeChange() {
  const type   = document.getElementById('gw-ov-type')?.value;
  const tRow   = document.getElementById('gw-ov-target-row');
  const cRow   = document.getElementById('gw-ov-content-row');
  const tLabel = document.getElementById('gw-ov-target-label');
  const cLabel = document.getElementById('gw-ov-content-label');
  if (!type) return;
  const hasContent = ['html','html_base64','html_uri'].includes(type);
  const hasTarget  = ['redirect','fetch','github','local'].includes(type);
  if (cRow) cRow.style.display = hasContent ? '' : 'none';
  if (tRow) tRow.style.display = hasTarget  ? '' : 'none';
  if (tLabel) tLabel.textContent = type === 'local' ? 'Local Path (e.g. /games/index.html)' : 'Target URL';
  if (cLabel) cLabel.textContent = {
    html: 'HTML Content (plain)',
    html_base64: 'Base64-Encoded HTML',
    html_uri: 'URI-Encoded HTML',
  }[type] || 'Content';
}

function gwOvSave(existingId) {
  const type       = document.getElementById('gw-ov-type')?.value;
  const match      = document.getElementById('gw-ov-match')?.value?.trim();
  const display    = document.getElementById('gw-ov-display')?.value?.trim();
  const target     = document.getElementById('gw-ov-target')?.value?.trim();
  const content    = document.getElementById('gw-ov-content')?.value || '';
  const tabTitle   = document.getElementById('gw-ov-tabTitle')?.value?.trim();
  const tabFavicon = document.getElementById('gw-ov-tabFavicon')?.value?.trim();
  const tabImage   = document.getElementById('gw-ov-tabImage')?.value?.trim();
  const password   = document.getElementById('gw-ov-password')?.value?.trim();

  if (!match || !type) { alert('Match and Type are required.'); return; }

  const entry = { type, match, display, target, content, tabTitle, tabFavicon, tabImage, password };
  // Remove empty optional fields
  Object.keys(entry).forEach(k => { if (entry[k] === '' || entry[k] === undefined) delete entry[k]; });

  if (existingId) window.SpectralLO.update(existingId, entry);
  else            window.SpectralLO.add(entry);
  document.querySelector('.gw-modal-bg')?.remove();
  gwRenderOverrides();
  gwRefreshStats();
}

// ── FILESYSTEM UI ──────────────────────────────────────────────
function gwRenderFS(dirPath) {
  gwFsCurrentPath = dirPath;
  const bread = document.getElementById('gw-fs-bread');
  const list  = document.getElementById('gw-fs-list');
  if (!bread || !list) return;

  const parts = dirPath.split('/').filter(Boolean);
  let crumbs  = `<span style="cursor:pointer;color:var(--cyan)" onclick="gwRenderFS('/')">/</span>`;
  let acc = '';
  for (const p of parts) {
    acc += '/' + p;
    const a = acc;
    crumbs += ` <span style="color:#444">›</span> <span style="cursor:pointer;color:#666;font-size:11px" onclick="gwRenderFS('${escAttr(a)}')">${escHtml(p)}</span>`;
  }
  bread.innerHTML = crumbs;

  const { files, dirs } = window.SpectralFS.listDir(dirPath);
  list.innerHTML = '';

  if (dirPath !== '/') {
    const parent = dirPath.split('/').slice(0,-1).join('/') || '/';
    list.insertAdjacentHTML('beforeend', `<div class="gw-fs-item" onclick="gwRenderFS('${escAttr(parent)}')"><span class="gw-fs-icon">📁</span><span class="gw-fs-name" style="color:#444">.. (back)</span></div>`);
  }

  dirs.sort().forEach(d => {
    const name = d.split('/').pop();
    list.insertAdjacentHTML('beforeend', `
      <div class="gw-fs-item" onclick="gwRenderFS('${escAttr(d)}')">
        <span class="gw-fs-icon">📁</span><span class="gw-fs-name">${escHtml(name)}/</span>
        <div class="gw-fs-actions"><button class="gw-fs-action-btn del" onclick="event.stopPropagation();gwFsDeleteDir('${escAttr(d)}')">🗑 Delete</button></div>
      </div>`);
  });

  files.sort((a,b) => a.name.localeCompare(b.name)).forEach(f => {
    const localUrl = 'local://' + f.path;
    list.insertAdjacentHTML('beforeend', `
      <div class="gw-fs-item">
        <span class="gw-fs-icon">${gwFileIcon(f.mime)}</span>
        <span class="gw-fs-name" title="${escAttr(f.path)}">${escHtml(f.name)}</span>
        <span class="gw-fs-meta">${window.SpectralFS.formatSize(f.size)}</span>
        <div class="gw-fs-actions">
          <button class="gw-fs-action-btn" onclick="navigateTo('${escAttr(localUrl)}')">▶ Open</button>
          <button class="gw-fs-action-btn" onclick="gwFsEdit('${escAttr(f.path)}')">✏️ Edit</button>
          <button class="gw-fs-action-btn" onclick="gwFsExportFile('${escAttr(f.path)}')">⬇ Save</button>
          <button class="gw-fs-action-btn" onclick="gwFsRename('${escAttr(f.path)}')">🏷 Rename</button>
          <button class="gw-fs-action-btn del" onclick="gwFsDelete('${escAttr(f.path)}')">🗑</button>
        </div>
      </div>`);
  });

  if (!files.length && !dirs.length && dirPath !== '/') {
    list.insertAdjacentHTML('beforeend', `<div style="color:#222;font-family:var(--font-mono);font-size:12px;padding:20px 8px;text-align:center">// Empty directory</div>`);
  }
  gwRefreshStats();
}

function gwFileIcon(mime = '') {
  if (mime.startsWith('image/'))   return '🖼️';
  if (mime.startsWith('video/'))   return '🎬';
  if (mime.startsWith('audio/'))   return '🎵';
  if (mime.includes('html'))       return '🌐';
  if (mime.includes('pdf'))        return '📕';
  if (mime.includes('zip'))        return '🗜️';
  if (mime.includes('json'))       return '📋';
  if (mime.includes('javascript') || mime.includes('css')) return '📜';
  return '📄';
}

async function gwHandleUpload(e) {
  const files = [...e.target.files];
  if (!files.length) return;
  let done = 0;
  for (const file of files) {
    const path = window.SpectralFS.normPath(gwFsCurrentPath + '/' + file.name);
    const mime = file.type || window.SpectralFS.mimeFromName(file.name);
    await window.SpectralFS.write(path, await file.arrayBuffer(), mime);
    done++;
  }
  alert(`✅ ${done} file(s) uploaded to ${gwFsCurrentPath}`);
  gwRenderFS(gwFsCurrentPath);
  e.target.value = '';
}

function gwFsUpload()  { document.getElementById('gw-file-input')?.click(); }
function gwFsNewFolder() {
  const name = prompt('Folder name:');
  if (!name?.trim()) return;
  const path = window.SpectralFS.normPath(gwFsCurrentPath + '/' + name.trim() + '/.keep');
  window.SpectralFS.write(path, '', 'text/plain').then(() => gwRenderFS(gwFsCurrentPath));
}

async function gwFsEdit(path) {
  const text = await window.SpectralFS.readText(path);
  const info = window.SpectralFS.info(path);
  document.querySelectorAll('.gw-nav-item').forEach(e => e.classList.remove('active'));
  document.querySelectorAll('.gw-panel').forEach(e => e.classList.remove('active'));
  document.querySelector('[data-panel="editor"]')?.classList.add('active');
  document.getElementById('gw-panel-editor')?.classList.add('active');
  document.getElementById('gw-editor-area').value = text || '';
  const mimeEl = document.getElementById('gw-editor-mime');
  if (mimeEl && info?.mime) mimeEl.value = info.mime;
  document.getElementById('gw-editor-title').textContent  = '✏️ ' + path;
  document.getElementById('gw-editor-path-tip').textContent = 'Editing: local://' + path;
  gwEditorCurrentPath = path;
}

async function gwEditorSave() {
  const content = document.getElementById('gw-editor-area')?.value || '';
  const mime    = document.getElementById('gw-editor-mime')?.value || 'text/plain';
  let path = gwEditorCurrentPath;
  if (!path) {
    path = prompt('Save as path (e.g. /index.html):');
    if (!path?.trim()) return;
    path = window.SpectralFS.normPath(path.trim());
    gwEditorCurrentPath = path;
  }
  await window.SpectralFS.write(path, content, mime);
  document.getElementById('gw-editor-path-tip').textContent = '✅ Saved to local://' + path;
  gwRefreshStats();
}

function gwEditorPreview() {
  const html = document.getElementById('gw-editor-area')?.value || '';
  createTab(URL.createObjectURL(new Blob([html], { type: 'text/html' })));
}

function gwFsDelete(path)    { if (confirm('Delete ' + path + '?')) { window.SpectralFS.delete(path); gwRenderFS(gwFsCurrentPath); } }
function gwFsDeleteDir(dir)  {
  const files = window.SpectralFS.list(dir);
  if (!confirm(`Delete "${dir}" and all ${files.length} file(s)?`)) return;
  files.forEach(f => window.SpectralFS.delete(f.path));
  gwRenderFS(gwFsCurrentPath);
}
function gwFsRename(path) {
  const name = prompt('New name:', path.split('/').pop());
  if (!name?.trim()) return;
  const newPath = path.split('/').slice(0,-1).join('/') + '/' + name.trim();
  window.SpectralFS.rename(path, window.SpectralFS.normPath(newPath));
  gwRenderFS(gwFsCurrentPath);
}
async function gwFsExportFile(path) {
  const blob = window.SpectralFS.read(path);
  if (!blob) return alert('File not found.');
  const info = window.SpectralFS.info(path);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = info?.name || path.split('/').pop();
  a.click();
}

// ── IMPORT/EXPORT ──────────────────────────────────────────────
async function gwExportOverrides() {
  const enc = document.getElementById('gw-ov-enc')?.value || 'base64';
  gwOutputData = window.SpectralLO.export(enc);
  gwOutputFilename = 'spectral-overrides.json';
  document.getElementById('gw-output-txt').value = gwOutputData;
  document.getElementById('gw-output-desc').textContent = `✅ Overrides exported (${enc}). ${gwOutputData.length} chars.`;
}

function gwImportOverrides(merge) {
  const enc  = document.getElementById('gw-ov-imp-enc')?.value || 'base64';
  const data = document.getElementById('gw-ov-import-txt')?.value?.trim();
  if (!data) return alert('No data to import.');
  try { const n = window.SpectralLO.import(data, enc, merge); alert(`✅ ${n} override(s) ${merge?'merged':'imported'}.`); gwRenderOverrides(); gwRefreshStats(); }
  catch (e) { alert('Import failed: ' + e.message); }
}

async function gwExportFS() {
  const enc = document.getElementById('gw-fs-enc')?.value || 'base64';
  try {
    gwOutputData = await window.SpectralFS.exportAll(enc);
    gwOutputFilename = 'spectral-fs.json';
    document.getElementById('gw-output-txt').value = gwOutputData;
    document.getElementById('gw-output-desc').textContent = `✅ Filesystem exported (${enc}). ${gwOutputData.length} chars.`;
  } catch (e) { alert('Export failed: ' + e.message); }
}

async function gwImportFS(merge) {
  const enc  = document.getElementById('gw-fs-imp-enc')?.value || 'base64';
  const data = document.getElementById('gw-fs-import-txt')?.value?.trim();
  if (!data) return alert('No data to import.');
  try { const n = await window.SpectralFS.importAll(data, merge); alert(`✅ ${n} file(s) ${merge?'merged':'imported'}.`); gwRenderFS(gwFsCurrentPath); gwRefreshStats(); }
  catch (e) { alert('Import failed: ' + e.message); }
}

function gwImportFSFromFile() { document.getElementById('gw-fs-import-input')?.click(); }
async function gwHandleFSImportFile(e) {
  const file = e.target.files[0]; if (!file) return;
  document.getElementById('gw-fs-import-txt').value = await file.text();
  e.target.value = '';
}

function gwCopyOutput() {
  const txt = document.getElementById('gw-output-txt')?.value;
  if (!txt) return;
  navigator.clipboard.writeText(txt).then(() => alert('✅ Copied!'));
}
function gwDownloadOutput() {
  if (!gwOutputData) return;
  const a = document.createElement('a');
  a.href     = 'data:application/json;charset=utf-8,' + encodeURIComponent(gwOutputData);
  a.download = gwOutputFilename;
  a.click();
}

// ── CLOCK ──────────────────────────────────────────────────────
let clockInterval = null;
function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  const tick = () => {
    const ce = document.getElementById('nt-clock'); const de = document.getElementById('nt-date');
    if (!ce) { clearInterval(clockInterval); clockInterval = null; return; }
    const now = new Date();
    ce.textContent = now.toTimeString().slice(0, 8);
    if (de) de.textContent = now.toDateString().toUpperCase();
  };
  tick(); clockInterval = setInterval(tick, 1000);
}

// ── SHORTCUTS ──────────────────────────────────────────────────
function renderShortcuts(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = SHORTCUTS.map(s =>
    `<div class="shortcut-card" onclick="navigateTo('${escAttr(s.url)}')"><span class="shortcut-icon">${s.icon}</span><span class="shortcut-label">${escHtml(s.label)}</span></div>`
  ).join('');
}

function wsGo() { const v = document.getElementById('ws-input')?.value?.trim(); if (v) navigateTo(v); }
function ntGo() { const v = document.getElementById('nt-input')?.value?.trim(); if (v) navigateTo(v); }

// ── BOOKMARKS ──────────────────────────────────────────────────
function addBookmark(url, title)  { if (bookmarks.some(b => b.url === url)) return; bookmarks.push({ id: Date.now(), url, title: title || url }); renderBookmarks(); save(); }
function removeBookmark(id)       { bookmarks = bookmarks.filter(b => b.id !== id); renderBookmarks(); save(); updateBookmarkBtn(activeTab()?.url || ''); }

function renderBookmarks() {
  const bar = document.getElementById('bookmarks-bar');
  bar.innerHTML = '';
  bookmarks.forEach(bm => {
    const el = document.createElement('div');
    el.className = 'bookmark-item'; el.draggable = true; el.dataset.id = bm.id;
    el.innerHTML = `<span class="bm-icon">🔖</span><span class="bm-label">${escHtml(bm.title)}</span>`;
    el.addEventListener('click',       ()  => navigateTo(bm.url));
    el.addEventListener('contextmenu', e   => { e.preventDefault(); showBmCtx(bm.id, e.clientX, e.clientY); });
    el.addEventListener('dragstart',   e   => { e.dataTransfer.setData('bm-id', String(bm.id)); setTimeout(() => el.classList.add('dragging'), 0); });
    el.addEventListener('dragend',     ()  => el.classList.remove('dragging'));
    el.addEventListener('dragover',    e   => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave',   ()  => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      const fi = bookmarks.findIndex(b => b.id === Number(e.dataTransfer.getData('bm-id')));
      const ti = bookmarks.findIndex(b => b.id === bm.id);
      if (fi === ti) return;
      const [m] = bookmarks.splice(fi, 1); bookmarks.splice(ti, 0, m);
      renderBookmarks(); save();
    });
    bar.appendChild(el);
  });
}

// ── BOOKMARK CONTEXT MENU ──────────────────────────────────────
let ctxBmId = null;
function showBmCtx(id, x, y) {
  ctxBmId = id;
  const ctx = document.getElementById('bm-ctx');
  ctx.style.display = 'block'; ctx.style.left = x + 'px'; ctx.style.top = y + 'px';
  requestAnimationFrame(() => {
    const r = ctx.getBoundingClientRect();
    if (r.right  > window.innerWidth)  ctx.style.left = (window.innerWidth  - r.width  - 8) + 'px';
    if (r.bottom > window.innerHeight) ctx.style.top  = (window.innerHeight - r.height - 8) + 'px';
  });
}
function hideBmCtx() { document.getElementById('bm-ctx').style.display = 'none'; ctxBmId = null; }

// ── NAV ────────────────────────────────────────────────────────
function updateNavBtns(tab) {
  document.getElementById('btn-back').disabled = !(tab?.historyBack?.length > 0);
  document.getElementById('btn-fwd').disabled  = !(tab?.historyFwd?.length  > 0);
}

function updateLock(url) {
  const lock = document.getElementById('url-lock');
  lock.className = '';
  if (/^https:\/\//i.test(url) || url.startsWith('spectral://') || url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('local://')) {
    lock.textContent = '🔒'; lock.className = 'secure';
  } else if (/^http:\/\//i.test(url)) {
    lock.textContent = '⚠';  lock.className = 'insecure';
  } else {
    lock.textContent = '🌐'; lock.className = 'neutral';
  }
}

function updateBookmarkBtn(url) {
  const btn = document.getElementById('bookmark-btn');
  const isBm = bookmarks.some(b => b.url === url);
  btn.classList.toggle('bookmarked', isBm);
  btn.textContent = isBm ? '★' : '☆';
}

// ── LOADING BAR ────────────────────────────────────────────────
let loadingTimer = null, loadPct = 0;
function showLoading() {
  const bar = document.getElementById('loading-bar');
  bar.classList.add('loading'); loadPct = 0; bar.style.width = '0%';
  if (loadingTimer) clearInterval(loadingTimer);
  loadingTimer = setInterval(() => { loadPct += Math.random() * 12 + 3; if (loadPct > 88) loadPct = 88; bar.style.width = loadPct + '%'; }, 120);
}
function hideLoading() {
  if (loadingTimer) { clearInterval(loadingTimer); loadingTimer = null; }
  const bar = document.getElementById('loading-bar');
  bar.style.width = '100%';
  setTimeout(() => { bar.classList.remove('loading'); bar.style.width = '0%'; }, 280);
}

// ── SETTINGS ACTIONS ───────────────────────────────────────────
function changeHomepage()     { const v = prompt('New homepage URL:', settings.homepage); if (v?.trim()) { settings.homepage = v.trim(); save(); navigateTo('spectral://settings'); } }
function changeSearchEngine() { const v = prompt('Search engine URL:', settings.searchEngine); if (v?.trim()) { settings.searchEngine = v.trim(); save(); navigateTo('spectral://settings'); } }
function toggleBookmarksBar(el) { el.classList.toggle('on'); settings.bookmarksBar = el.classList.contains('on'); document.getElementById('bookmarks-bar').style.display = settings.bookmarksBar ? 'flex' : 'none'; save(); }
async function reloadOverrides() { await loadOverrides(); navigateTo('spectral://settings'); }
function clearData() { if (confirm('Clear all Spectral.exe browser data?')) { localStorage.removeItem(STORAGE_KEY); location.reload(); } }

// ── HELPERS ────────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return escHtml(s); }

// ── FULLSCREEN ─────────────────────────────────────────────────
let spectralFullscreen = false;

function toggleFullscreen() {
  spectralFullscreen = !spectralFullscreen;
  document.body.classList.toggle('spectral-fullscreen', spectralFullscreen);
  const btn = document.getElementById('btn-fullscreen');
  if (spectralFullscreen) {
    btn.classList.add('is-fullscreen');
    btn.title     = 'Exit Fullscreen';
    btn.innerHTML = '&#x2715;'; // ✕ while fullscreen
    // Try real browser fullscreen API too
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    btn.classList.remove('is-fullscreen');
    btn.title     = 'Fullscreen tab';
    btn.innerHTML = '&#x26F6;';
    document.exitFullscreen?.().catch(() => {});
  }
}

// Sync if user presses Escape / browser F11 exits native fullscreen
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && spectralFullscreen) {
    spectralFullscreen = false;
    document.body.classList.remove('spectral-fullscreen');
    const btn = document.getElementById('btn-fullscreen');
    if (btn) { btn.classList.remove('is-fullscreen'); btn.title = 'Fullscreen tab'; btn.innerHTML = '&#x26F6;'; }
  }
});

// ── DOWNLOAD PAGE → local:// ────────────────────────────────────
async function downloadCurrentPage() {
  const tab = activeTab();
  if (!tab) return;

  const btn = document.getElementById('btn-download');
  btn.classList.add('downloading');

  const url = tab.url;
  let saved = false;

  try {
    // ── Case 1: spectral:// or local:// internal pages — skip
    if (url.startsWith('spectral://') || url.startsWith('about:')) {
      showDlToast('⚠ Cannot save internal spectral:// pages', 'warn');
      return;
    }

    // ── Case 2: local:// file — it's already saved, just notify
    if (url.startsWith('local://')) {
      showDlToast('💾 Already in local:// filesystem');
      return;
    }

    // ── Case 3: blob: URL — read blob content directly
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      const res  = await fetch(url);
      const blob = await res.blob();
      const ext  = blob.type.includes('html') ? '.html' : blob.type.includes('image/') ? ('.' + blob.type.split('/')[1]) : '.bin';
      const path = await dlPromptPath('/downloads/page' + ext);
      if (!path) return;
      await window.SpectralFS.write(path, await blob.arrayBuffer(), blob.type);
      showDlToast('✓ Saved to local://' + path);
      saved = true;
      return;
    }

    // ── Case 4: detect by URL extension (image, etc.)
    const urlPath   = (() => { try { return new URL(url).pathname; } catch(_) { return url; } })();
    const ext       = urlPath.split('.').pop().toLowerCase();
    const imageExts = ['png','jpg','jpeg','gif','webp','svg','ico','bmp','avif'];
    const isImage   = imageExts.includes(ext);

    if (isImage) {
      // Fetch binary image and save
      const res  = await fetch(url, { mode: 'no-cors' }).catch(() => null);
      if (res) {
        const blob = await res.blob();
        const mime = blob.type || ('image/' + ext);
        const name = urlPath.split('/').pop() || ('image.' + ext);
        const path = await dlPromptPath('/downloads/' + name);
        if (!path) return;
        await window.SpectralFS.write(path, await blob.arrayBuffer(), mime);
        showDlToast('✓ Image saved to local://' + path);
        saved = true;
        return;
      }
    }

    // ── Case 5: Try to get HTML from the active iframe
    const contentEl = document.querySelector(`.tab-content[data-id="${tab.id}"]`);
    const iframe    = contentEl?.querySelector('iframe');

    // Same-origin blob iframe — we can read its HTML
    if (iframe?.src?.startsWith('blob:') || iframe?.src?.startsWith('data:')) {
      const res  = await fetch(iframe.src);
      const text = await res.text();
      const path = await dlPromptPath('/downloads/page.html');
      if (!path) return;
      await window.SpectralFS.write(path, text, 'text/html');
      showDlToast('✓ HTML saved to local://' + path);
      saved = true;
      return;
    }

    // Cross-origin — fetch directly
    const fetchUrl = iframe?.getAttribute('data-spectral-src') || url;
    const res      = await fetch(fetchUrl).catch(() => null);
    if (res && res.ok) {
      const contentType = res.headers.get('content-type') || '';
      const isHtml      = contentType.includes('html');
      const isImg       = contentType.includes('image/');
      const body        = await res.arrayBuffer();
      const mime        = contentType.split(';')[0].trim();
      const defExt      = isHtml ? '.html' : isImg ? ('.' + mime.split('/')[1]) : '.bin';
      const name        = urlPath.split('/').pop() || ('download' + defExt);
      const path        = await dlPromptPath('/downloads/' + name);
      if (!path) return;
      await window.SpectralFS.write(path, body, mime || 'application/octet-stream');
      showDlToast('✓ Saved to local://' + path);
      saved = true;
      return;
    }

    showDlToast('⚠ Could not fetch page (cross-origin restriction)', 'warn');

  } catch (e) {
    showDlToast('✗ Download failed: ' + e.message, 'err');
  } finally {
    btn.classList.remove('downloading');
  }
}

function dlPromptPath(defaultPath) {
  return new Promise(resolve => {
    // Custom styled prompt modal
    const bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:99998;display:flex;align-items:center;justify-content:center';
    bg.innerHTML = `
      <div style="background:#080808;border:1px solid #252525;border-radius:10px;padding:24px;width:440px;max-width:95vw;display:flex;flex-direction:column;gap:14px;box-shadow:0 0 40px rgba(0,255,136,.07)">
        <div style="font-family:var(--font-logo);font-size:13px;color:var(--g);letter-spacing:2px">⬇ SAVE TO local://</div>
        <div style="font-family:var(--font-mono);font-size:11px;color:#2a5a2a">Destination path in local:// filesystem:</div>
        <input id="dl-path-input" type="text" value="${defaultPath}"
          style="background:#050505;border:1px solid #252525;border-radius:5px;color:#00ff41;font-family:var(--font-mono);font-size:13px;padding:9px 14px;outline:none;width:100%;transition:border-color .2s;letter-spacing:.5px"
          onfocus="this.style.borderColor='var(--g)'" onblur="this.style.borderColor='#252525'"/>
        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="dl-cancel" style="background:transparent;border:1px solid #252525;border-radius:4px;color:#444;font-family:var(--font-mono);font-size:12px;padding:7px 16px;cursor:pointer">Cancel</button>
          <button id="dl-save"   style="background:linear-gradient(135deg,#001a0a,#003322);border:1px solid var(--g);border-radius:4px;color:var(--g);font-family:var(--font-logo);font-size:11px;letter-spacing:1px;padding:7px 18px;cursor:pointer">SAVE</button>
        </div>
      </div>`;
    document.body.appendChild(bg);
    const input = bg.querySelector('#dl-path-input');
    input.focus(); input.select();
    const ok  = () => { const v = input.value.trim(); bg.remove(); resolve(v || null); };
    const esc = () => { bg.remove(); resolve(null); };
    bg.querySelector('#dl-save').addEventListener('click', ok);
    bg.querySelector('#dl-cancel').addEventListener('click', esc);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') esc(); });
  });
}

function showDlToast(msg, type = 'ok') {
  let t = document.getElementById('spectral-dl-toast');
  if (!t) { t = document.createElement('div'); t.id = 'spectral-dl-toast'; document.body.appendChild(t); }
  const colors = { ok: 'var(--g)', warn: 'var(--yellow)', err: 'var(--r)' };
  t.style.color = colors[type] || colors.ok;
  t.style.borderColor = colors[type] || colors.ok;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

// ── DEV GATE — list.json protected panel ──────────────────────
// The Spectral Dev token: a fixed UUID-style key hard-coded here.
// Change this to any UUID-looking string — it's the "prove you're a dev" gate.
const SPECTRAL_DEV_TOKEN = 'SPEC-7F3A-19CC-4D2B-A801-E99F2C38D1B7';
const DEV_GATE_KEY       = 'spectral_dev_unlocked';

function isDevUnlocked() {
  return sessionStorage.getItem(DEV_GATE_KEY) === '1';
}

// Called from gateway or anywhere list.json entries need to be shown
function requireDevAuth(onUnlock) {
  if (isDevUnlocked()) { onUnlock(); return; }

  // Generate a fake-looking "session token" shown as flavour text
  const fakeSession = Array.from({length: 4}, () =>
    Math.random().toString(16).slice(2, 6).toUpperCase()
  ).join('-');

  const bg = document.createElement('div');
  bg.className = 'gw-modal-bg';
  bg.style.zIndex = '20000';
  let attempts = 0;

  bg.innerHTML = `
  <div style="background:#030303;border:1px solid #1a1a1a;border-radius:12px;padding:36px 40px;width:520px;max-width:95vw;display:flex;flex-direction:column;gap:0;box-shadow:0 0 80px rgba(0,238,255,.06),0 40px 100px rgba(0,0,0,.98)"
    onclick="event.stopPropagation()">
    <div class="devgate-wrap">
      <div class="devgate-icon">🛡</div>
      <div class="devgate-title">Spectral Dev Auth</div>
      <div class="devgate-uuid">session // ${fakeSession}</div>
      <div class="devgate-sub">list.json overrides are restricted to verified Spectral developers.<br>Enter your dev token to unlock this view.</div>
      <div class="devgate-hint">format: SPEC-xxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</div>
      <div class="devgate-form">
        <input class="devgate-input" id="devgate-input" type="password"
          placeholder="SPEC-xxxx-xxxx-xxxx-xxxx-xxxx"
          autocomplete="off" spellcheck="false"/>
        <button class="devgate-btn" id="devgate-btn">VERIFY</button>
      </div>
      <div class="devgate-error" id="devgate-error"></div>
      <div class="devgate-attempts" id="devgate-attempts"></div>
    </div>
  </div>`;
  document.body.appendChild(bg);

  // Auto-uppercase and format as they type
  const input = document.getElementById('devgate-input');
  input.addEventListener('input', () => {
    // Don't force format during typing — just uppercase
    input.value = input.value.toUpperCase();
  });

  const verify = () => {
    const val = input.value.trim();
    if (val === SPECTRAL_DEV_TOKEN) {
      sessionStorage.setItem(DEV_GATE_KEY, '1');
      bg.remove();
      // Brief flash before calling unlock
      showDlToast('✓ Dev access granted — session active', 'ok');
      setTimeout(onUnlock, 180);
    } else {
      attempts++;
      const errEl = document.getElementById('devgate-error');
      const attEl = document.getElementById('devgate-attempts');
      const msgs  = [
        'ACCESS DENIED — invalid token',
        'AUTHENTICATION FAILED — retry',
        'TOKEN MISMATCH — verification error',
        'REJECTED — check your credentials',
      ];
      if (errEl) { errEl.textContent = msgs[(attempts - 1) % msgs.length]; errEl.style.opacity = '1'; setTimeout(() => errEl.style.opacity = '0', 1800); }
      if (attEl) attEl.textContent = attempts > 1 ? `${attempts} failed attempt${attempts > 1 ? 's' : ''} this session` : '';
      input.value = '';
      input.focus();
      // Shake animation
      input.style.animation = 'none';
      requestAnimationFrame(() => { input.style.animation = 'borderGlow 0.3s ease-in-out 2'; });
    }
  };

  document.getElementById('devgate-btn').addEventListener('click', verify);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') verify(); if (e.key === 'Escape') bg.remove(); });
  input.focus();
}

// ── EVENT WIRING ───────────────────────────────────────────────
function wireEvents() {
  document.getElementById('new-tab-btn').addEventListener('click', () => createTab('spectral://new_tab'));

  document.getElementById('btn-back').addEventListener('click', () => {
    const tab = activeTab(); if (!tab?.historyBack?.length) return;
    tab.historyFwd.push(tab.url); navigateTo(tab.historyBack.pop(), true);
  });
  document.getElementById('btn-fwd').addEventListener('click', () => {
    const tab = activeTab(); if (!tab?.historyFwd?.length) return;
    tab.historyBack.push(tab.url); navigateTo(tab.historyFwd.pop(), true);
  });
  document.getElementById('btn-refresh').addEventListener('click', () => { const tab = activeTab(); if (tab) navigateTo(tab.url, true); });
  document.getElementById('btn-home').addEventListener('click', () => navigateTo(settings.homepage));

  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-download').addEventListener('click', downloadCurrentPage);

  const urlBar = document.getElementById('url-bar');
  urlBar.addEventListener('keydown', e => { if (e.key === 'Enter') navigateTo(urlBar.value); });
  urlBar.addEventListener('focus', () => urlBar.select());
  document.getElementById('url-go').addEventListener('click', () => navigateTo(urlBar.value));

  document.getElementById('bookmark-btn').addEventListener('click', () => {
    const tab = activeTab(); if (!tab) return;
    const existing = bookmarks.find(b => b.url === tab.url);
    if (existing) removeBookmark(existing.id); else addBookmark(tab.url, tab.title);
    updateBookmarkBtn(tab.url);
  });

  document.addEventListener('click', () => hideBmCtx());
  document.getElementById('bm-ctx').addEventListener('click', e => e.stopPropagation());

  document.getElementById('ctx-open').addEventListener('click', () => { const bm = bookmarks.find(b => b.id === ctxBmId); if (bm) navigateTo(bm.url); hideBmCtx(); });
  document.getElementById('ctx-remove').addEventListener('click', () => { if (ctxBmId != null) removeBookmark(ctxBmId); hideBmCtx(); });
  document.getElementById('ctx-rename').addEventListener('click', () => {
    const bm   = bookmarks.find(b => b.id === ctxBmId);
    const bmEl = document.querySelector(`.bookmark-item[data-id="${ctxBmId}"]`);
    hideBmCtx(); if (!bm || !bmEl) return;
    const labelEl = bmEl.querySelector('.bm-label');
    const input   = document.createElement('input');
    input.className = 'bm-rename-input'; input.value = bm.title;
    labelEl.replaceWith(input); input.focus(); input.select();
    const commit = () => { bm.title = input.value.trim() || bm.title; renderBookmarks(); save(); };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') renderBookmarks(); });
  });

  document.querySelector('.wm-close')?.addEventListener('click', () => { if (confirm('Close Spectral.exe?')) window.close(); });
}

// ── BOOT ───────────────────────────────────────────────────────
async function boot() {
  await loadOverrides();
  wireEvents();
  const hasState = loadState();
  if (hasState && tabs.length > 0) {
    document.getElementById('bookmarks-bar').style.display = settings.bookmarksBar ? 'flex' : 'none';
    tabs.forEach(savedTab => {
      const tabEl = buildTabEl(savedTab);
      document.getElementById('tab-strip').insertBefore(tabEl, document.getElementById('new-tab-btn'));
      const contentEl = document.createElement('div');
      contentEl.className = 'tab-content'; contentEl.dataset.id = savedTab.id;
      document.getElementById('content').appendChild(contentEl);
      // Restore tab image
      if (savedTab.tabImage) {
        const el = document.querySelector(`.tab[data-id="${savedTab.id}"]`);
        if (el) { el.style.backgroundImage = `url(${savedTab.tabImage})`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; }
      }
    });
    tabs.forEach(t => {
      const { resolved, spectralOverride } = resolveUrl(t.url);
      const contentEl = document.querySelector(`.tab-content[data-id="${t.id}"]`);
      if (contentEl) renderContent(t.id, resolved, t.url, spectralOverride);
      renderTabEl(t.id);
    });
    renderBookmarks();
    const targetId = (activeTabId && getTab(activeTabId)) ? activeTabId : tabs[0]?.id;
    if (targetId) switchTab(targetId);
  } else {
    bookmarks = DEFAULT_BOOKMARKS.map(b => ({ ...b }));
    renderBookmarks();
    createTab('spectral://welcome_page');
  }
}

boot();
