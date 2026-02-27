// ═══════════════════════════════════════════════════════════════
// SPECTRAL.EXE — Terminal Engine
// spectral-terminal.js  —  loaded after spectral-fs.js
//
// Registers:  spectral://terminal
// Exposes:    window.SpectralTerminal.render(tabId, el)
//             window.SpectralTerminal.exec(line) → string output
// ═══════════════════════════════════════════════════════════════
'use strict';

// ── TERMINAL STATE ─────────────────────────────────────────────
const TERM_HISTORY_KEY = 'spectral_term_history';
const TERM_ENV_KEY     = 'spectral_term_env';
const TERM_NS_KEY      = 'spectral_term_namespaces';

// Active namespace registry (persisted)
// { [nsName]: { type, meta, nodes: [{...}] } }
function nsLoad()        { try { return JSON.parse(localStorage.getItem(TERM_NS_KEY) || '{}'); } catch(_){ return {}; } }
function nsSave(obj)     { localStorage.setItem(TERM_NS_KEY, JSON.stringify(obj)); }
function nsGet(name)     { return nsLoad()[name] || null; }
function nsSet(name, ns) { const all = nsLoad(); all[name] = ns; nsSave(all); }
function nsDelete(name)  { const all = nsLoad(); delete all[name]; nsSave(all); }
function nsAll()         { return nsLoad(); }

// Environment variables
function envLoad()       { try { return JSON.parse(localStorage.getItem(TERM_ENV_KEY) || '{}'); } catch(_){ return {}; } }
function envSave(obj)    { localStorage.setItem(TERM_ENV_KEY, JSON.stringify(obj)); }
function envSet(k, v)    { const e = envLoad(); e[k] = v; envSave(e); }
function envGet(k)       { return envLoad()[k] ?? null; }
function envAll()        { return envLoad(); }
function envDel(k)       { const e = envLoad(); delete e[k]; envSave(e); }

// Command history
function histLoad()      { try { return JSON.parse(localStorage.getItem(TERM_HISTORY_KEY) || '[]'); } catch(_){ return []; } }
function histPush(line)  { const h = histLoad(); h.push(line); if(h.length > 500) h.shift(); localStorage.setItem(TERM_HISTORY_KEY, JSON.stringify(h)); }
function histClear()     { localStorage.removeItem(TERM_HISTORY_KEY); }

// ── OUTPUT HELPERS ─────────────────────────────────────────────
function ok(msg)    { return { type: 'ok',    text: msg  }; }
function err(msg)   { return { type: 'err',   text: msg  }; }
function warn(msg)  { return { type: 'warn',  text: msg  }; }
function info(msg)  { return { type: 'info',  text: msg  }; }
function raw(html)  { return { type: 'raw',   html: html }; }
function multi(...lines) { return { type: 'multi', lines: lines.filter(Boolean) }; }

// ── TOKENIZER ──────────────────────────────────────────────────
// Splits on spaces, respects "quoted strings", and ~tilde~ as delimiter
// Returns { cmd, ns, method, args }
//   ">init FreeDNX / mainNode"
//   cmd='init', args=['FreeDNX','/','mainNode']
//
//   ">FDNX.add ~ "http://MacVG.io" ~ "kbsigmaboy67.github.io/macvg""
//   ns='FDNX', method='add', args=['http://MacVG.io', 'kbsigmaboy67.github.io/macvg']

function tokenize(raw) {
  // Strip leading > if present
  let line = raw.trim().replace(/^>+\s*/, '');
  if (!line) return null;

  // Split by ~ first (tilde = argument separator, like a pipe-free delimiter)
  const tildeParts = line.split(/\s*~\s*/);

  // The first part is "cmd" or "ns.method args"
  const head = tildeParts[0].trim();
  const tiledArgs = tildeParts.slice(1).map(p => unquote(p.trim()));

  // Parse head: may be "NS.method arg1 arg2" or "cmd arg1 arg2"
  const headTokens = tokenizeHead(head);
  const [first, ...rest] = headTokens;

  let ns = null, method = null, cmd = null;
  if (first && first.includes('.')) {
    const dot = first.indexOf('.');
    ns     = first.slice(0, dot);
    method = first.slice(dot + 1);
  } else {
    cmd = first;
  }

  const args = [...rest.map(t => unquote(t)), ...tiledArgs].filter(a => a !== '');
  return { cmd, ns, method, args, raw: line };
}

