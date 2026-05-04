// Golf: Paper Craft — Edit UI page
// Lets the designer override position, size, visibility, and basic style
// (icon / font size) of named menu and in-game UI buttons WITHOUT touching
// game code. Overrides are persisted to localStorage under
// `gpc_ui_overrides` and read by game.js's btn() at draw time. Per-course
// overrides supported via `id@N` keys (e.g. `play.restart@3`).
(() => {
  'use strict';

  const STORAGE_KEY = 'gpc_ui_overrides';
  const CLIPBOARD_KEY = 'gpc_ui_clipboard';
  // Game canvas in game.js: H=540, W defaults to 680 (design base — see
  // project_canvas_constants memory). Preview MUST match exactly so absolute
  // pixel x/y overrides render at the same screen position in both surfaces.
  // Previously 640 — caused right-shift bug in-game (centered in editor →
  // off to the right in game because game W=680 made W/2 = 340 not 320).
  const W = 680, H = 540;

  // ----- Style clipboard -----
  // In-memory clipboard mirrored to localStorage so it survives reloads + is
  // shared across ui-editor tabs (storage event below). Shape:
  //   { override: {…overridesMinusXY…}, hadPosition: bool, x, y, sourceId, sourceLabel, ts }
  let clipboard = loadClipboard();
  function loadClipboard() {
    try {
      const raw = localStorage.getItem(CLIPBOARD_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && obj.override ? obj : null;
    } catch (_) { return null; }
  }
  function saveClipboard(obj) {
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(obj)); }
    catch (e) { console.error('[ui-editor] clipboard save', e); }
  }
  function clearClipboardStorage() {
    try { localStorage.removeItem(CLIPBOARD_KEY); } catch (_) {}
  }
  function copyStyleFromSelected() {
    const el = getElement(selectedElementId);
    if (!el) return;
    // Capture the FULL effective override that the active scope sees — merge
    // global ← per-course so paste preserves whatever the user is looking at.
    const gOvr = getOverride(el.id, '') || {};
    const cOvr = scopeCourseId ? (getOverride(el.id, scopeCourseId) || {}) : {};
    const merged = { ...gOvr, ...cOvr };
    if (!Object.keys(merged).length) {
      flashToast('Nothing to copy — element has no overrides', 'error');
      return;
    }
    const hadPosition = ('x' in merged) || ('y' in merged);
    const hadSize = ('w' in merged) || ('h' in merged);
    const x = merged.x, y = merged.y;
    const w = merged.w, h = merged.h;
    const stripped = { ...merged };
    delete stripped.x; delete stripped.y;
    delete stripped.w; delete stripped.h;
    // Deep-clone layers so later edits to the source don't mutate clipboard.
    if (Array.isArray(stripped.layers)) {
      try { stripped.layers = JSON.parse(JSON.stringify(stripped.layers)); } catch (_) {}
    }
    clipboard = {
      override: stripped,
      hadPosition,
      hadSize,
      x: typeof x === 'number' ? x : null,
      y: typeof y === 'number' ? y : null,
      w: typeof w === 'number' ? w : null,
      h: typeof h === 'number' ? h : null,
      sourceId: el.id,
      sourceLabel: el.label,
      ts: Date.now()
    };
    saveClipboard(clipboard);
    refreshClipboardUI();
    flashToast('Copied ' + el.label + ' style', 'success');
  }
  function pasteStyleOntoSelected() {
    if (!clipboard || !clipboard.override) {
      flashToast('Clipboard is empty', 'error');
      return;
    }
    const el = getElement(selectedElementId);
    if (!el) return;
    const existing = getOverride(el.id, scopeCourseId);
    if (existing && Object.keys(existing).length) {
      if (!confirm(el.label + ' already has overrides in this scope. Replace style with clipboard?')) return;
    }
    const includePos = !!document.getElementById('copy-include-pos')?.checked;
    const includeSize = !!document.getElementById('copy-include-size')?.checked;
    // Merge: keep current x/y unless includePos. Replace everything else.
    const cur = getOverride(el.id, scopeCourseId) || {};
    const next = { ...cur, ...clipboard.override };
    // Deep-clone layers from clipboard so mutating the target doesn't taint it.
    if (Array.isArray(next.layers)) {
      try { next.layers = JSON.parse(JSON.stringify(next.layers)); } catch (_) {}
    }
    if (includePos) {
      if (clipboard.x != null) next.x = clipboard.x;
      if (clipboard.y != null) next.y = clipboard.y;
    } else {
      // Preserve the target's current position explicitly.
      if (cur.x != null) next.x = cur.x; else delete next.x;
      if (cur.y != null) next.y = cur.y; else delete next.y;
    }
    if (includeSize) {
      if (clipboard.w != null) next.w = clipboard.w;
      if (clipboard.h != null) next.h = clipboard.h;
    } else {
      if (cur.w != null) next.w = cur.w; else delete next.w;
      if (cur.h != null) next.h = cur.h; else delete next.h;
    }
    // Replace whole-store entry so removed keys (e.g. icon cleared in source)
    // also drop. patchOverride only merges — for paste we want full replace.
    if (undo) undo.recordBefore();
    store[keyFor(el.id, scopeCourseId)] = next;
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    selectedLayerId = null;
    renderElementList(); renderProps(); renderPreview();
    flashToast('Pasted onto ' + el.label, 'success');
  }
  function refreshClipboardUI() {
    const pasteBtn = document.getElementById('btn-paste-style');
    const status = document.getElementById('clipboard-status');
    const has = !!(clipboard && clipboard.override);
    if (pasteBtn) pasteBtn.disabled = !has;
    if (status) {
      status.textContent = has
        ? `Clipboard: ${clipboard.sourceLabel || clipboard.sourceId} (${Object.keys(clipboard.override).length} keys${clipboard.hadPosition ? ', +pos' : ''})`
        : 'Clipboard: empty';
    }
  }

  // ----- Icon catalog -----
  // Mirrors UI_ICON_SPRITES in www/src/game.js (drawIcon dispatch). When you
  // add a new icon there, add it here too. Stored override value is the SHORT
  // KEY (e.g. "play") — that is what game.js's btn() consumes via style.icon.
  let ICON_CATALOG = [];
  let ICON_BY_KEY = {};
  let BG_CATALOG = [];
  let BG_BY_KEY = {};

  function _toEntry(a) {
    return {
      key: a.name,
      label: a.name.replace(/^ui-|-icon$|-plate$|-panel$|-bg$/g, '').replace(/-/g, ' '),
      src: a.path,
      tags: a.tags || []
    };
  }
  function _isPlateLike(name) {
    const n = (name || '').toLowerCase();
    return n.indexOf('plate') >= 0 || n.indexOf('panel') >= 0 ||
           n.indexOf('bg') >= 0 || n.indexOf('button') >= 0 ||
           n.indexOf('card') >= 0 || n.indexOf('chip') >= 0;
  }

  // Asset-picker scope: 'global' = all UI/icon assets regardless of course,
  // 'course' = only those tagged with the active scope course (and global
  // ones, so cross-course staples remain visible). Default is 'global'
  // because UI sprites are mostly shared.
  let pickerScope = 'global';
  function _scopeFilter(list) {
    if (pickerScope !== 'course' || !scopeCourseId) return list;
    const cid = String(scopeCourseId).replace(/^c/i, '');
    return list.filter(a => !a.course || a.course === cid);
  }

  function updateIconCatalog() {
    if (!window.GPC_ASSETS) return;
    // ICON catalog — any ui/icon-tagged asset. Background-plate-like names
    // are filtered out so they don't pollute the icon picker.
    const list = _scopeFilter(window.GPC_ASSETS.list({anyTag:['ui','icon']}));
    ICON_CATALOG = list
      .filter(a => !_isPlateLike(a.name))
      .map(_toEntry);
    ICON_BY_KEY = ICON_CATALOG.reduce((m, e) => (m[e.key] = e, m), {});

    // BACKGROUND catalog — ui-tagged assets prioritising plate/panel/bg names.
    const bgList = _scopeFilter(window.GPC_ASSETS.list({anyTag:['ui']}));
    BG_CATALOG = bgList.map(_toEntry).sort((a, b) => {
      const ap = _isPlateLike(a.key) ? 0 : 1;
      const bp = _isPlateLike(b.key) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.label.localeCompare(b.label);
    });
    BG_BY_KEY = BG_CATALOG.reduce((m, e) => (m[e.key] = e, m), {});
  }

  // ----- UI catalog -----
  // Each element lists its known id (matches what btn() in game.js passes
  // via `style.id`), human label and sensible defaults so the preview can
  // sketch the layout even when nothing is overridden yet.
  const SCREENS = [
    {
      id: 'menu', label: 'Main Menu',
      bg: 'menu',
      elements: [
        { id: 'menu.play',        label: 'PLAY',          defaults: { x: W/2 - 85, y: 260, w: 170, h: 46 } },
        { id: 'menu.upgrades',    label: 'UPGRADES',      defaults: { x: W/2 - 85, y: 330, w: 170, h: 38 } },
        { id: 'menu.shop',        label: 'SHOP',          defaults: { x: W/2 - 85, y: 380, w: 170, h: 38 } },
        { id: 'menu.soundToggle', label: 'Sound toggle',  defaults: { x: W - 46,   y: 14,  w: 32,  h: 32 } }
      ]
    },
    {
      id: 'play', label: 'In-Game HUD',
      bg: 'play',
      elements: [
        { id: 'play.back',     label: 'Back / Editor', defaults: { x: W - 70,  y: 72, w: 58, h: 24 } },
        { id: 'play.restart',  label: 'Restart',        defaults: { x: W - 134, y: 72, w: 60, h: 24 } },
        { id: 'play.unstuck',  label: 'Unstuck',        defaults: { x: W - 210, y: 72, w: 72, h: 24 } }
      ]
    }
  ];

  // ----- State -----
  let store = loadStore();
  let activeScreenId = 'menu';
  let selectedElementId = SCREENS[0].elements[0].id;
  let scopeCourseId = ''; // '' = global
  // Undo/redo stack — wired in boot() once UndoStack helper is available.
  let undo = null;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) { return {}; }
  }
  function saveStore() {
    // Capture the prior state on the undo stack BEFORE persisting the new
    // one. Drags wrap many saves in beginTransaction() so the stack only
    // gets one entry per logical action.
    if (undo) undo.recordBefore();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      localStorage.setItem('gpc_ui_overrides_updated_at', String(Date.now()));
      flashToast('Saved', 'success');
      if (window.EditorShell) window.EditorShell.markClean();
    } catch (e) { console.error('[ui-editor] save failed', e); flashToast('Save failed', 'error'); }
    if (undo) undo.commit();
  }
  // Persist current store WITHOUT touching the undo stack — used by undo/redo
  // application path so we don't poison history.
  function saveStoreSilent() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      localStorage.setItem('gpc_ui_overrides_updated_at', String(Date.now()));
      if (window.EditorShell) window.EditorShell.markClean();
    } catch (e) { console.error('[ui-editor] save failed', e); }
  }
  function flashToast(msg, type) {
    if (window.EditorShell && typeof window.EditorShell.toast === 'function') {
      window.EditorShell.toast(msg, type || 'info');
      return;
    }
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(flashToast._t);
    flashToast._t = setTimeout(() => t.classList.remove('show'), 1100);
  }
  function markDirty() { if (window.EditorShell) window.EditorShell.markDirty(); }

  // ----- Override accessors -----
  function keyFor(id, courseId) { return courseId ? (id + '@' + courseId) : id; }
  function getOverride(id, courseId) { return store[keyFor(id, courseId)] || null; }
  function patchOverride(id, courseId, patch) {
    const k = keyFor(id, courseId);
    store[k] = { ...(store[k] || {}), ...patch };
    markDirty();
    saveStore();
  }
  function clearOverride(id, courseId) { delete store[keyFor(id, courseId)]; markDirty(); saveStore(); }

  function effectiveProps(el) {
    // Merge defaults ← global override ← per-course override (in active scope).
    const ovr = { ...(getOverride(el.id, '') || {}), ...(scopeCourseId ? (getOverride(el.id, scopeCourseId) || {}) : {}) };
    return {
      x: ovr.x != null ? Number(ovr.x) : el.defaults.x,
      y: ovr.y != null ? Number(ovr.y) : el.defaults.y,
      w: ovr.w != null ? Number(ovr.w) : el.defaults.w,
      h: ovr.h != null ? Number(ovr.h) : el.defaults.h,
      hidden: !!ovr.hidden,
      lockAspect: !!ovr.lockAspect,
      icon: ovr.icon != null ? String(ovr.icon) : '',
      background: ovr.background != null ? String(ovr.background) : '',
      fontSize: Number.isFinite(Number(ovr.fontSize)) ? Number(ovr.fontSize) : null,
      // Legacy label color/font controls — consumed by game.js applyUiOverride
      // (passed through as textFill/fontFamily on the button style).
      color: typeof ovr.color === 'string' ? ovr.color : '',
      fontFamily: typeof ovr.fontFamily === 'string' ? ovr.fontFamily : '',
      fontWeight: Number.isFinite(Number(ovr.fontWeight)) ? Number(ovr.fontWeight) : null,
      layers: Array.isArray(ovr.layers) ? ovr.layers : []
    };
  }

  // ----- Layer state + helpers -----
  let selectedLayerId = null;

  function _uid() { return 'layer-' + Math.random().toString(36).slice(2, 9); }
  function getLayers(elId, courseId) {
    const ovr = getOverride(elId, courseId) || getOverride(elId, '') || {};
    return Array.isArray(ovr.layers) ? ovr.layers : [];
  }
  // Read+write layers array on the *active scope*. If no override exists in
  // the active scope yet, seed it with a copy of the global one so edits don't
  // silently overwrite global defaults.
  function getEditableLayers() {
    const cur = getOverride(selectedElementId, scopeCourseId);
    if (cur && Array.isArray(cur.layers)) return cur.layers.slice();
    if (scopeCourseId) {
      const g = getOverride(selectedElementId, '');
      if (g && Array.isArray(g.layers)) return g.layers.map((l) => ({ ...l }));
    }
    return [];
  }
  function writeLayers(arr) {
    patchOverride(selectedElementId, scopeCourseId, { layers: arr });
  }
  // Build the in-code default render for the currently-selected button as a
  // layers array (using effective props so user edits to x/y/w/h apply).
  function _seedDefaultsForSelected() {
    const el = getElement(selectedElementId);
    if (!el || !window.UIButtonRender || typeof window.UIButtonRender.defaultLayersFor !== 'function') return [];
    const p = effectiveProps(el);
    return window.UIButtonRender.defaultLayersFor({
      label: el.label,
      icon: p.icon,
      background: p.background,
      x: p.x, y: p.y, w: p.w, h: p.h,
      fontSize: p.fontSize || 18
    });
  }
  function addLayer(type) {
    let arr = getEditableLayers();
    // First-time add → seed the in-code defaults so the user sees + can edit
    // the existing render instead of starting from a blank that overlays it.
    if (!arr.length) {
      arr = _seedDefaultsForSelected();
    }
    const layer = type === 'text'
      ? { id: _uid(), type: 'text', text: 'TEXT', size: 16, color: '#2a1c0e',
          align: 'center', bold: true, anchor: 'cc', x: 0, y: 0, w: null, h: null }
      : { id: _uid(), type: 'sprite', sprite: '', anchor: 'cc',
          x: 0, y: 0, w: null, h: null };
    arr.push(layer);
    writeLayers(arr);
    selectedLayerId = layer.id;
    renderLayersPanel(); renderPreview();
  }
  function patchLayer(layerId, patch) {
    const arr = getEditableLayers();
    const i = arr.findIndex((l) => l.id === layerId);
    if (i < 0) return;
    arr[i] = { ...arr[i], ...patch };
    writeLayers(arr);
    renderPreview();
  }
  function deleteLayer(layerId) {
    const arr = getEditableLayers().filter((l) => l.id !== layerId);
    writeLayers(arr);
    if (selectedLayerId === layerId) selectedLayerId = null;
    renderLayersPanel(); renderPreview();
  }
  function moveLayer(layerId, dir) {
    const arr = getEditableLayers();
    const i = arr.findIndex((l) => l.id === layerId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    writeLayers(arr);
    renderLayersPanel(); renderPreview();
  }
  function getSelectedLayer() {
    if (!selectedLayerId) return null;
    return getEditableLayers().find((l) => l.id === selectedLayerId) || null;
  }

  // Resolve a stored sprite key to an entry from either catalog. Accepts
  // catalog short keys (e.g. "ui-play-icon") and falls back to manifest
  // lookup so legacy/raw paths still work.
  function _resolveSpriteEntry(key) {
    if (!key) return null;
    if (BG_BY_KEY[key]) return BG_BY_KEY[key];
    if (ICON_BY_KEY[key]) return ICON_BY_KEY[key];
    if (window.GPC_ASSETS && typeof window.GPC_ASSETS.byName === 'function') {
      const a = window.GPC_ASSETS.byName(key);
      if (a) return _toEntry(a);
    }
    // Treat as raw path.
    if (typeof key === 'string' && /\.(png|webp|jpg|jpeg|svg)$/i.test(key)) {
      return { key, label: key, src: key, tags: [] };
    }
    return null;
  }
  // Cache loaded HTMLImageElements for preview re-renders.
  const _imgCache = {};
  function _loadImg(src, onReady) {
    if (!src) return null;
    if (_imgCache[src]) return _imgCache[src];
    const img = new Image();
    img.onload = () => { if (onReady) onReady(); };
    img.src = src;
    _imgCache[src] = img;
    return img;
  }

  function getScreen() { return SCREENS.find((s) => s.id === activeScreenId) || SCREENS[0]; }
  function getElement(id) {
    for (const s of SCREENS) {
      const e = s.elements.find((e) => e.id === id);
      if (e) return e;
    }
    return null;
  }

  // ----- Render: screen tabs -----
  function renderScreenTabs() {
    const root = document.getElementById('screen-tabs');
    root.innerHTML = '';
    for (const s of SCREENS) {
      const btn = document.createElement('button');
      btn.className = 'screen-tab' + (s.id === activeScreenId ? ' active' : '');
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        activeScreenId = s.id;
        const first = (s.elements[0] && s.elements[0].id) || null;
        if (first) selectedElementId = first;
        renderScreenTabs(); renderElementList(); renderProps(); renderPreview();
      });
      root.appendChild(btn);
    }
  }

  // ----- Render: element list -----
  function renderElementList() {
    const root = document.getElementById('el-list');
    root.innerHTML = '';
    const screen = getScreen();
    if (!screen.elements.length) {
      root.innerHTML = '<div class="empty-pane">No elements registered for this screen yet.</div>';
      return;
    }
    for (const el of screen.elements) {
      const item = document.createElement('div');
      // Compute which scopes have overrides (Global / C1..C5) and render
      // small badges so the user can see at a glance where they've already
      // diverged from in-code defaults.
      const scopes = scopesWithOverrides(el.id);
      const hasOvr = scopes.length > 0;
      item.className = 'el-item' + (el.id === selectedElementId ? ' active' : '') + (hasOvr ? ' has-override' : '');
      const badges = scopes.map((s) => {
        const lbl = s === '' ? 'G' : ('C' + s);
        const cls = s === '' ? 'ovr-badge global' : 'ovr-badge';
        const title = s === '' ? 'Global override' : ('Course ' + s + ' override');
        return `<span class="${cls}" title="${title}">${lbl}</span>`;
      }).join('');
      item.innerHTML = `<span>${el.label}</span><span class="meta">${el.id}</span>` +
                      (badges ? `<span class="ovr-badges">${badges}</span>` : '');
      item.addEventListener('click', () => {
        selectedElementId = el.id;
        selectedLayerId = null;
        renderElementList(); renderProps(); renderPreview();
      });
      root.appendChild(item);
    }
  }

  // Return list of scope ids ('' = global, '1'..'5' = per-course) that have
  // at least one stored override key for the given element id.
  function scopesWithOverrides(elId) {
    const out = [];
    if (store[elId]) out.push('');
    const prefix = elId + '@';
    for (const k of Object.keys(store)) {
      if (k.startsWith(prefix)) {
        const c = k.slice(prefix.length);
        if (c && out.indexOf(c) < 0) out.push(c);
      }
    }
    // Stable order: global first then numeric ascending.
    out.sort((a, b) => {
      if (a === '') return -1;
      if (b === '') return 1;
      return Number(a) - Number(b);
    });
    return out;
  }

  // Per-property reset: drop a single field from the current scope's override
  // record (so the in-code default + any global override re-takes effect).
  function resetProperty(prop) {
    const cur = getOverride(selectedElementId, scopeCourseId);
    if (!cur || cur[prop] == null) return; // already at default
    const next = { ...cur };
    delete next[prop];
    if (Object.keys(next).length) store[keyFor(selectedElementId, scopeCourseId)] = next;
    else delete store[keyFor(selectedElementId, scopeCourseId)];
    markDirty(); saveStore();
    renderElementList(); renderProps(); renderPreview();
    flashToast('Reset ' + prop, 'info');
  }

  // ----- Render: properties panel -----
  function renderProps() {
    const empty = document.getElementById('props-empty');
    const body = document.getElementById('props-body');
    const el = getElement(selectedElementId);
    if (!el) { empty.style.display = ''; body.style.display = 'none'; return; }
    empty.style.display = 'none';
    body.style.display = '';
    const meta = document.getElementById('props-meta');
    meta.textContent = `${el.label} · ${el.id}` + (scopeCourseId ? ` · scoped to Course ${scopeCourseId}` : '');
    const props = effectiveProps(el);
    const setVal = (sel, v) => {
      const e = document.querySelector(sel);
      if (!e || document.activeElement === e) return;
      if (e.type === 'checkbox') e.checked = !!v;
      else e.value = v == null ? '' : v;
    };
    setVal('input[data-prop="x"]', Math.round(props.x));
    setVal('input[data-prop="y"]', Math.round(props.y));
    setVal('input[data-prop="w"]', Math.round(props.w));
    setVal('input[data-prop="h"]', Math.round(props.h));
    setVal('input[data-flag="hidden"]', props.hidden);
    setVal('input[data-flag="lockAspect"]', props.lockAspect);
    setPickerValue('background', props.background);
    setPickerValue('icon', props.icon);
    setVal('input[data-prop="fontSize"]', props.fontSize != null ? props.fontSize : '');
    setVal('input[data-prop="color"]', props.color || '');
    setVal('select[data-prop="fontFamily"]', props.fontFamily || '');
    setVal('select[data-prop="fontWeight"]', props.fontWeight != null ? String(props.fontWeight) : '');
    // Sync the color <input type=color> swatch to the text value (only if it
    // parses as a #RRGGBB literal — the picker can't display named colors).
    const colorPick = document.getElementById('legacy-color-picker');
    if (colorPick && document.activeElement !== colorPick) {
      const v = props.color || '';
      colorPick.value = /^#([0-9a-f]{6})$/i.test(v) ? v : '#FFF8E8';
    }
    const courseSel = document.getElementById('course-scope');
    if (courseSel && document.activeElement !== courseSel) courseSel.value = scopeCourseId;
    // Refresh layers panel for the newly-selected element.
    renderLayersPanel();
  }

  // §WYSIWYG§ Notify the embedded game iframe which UI element is currently
  // selected so it can draw a highlight overlay on the matching button. The
  // iframe runs the same-origin game with ?menuOnly=1&editorSync=1, listening
  // for { type: 'ui-editor:select', target: <id> } messages.
  function postSelectionToPreview() {
    try {
      const iframe = document.getElementById('ui-preview-iframe');
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage(
        selectedElementId
          ? { type: 'ui-editor:select', target: selectedElementId }
          : { type: 'ui-editor:clearSelect' },
        location.origin
      );
    } catch (_) {}
  }

  // ----- Render: preview canvas -----
  function drawPreviewBackdrop(ctx, screen) {
    if (screen.bg === 'menu') {
      // Soft sky → ground gradient like the main menu.
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#c5e0f4'); g.addColorStop(0.6, '#dce8d6'); g.addColorStop(1, '#9cc26d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#7a5a38'; ctx.fillRect(0, 480, W, H - 480);
      // Title placeholder
      ctx.font = '800 36px Fredoka, sans-serif';
      ctx.fillStyle = 'rgba(42,28,14,0.85)';
      ctx.textAlign = 'center';
      ctx.fillText('GOLF · Paper Craft', W / 2, 130);
      ctx.font = '600 14px Fredoka, sans-serif';
      ctx.fillStyle = 'rgba(42,28,14,0.55)';
      ctx.fillText('— Main menu preview —', W / 2, 160);
    } else if (screen.bg === 'play') {
      // Sky gradient + ground line + ball + hole stand-in
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#c5e0f4'); g.addColorStop(1, '#9cc26d');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#7a5a38'; ctx.fillRect(0, 380, W, H - 380);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(120, 360, 12, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.ellipse(540, 384, 18, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a23';
      ctx.fillRect(545, 320, 4, 60);
      ctx.beginPath(); ctx.moveTo(549, 320); ctx.lineTo(580, 330); ctx.lineTo(549, 340); ctx.closePath(); ctx.fill();
      // Shots card mock
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(20, 14, 140, 38);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.strokeRect(20, 14, 140, 38);
      ctx.fillStyle = '#2a1c0e';
      ctx.font = '700 12px Fredoka, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Shots: 0/5', 30, 38);
    }
  }

  function renderPreview() {
    // §WYSIWYG§ The center pane is now an <iframe> running the real game in
    // ?menuOnly=1 mode — it picks up override changes via the existing
    // localStorage 'storage' event listener already wired in game.js. The
    // editor no longer maintains a simplified canvas mock. We still update
    // the preview-info badge and broadcast selection to the iframe so it can
    // draw a highlight overlay around the selected element.
    postSelectionToPreview();
    {
      const _el0 = getElement(selectedElementId);
      const _info0 = document.getElementById('preview-info');
      if (_info0) {
        if (_el0) {
          const _p0 = effectiveProps(_el0);
          _info0.textContent = `${_el0.label} · ${Math.round(_p0.x)},${Math.round(_p0.y)} · ${Math.round(_p0.w)}×${Math.round(_p0.h)}`;
        } else {
          _info0.textContent = '';
        }
      }
    }
    return;
    // ↓ Legacy simplified canvas mock — preserved as dead code under early
    // return so it can be revived if a fallback preview is needed. Original
    // implementation drew a flat backdrop + element rects without sprites.
    /* eslint-disable no-unreachable */
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const screen = getScreen();
    drawPreviewBackdrop(ctx, screen);

    // Draw each element in its effective position. When `background` override
    // is set, draw that sprite as the plate; otherwise use the translucent
    // editor body. Icon sprite (if any) renders on top at ~70% size, then
    // the label.
    for (const el of screen.elements) {
      const p = effectiveProps(el);
      const isSelected = el.id === selectedElementId;
      ctx.save();
      ctx.globalAlpha = p.hidden ? 0.32 : 1;

      // If composite layers present, they REPLACE legacy bg/icon/label.
      const hasLayers = !!(window.UIButtonRender && p.layers && p.layers.length);

      // Background layer
      const bgEntry = !hasLayers ? _resolveSpriteEntry(p.background) : null;
      let drewSprite = false;
      if (bgEntry) {
        const img = _loadImg(bgEntry.src, renderPreview);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, p.x, p.y, p.w, p.h);
          drewSprite = true;
        }
      }
      if (!drewSprite && !hasLayers) {
        ctx.fillStyle = isSelected ? 'rgba(192,138,255,0.55)' : 'rgba(255,255,255,0.78)';
        ctx.strokeStyle = isSelected ? '#9a5fe0' : 'rgba(42,28,14,0.7)';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        roundRect(ctx, p.x, p.y, p.w, p.h, 6);
        ctx.fill(); ctx.stroke();
      } else if (hasLayers && isSelected) {
        ctx.strokeStyle = '#9a5fe0';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4,3]);
        roundRect(ctx, p.x, p.y, p.w, p.h, 6);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isSelected) {
        // Selection ring around sprite plate
        ctx.strokeStyle = '#9a5fe0';
        ctx.lineWidth = 2.5;
        roundRect(ctx, p.x, p.y, p.w, p.h, 6);
        ctx.stroke();
      }

      // Icon layer (centered, ~70% of min dim) — skipped when layers replace legacy
      const iconEntry = !hasLayers ? _resolveSpriteEntry(p.icon) : null;
      if (iconEntry) {
        const img = _loadImg(iconEntry.src, renderPreview);
        if (img && img.complete && img.naturalWidth > 0) {
          const iw = img.naturalWidth, ih = img.naturalHeight;
          const target = Math.min(p.w, p.h) * 0.7;
          const scale = target / Math.max(iw, ih);
          const dw = iw * scale, dh = ih * scale;
          ctx.drawImage(img, p.x + (p.w - dw) / 2, p.y + (p.h - dh) / 2, dw, dh);
        }
      }

      // Label — skipped when layers replace legacy
      if (!hasLayers) {
        ctx.fillStyle = drewSprite ? '#2a1c0e' : (isSelected ? '#1a1024' : '#2a1c0e');
        ctx.font = `700 ${p.fontSize || 13}px Fredoka, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = (p.hidden ? '(hidden) ' : '') + el.label;
        ctx.fillText(text, p.x + p.w / 2, p.y + p.h / 2);
      }

      // Composite layers (new) — uses shared UIButtonRender so the editor
      // preview renders pixel-identically to the in-game runtime.
      if (hasLayers) {
        window.UIButtonRender.draw(ctx, { x: p.x, y: p.y, w: p.w, h: p.h }, p.layers, {
          vars: { shots: 2, maxShots: 5, coins: 120, gems: 8,
                  course: scopeCourseId || 1, level: 1 },
          getImage: (src) => {
            const entry = _resolveSpriteEntry(src);
            if (!entry) return null;
            return _loadImg(entry.src, renderPreview);
          },
          imageReady: (img) => !!(img && img.complete && img.naturalWidth > 0),
          selection: (isSelected && selectedLayerId) ? { layerId: selectedLayerId } : null
        });
      }
      ctx.restore();
    }

    // Stage info text
    const el = getElement(selectedElementId);
    const info = document.getElementById('preview-info');
    if (el) {
      const p = effectiveProps(el);
      info.textContent = `${el.label} · ${Math.round(p.x)},${Math.round(p.y)} · ${Math.round(p.w)}×${Math.round(p.h)}`;
    } else { info.textContent = ''; }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  // ----- Drag-to-position -----
  // Click any element rect on the preview to select + drag it. Hold the corner
  // to resize (with optional aspect-ratio lock).
  let drag = null;
  function setupCanvasInteraction() {
    // §WYSIWYG§ The center pane is now an <iframe>, not a canvas — there's
    // nothing to drag on. v1 ships with numerical inputs + arrow keys for
    // position editing; v2 may overlay drag handles on the iframe via
    // postMessage. Bail out cleanly so the rest of the editor still works.
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    canvas.addEventListener('mousedown', (ev) => {
      // Start a drag transaction so the entire move/resize collapses into a
      // single undo entry instead of one per pixel of mouse movement.
      if (undo) undo.beginTransaction();
      const r = canvas.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * (canvas.width / r.width);
      const sy = (ev.clientY - r.top)  * (canvas.height / r.height);
      const screen = getScreen();
      // Layer-first hit-test on the *currently-selected* element. Layers can
      // overflow the parent, so they have to be tested even outside the box.
      const selEl = getElement(selectedElementId);
      if (selEl && window.UIButtonRender) {
        const ep = effectiveProps(selEl);
        const layers = ep.layers || [];
        const tmp = canvas.getContext('2d');
        for (let i = layers.length - 1; i >= 0; i--) {
          const layer = layers[i];
          const bbox = window.UIButtonRender.layerBBox(
            { x: ep.x, y: ep.y, w: ep.w, h: ep.h },
            layer,
            { measureCtx: tmp,
              getImage: (src) => { const e = _resolveSpriteEntry(src); return e ? _loadImg(e.src) : null; },
              imageReady: (img) => !!(img && img.complete && img.naturalWidth > 0) }
          );
          if (sx >= bbox.x && sx <= bbox.x + bbox.w && sy >= bbox.y && sy <= bbox.y + bbox.h) {
            selectedLayerId = layer.id;
            const lmode = ((bbox.x + bbox.w - sx) <= 12 && (bbox.y + bbox.h - sy) <= 12) ? 'resize' : 'move';
            drag = {
              isLayer: true,
              layerId: layer.id,
              mode: lmode,
              startMouseX: sx, startMouseY: sy,
              startX: layer.x || 0, startY: layer.y || 0,
              startW: bbox.w, startH: bbox.h,
              ratio: bbox.w / Math.max(1, bbox.h)
            };
            renderLayersPanel(); renderPreview();
            return;
          }
        }
      }
      // Find topmost element under the cursor (last in array drawn last → topmost)
      let target = null;
      let mode = 'move';
      for (let i = screen.elements.length - 1; i >= 0; i--) {
        const el = screen.elements[i];
        const p = effectiveProps(el);
        if (sx >= p.x && sx <= p.x + p.w && sy >= p.y && sy <= p.y + p.h) {
          target = el;
          // Resize zone in the bottom-right 12px corner.
          if ((p.x + p.w - sx) <= 14 && (p.y + p.h - sy) <= 14) mode = 'resize';
          break;
        }
      }
      if (!target) {
        // Click on empty space → deselect layer.
        if (selectedLayerId) { selectedLayerId = null; renderLayersPanel(); renderPreview(); }
        return;
      }
      selectedLayerId = null;
      selectedElementId = target.id;
      const props = effectiveProps(target);
      drag = {
        elId: target.id,
        mode,
        startMouseX: sx, startMouseY: sy,
        startX: props.x, startY: props.y,
        startW: props.w, startH: props.h,
        ratio: props.w / Math.max(1, props.h),
        lockAspect: props.lockAspect
      };
      renderElementList(); renderProps(); renderPreview();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!drag) return;
      const r = canvas.getBoundingClientRect();
      const sx = (ev.clientX - r.left) * (canvas.width / r.width);
      const sy = (ev.clientY - r.top)  * (canvas.height / r.height);
      const dx = sx - drag.startMouseX;
      const dy = sy - drag.startMouseY;
      if (drag.isLayer) {
        if (drag.mode === 'move') {
          patchLayer(drag.layerId, {
            x: Math.round(drag.startX + dx),
            y: Math.round(drag.startY + dy)
          });
        } else {
          let nw = Math.max(8, Math.round(drag.startW + dx));
          let nh = Math.max(8, Math.round(drag.startH + dy));
          if (ev.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) nh = Math.max(8, Math.round(nw / drag.ratio));
            else nw = Math.max(8, Math.round(nh * drag.ratio));
          }
          patchLayer(drag.layerId, { w: nw, h: nh });
        }
        renderLayerInspector();
        return;
      }
      const patch = {};
      if (drag.mode === 'move') {
        patch.x = Math.round(drag.startX + dx);
        patch.y = Math.round(drag.startY + dy);
      } else {
        patch.w = Math.max(8, Math.round(drag.startW + dx));
        patch.h = Math.max(8, Math.round(drag.startH + dy));
        if (drag.lockAspect) {
          // Use whichever delta is bigger to drive both dimensions.
          if (Math.abs(dx) > Math.abs(dy)) patch.h = Math.max(8, Math.round(patch.w / drag.ratio));
          else patch.w = Math.max(8, Math.round(patch.h * drag.ratio));
        }
      }
      patchOverride(drag.elId, scopeCourseId, patch);
      renderProps(); renderPreview();
    });
    window.addEventListener('mouseup', () => {
      if (drag) { drag = null; renderElementList(); }
      if (undo) undo.endTransaction();
    });
  }

  // ----- Sprite pickers (Background + Icon) -----
  // Two parallel pickers sharing the same UI/UX. Each is keyed by `field`
  // ('background' or 'icon') and writes that field into the override store.
  // Selection always mirrors the currently selected element + course scope.
  const PICKERS = {
    background: {
      field: 'background',
      rootId: 'bg-picker',
      ids: { trigger: 'bgp-trigger', thumb: 'bgp-thumb', name: 'bgp-name', sub: 'bgp-sub',
             clear: 'bgp-clear', popover: 'bgp-popover', search: 'bgp-search', grid: 'bgp-grid' },
      catalog: () => BG_CATALOG, byKey: () => BG_BY_KEY,
      open: false, filter: ''
    },
    icon: {
      field: 'icon',
      rootId: 'icon-picker',
      ids: { trigger: 'sp-trigger', thumb: 'sp-thumb', name: 'sp-name', sub: 'sp-sub',
             clear: 'sp-clear', popover: 'sp-popover', search: 'sp-search', grid: 'sp-grid' },
      catalog: () => ICON_CATALOG, byKey: () => ICON_BY_KEY,
      open: false, filter: ''
    },
    // Layer-sprite picker — shows ALL ui-tagged assets (icons + plates) so a
    // layer can stack any sprite. Writes to the selected layer's `sprite` field.
    layerSprite: {
      field: 'sprite',
      rootId: 'ls-picker',
      ids: { trigger: 'lsp-trigger', thumb: 'lsp-thumb', name: 'lsp-name', sub: 'lsp-sub',
             clear: 'lsp-clear', popover: 'lsp-popover', search: 'lsp-search', grid: 'lsp-grid' },
      // Union of plates + icons for max flexibility.
      catalog: () => {
        const seen = Object.create(null);
        const out = [];
        const push = (e) => { if (!seen[e.key]) { seen[e.key] = 1; out.push(e); } };
        BG_CATALOG.forEach(push);
        ICON_CATALOG.forEach(push);
        return out;
      },
      byKey: () => {
        const m = {};
        BG_CATALOG.forEach((e) => (m[e.key] = e));
        ICON_CATALOG.forEach((e) => (m[e.key] = e));
        return m;
      },
      open: false, filter: '',
      // Special: writes into the selected layer instead of the override root.
      isLayerPicker: true
    }
  };

  function setSpriteOverride(field, key) {
    // Layer-sprite picker writes into the selected layer, not the root.
    if (PICKERS[field] && PICKERS[field].isLayerPicker) {
      if (selectedLayerId) patchLayer(selectedLayerId, { sprite: key || '' });
      setPickerValue(field, key || '');
      renderLayersPanel();
      return;
    }
    if (key) {
      patchOverride(selectedElementId, scopeCourseId, { [field]: key });
    } else {
      const cur = getOverride(selectedElementId, scopeCourseId) || {};
      const next = { ...cur };
      delete next[field];
      if (Object.keys(next).length) store[keyFor(selectedElementId, scopeCourseId)] = next;
      else delete store[keyFor(selectedElementId, scopeCourseId)];
      saveStore();
    }
    renderElementList();
    renderPreview();
    setPickerValue(field, key || '');
  }
  // Back-compat alias retained for any callers that still use the
  // single-picker API. New code should call setSpriteOverride('icon', …).
  function setIconOverride(key) { setSpriteOverride('icon', key); }
  function setPickerValue(field, key) {
    const cfg = PICKERS[field];
    if (!cfg) return;
    const root = document.getElementById(cfg.rootId);
    const thumb = document.getElementById(cfg.ids.thumb);
    const name  = document.getElementById(cfg.ids.name);
    const sub   = document.getElementById(cfg.ids.sub);
    const clr   = document.getElementById(cfg.ids.clear);
    if (!root || !thumb || !name) return;
    const entry = key ? (cfg.byKey()[key] || _resolveSpriteEntry(key)) : null;
    thumb.innerHTML = '';
    if (entry) {
      thumb.classList.remove('empty');
      const img = document.createElement('img');
      img.src = entry.src; img.alt = entry.label;
      thumb.appendChild(img);
      name.textContent = entry.label;
      if (sub) sub.textContent = entry.key;
      clr.style.display = '';
    } else if (key) {
      // Custom value not in catalog (e.g. legacy import). Show raw key.
      thumb.classList.add('empty');
      name.textContent = key;
      if (sub) sub.textContent = '(custom — not in catalog)';
      clr.style.display = '';
    } else {
      thumb.classList.add('empty');
      name.textContent = '(none — using in-code default)';
      if (sub) sub.textContent = '';
      clr.style.display = 'none';
    }
    // Highlight the selected cell in the open popover.
    root.querySelectorAll('.sp-cell').forEach((c) => {
      c.classList.toggle('active', c.dataset.key === (key || ''));
    });
  }
  function _activePickerKey(field) {
    const cfg = PICKERS[field];
    if (cfg && cfg.isLayerPicker) {
      const layer = getSelectedLayer();
      return layer && layer.sprite ? layer.sprite : '';
    }
    const el = getElement(selectedElementId);
    if (!el) return '';
    const p = effectiveProps(el);
    return p[field] || '';
  }
  function renderPickerGrid(field) {
    const cfg = PICKERS[field];
    if (!cfg) return;
    const grid = document.getElementById(cfg.ids.grid);
    if (!grid) return;
    const q = (cfg.filter || '').trim().toLowerCase();
    const catalog = cfg.catalog();
    const matches = catalog.filter((e) =>
      !q || e.key.toLowerCase().includes(q) || e.label.toLowerCase().includes(q));
    grid.innerHTML = '';
    if (!q) {
      const empty = document.createElement('button');
      empty.type = 'button';
      empty.className = 'sp-cell empty-opt';
      empty.dataset.key = '';
      empty.title = 'Use the in-code default for this button';
      empty.innerHTML = '<span class="sp-cell-thumb"></span><span class="sp-cell-name">DEFAULT</span>';
      empty.addEventListener('click', () => { setSpriteOverride(field, ''); closeSpritePicker(field); });
      grid.appendChild(empty);
    }
    if (!matches.length) {
      const e = document.createElement('div');
      e.className = 'sp-empty'; e.textContent = 'No sprites match.';
      grid.appendChild(e);
    }
    for (const entry of matches) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sp-cell';
      cell.dataset.key = entry.key;
      cell.title = entry.key;
      const tagsHtml = (entry.tags || []).map(t => `<span class="sp-tag">${t}</span>`).join('');
      cell.innerHTML = `
        <span class="sp-cell-thumb"><img src="${entry.src}" alt="${entry.label}"></span>
        <span class="sp-cell-name">${entry.label}</span>
        <div class="sp-tags-hover">${tagsHtml}</div>`;
      cell.addEventListener('click', () => { setSpriteOverride(field, entry.key); closeSpritePicker(field); });
      grid.appendChild(cell);
    }
    const cur = _activePickerKey(field);
    grid.querySelectorAll('.sp-cell').forEach((c) =>
      c.classList.toggle('active', c.dataset.key === cur));
  }
  function openSpritePicker(field) {
    const cfg = PICKERS[field];
    if (!cfg) return;
    // Close any other open picker first to avoid two-popover overlap.
    Object.keys(PICKERS).forEach((f) => { if (f !== field) closeSpritePicker(f); });
    const root = document.getElementById(cfg.rootId);
    if (!root) return;
    cfg.open = true;
    root.classList.add('open');
    document.getElementById(cfg.ids.trigger).setAttribute('aria-expanded', 'true');
    renderPickerGrid(field);
    const search = document.getElementById(cfg.ids.search);
    if (search) { search.value = cfg.filter || ''; setTimeout(() => search.focus(), 0); }
  }
  function closeSpritePicker(field) {
    if (field == null) {
      Object.keys(PICKERS).forEach(closeSpritePicker);
      return;
    }
    const cfg = PICKERS[field];
    if (!cfg) return;
    const root = document.getElementById(cfg.rootId);
    if (!root) return;
    cfg.open = false;
    root.classList.remove('open');
    const trig = document.getElementById(cfg.ids.trigger);
    if (trig) trig.setAttribute('aria-expanded', 'false');
  }
  function anyPickerOpen() { return Object.keys(PICKERS).some(f => PICKERS[f].open); }
  function setupSpritePicker(field) {
    const cfg = PICKERS[field];
    if (!cfg) return;
    const trigger = document.getElementById(cfg.ids.trigger);
    const search  = document.getElementById(cfg.ids.search);
    const clear   = document.getElementById(cfg.ids.clear);
    if (!trigger) return;
    trigger.addEventListener('click', (ev) => {
      if (clear && ev.target.closest('#' + cfg.ids.clear)) return;
      cfg.open ? closeSpritePicker(field) : openSpritePicker(field);
    });
    if (clear) {
      clear.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setSpriteOverride(field, '');
      });
    }
    if (search) {
      search.addEventListener('input', () => {
        cfg.filter = search.value || '';
        renderPickerGrid(field);
      });
      search.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { closeSpritePicker(field); trigger.focus(); }
      });
    }
    // Click-outside closes the popover.
    document.addEventListener('mousedown', (ev) => {
      if (!cfg.open) return;
      const root = document.getElementById(cfg.rootId);
      if (root && !root.contains(ev.target)) closeSpritePicker(field);
    });
  }
  function setupIconPicker() {
    setupSpritePicker('background');
    setupSpritePicker('icon');
    setupSpritePicker('layerSprite');
  }

  // ----- Layers panel + Inspector -----
  function renderLayersPanel() {
    const list = document.getElementById('layers-list');
    if (!list) return;
    list.innerHTML = '';
    const layers = getEditableLayers();
    if (!layers.length) {
      list.innerHTML = '<div class="empty-pane" style="padding:8px">No layers yet.</div>';
    } else {
      layers.forEach((l, i) => {
        const row = document.createElement('div');
        row.className = 'el-item' + (l.id === selectedLayerId ? ' active' : '');
        const icon = l.type === 'text' ? 'A' : '🖼';
        const label = l.type === 'text'
          ? (l.text || '(empty)').slice(0, 22)
          : (l.sprite || '(no sprite)').slice(0, 22);
        row.innerHTML =
          `<span style="display:inline-block;width:18px;text-align:center;font-weight:800;color:var(--accent)">${icon}</span>` +
          `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</span>` +
          `<span class="meta">${l.anchor || 'cc'}</span>` +
          `<button class="sp-clear" data-act="up" title="Move up" style="margin-left:4px">↑</button>` +
          `<button class="sp-clear" data-act="down" title="Move down">↓</button>` +
          `<button class="sp-clear" data-act="del" title="Delete" style="color:#ef6a6a">✕</button>`;
        row.addEventListener('click', (ev) => {
          const act = ev.target.dataset && ev.target.dataset.act;
          if (act === 'up')   { moveLayer(l.id, -1); ev.stopPropagation(); return; }
          if (act === 'down') { moveLayer(l.id, +1); ev.stopPropagation(); return; }
          if (act === 'del')  { deleteLayer(l.id); ev.stopPropagation(); return; }
          selectedLayerId = l.id;
          renderLayersPanel(); renderLayerInspector(); renderPreview();
        });
        list.appendChild(row);
      });
    }
    renderLayerInspector();
  }

  function renderLayerInspector() {
    const insp = document.getElementById('layer-inspector');
    if (!insp) return;
    const layer = getSelectedLayer();
    if (!layer) { insp.style.display = 'none'; return; }
    insp.style.display = '';
    const meta = document.getElementById('layer-inspector-meta');
    if (meta) meta.textContent = `${layer.type.toUpperCase()} layer · ${layer.id}`;

    // Toggle which fields show based on layer type.
    insp.querySelectorAll('[data-layer-field]').forEach((row) => {
      const f = row.dataset.layerField;
      const isSpriteField = (f === 'sprite' || f === 'tint');
      const isTextField = (f === 'text' || f === 'size' || f === 'color' ||
                           f === 'align' || f === 'bold' || f === 'font');
      if (isSpriteField) row.style.display = layer.type === 'sprite' ? '' : 'none';
      else if (isTextField) row.style.display = layer.type === 'text' ? '' : 'none';
    });

    // Populate inputs (skip the focused one to avoid clobbering active edit).
    const set = (sel, v) => {
      const e = insp.querySelector(sel);
      if (!e || document.activeElement === e) return;
      if (e.type === 'checkbox') e.checked = !!v;
      else e.value = v == null ? '' : v;
    };
    set('input[data-layer-prop="x"]', Math.round(layer.x || 0));
    set('input[data-layer-prop="y"]', Math.round(layer.y || 0));
    set('input[data-layer-prop="w"]', layer.w == null ? '' : Math.round(layer.w));
    set('input[data-layer-prop="h"]', layer.h == null ? '' : Math.round(layer.h));
    set('input[data-layer-prop="text"]', layer.text);
    set('input[data-layer-prop="size"]', layer.size);
    set('input[data-layer-prop="color"]', layer.color);
    {
      const cp = insp.querySelector('input[data-layer-prop="colorPicker"]');
      if (cp && document.activeElement !== cp) {
        const v = layer.color || '';
        cp.value = /^#([0-9a-f]{6})$/i.test(v) ? v : '#2a1c0e';
      }
    }
    set('select[data-layer-prop="align"]', layer.align || 'center');
    set('select[data-layer-prop="font"]', layer.font || '');
    set('input[data-layer-prop="bold"]', !!layer.bold);
    set('input[data-layer-prop="tint"]', layer.tint);

    // Sprite picker thumbnail
    setPickerValue('layerSprite', layer.sprite || '');

    // Anchor 9-grid
    const anchorGrid = document.getElementById('anchor-grid');
    if (anchorGrid && !anchorGrid.dataset.built) {
      const keys = ['tl','tc','tr','cl','cc','cr','bl','bc','br'];
      anchorGrid.innerHTML = '';
      keys.forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'top-btn';
        b.dataset.anchor = k;
        b.style.cssText = 'padding:4px;font-size:10px;text-align:center';
        b.textContent = k;
        b.addEventListener('click', () => {
          const cur = getSelectedLayer();
          if (cur) patchLayer(cur.id, { anchor: k });
          renderLayerInspector();
        });
        anchorGrid.appendChild(b);
      });
      anchorGrid.dataset.built = '1';
    }
    if (anchorGrid) {
      anchorGrid.querySelectorAll('button').forEach((b) => {
        b.style.borderColor = (b.dataset.anchor === (layer.anchor || 'cc'))
          ? 'var(--accent)' : 'var(--line-strong)';
        b.style.color = (b.dataset.anchor === (layer.anchor || 'cc'))
          ? 'var(--accent)' : 'var(--ink)';
      });
    }
  }

  function bindLayerInspector() {
    const insp = document.getElementById('layer-inspector');
    if (!insp) return;
    insp.querySelectorAll('input[data-layer-prop],select[data-layer-prop]').forEach((el) => {
      const prop = el.dataset.layerProp;
      const handler = () => {
        const layer = getSelectedLayer();
        if (!layer) return;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') {
          v = el.value === '' ? null : Number(el.value);
          if (v != null && !Number.isFinite(v)) return;
        } else v = el.value;
        // Color swatch (type=color, data-layer-prop="colorPicker") writes into
        // the `color` field AND mirrors the text input next to it so the user
        // can still type a custom value.
        if (prop === 'colorPicker') {
          const txt = insp.querySelector('input[data-layer-prop="color"]');
          if (txt) txt.value = v;
          patchLayer(layer.id, { color: v });
          return;
        }
        patchLayer(layer.id, { [prop]: v });
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    const addS = document.getElementById('btn-add-sprite-layer');
    const addT = document.getElementById('btn-add-text-layer');
    const del  = document.getElementById('btn-delete-layer');
    if (addS) addS.addEventListener('click', () => addLayer('sprite'));
    if (addT) addT.addEventListener('click', () => addLayer('text'));
    if (del)  del.addEventListener('click', () => { if (selectedLayerId) deleteLayer(selectedLayerId); });
    const restore = document.getElementById('btn-restore-defaults');
    if (restore) restore.addEventListener('click', () => {
      const el = getElement(selectedElementId);
      if (!el) return;
      if (!confirm('Wipe current layers and re-seed from in-code defaults for ' + el.label + '?')) return;
      const seeded = _seedDefaultsForSelected();
      writeLayers(seeded);
      selectedLayerId = null;
      renderLayersPanel(); renderPreview();
      flashToast('Defaults restored');
    });
  }

  // ----- Event wiring -----
  function bindUI() {
    document.querySelectorAll('input[data-prop]').forEach((el) => {
      el.addEventListener('input', () => {
        const v = el.type === 'number' ? Number(el.value) : el.value;
        if (el.type === 'number' && !Number.isFinite(v)) return;
        // Empty text fields (icon) clear that override.
        if (el.type === 'text' && !v) {
          const cur = getOverride(selectedElementId, scopeCourseId) || {};
          const next = { ...cur };
          delete next[el.dataset.prop];
          if (Object.keys(next).length) store[keyFor(selectedElementId, scopeCourseId)] = next;
          else delete store[keyFor(selectedElementId, scopeCourseId)];
          saveStore();
        } else {
          patchOverride(selectedElementId, scopeCourseId, { [el.dataset.prop]: v });
        }
        renderElementList(); renderPreview();
      });
    });
    // Selects in the right-panel legacy section (fontFamily, fontWeight).
    document.querySelectorAll('select[data-prop]').forEach((el) => {
      el.addEventListener('change', () => {
        const raw = el.value;
        const prop = el.dataset.prop;
        if (!raw) {
          // Empty option clears the override key entirely.
          const cur = getOverride(selectedElementId, scopeCourseId) || {};
          const next = { ...cur };
          delete next[prop];
          if (Object.keys(next).length) store[keyFor(selectedElementId, scopeCourseId)] = next;
          else delete store[keyFor(selectedElementId, scopeCourseId)];
          saveStore();
        } else {
          const v = (prop === 'fontWeight') ? Number(raw) : raw;
          patchOverride(selectedElementId, scopeCourseId, { [prop]: v });
        }
        renderElementList(); renderPreview();
      });
    });
    // Color swatch <-> text input two-way binding for the legacy label color.
    const legacyColorPick = document.getElementById('legacy-color-picker');
    if (legacyColorPick) {
      legacyColorPick.addEventListener('input', () => {
        const v = legacyColorPick.value;
        const txt = document.querySelector('input[data-prop="color"]');
        if (txt) txt.value = v;
        patchOverride(selectedElementId, scopeCourseId, { color: v });
        renderPreview();
      });
    }
    document.querySelectorAll('input[data-flag]').forEach((el) => {
      el.addEventListener('change', () => {
        patchOverride(selectedElementId, scopeCourseId, { [el.dataset.flag]: el.checked });
        renderElementList(); renderPreview();
      });
    });
    document.getElementById('course-scope').addEventListener('change', (ev) => {
      scopeCourseId = ev.target.value;
      // If picker is in course-scope mode, refresh catalogs so they reflect
      // the new active course.
      if (pickerScope === 'course') updateIconCatalog();
      renderElementList(); renderProps(); renderPreview();
    });
    const pickerScopeSel = document.getElementById('picker-scope');
    if (pickerScopeSel) {
      pickerScopeSel.value = pickerScope;
      pickerScopeSel.addEventListener('change', (ev) => {
        pickerScope = ev.target.value === 'course' ? 'course' : 'global';
        updateIconCatalog();
        renderProps(); renderPreview();
      });
    }
    document.getElementById('btn-reset').addEventListener('click', () => {
      const el = getElement(selectedElementId);
      if (!el) return;
      const lbl = el.label + (scopeCourseId ? ` (Course ${scopeCourseId})` : ' (global)');
      if (!confirm('Reset overrides for ' + lbl + '?')) return;
      clearOverride(el.id, scopeCourseId);
      renderElementList(); renderProps(); renderPreview();
    });
    // Per-property reset (↺) buttons in the Position+Style inspector rows
    document.querySelectorAll('button.ic-reset[data-reset]').forEach((b) => {
      b.addEventListener('click', () => resetProperty(b.dataset.reset));
    });
    document.getElementById('btn-save').addEventListener('click', saveStore);
    document.getElementById('btn-publish').addEventListener('click', async () => {
      // 1. Always write localStorage first (preserves dev-tab fast-sync).
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        localStorage.setItem('gpc_ui_overrides_updated_at', String(Date.now()));
      } catch (_) {}

      // 2. Prompt for password (deploys overrides to GitHub via /api).
      const pw = prompt('Publish password (deploys UI overrides globally):');
      if (!pw) { flashToast('Publish cancelled'); return; }

      flashToast('Publishing...');
      try {
        const res = await fetch('/api/publish-ui-overrides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw, store })
        });
        let body = {};
        try { body = await res.json(); } catch (_) {}
        if (!res.ok || !body.ok) {
          throw new Error(body.error || ('HTTP ' + res.status));
        }
        const sha = String(body.commitSha || '').slice(0, 7);
        flashToast(sha ? ('Published — ' + sha) : 'Published');
      } catch (e) {
        console.error('[publish]', e);
        flashToast('Publish failed: ' + (e.message || e));
      }
    });
    document.getElementById('btn-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'gpc-ui-overrides.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    document.getElementById('btn-import').addEventListener('click', () => document.getElementById('file-import').click());
    document.getElementById('file-import').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const obj = JSON.parse(String(r.result || '{}'));
          if (obj && typeof obj === 'object') {
            store = obj; saveStore();
            renderScreenTabs(); renderElementList(); renderProps(); renderPreview();
          }
        } catch (e) { alert('Import failed: ' + e.message); }
      };
      r.readAsText(f);
      ev.target.value = '';
    });

    // Play button — open last-selected level (same logic as the other editors)
    document.getElementById('btn-play-game').addEventListener('click', () => {
      let target = null;
      try {
        const raw = localStorage.getItem('gpc_editor_v1');
        if (raw) {
          const st = JSON.parse(raw);
          const levels = st && Array.isArray(st.levels) ? st.levels : [];
          const idx = (st && Number.isFinite(st.currentIdx)) ? st.currentIdx : 0;
          const lvl = levels[idx];
          if (lvl && lvl.courtId && lvl.slot) target = { course: lvl.courtId, level: lvl.slot };
        }
      } catch (_) {}
      if (target) location.href = `./index.html?course=${target.course}&level=${target.level}&editorSync=1`;
      else        location.href = './index.html';
    });

    setupCanvasInteraction();
    setupIconPicker();
    bindLayerInspector();

    // §WYSIWYG§ Hide the loading overlay once the embedded game has booted,
    // and re-broadcast the current selection so the iframe highlights the
    // active button right after first paint.
    (function setupPreviewIframe() {
      const iframe = document.getElementById('ui-preview-iframe');
      const loading = document.getElementById('preview-loading');
      if (!iframe) return;
      const onReady = () => {
        if (loading) loading.classList.add('hidden');
        // Wait one tick so the game's message listener is wired up.
        setTimeout(postSelectionToPreview, 250);
      };
      iframe.addEventListener('load', onReady);
      // Safety: if 'load' has already fired (cached), still hide after 4s.
      setTimeout(() => { if (loading) loading.classList.add('hidden'); }, 4000);
    })();

    // Copy / Paste style buttons
    const cBtn = document.getElementById('btn-copy-style');
    const pBtn = document.getElementById('btn-paste-style');
    if (cBtn) cBtn.addEventListener('click', copyStyleFromSelected);
    if (pBtn) pBtn.addEventListener('click', pasteStyleOntoSelected);
    refreshClipboardUI();

    // Cross-tab sync: another ui-editor tab copied → enable our paste button.
    window.addEventListener('storage', (ev) => {
      if (ev.key !== CLIPBOARD_KEY) return;
      clipboard = loadClipboard();
      refreshClipboardUI();
    });

    // Keyboard: Delete = clear override on selected element; Esc = close picker / deselect
    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target && ev.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedElementId) {
        const el = getElement(selectedElementId);
        if (!el) return;
        clearOverride(el.id, scopeCourseId);
        renderElementList(); renderProps(); renderPreview();
        flashToast('Override cleared');
        ev.preventDefault();
      } else if (ev.key === 'Escape') {
        if (anyPickerOpen()) closeSpritePicker();
      }
    });
  }

  function renderAll() {
    renderScreenTabs();
    renderElementList();
    renderProps();
    renderPreview();
    renderLayersPanel();
  }

  // ----- Boot -----
  document.addEventListener('DOMContentLoaded', async () => {
    if (window.GPC_ASSETS) {
      await window.GPC_ASSETS.ready();
      updateIconCatalog();
      window.GPC_ASSETS.on('change', () => {
        updateIconCatalog();
        Object.keys(PICKERS).forEach((f) => { if (PICKERS[f].open) renderPickerGrid(f); });
        renderPreview();
      });
    }
    renderScreenTabs();
    renderElementList();
    renderProps();
    renderPreview();
    bindUI();
    // Boot-time renders may incidentally trigger markDirty() (e.g. through
    // input-binding side effects). Clear the dirty pill once the initial
    // paint settles so users only see "Unsaved" after their own edits.
    setTimeout(() => {
      try { if (window.EditorShell) window.EditorShell.markClean(); } catch (_) {}
    }, 0);
    // Saved-ago indicator — re-renders every 5s using the timestamp written
    // alongside each saveStore() call so users can see when overrides last
    // hit localStorage / the live game tab.
    (function initSavedAgo() {
      const node = document.getElementById('saved-ago');
      if (!node) return;
      function fmt(diff) {
        if (diff < 5)    return 'Saved just now';
        if (diff < 60)   return 'Saved ' + Math.floor(diff) + 's ago';
        if (diff < 3600) return 'Saved ' + Math.floor(diff / 60) + 'm ago';
        return 'Saved ' + Math.floor(diff / 3600) + 'h ago';
      }
      function tick() {
        const ts = Number(localStorage.getItem('gpc_ui_overrides_updated_at') || 0);
        if (!ts) { node.textContent = ''; return; }
        node.textContent = fmt((Date.now() - ts) / 1000);
      }
      tick();
      setInterval(tick, 5000);
    })();

    // Initialize undo/redo stack and wire to EditorShell shortcuts.
    if (window.UndoStack) {
      undo = window.UndoStack.create({
        getState: () => store,
        setState: (s) => { store = s || {}; },
        render:   renderAll,
        onChange: saveStoreSilent
      });
      if (window.EditorShell) {
        window.EditorShell.mount({
          title: 'Edit UI',
          subtitle: 'Reposition, resize and re-skin menu / in-game UI buttons.',
          page: 'ui',
          actions: {
            onUndo: undo.undo,
            onRedo: undo.redo,
            onPlayLive: function () { window.open('index.html?editorSync=1', '_blank'); }
          }
        });
      }
    }

    // Cmd/Ctrl+C / Cmd/Ctrl+V copy/paste style. Skip when an input has focus
    // so the user can still copy text inside fields normally.
    function _inputFocused() {
      const a = document.activeElement;
      if (!a) return false;
      const t = (a.tagName || '').toUpperCase();
      return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable;
    }
    if (window.EditorShell && typeof window.EditorShell.bindShortcut === 'function') {
      window.EditorShell.bindShortcut('Cmd+c', () => {
        if (_inputFocused()) return;
        if (!selectedElementId) return;
        copyStyleFromSelected();
      });
      window.EditorShell.bindShortcut('Cmd+v', () => {
        if (_inputFocused()) return;
        if (!selectedElementId) return;
        pasteStyleOntoSelected();
      });
    } else {
      window.addEventListener('keydown', (ev) => {
        const meta = ev.metaKey || ev.ctrlKey;
        if (!meta || _inputFocused() || !selectedElementId) return;
        const k = (ev.key || '').toLowerCase();
        if (k === 'c') { ev.preventDefault(); copyStyleFromSelected(); }
        else if (k === 'v') { ev.preventDefault(); pasteStyleOntoSelected(); }
      });
    }
  });
})();