function tokenizeHead(str) {
  const tokens = [];
  let cur = '', inQ = false, qChar = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (!inQ && (c === '"' || c === "'")) { inQ = true; qChar = c; }
    else if (inQ && c === qChar)          { inQ = false; tokens.push(cur); cur = ''; }
    else if (!inQ && c === ' ')           { if (cur) { tokens.push(cur); cur = ''; } }
    else                                  { cur += c; }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function unquote(s) {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ── GITHUB URL NORMALIZER ──────────────────────────────────────
// Accepts:  "kbsigmaboy67.github.io/macvg"  OR  "https://kbsigmaboy67.github.io/macvg"
// Returns:  "https://kbsigmaboy67.github.io/macvg"
function normalizeGithubUrl(raw) {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.includes('github.io'))  return 'https://' + raw;
  // user/repo  → user.github.io/repo
  const slash = raw.indexOf('/');
  if (slash > 0) {
    const user = raw.slice(0, slash);
    const repo = raw.slice(slash + 1);
    return `https://${user}.github.io/${repo}`;
  }
  return 'https://' + raw;
}

// ── OVERRIDE HELPERS ───────────────────────────────────────────
function addOverride(entry) {
  window.SpectralLO.add(entry);
}
function removeOverridByMatch(match) {
  const arr = window.SpectralLO.load();
  const tgt = arr.find(o => o.match === match || o.match.toLowerCase() === match.toLowerCase());
  if (tgt) { window.SpectralLO.remove(tgt.id); return true; }
  return false;
}
function listOverrides() {
  return window.SpectralLO.load();
}

// ── NAMESPACE DEFINITIONS ──────────────────────────────────────
// Namespaces are user-defined "objects" with typed methods.
// Built-in namespace types: FreeDNX, FileNode, NetNode, AliasNode

const NS_TYPES = {

  // FreeDNX — Domain override namespace
  // FDNX.add  ~ "http://fake.domain" ~ "real.github.io/path"
  // FDNX.rm   ~ "http://fake.domain"
  // FDNX.ls
  // FDNX.get  ~ "http://fake.domain"
  // FDNX.set  ~ "http://fake.domain" ~ type=redirect|github|fetch|local ~ target ~ [display]
  FreeDNX: {
    description: 'Domain override manager — maps fake/custom URLs to real targets',
    methods: {
      add(ns, args) {
        // args[0] = fake URL (match), args[1] = real GitHub pages URL or any target
        if (args.length < 2) return err('Usage: NS.add ~ "http://fake.url" ~ "githubuser.github.io/repo"');
        const [match, target] = args;
        const display = args[2] || null;
        const realTarget = normalizeGithubUrl(target);
        const isGH = realTarget.includes('github.io');
        const entry = {
          type:    isGH ? 'github' : 'redirect',
          match:   match.trim(),
          target:  realTarget,
          display: display || match.replace(/^https?:\/\//, ''),
        };
        // Remove existing same-match entry first
        removeOverridByMatch(entry.match);
        addOverride(entry);
        return multi(
          ok(`✓ Override added`),
          info(`  match   → ${entry.match}`),
          info(`  target  → ${entry.type === 'github' ? '🐙 ' : '🔗 '}${entry.target}`),
          info(`  type    → ${entry.type}`),
        );
      },
      rm(ns, args) {
        if (!args[0]) return err('Usage: NS.rm ~ "http://fake.url"');
        const removed = removeOverridByMatch(args[0]);
        return removed ? ok(`✓ Removed override for: ${args[0]}`) : warn(`No override found matching: ${args[0]}`);
      },
      ls(ns, args) {
        const all = listOverrides().filter(o => o._ns === ns._name || !o._ns);
        if (!all.length) return info('No overrides in local list.');
        const rows = all.map(o =>
          `<tr><td class="tc-match">${_e(o.match)}</td><td class="tc-type">${_e(o.type)}</td><td class="tc-target">${_e(o.target||o.content?.slice(0,40)||'')}</td><td class="tc-disp">${_e(o.display||'')}</td></tr>`
        ).join('');
        return raw(`<table class="term-table"><thead><tr><th>match</th><th>type</th><th>target</th><th>display</th></tr></thead><tbody>${rows}</tbody></table>`);
      },
      get(ns, args) {
        if (!args[0]) return err('Usage: NS.get ~ "http://match.url"');
        const o = listOverrides().find(x => x.match === args[0]);
        if (!o) return warn(`Not found: ${args[0]}`);
        return multi(
          info(`match:    ${o.match}`),
          info(`type:     ${o.type}`),
          info(`target:   ${o.target || '(inline content)'}`),
          info(`display:  ${o.display || '(none)'}`),
          o.password   ? warn(`password: [protected]`)         : null,
          o.tabTitle   ? info(`tabTitle: ${o.tabTitle}`)       : null,
          o.tabFavicon ? info(`favicon:  ${o.tabFavicon}`)     : null,
          o.tabImage   ? info(`tabImage: ${o.tabImage}`)       : null,
        );
      },
      set(ns, args) {
        // NS.set ~ "match" ~ type ~ target ~ [display]
        if (args.length < 3) return err('Usage: NS.set ~ "match" ~ type ~ target ~ [display]');
        const [match, type, target, display] = args;
        removeOverridByMatch(match);
        addOverride({ type, match, target, display: display || null });
        return ok(`✓ Override updated: ${match} → ${target}`);
      },
      protect(ns, args) {
        // NS.protect ~ "match" ~ "password"
        if (args.length < 2) return err('Usage: NS.protect ~ "match" ~ "password"');
        const [match, password] = args;
        const arr = window.SpectralLO.load();
        const o = arr.find(x => x.match === match);
        if (!o) return err(`No override found for: ${match}`);
        window.SpectralLO.update(o.id, { ...o, password });
        return ok(`✓ Password set on: ${match}`);
      },
      unprotect(ns, args) {
        if (!args[0]) return err('Usage: NS.unprotect ~ "match"');
        const arr = window.SpectralLO.load();
        const o = arr.find(x => x.match === args[0]);
        if (!o) return err(`Not found: ${args[0]}`);
        const patched = { ...o }; delete patched.password;
        window.SpectralLO.update(o.id, patched);
        return ok(`✓ Password removed from: ${args[0]}`);
      },
      icon(ns, args) {
        // NS.icon ~ "match" ~ "🎮"  or URL
        if (args.length < 2) return err('Usage: NS.icon ~ "match" ~ "emoji_or_url"');
        const [match, icon] = args;
        const arr = window.SpectralLO.load();
        const o = arr.find(x => x.match === match);
        if (!o) return err(`Not found: ${match}`);
        window.SpectralLO.update(o.id, { ...o, tabFavicon: icon });
        return ok(`✓ Tab icon set for: ${match}`);
      },
      title(ns, args) {
        if (args.length < 2) return err('Usage: NS.title ~ "match" ~ "New Title"');
        const [match, title] = args;
        const arr = window.SpectralLO.load();
        const o = arr.find(x => x.match === match);
        if (!o) return err(`Not found: ${match}`);
        window.SpectralLO.update(o.id, { ...o, tabTitle: title, display: title });
        return ok(`✓ Tab title set: "${title}"`);
      },
      clear(ns, args) {
        const arr = window.SpectralLO.load();
        if (!arr.length) return info('Nothing to clear.');
        if (!confirm(`Delete all ${arr.length} local override(s)?`)) return warn('Cancelled.');
        arr.forEach(o => window.SpectralLO.remove(o.id));
        return ok(`✓ Cleared ${arr.length} overrides`);
      },
    }
  },

  // FileNode — local:// filesystem namespace
  // FN.ls [path]
  // FN.cat ~ "/path/file.txt"
  // FN.rm  ~ "/path/file"
  // FN.mv  ~ "/from" ~ "/to"
  // FN.write ~ "/path/file.txt" ~ "content"
  // FN.open ~ "/path/file"
  FileNode: {
    description: 'local:// filesystem interface',
    methods: {
      ls(ns, args) {
        const path = args[0] || '/';
        const { files, dirs } = window.SpectralFS.listDir(path);
        if (!files.length && !dirs.length) return info(`(empty) ${path}`);
        const rows = [
          ...dirs.sort().map(d => `<tr><td class="tc-match">📁 ${_e(d.split('/').pop())}/</td><td>dir</td><td></td></tr>`),
          ...files.sort((a,b)=>a.name.localeCompare(b.name)).map(f =>
            `<tr><td class="tc-match">${_e(f.name)}</td><td class="tc-type">${_e(f.mime)}</td><td class="tc-target">${window.SpectralFS.formatSize(f.size)}</td></tr>`
          )
        ].join('');
        return raw(`<table class="term-table"><thead><tr><th>name</th><th>type</th><th>size</th></tr></thead><tbody>${rows}</tbody></table>`);
      },
      async cat(ns, args) {
        if (!args[0]) return err('Usage: NS.cat ~ "/path/to/file"');
        const text = await window.SpectralFS.readText(args[0]);
        if (text === null) return err(`File not found: ${args[0]}`);
        const escaped = _e(text.slice(0, 4000)) + (text.length > 4000 ? '\n…(truncated)' : '');
        return raw(`<pre class="term-pre">${escaped}</pre>`);
      },
      rm(ns, args) {
        if (!args[0]) return err('Usage: NS.rm ~ "/path/to/file"');
        const ok2 = window.SpectralFS.delete(args[0]);
        return ok2 ? ok(`✓ Deleted: ${args[0]}`) : err(`Not found: ${args[0]}`);
      },
      mv(ns, args) {
        if (args.length < 2) return err('Usage: NS.mv ~ "/from" ~ "/to"');
        const renamed = window.SpectralFS.rename(args[0], args[1]);
        return renamed ? ok(`✓ Moved: ${args[0]} → ${args[1]}`) : err(`Not found: ${args[0]}`);
      },
      async write(ns, args) {
        if (args.length < 2) return err('Usage: NS.write ~ "/path/file.txt" ~ "content"');
        const [path, ...rest] = args;
        const content = rest.join(' ');
        await window.SpectralFS.write(path, content, 'text/plain');
        return ok(`✓ Written: ${path} (${content.length} chars)`);
      },
      open(ns, args) {
        if (!args[0]) return err('Usage: NS.open ~ "/path/to/file"');
        if (typeof navigateTo === 'function') navigateTo('local://' + args[0]);
        return ok(`✓ Opening local://${args[0]}`);
      },
      info(ns, args) {
        if (!args[0]) return err('Usage: NS.info ~ "/path/to/file"');
        const f = window.SpectralFS.info(args[0]);
        if (!f) return err(`Not found: ${args[0]}`);
        return multi(
          info(`name:     ${f.name}`),
          info(`mime:     ${f.mime}`),
          info(`size:     ${window.SpectralFS.formatSize(f.size)}`),
          info(`chunks:   ${f.chunks}`),
          info(`modified: ${new Date(f.modified).toLocaleString()}`),
        );
      },
    }
  },

  // NetNode — network/fetch utilities
  // NN.fetch ~ "https://url" ~ [save to local path]
  // NN.ping  ~ "https://url"
  // NN.open  ~ "url"
  NetNode: {
    description: 'Network and fetch utilities',
    methods: {
      async fetch(ns, args) {
        if (!args[0]) return err('Usage: NS.fetch ~ "https://url" ~ [/save/path]');
        const [url, savePath] = args;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (savePath) {
            const buf = await blob.arrayBuffer();
            await window.SpectralFS.write(savePath, buf, blob.type || 'application/octet-stream');
            return ok(`✓ Fetched & saved: ${savePath} (${window.SpectralFS.formatSize(buf.byteLength)})`);
          }
          const text = await blob.text();
          return raw(`<pre class="term-pre">${_e(text.slice(0, 3000))}${text.length > 3000 ? '\n…(truncated)' : ''}</pre>`);
        } catch(e) { return err(`fetch failed: ${e.message}`); }
      },
      async ping(ns, args) {
        if (!args[0]) return err('Usage: NS.ping ~ "https://url"');
        const t0 = performance.now();
        try {
          await fetch(args[0], { method: 'HEAD', mode: 'no-cors' });
          const ms = (performance.now() - t0).toFixed(1);
          return ok(`✓ Reachable — ${ms}ms`);
        } catch(e) { return err(`Unreachable: ${e.message}`); }
      },
      open(ns, args) {
        if (!args[0]) return err('Usage: NS.open ~ "url"');
        if (typeof navigateTo === 'function') navigateTo(args[0]);
        return ok(`✓ Navigating to: ${args[0]}`);
      },
      tab(ns, args) {
        if (!args[0]) return err('Usage: NS.tab ~ "url"');
        if (typeof createTab === 'function') createTab(args[0]);
        return ok(`✓ New tab: ${args[0]}`);
      },
    }
  },

  // AliasNode — quick shorthand alias system
  // AN.set  ~ "alias" ~ "url or command"
  // AN.run  ~ "alias"
  // AN.ls
  // AN.rm   ~ "alias"
  AliasNode: {
    description: 'Command and URL alias manager',
    methods: {
      set(ns, args) {
        if (args.length < 2) return err('Usage: NS.set ~ "alias" ~ "url_or_command"');
        envSet('alias:' + args[0], args.slice(1).join(' '));
        return ok(`✓ Alias set: ${args[0]} → ${args.slice(1).join(' ')}`);
      },
      run(ns, args) {
        if (!args[0]) return err('Usage: NS.run ~ "alias"');
        const val = envGet('alias:' + args[0]);
        if (!val) return err(`Alias not found: ${args[0]}`);
        return SpectralTerminal.exec(val);
      },
      ls(ns, args) {
        const all = envAll();
        const aliases = Object.entries(all).filter(([k]) => k.startsWith('alias:'));
        if (!aliases.length) return info('No aliases defined.');
        const rows = aliases.map(([k,v]) => `<tr><td class="tc-match">${_e(k.replace('alias:',''))}</td><td class="tc-target">${_e(v)}</td></tr>`).join('');
        return raw(`<table class="term-table"><thead><tr><th>alias</th><th>value</th></tr></thead><tbody>${rows}</tbody></table>`);
      },
      rm(ns, args) {
        if (!args[0]) return err('Usage: NS.rm ~ "alias"');
        envDel('alias:' + args[0]);
        return ok(`✓ Removed alias: ${args[0]}`);
      },
    }
  },
};

// ── BUILTIN COMMANDS ───────────────────────────────────────────
const BUILTINS = {

  // init <NsType> [/ <varName>]
  // Creates and binds a namespace instance
  // ">init FreeDNX / mainNode" → creates NS 'mainNode' of type FreeDNX
  // After this, "mainNode.add ~..." works
  init(args) {
    if (!args.length) return err('Usage: init <NsType> [/ <varName>]\nTypes: ' + Object.keys(NS_TYPES).join(', '));
    const typeName = args[0];
    const slashIdx = args.indexOf('/');
    const varName  = slashIdx !== -1 ? args[slashIdx + 1] : typeName;

    if (!NS_TYPES[typeName]) return err(`Unknown namespace type: ${typeName}\nAvailable: ${Object.keys(NS_TYPES).join(', ')}`);
    if (!varName) return err('Provide a variable name after /');

    const ns = { _type: typeName, _name: varName, created: Date.now() };
    nsSet(varName, ns);
    return multi(
      ok(`✓ Initialized ${typeName} as "${varName}"`),
      info(`  ${NS_TYPES[typeName].description}`),
      info(`  Use: ${varName}.<method> ~ args`),
      info(`  Methods: ${Object.keys(NS_TYPES[typeName].methods).join(', ')}`),
    );
  },

  // ns — list all active namespaces
  ns(args) {
    const all = nsAll();
    if (!Object.keys(all).length) return info('No namespaces initialized. Use: init <Type> / <name>');
    const rows = Object.entries(all).map(([k, v]) =>
      `<tr><td class="tc-match">${_e(k)}</td><td class="tc-type">${_e(v._type)}</td><td class="tc-target">${_e(NS_TYPES[v._type]?.description || '')}</td></tr>`
    ).join('');
    return raw(`<table class="term-table"><thead><tr><th>name</th><th>type</th><th>description</th></tr></thead><tbody>${rows}</tbody></table>`);
  },

  // drop <varName> — destroy namespace
  drop(args) {
    if (!args[0]) return err('Usage: drop <varName>');
    if (!nsGet(args[0])) return warn(`Not found: ${args[0]}`);
    nsDelete(args[0]);
    return ok(`✓ Dropped namespace: ${args[0]}`);
  },

  // nav <url> — navigate current tab
  nav(args) {
    if (!args[0]) return err('Usage: nav <url>');
    if (typeof navigateTo === 'function') navigateTo(args.join(' '));
    return ok(`✓ Navigating to: ${args.join(' ')}`);
  },

  // tab <url> — open URL in new tab
  tab(args) {
    if (!args[0]) return err('Usage: tab <url>');
    if (typeof createTab === 'function') createTab(args.join(' '));
    return ok(`✓ New tab: ${args.join(' ')}`);
  },

  // open <spectral|local|any url>
  open(args) {
    if (!args[0]) return err('Usage: open <url>');
    if (typeof navigateTo === 'function') navigateTo(args.join(' '));
    return ok(`✓ Opening: ${args.join(' ')}`);
  },

  // go <spectral page name>  e.g. go settings | go gateway | go terminal
  go(args) {
    const pages = {
      settings: 'spectral://settings',
      gateway:  'spectral://overrides_gateway_list',
      terminal: 'spectral://terminal',
      welcome:  'spectral://welcome_page',
      newtab:   'spectral://new_tab',
      home:     'spectral://welcome_page',
    };
    const dest = pages[args[0]?.toLowerCase()] || 'spectral://' + (args[0] || '');
    if (typeof navigateTo === 'function') navigateTo(dest);
    return ok(`✓ Navigating to: ${dest}`);
  },

  // ov — override shortcuts
  ov(args) {
    const sub = args[0];
    if (!sub) {
      const arr = window.SpectralLO.load();
      if (!arr.length) return info('No local overrides. Use: ov.add ~ "match" ~ "target"');
      const rows = arr.map(o =>
        `<tr><td class="tc-match">${_e(o.match)}</td><td class="tc-type">${_e(o.type)}</td><td class="tc-target">${_e(o.target||'')}</td></tr>`
      ).join('');
      return raw(`<table class="term-table"><thead><tr><th>match</th><th>type</th><th>target</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    return warn(`Unknown ov subcommand. Try: ov (no args to list), or use a FreeDNX namespace for full override control.`);
  },

  // env [key] [value]
  env(args) {
    if (!args.length) {
      const all = envAll();
      const entries = Object.entries(all).filter(([k]) => !k.startsWith('alias:'));
      if (!entries.length) return info('No environment variables set.');
      const rows = entries.map(([k,v]) => `<tr><td class="tc-match">${_e(k)}</td><td class="tc-target">${_e(String(v))}</td></tr>`).join('');
      return raw(`<table class="term-table"><thead><tr><th>key</th><th>value</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (args.length === 1) {
      const v = envGet(args[0]);
      return v !== null ? info(`${args[0]} = ${v}`) : warn(`Not set: ${args[0]}`);
    }
    envSet(args[0], args.slice(1).join(' '));
    return ok(`✓ ${args[0]} = ${args.slice(1).join(' ')}`);
  },

  // set key value (alias for env with 2 args)
  set(args) {
    if (args.length < 2) return err('Usage: set <key> <value>');
    envSet(args[0], args.slice(1).join(' '));
    return ok(`✓ ${args[0]} = ${args.slice(1).join(' ')}`);
  },

  // get key
  get(args) {
    if (!args[0]) return err('Usage: get <key>');
    const v = envGet(args[0]);
    return v !== null ? info(`${args[0]} = ${v}`) : warn(`Not set: ${args[0]}`);
  },

  // unset key
  unset(args) {
    if (!args[0]) return err('Usage: unset <key>');
    envDel(args[0]);
    return ok(`✓ Unset: ${args[0]}`);
  },

  // ls [local path | overrides | env | ns]
  ls(args) {
    const target = args[0]?.toLowerCase();
    if (!target || target === '/') {
      const { files, dirs } = window.SpectralFS.listDir('/');
      const parts = [
        ...dirs.sort().map(d => `📁 ${d}/`),
        ...files.sort((a,b)=>a.name.localeCompare(b.name)).map(f => `📄 ${f.path}  (${window.SpectralFS.formatSize(f.size)})`),
      ];
      return parts.length ? raw(`<pre class="term-pre">${_e(parts.join('\n'))}</pre>`) : info('Filesystem is empty. Use upload in Gateway to add files.');
    }
    if (target === 'ov' || target === 'overrides') return BUILTINS.ov([]);
    if (target === 'ns') return BUILTINS.ns([]);
    if (target === 'env') return BUILTINS.env([]);
    // Treat as local path
    const { files, dirs } = window.SpectralFS.listDir(args[0]);
    const parts = [
      ...dirs.sort().map(d => `📁 ${d.split('/').pop()}/`),
      ...files.sort((a,b)=>a.name.localeCompare(b.name)).map(f => `📄 ${f.name}  (${window.SpectralFS.formatSize(f.size)})`),
    ];
    return parts.length ? raw(`<pre class="term-pre">${_e(parts.join('\n'))}</pre>`) : info(`Empty: ${args[0]}`);
  },

  // cat <local path>
  async cat(args) {
    if (!args[0]) return err('Usage: cat <local path>');
    const text = await window.SpectralFS.readText(args[0]);
    if (text === null) return err(`File not found: ${args[0]}`);
    return raw(`<pre class="term-pre">${_e(text.slice(0, 5000))}${text.length > 5000 ? '\n…(truncated)' : ''}</pre>`);
  },

  // rm <local path>
  rm(args) {
    if (!args[0]) return err('Usage: rm <local path>');
    const ok2 = window.SpectralFS.delete(args[0]);
    return ok2 ? ok(`✓ Deleted: ${args[0]}`) : err(`Not found: ${args[0]}`);
  },

  // clear — clear terminal output
  clear() { return { type: 'clear' }; },

  // reset — clear all terminal history + env + namespaces
  reset(args) {
    histClear();
    if (args[0] === '--all') {
      nsSave({});
      envSave({});
      return ok('✓ Terminal fully reset (history, env, namespaces)');
    }
    return ok('✓ History cleared (use reset --all to also clear env and namespaces)');
  },

  // help [command]
  help(args) {
    if (args[0]) {
      const cmd = args[0].toLowerCase();
      const desc = HELP[cmd];
      return desc ? raw(`<pre class="term-pre">${_e(desc)}</pre>`) : warn(`No help for: ${args[0]}`);
    }
    return raw(HELP_OVERVIEW);
  },

  // version
  version() {
    return raw(`<pre class="term-pre">Spectral.exe Terminal — v4.0.0
Namespace types: ${Object.entries(NS_TYPES).map(([k,v]) => `\n  ${k.padEnd(12)} — ${v.description}`).join('')}
Builtins: ${Object.keys(BUILTINS).join(', ')}</pre>`);
  },

  // echo <...>
  echo(args) { return info(args.join(' ')); },

  // bookmark <url> [title]
  bookmark(args) {
    if (!args[0]) return err('Usage: bookmark <url> [title]');
    if (typeof addBookmark === 'function') {
      addBookmark(args[0], args.slice(1).join(' ') || args[0]);
      return ok(`✓ Bookmarked: ${args[0]}`);
    }
    return warn('Browser not ready');
  },

  // eval <js expression> — for power users
  eval(args) {
    const expr = args.join(' ');
    if (!expr) return err('Usage: eval <js expression>');
    try {
      // eslint-disable-next-line no-eval
      const result = (0, eval)(expr);
      const out = result === undefined ? '(undefined)' : JSON.stringify(result, null, 2);
      return raw(`<pre class="term-pre">${_e(String(out))}</pre>`);
    } catch(e) { return err(`eval error: ${e.message}`); }
  },
};

// ── HELP TEXT ──────────────────────────────────────────────────
const HELP = {
  init: `init <NsType> [/ <varName>]
  Create a namespace instance of the given type.
  Types: FreeDNX, FileNode, NetNode, AliasNode
  Example:
    init FreeDNX / mainNode
    mainNode.add ~ "http://MacVG.io" ~ "kbsigmaboy67.github.io/macvg"`,

  'freedns': `FreeDNX Namespace — Domain override manager
  Methods:
    NS.add     ~ "match" ~ "github_or_target" ~ [display]
    NS.rm      ~ "match"
    NS.ls
    NS.get     ~ "match"
    NS.set     ~ "match" ~ type ~ target ~ [display]
    NS.protect ~ "match" ~ "password"
    NS.icon    ~ "match" ~ "🎮_or_url"
    NS.title   ~ "match" ~ "Tab Title"
    NS.clear`,

  nav:      `nav <url>\n  Navigate current tab to URL`,
  tab:      `tab <url>\n  Open URL in new tab`,
  go:       `go <page>\n  Go to spectral page: settings, gateway, terminal, welcome, newtab`,
  ls:       `ls [path | ov | env | ns]\n  List local files, overrides, env vars, or namespaces`,
  cat:      `cat <local path>\n  Print file contents`,
  rm:       `rm <local path>\n  Delete file from local:// filesystem`,
  env:      `env [key] [value]\n  Show, get, or set environment variables`,
  set:      `set <key> <value>\n  Set environment variable`,
  get:      `get <key>\n  Get environment variable`,
  unset:    `unset <key>\n  Remove environment variable`,
  bookmark: `bookmark <url> [title]\n  Add URL to bookmarks bar`,
  eval:     `eval <js>\n  Evaluate JavaScript expression`,
  clear:    `clear\n  Clear terminal output`,
  reset:    `reset [--all]\n  Clear history. --all also clears env and namespaces`,
  version:  `version\n  Show terminal and namespace version info`,
  echo:     `echo <text>\n  Print text`,
  help:     `help [command]\n  Show help. Use help <command> for details.`,
};

const HELP_OVERVIEW = `<pre class="term-pre">
<span class="th-cyan">SPECTRAL.EXE TERMINAL</span>  — type commands below, press Enter

<span class="th-green">SYNTAX</span>
  command arg1 arg2          — space-separated arguments
  command ~ "arg1" ~ "arg2" — tilde-delimited (use for URLs)
  NS.method ~ arg            — call method on namespace
  >command                   — optional leading >

<span class="th-green">INIT / NAMESPACE</span>
  init FreeDNX / myDNS       — create a FreeDNX namespace called myDNS
  init FileNode / files      — create a FileNode namespace
  init NetNode / net         — create a NetNode namespace
  init AliasNode / al        — create an AliasNode namespace
  ns                         — list active namespaces
  drop <name>                — destroy namespace

<span class="th-green">FREEDNS (domain overrides)</span>
  myDNS.add  ~ "http://fake.io" ~ "user.github.io/repo"
  myDNS.rm   ~ "http://fake.io"
  myDNS.ls
  myDNS.set  ~ "match" ~ type ~ target
  myDNS.protect ~ "match" ~ "password"
  myDNS.icon    ~ "match" ~ "🎮"
  myDNS.title   ~ "match" ~ "Tab Title"

<span class="th-green">NAVIGATION</span>
  nav https://example.com    — navigate current tab
  tab https://example.com    — open new tab
  go settings|gateway|terminal|welcome

<span class="th-green">FILESYSTEM (local://)</span>
  ls [/path]                 — list files
  cat /path/file.txt         — read file
  rm /path/file              — delete file

<span class="th-green">ENVIRONMENT</span>
  env                        — list all vars
  set KEY value              — set variable
  get KEY                    — get variable
  unset KEY                  — remove variable

<span class="th-green">OTHER</span>
  bookmark url [title]       — add bookmark
  eval &lt;js expression&gt;       — run JavaScript
  clear                      — clear terminal
  reset [--all]              — reset history/env/ns
  version                    — version info
  help &lt;command&gt;             — detailed help

<span class="th-dim">Tip: Use ~ as delimiter for arguments containing slashes or spaces.
     Strings in "quotes" or 'quotes' are treated as single arguments.</span>
</pre>`;

// ── EXECUTOR ───────────────────────────────────────────────────
async function execLine(rawLine) {
  const t = tokenize(rawLine);
  if (!t) return null;

  histPush(rawLine);

  // Namespace method call: NS.method ~ args
  if (t.ns) {
    // Check user-defined namespaces
    const nsObj = nsGet(t.ns);
    if (nsObj) {
      const type    = nsObj._type;
      const nsDef   = NS_TYPES[type];
      if (!nsDef) return err(`Namespace type "${type}" not found (was it removed?)`);
      const method  = nsDef.methods[t.method];
      if (!method)  return err(`Unknown method: ${t.ns}.${t.method}\nAvailable: ${Object.keys(nsDef.methods).join(', ')}`);
      try { return await method(nsObj, t.args); }
      catch(e) { return err(`${t.ns}.${t.method} error: ${e.message}`); }
    }

    // Check if it's a short-type alias: FDNX → FreeDNX auto-detect
    // (Users can call NS type methods directly without init if NS name matches type prefix)
    const typeByPrefix = Object.keys(NS_TYPES).find(k =>
      k.toLowerCase().startsWith(t.ns.toLowerCase()) || t.ns.toLowerCase() === k.toLowerCase()
    );
    if (typeByPrefix) {
      // Auto-init ephemeral instance
      const ephemeralNs = { _type: typeByPrefix, _name: t.ns };
      const nsDef   = NS_TYPES[typeByPrefix];
      const method  = nsDef.methods[t.method];
      if (!method)  return err(`Unknown method: ${t.method}\nAvailable for ${typeByPrefix}: ${Object.keys(nsDef.methods).join(', ')}`);
      try { return await method(ephemeralNs, t.args); }
      catch(e) { return err(`${t.ns}.${t.method} error: ${e.message}`); }
    }

    return err(`Unknown namespace: "${t.ns}"\nUse "ns" to list active namespaces, or "init" to create one.`);
  }

  // Built-in command
  const builtin = BUILTINS[t.cmd?.toLowerCase()];
  if (builtin) {
    try { return await builtin(t.args); }
    catch(e) { return err(`${t.cmd} error: ${e.message}`); }
  }

  // Unknown
  return warn(`Unknown command: "${t.cmd}"\nType "help" for a list of commands.`);
}

// ── SAFE HTML ESCAPE ───────────────────────────────────────────
function _e(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── TERMINAL RENDERER ──────────────────────────────────────────
// Called by spectral.js renderSpectralPage for spectral://terminal
function renderTerminal(tabId, el) {
  if (typeof updateTabMeta === 'function') updateTabMeta(tabId, 'Terminal — Spectral.exe', '💻');

  el.innerHTML = `<div class="sterm-root" id="sterm-root">
    <div class="sterm-topbar">
      <span class="sterm-title">SPECTRAL://TERMINAL</span>
      <div class="sterm-topbar-actions">
        <button class="sterm-tbtn" onclick="stermClear()">⌫ Clear</button>
        <button class="sterm-tbtn" onclick="stermHelp()">? Help</button>
        <button class="sterm-tbtn" onclick="stermHist()">🕐 History</button>
      </div>
    </div>
    <div class="sterm-output" id="sterm-output"></div>
    <div class="sterm-inputbar">
      <span class="sterm-prompt">spectral<span class="sterm-prompt-gt">&gt;</span></span>
      <input
        id="sterm-input"
        class="sterm-input"
        type="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="type a command, or 'help'…"
      />
    </div>
  </div>`;

  // Inject terminal CSS
  if (!document.getElementById('sterm-style')) {
    const s = document.createElement('style');
    s.id = 'sterm-style';
    s.textContent = TERM_CSS;
    document.head.appendChild(s);
  }

  // Boot message
  stermPrint([
    raw(`<pre class="term-pre th-cyan">
  ╔═══════════════════════════════════════╗
  ║   SPECTRAL.EXE  TERMINAL  v4.0.0     ║
  ╚═══════════════════════════════════════╝</pre>`),
    info('Type "help" for command reference.'),
    info('Example: init FreeDNX / dns'),
    info('         dns.add ~ "http://MacVG.io" ~ "kbsigmaboy67.github.io/macvg"'),
  ]);

  // Check existing namespaces
  const existingNs = Object.keys(nsAll());
  if (existingNs.length) {
    stermPrint([info(`Active namespaces: ${existingNs.join(', ')}`)]);
  }

  // Wire input
  const input = document.getElementById('sterm-input');
  if (!input) return;

  let histIdx = -1;
  let histDraft = '';

  input.addEventListener('keydown', async (e) => {
    const hist = histLoad();

    if (e.key === 'Enter') {
      const line = input.value.trim();
      if (!line) return;
      stermEcho(line);
      input.value = '';
      histIdx = -1;
      histDraft = '';
      const result = await execLine(line);
      if (result) stermPrint([result]);
      // Scroll output to bottom
      const out = document.getElementById('sterm-output');
      if (out) out.scrollTop = out.scrollHeight;
    }

    // Arrow up — history back
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx === -1) histDraft = input.value;
      const next = histIdx + 1;
      if (next < hist.length) {
        histIdx = next;
        input.value = hist[hist.length - 1 - histIdx];
      }
    }

    // Arrow down — history forward
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx <= 0) { histIdx = -1; input.value = histDraft; }
      else { histIdx--; input.value = hist[hist.length - 1 - histIdx]; }
    }

    // Tab autocomplete (basic)
    if (e.key === 'Tab') {
      e.preventDefault();
      const val  = input.value;
      const cmds = [...Object.keys(BUILTINS), ...Object.keys(nsAll()).map(n => n + '.')];
      const matches = cmds.filter(c => c.startsWith(val));
      if (matches.length === 1) { input.value = matches[0]; }
      else if (matches.length > 1) stermPrint([info(matches.join('  '))]);
    }
  });

  input.focus();
}

// ── TERMINAL OUTPUT HELPERS ────────────────────────────────────
function stermEcho(line) {
  const out = document.getElementById('sterm-output');
  if (!out) return;
  const row = document.createElement('div');
  row.className = 'sterm-echo';
  row.innerHTML = `<span class="sterm-echo-prompt">spectral&gt;</span> ${_e(line)}`;
  out.appendChild(row);
}

function stermPrint(results) {
  const out = document.getElementById('sterm-output');
  if (!out) return;
  for (const r of results) {
    if (!r) continue;
    const row = document.createElement('div');
    if (r.type === 'clear') { out.innerHTML = ''; continue; }
    if (r.type === 'multi') { stermPrint(r.lines); continue; }
    row.className = 'sterm-line sterm-' + r.type;
    if (r.type === 'raw')  { row.innerHTML = r.html; }
    else                   { row.textContent = r.text; }
    out.appendChild(row);
  }
  out.scrollTop = out.scrollHeight;
}

function stermClear() { const o = document.getElementById('sterm-output'); if(o) o.innerHTML = ''; }
function stermHelp()  { stermPrint([raw(HELP_OVERVIEW)]); const o = document.getElementById('sterm-output'); if(o) o.scrollTop = o.scrollHeight; }
function stermHist()  {
  const h = histLoad();
  if (!h.length) { stermPrint([info('No command history.')]); return; }
  stermPrint([raw(`<pre class="term-pre">${h.slice(-30).map((l,i)=>_e(`${h.length-30+i+1}  ${l}`)).join('\n')}</pre>`)]);
  const o = document.getElementById('sterm-output'); if(o) o.scrollTop = o.scrollHeight;
}

// ── TERMINAL CSS ───────────────────────────────────────────────
const TERM_CSS = `
.sterm-root {
  display: flex; flex-direction: column; height: 100%; background: #000;
  font-family: 'Share Tech Mono', monospace; color: #b0b0b0; overflow: hidden;
  position: relative;
}
.sterm-root::before {
  content: '';
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,.007) 2px, rgba(0,255,65,.007) 4px);
}
.sterm-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: #030303; border-bottom: 1px solid #111;
  flex-shrink: 0; position: relative; z-index: 1;
}
.sterm-title {
  font-family: 'Orbitron', monospace; font-size: 11px; font-weight: 900; letter-spacing: 3px;
  background: linear-gradient(90deg, #ff0040, #ff00cc, #0088ff, #00eeff, #00ff88);
  background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  animation: rgbShift 4s linear infinite;
}
.sterm-topbar-actions { display: flex; gap: 6px; }
.sterm-tbtn {
  background: transparent; border: 1px solid #1e1e1e; border-radius: 4px;
  color: #444; font-family: 'Share Tech Mono', monospace; font-size: 11px;
  padding: 3px 10px; cursor: pointer; transition: all .15s;
}
.sterm-tbtn:hover { border-color: #00eeff; color: #00eeff; }
.sterm-output {
  flex: 1; overflow-y: auto; padding: 12px 18px; display: flex;
  flex-direction: column; gap: 2px; position: relative; z-index: 1;
  scroll-behavior: smooth;
}
.sterm-output::-webkit-scrollbar { width: 5px; }
.sterm-output::-webkit-scrollbar-track { background: #050505; }
.sterm-output::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 3px; }
.sterm-echo {
  font-size: 13px; color: #555; padding: 1px 0; line-height: 1.5;
  border-left: 2px solid #111; padding-left: 10px; margin: 3px 0;
}
.sterm-echo-prompt { color: #00ff41; margin-right: 6px; }
.sterm-line { font-size: 13px; padding: 1px 0; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.sterm-ok   { color: #00ff41; }
.sterm-err  { color: #ff0040; }
.sterm-warn { color: #ffee00; }
.sterm-info { color: #666; }
.sterm-raw  { color: #b0b0b0; }
.sterm-inputbar {
  display: flex; align-items: center; gap: 0; padding: 10px 18px;
  background: #030303; border-top: 1px solid #0d0d0d; flex-shrink: 0;
  position: relative; z-index: 1;
}
.sterm-prompt {
  font-size: 13px; color: #00ff41; flex-shrink: 0; margin-right: 6px;
  font-family: 'Share Tech Mono', monospace;
  text-shadow: 0 0 6px rgba(0,255,65,.4);
}
.sterm-prompt-gt { color: #00eeff; }
.sterm-input {
  flex: 1; background: transparent; border: none; outline: none;
  color: #e0e0e0; font-family: 'Share Tech Mono', monospace; font-size: 13px;
  caret-color: #00eeff;
}
.sterm-input::placeholder { color: #1e1e1e; }
/* inline table */
.term-table {
  border-collapse: collapse; font-size: 12px; margin: 4px 0; min-width: 400px;
}
.term-table th {
  text-align: left; color: #00eeff; padding: 3px 16px 3px 0;
  border-bottom: 1px solid #1e1e1e; font-family: 'Share Tech Mono', monospace;
  font-weight: normal; letter-spacing: 1px; font-size: 11px;
}
.term-table td { padding: 2px 16px 2px 0; color: #777; vertical-align: top; }
.tc-match  { color: #b0b0b0; }
.tc-type   { color: #00ff88; min-width: 80px; }
.tc-target { color: #555; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tc-disp   { color: #444; }
.term-pre  { white-space: pre-wrap; word-break: break-word; margin: 0; font-size: 12px; line-height: 1.6; }
/* help colours */
.th-cyan  { color: #00eeff; }
.th-green { color: #00ff41; }
.th-dim   { color: #333; }
`;

// ── PUBLIC API ─────────────────────────────────────────────────
window.SpectralTerminal = {
  render: renderTerminal,
  exec:   execLine,
  print:  stermPrint,
  echo:   stermEcho,
};

console.log('[Spectral] Terminal engine loaded — spectral://terminal ready');
