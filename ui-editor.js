// Golf: Paper Craft — Edit UI page
// Lets the designer override position, size, visibility, and basic style
// (icon / font size) of named menu and in-game UI buttons WITHOUT touching
// game code. Overrides are persisted to localStorage under
// `gpc_ui_overrides` and read by game.js's btn() at draw time. Per-course
// overrides supported via `id@N` keys (e.g. `play.restart@3`).
(() => {
  'use strict';

  const STORAGE_KEY = 'gpc_ui_overrides';
  // §D19§ Migrated from single-slot 'gpc_ui_clipboard' to multi-slot
  // 'gpc_ui_clipboards'. Slots: position | style | perCourse | full.
  // Each slot holds: { data, sourceId, sourceLabel, sourceCourse, ts }
  // Paste buttons for a slot are hidden when slot === null.
  const CLIPBOARD_KEY = 'gpc_ui_clipboards';
  const LEGACY_CLIPBOARD_KEY = 'gpc_ui_clipboard';
  // Game canvas in game.js: H=540, W defaults to 680 (design base — see
  // project_canvas_constants memory). Preview MUST match exactly so absolute
  // pixel x/y overrides render at the same screen position in both surfaces.
  // Previously 640 — caused right-shift bug in-game (centered in editor →
  // off to the right in game because game W=680 made W/2 = 340 not 320).
  const W = 680, H = 540;

  // ----- Per-section clipboards -----
  // Multi-slot model: each section in the inspector copies/pastes its own
  // scope independently. The element-wide pair at the bottom of the pane
  // copies/pastes everything as one slot ('full').
  const SCOPES = ['position', 'size', 'style', 'perCourse', 'full'];
  let clipboards = loadClipboards();

  function _emptyClipboards() {
    return { position: null, style: null, perCourse: null, full: null };
  }
  function loadClipboards() {
    const out = _emptyClipboards();
    try {
      const raw = localStorage.getItem(CLIPBOARD_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') {
          SCOPES.forEach((k) => { if (obj[k]) out[k] = obj[k]; });
          return out;
        }
      }
    } catch (_) {}
    // Migration: read legacy single-slot 'gpc_ui_clipboard' as 'full'.
    try {
      const legacy = localStorage.getItem(LEGACY_CLIPBOARD_KEY);
      if (legacy) {
        const obj = JSON.parse(legacy);
        if (obj && typeof obj === 'object' && obj.override) {
          const merged = { ...obj.override };
          if (typeof obj.x === 'number') merged.x = obj.x;
          if (typeof obj.y === 'number') merged.y = obj.y;
          if (typeof obj.w === 'number') merged.w = obj.w;
          if (typeof obj.h === 'number') merged.h = obj.h;
          out.full = {
            data: merged,
            sourceId: obj.sourceId || '',
            sourceLabel: obj.sourceLabel || '',
            sourceCourse: '',
            ts: obj.ts || Date.now()
          };
          // keep legacy key around so older tabs still work; new writes go to multi-slot.
        }
      }
    } catch (_) {}
    return out;
  }
  function saveClipboards() {
    try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboards)); }
    catch (e) { console.error('[ui-editor] clipboards save', e); }
  }
  function _deepClone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; } }
  function _setSlot(scope, data) {
    const el = getElement(selectedElementId);
    clipboards[scope] = {
      data: _deepClone(data),
      sourceId: el ? el.id : '',
      sourceLabel: el ? el.label : '',
      sourceCourse: scopeCourseId || '',
      ts: Date.now()
    };
    saveClipboards();
    refreshClipboardUI();
  }

  // ----- Per-section copy implementations -----
  function _effectiveMerged(el) {
    const gOvr = getOverride(el.id, '') || {};
    const cOvr = scopeCourseId ? (getOverride(el.id, scopeCourseId) || {}) : {};
    return { ...gOvr, ...cOvr };
  }
  // Position copy = x / y (and xRel if present). Always copies the *effective*
  // values (override OR code default) so user can paste between elements
  // even when the source has no override yet — fixes the "Nothing to copy"
  // dead-end on default-state elements.
  function copyPosition() {
    const el = getElement(selectedElementId); if (!el) return;
    const props = effectiveProps(el);
    const merged = _effectiveMerged(el);
    const data = { x: Math.round(props.x), y: Math.round(props.y) };
    // xRel only when set explicitly — pasting xRel onto a target re-anchors
    // it to canvas center; pasting absolute x keeps the literal offset.
    if (Number.isFinite(Number(merged.xRel))) data.xRel = Number(merged.xRel);
    _setSlot('position', data);
    flashToast('Copied position from ' + el.label, 'success');
  }
  // Size copy = w / h (and lockAspect if true). Effective values, same idea.
  function copySize() {
    const el = getElement(selectedElementId); if (!el) return;
    const props = effectiveProps(el);
    const merged = _effectiveMerged(el);
    const data = { w: Math.round(props.w), h: Math.round(props.h) };
    if (merged.lockAspect) data.lockAspect = true;
    _setSlot('size', data);
    flashToast('Copied size from ' + el.label, 'success');
  }
  function copyStyle() {
    const el = getElement(selectedElementId); if (!el) return;
    const merged = _effectiveMerged(el);
    const data = {};
    if (Array.isArray(merged.layers) && merged.layers.length) {
      // Layers mode: capture layers + label only (style fields are ignored
      // by the renderer when layers are present, so they're not part of
      // "style" in this scope). Pasting onto a legacy target switches it.
      data.layers = _deepClone(merged.layers);
      if ('label' in merged) data.label = merged.label;
    } else {
      ['label', 'background', 'icon', 'fontSize', 'color', 'fontFamily', 'fontWeight'].forEach((k) => {
        if (k in merged) data[k] = merged[k];
      });
    }
    // Style copy succeeds even on default-state elements so user can transfer
    // between targets. Empty payload = "match defaults" — paste will clear
    // overrides on target.
    _setSlot('style', data);
    flashToast('Copied style from ' + el.label, 'success');
  }
  function copyPerCourse() {
    const el = getElement(selectedElementId); if (!el) return;
    if (!scopeCourseId) {
      flashToast('Switch to a course scope to copy per-course override', 'error'); return;
    }
    const ovr = getOverride(el.id, scopeCourseId);
    if (!ovr || !Object.keys(ovr).length) {
      flashToast('Nothing to copy — no per-course override on this scope', 'error'); return;
    }
    _setSlot('perCourse', ovr);
    flashToast('Copied per-course override from ' + el.label, 'success');
  }
  function copyFull() {
    const el = getElement(selectedElementId); if (!el) return;
    // Effective merge: union of overrides AND code defaults so paste-between-
    // elements works even when the source has no override yet.
    const props = effectiveProps(el);
    const ovrMerged = _effectiveMerged(el);
    const merged = {
      x: Math.round(props.x), y: Math.round(props.y),
      w: Math.round(props.w), h: Math.round(props.h),
      ...ovrMerged
    };
    _setSlot('full', merged);
    flashToast('Copied ' + el.label, 'success');
  }

  // ----- Per-section paste implementations -----
  // All paste paths funnel through _writeOverrideMerged so undo/dirty/save
  // stay consistent. `mode` is 'merge' (keep target's other fields) or
  // 'replace' (full overwrite).
  function _writeOverrideMerged(el, patch, opts) {
    const courseScope = opts && opts.courseScope != null ? opts.courseScope : scopeCourseId;
    const cur = getOverride(el.id, courseScope) || {};
    let next;
    if (opts && opts.replace) {
      next = _deepClone(patch);
    } else {
      next = { ...cur, ..._deepClone(patch) };
      // Cross-mode style paste: if patch.layers, drop legacy style fields
      // on target so the renderer respects layers (and vice versa).
      if (Array.isArray(patch.layers)) {
        ['background', 'icon', 'fontSize', 'color', 'fontFamily', 'fontWeight'].forEach((k) => { delete next[k]; });
      } else if (patch.layers === null || (opts && opts.dropLayers)) {
        delete next.layers;
      }
    }
    if (undo) undo.recordBefore();
    if (Object.keys(next).length) store[keyFor(el.id, courseScope)] = next;
    else delete store[keyFor(el.id, courseScope)];
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    selectedLayerId = null;
    renderElementList(); renderProps(); renderPreview();
  }
  function pastePosition() {
    const slot = clipboards.position; if (!slot) return;
    const el = getElement(selectedElementId); if (!el) return;
    // Position-only — never touches w/h. xRel paste re-anchors center;
    // explicit drop ensures stale absolute x doesn't survive.
    const patch = { ...slot.data };
    if ('xRel' in patch) delete patch.x; // xRel wins; absolute x is derived
    _writeOverrideMerged(el, patch);
    flashToast('Pasted position onto ' + el.label, 'success');
  }
  function pasteSize() {
    const slot = clipboards.size; if (!slot) return;
    const el = getElement(selectedElementId); if (!el) return;
    _writeOverrideMerged(el, slot.data);
    flashToast('Pasted size onto ' + el.label, 'success');
  }
  function pasteStyle() {
    const slot = clipboards.style; if (!slot) return;
    const el = getElement(selectedElementId); if (!el) return;
    // Cross-mode: patch may carry { layers } or legacy style fields. The
    // renderer in game.js + ui-button-render.js respects layers when present
    // and falls back to legacy fields otherwise — so writing layers onto a
    // legacy target (or vice versa) switches the target's mode automatically.
    _writeOverrideMerged(el, slot.data);
    flashToast('Pasted style onto ' + el.label, 'success');
  }
  function pastePerCourse() {
    const slot = clipboards.perCourse; if (!slot) return;
    const el = getElement(selectedElementId); if (!el) return;
    if (!scopeCourseId) {
      flashToast('Switch to a course scope before pasting per-course override', 'error'); return;
    }
    _writeOverrideMerged(el, slot.data, { replace: true, courseScope: scopeCourseId });
    flashToast('Pasted per-course override onto ' + el.label, 'success');
  }
  function pasteFull() {
    const slot = clipboards.full; if (!slot) return;
    const el = getElement(selectedElementId); if (!el) return;
    const existing = getOverride(el.id, scopeCourseId);
    if (existing && Object.keys(existing).length) {
      if (!confirm(el.label + ' already has overrides in this scope. Replace with clipboard?')) return;
    }
    _writeOverrideMerged(el, slot.data, { replace: true });
    flashToast('Pasted onto ' + el.label, 'success');
  }
  // Keyboard shortcuts wire to the element-wide pair.
  function copyStyleFromSelected() { copyFull(); }
  function pasteStyleOntoSelected() { pasteFull(); }

  function refreshClipboardUI() {
    // For each scope, toggle visibility + update source caption.
    const cfg = [
      { scope: 'position', pasteId: 'btn-paste-position', capId: 'cap-position' },
      { scope: 'size',     pasteId: 'btn-paste-size',     capId: 'cap-size' },
      { scope: 'style',    pasteId: 'btn-paste-style',    capId: 'cap-style' },
      { scope: 'perCourse',pasteId: 'btn-paste-percourse',capId: 'cap-percourse' },
      { scope: 'full',     pasteId: 'btn-paste-full',     capId: 'cap-full' }
    ];
    cfg.forEach((c) => {
      const slot = clipboards[c.scope];
      const pBtn = document.getElementById(c.pasteId);
      const cap = document.getElementById(c.capId);
      const has = !!slot;
      if (pBtn) pBtn.style.display = has ? '' : 'none';
      if (cap) {
        if (has) {
          const where = slot.sourceCourse ? ' · C' + slot.sourceCourse : '';
          cap.textContent = 'Copied from ' + (slot.sourceLabel || slot.sourceId || '?') + where;
          cap.style.display = '';
        } else {
          cap.textContent = '';
          cap.style.display = 'none';
        }
      }
    });
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
  // §D19_P5§ Buttons are now composable: parent kind:'button' (invisible
  // hit-rect + Action) with seeded children (bg image + optional icon image
  // + optional text). Legacy kind:'leaf' is sunset for these ids — old override
  // stores auto-decompose via migrateLegacyLeaves() on load.
  // seedChildren entries describe child override rows the editor seeds when
  // the parent is loaded for the first time. Each child id is `<parent>.<suffix>`.
  const SCREENS = [
    {
      id: 'menu', label: 'Main Menu',
      bg: 'menu',
      elements: [
        // Non-button visuals — center-top anchored so they stay centered at any W.
        // x=0 means "center of element aligns with anchor point (W/2)".
        { id: 'menu.title',       label: 'GOLF! title',   kind: 'text', // §P15-FIX-2§ was 'leaf'; text kind hides sprite pickers (bg/icon) for canvas-drawn title
          defaults: { x: 0, y: 67, w: 224, h: 86,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } } },
        { id: 'menu.previewBall', label: 'Mascot ball',   kind: 'image', // §P15-FIX-3§ was 'leaf'; image kind hides label/icon/typo for sprite-only mascot
          defaults: { x: 0, y: 186, w: 48, h: 56,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } } },
        // Composable buttons — parent is invisible, children render.
        // Centered icon+label group inside each button — matches the legacy
        // drawButton layout (group.startX = btnW/2 - groupW/2, y centered).
        { id: 'menu.play',        label: 'PLAY button',   kind: 'button', action: 'goto:courses',
          defaults: { x: 0, y: 260, w: 170, h: 46,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'PLAY bg',   background: 'ui-button-paper', x: 0,  y: 0,  w: 170, h: 46 },
            { suffix: 'icon', kind: 'image', label: 'PLAY icon', background: 'ui-play-icon',    x: 42, y: 9,  w: 28,  h: 28 },
            { suffix: 'text', kind: 'text',  label: 'PLAY',      x: 78, y: 0, w: 82,  h: 46, fontSize: 19, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        { id: 'menu.upgrades',    label: 'UPGRADES button', kind: 'button', action: 'goto:upgrades',
          defaults: { x: 0, y: 330, w: 170, h: 38,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'UPGRADES bg',   background: 'ui-button-paper',  x: 0,  y: 0, w: 170, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'UPGRADES icon', background: 'ui-upgrades-icon', x: 35, y: 8, w: 22,  h: 22 },
            { suffix: 'text', kind: 'text',  label: 'UPGRADES',      x: 65, y: 0, w: 105, h: 38, fontSize: 14, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        { id: 'menu.shop',        label: 'SHOP button', kind: 'button', action: 'goto:shop',
          defaults: { x: 0, y: 380, w: 170, h: 38,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'SHOP bg',   background: 'ui-button-paper', x: 0,  y: 0, w: 170, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'SHOP icon', background: 'ui-shop-icon',    x: 55, y: 8, w: 22,  h: 22 },
            { suffix: 'text', kind: 'text',  label: 'SHOP',      x: 85, y: 0, w: 85,  h: 38, fontSize: 14, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        // Right-top anchor: x = -(distance of right edge from right boundary).
        // §D19_P11§ coinChip right=W-154 gives 8px gap to gemChip left (W-146).
        // Math: right edge = W+x (anchor=1,pivot=1); x=-154 → right=W-154.
        { id: 'menu.coinChip',    label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0',          boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        // §D19_P11§ gemChip right=W-54 gives 8px gap to soundToggle left (W-46).
        // Math: right=W+x (anchor=1,pivot=1); x=-54 → right=W-54.
        { id: 'menu.gemChip',     label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0',         boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        // §D19_P6§ Migrated from kind:'button' (P5 bg+icon) to kind:'toggle'
        // with on/off state-children. Pre-filled icons mirror the existing
        // mute/unmute visual: ui-sound-on under .on, ui-sound-off under .off.
        // The .on/.off entries themselves are kind:'empty' (transform-only)
        // and host one image child each.
        // soundToggle legacy right edge = 634+32 = 666 = W-14, so x=-14.
        { id: 'menu.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',       x: 0, y: 0, w: 32, h: 32,
              grandchildren: [
                { suffix: 'icon', kind: 'image', label: 'Sound on icon', background: 'ui-sound-on', x: 4, y: 4, w: 24, h: 24 }
              ]
            },
            { suffix: 'off', kind: 'empty', label: 'off',      x: 0, y: 0, w: 32, h: 32,
              grandchildren: [
                { suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }
              ]
            }
          ]
        }
      ]
    },
    // §D19_P13§ Level Complete screen — decomposes drawComplete() elements.
    {
      id: 'complete', label: 'Level Complete',
      bg: 'complete',
      elements: [
        // Paper card background — center-anchored
        { id: 'complete.card',       label: 'Result card bg', kind: 'image',
          defaults: { x: 0, y: 218, w: 430, h: 250,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 } } },
        // "Nice Shot!" headline — dynamic based on stars
        { id: 'complete.title',      label: 'Result headline', kind: 'text',
          defaults: { x: 0, y: 140, w: 380, h: 36,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 },
                      fontSize: 24, fontFamily: 'Bungee, Fredoka, sans-serif', color: '#7CAE50', textAlign: 'center',
                      boundVar: 'resultTitle' } },
        // "Level name · N shots" subtitle
        { id: 'complete.subtitle',   label: 'Level name + shots', kind: 'text',
          defaults: { x: 0, y: 172, w: 380, h: 24,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 },
                      fontSize: 14, color: '#2A1C0E', textAlign: 'center',
                      boundVar: 'levelNameShots' } },
        // Stars row — 3 image children
        { id: 'complete.star1',      label: 'Star 1', kind: 'image',
          defaults: { x: -78, y: 218, w: 52, h: 52,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 } } },
        { id: 'complete.star2',      label: 'Star 2', kind: 'image',
          defaults: { x: 0,   y: 218, w: 56, h: 56,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 } } },
        { id: 'complete.star3',      label: 'Star 3', kind: 'image',
          defaults: { x: 78,  y: 218, w: 52, h: 52,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0.5 } } },
        // Coin reward row
        { id: 'complete.coinReward', label: 'Coin reward', kind: 'button', action: '',
          defaults: { x: -80, y: 270, w: 140, h: 32,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'icon', kind: 'image', label: 'Coin icon', background: 'ui-coin-icon', x: 4,  y: 6, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '+40', boundVar: 'coinsEarned', x: 30, y: 0, w: 106, h: 32, fontSize: 16, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        // Gem reward row
        { id: 'complete.gemReward',  label: 'Gem reward', kind: 'button', action: '',
          defaults: { x: 80,  y: 270, w: 140, h: 32,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'icon', kind: 'image', label: 'Gem icon', background: 'ui-gem-icon', x: 4,  y: 6, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '+1', boundVar: 'gemsEarned', x: 30, y: 0, w: 106, h: 32, fontSize: 16, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        // Watch Ad button (full-width)
        { id: 'complete.adBtn',      label: 'Watch Ad button', kind: 'button', action: 'ad:watchAndDouble',
          defaults: { x: 0, y: 362, w: 290, h: 40,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Ad bg',   background: 'ui-button-paper', x: 0,  y: 0, w: 290, h: 40 },
            { suffix: 'icon', kind: 'image', label: 'Play icon', background: 'ui-play-icon',   x: 12, y: 8, w: 24,  h: 24 },
            { suffix: 'text', kind: 'text',  label: 'Watch Ad · 2x coins + 1 gem', x: 44, y: 0, w: 240, h: 40, fontSize: 13, color: '#2A1C0E', textAlign: 'left' }
          ]
        },
        // Bottom row: Menu / Retry / Next
        { id: 'complete.menuBtn',    label: 'Menu button', kind: 'button', action: 'goto:select',
          defaults: { x: -205, y: 430, w: 110, h: 40,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Menu bg',   background: 'ui-button-paper', x: 0, y: 0, w: 110, h: 40 },
            { suffix: 'text', kind: 'text',  label: 'Menu',      x: 0, y: 0, w: 110, h: 40, fontSize: 13, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'complete.retryBtn',   label: 'Retry button', kind: 'button', action: 'level:restart',
          defaults: { x: -70, y: 430, w: 140, h: 40,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Retry bg',   background: 'ui-button-paper', x: 0, y: 0, w: 140, h: 40 },
            { suffix: 'text', kind: 'text',  label: 'Retry',      x: 0, y: 0, w: 140, h: 40, fontSize: 13, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'complete.nextBtn',    label: 'Next button', kind: 'button', action: 'level:next',
          defaults: { x: 95, y: 430, w: 110, h: 40,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Next bg',   background: 'ui-button-paper', x: 0,  y: 0,  w: 110, h: 40 },
            { suffix: 'icon', kind: 'image', label: 'Next icon', background: 'ui-play-icon',    x: 80, y: 10, w: 20,  h: 20 },
            { suffix: 'text', kind: 'text',  label: 'Next',      x: 0,  y: 0,  w: 78,  h: 40, fontSize: 13, color: '#2A1C0E', textAlign: 'center' }
          ]
        }
      ]
    },
    // §D19_P13§ Level Select screen — decomposes drawSelect() / drawLevelTile().
    // perCourse: true means the 'select' screen changes visuals per course.
    // templates: named visual blueprints shared by the 18 hole instances.
    {
      id: 'select', label: 'Level Select',
      bg: 'select',
      perCourse: true,
      // §D19_P13§ TEMPLATES: per-course shared visual blueprints.
      // seedChildren carry {course} placeholder in background keys.
      // The renderer resolves {course} → actual course index+1 at draw time.
      // "template" entries in elements[] expand seedChildren into virtual
      // child entries scoped to each instance id (e.g. select.hole1.bg).
      templates: {
        holeCircle: {
          label: 'Hole circle (all 18)',
          kind: 'button',
          seedChildren: [
            { suffix: 'bg',    kind: 'image', label: 'Circle bg',  background: 'ui-level-node-unlocked', w: 68, h: 42 },
            { suffix: 'num',   kind: 'text',  label: '?',    boundVar: 'levelNum',   x: 0,  y: 0,  w: 68, h: 36, fontSize: 18, color: '#FFF8E8', textAlign: 'center' },
            { suffix: 'star1', kind: 'image', label: 'Star 1', background: 'ui-star-filled', x: 6,  y: 30, w: 14, h: 14 },
            { suffix: 'star2', kind: 'image', label: 'Star 2', background: 'ui-star-filled', x: 27, y: 30, w: 14, h: 14 },
            { suffix: 'star3', kind: 'image', label: 'Star 3', background: 'ui-star-filled', x: 48, y: 30, w: 14, h: 14 }
          ]
        }
      },
      elements: [
        // Top-left "Courses" back button
        { id: 'select.coursesBtn', label: 'Courses back', kind: 'button', action: 'goto:courses',
          defaults: { x: 12, y: 12, w: 70, h: 32,
                      anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 }, pivot: { x: 0, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Courses bg',   background: 'ui-button-paper', x: 0, y: 0, w: 70, h: 32 },
            { suffix: 'text', kind: 'text',  label: 'Courses',      x: 0, y: 0, w: 70, h: 32, fontSize: 14, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        // Top-center course title banner
        { id: 'select.courseTitle', label: 'Course title', kind: 'text',
          defaults: { x: 0, y: 20, w: 320, h: 28,
                      anchorMin: { x: 0.5, y: 0 }, anchorMax: { x: 0.5, y: 0 }, pivot: { x: 0.5, y: 0 },
                      fontSize: 16, color: '#2A1C0E', textAlign: 'center', boundVar: 'courseTitle' } },
        // Top-right coin chip (reuse menu layout)
        { id: 'select.coinChip', label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'select.gemChip',  label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'select.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',  x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound on icon',  background: 'ui-sound-on',  x: 4, y: 4, w: 24, h: 24 }] },
            { suffix: 'off', kind: 'empty', label: 'off', x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }] }
          ]
        },
        // 18 hole instances referencing the holeCircle template.
        // Positions mirror selectFlagPos() (3 rows×6, S-curve, W=680).
        // margin=58, usableW=564, colStep=112.8, startY=140, rowStep=95
        // row0 L→R: x=58,171,284,397,510,622; row1 R→L; row2 L→R
        // Wiggle (sin(i*1.31)*6) omitted for editor (editor positions are stable).
        ...(() => {
          const holes = [];
          const perRow = 6, margin = 58, usableW = 680 - margin * 2, colStep = usableW / (perRow - 1);
          const startY = 140, rowStep = 95;
          for (let i = 0; i < 18; i++) {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const effCol = (row % 2 === 0) ? col : (perRow - 1 - col);
            const x = margin + effCol * colStep;
            const y = startY + row * rowStep;
            holes.push({
              id: `select.hole${i + 1}`,
              label: `Hole ${i + 1}`,
              kind: 'button',
              template: 'holeCircle',
              templateData: { levelNum: i + 1 },
              action: `level:${i}`,
              defaults: {
                x: x - 34,   // center the 68-wide tile
                y: y - 21,   // center the 42-high tile
                w: 68, h: 42,
                anchorMin: { x: 0, y: 0 }, anchorMax: { x: 0, y: 0 }, pivot: { x: 0, y: 0 }
              }
            });
          }
          return holes;
        })()
      ]
    },
    {
      id: 'play', label: 'In-Game HUD',
      bg: 'play',
      elements: [
        { id: 'play.back',     label: 'Back / Editor', kind: 'button', action: 'goto:select',
          defaults: { x: -170, y: 110, w: 58, h: 24,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Back bg', background: 'ui-button-paper', x: 0, y: 0, w: 58, h: 24 },
            { suffix: 'text', kind: 'text',  label: 'Back',    x: 0, y: 0, w: 58, h: 24, fontSize: 11, color: '#2A1C0E' }
          ]
        },
        { id: 'play.restart',  label: 'Restart', kind: 'button', action: 'level:restart',
          defaults: { x: -234, y: 110, w: 60, h: 24,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Restart bg', background: 'ui-button-paper', x: 0, y: 0, w: 60, h: 24 },
            { suffix: 'text', kind: 'text',  label: 'Restart',    x: 0, y: 0, w: 60, h: 24, fontSize: 11, color: '#2A1C0E' }
          ]
        },
        { id: 'play.unstuck',  label: 'Unstuck', kind: 'button', action: 'level:unstuck',
          defaults: { x: -210, y: 110, w: 72, h: 24,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Unstuck bg',   background: 'ui-button-paper', x: 0,  y: 0, w: 72, h: 24 },
            { suffix: 'icon', kind: 'image', label: 'Unstuck icon', background: 'ui-unstuck-icon', x: 4,  y: 4, w: 16, h: 16 },
            { suffix: 'text', kind: 'text',  label: 'Unstuck',      x: 22, y: 0, w: 50, h: 24, fontSize: 10, color: '#2A1C0E' }
          ]
        }
      ]
    },
    // §P21§ --- courses screen ---
    {
      id: 'courses', label: 'Courses',
      bg: 'courses',
      elements: [
        { id: 'courses.coinChip', label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'courses.gemChip', label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',        x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'courses.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',  x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound on icon',  background: 'ui-sound-on',  x: 4, y: 4, w: 24, h: 24 }] },
            { suffix: 'off', kind: 'empty', label: 'off', x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }] }
          ]
        }
      ]
    },
    // §P21§ --- upgrades screen ---
    {
      id: 'upgrades', label: 'Upgrades',
      bg: 'upgrades',
      elements: [
        { id: 'upgrades.coinChip', label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'upgrades.gemChip', label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',        x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'upgrades.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',  x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound on icon',  background: 'ui-sound-on',  x: 4, y: 4, w: 24, h: 24 }] },
            { suffix: 'off', kind: 'empty', label: 'off', x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }] }
          ]
        }
      ]
    },
    // §P21§ --- shop screen ---
    {
      id: 'shop', label: 'Shop',
      bg: 'shop',
      elements: [
        { id: 'shop.coinChip', label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'shop.gemChip', label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',        x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'shop.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',  x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound on icon',  background: 'ui-sound-on',  x: 4, y: 4, w: 24, h: 24 }] },
            { suffix: 'off', kind: 'empty', label: 'off', x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }] }
          ]
        }
      ]
    },
    // §P21§ --- failed screen ---
    {
      id: 'failed', label: 'Failed',
      bg: 'failed',
      elements: [
        { id: 'failed.coinChip', label: 'Coin chip', kind: 'button', action: '',
          defaults: { x: -154, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Coin plate', background: 'ui-chip-coin-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Coin icon',  background: 'ui-coin-icon',       x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'coins', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'failed.gemChip', label: 'Gem chip', kind: 'button', action: '',
          defaults: { x: -54, y: 14, w: 92, h: 38,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          seedChildren: [
            { suffix: 'bg',   kind: 'image', label: 'Gem plate', background: 'ui-chip-gem-plate', x: 0,  y: 0, w: 92, h: 38 },
            { suffix: 'icon', kind: 'image', label: 'Gem icon',  background: 'ui-gem-icon',        x: 8,  y: 9, w: 20, h: 20 },
            { suffix: 'text', kind: 'text',  label: '0', boundVar: 'gems', x: 32, y: 0, w: 52, h: 38, fontSize: 16, color: '#2A1C0E', textAlign: 'center' }
          ]
        },
        { id: 'failed.soundToggle', label: 'Sound toggle', kind: 'toggle', action: 'toggle:sound',
          defaults: { x: -14, y: 14, w: 32, h: 32,
                      anchorMin: { x: 1, y: 0 }, anchorMax: { x: 1, y: 0 }, pivot: { x: 1, y: 0 } },
          toggleStateKey: 'soundMuted',
          seedChildren: [
            { suffix: 'bg',  kind: 'image', label: 'Sound bg', background: 'ui-button-paper', x: 0, y: 0, w: 32, h: 32 },
            { suffix: 'on',  kind: 'empty', label: 'on',  x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound on icon',  background: 'ui-sound-on',  x: 4, y: 4, w: 24, h: 24 }] },
            { suffix: 'off', kind: 'empty', label: 'off', x: 0, y: 0, w: 32, h: 32,
              grandchildren: [{ suffix: 'icon', kind: 'image', label: 'Sound off icon', background: 'ui-sound-off', x: 4, y: 4, w: 24, h: 24 }] }
          ]
        }
      ]
    }
  ];

  // §D19_P5§ One-shot migration: seed composable children for each SCREENS
  // button if they aren't already in the store, AND auto-decompose any
  // legacy single-leaf override (background/icon/label fields directly on
  // the parent id) into the new tree. Idempotent.
  // §D19_P6_SEED_V§ Schema version for SCREENS seedChildren defaults.
  // Bump this when seed positions / sprite keys change so existing stores
  // get re-seeded ONCE (preserving user customizations is sacrificed for
  // correctness — user can re-edit faster than a button can stay broken).
  const SEED_SCHEMA_VERSION = 11; // §P21§ courses/upgrades/shop/failed coin+gem+sound chips
  // §D19_P9§ Top-level button ids whose stored x/y must be force-reset on
  // version bump. v5: menu buttons + chips + sound now use anchor system;
  // stale absolute coords would misplace them on wide viewports.
  // §P16§ complete.* and select.* parents force-reset so they get re-seeded
  // with the correct anchorMin/anchorMax/pivot/x/y/w/h from SCREENS defaults.
  const SEED_V3_FORCE_RESET = [
    'play.back', 'play.restart', 'play.unstuck',
    'menu.title', 'menu.previewBall',
    'menu.play', 'menu.upgrades', 'menu.shop',
    'menu.coinChip', 'menu.gemChip', 'menu.soundToggle',
    'complete.adBtn', 'complete.menuBtn', 'complete.retryBtn', 'complete.nextBtn',
    'complete.coinReward', 'complete.gemReward',
    'select.coursesBtn', 'select.coinChip', 'select.gemChip', 'select.soundToggle',
    // §P21§ new composable chips
    'courses.coinChip', 'courses.gemChip', 'courses.soundToggle',
    'upgrades.coinChip', 'upgrades.gemChip', 'upgrades.soundToggle',
    'shop.coinChip', 'shop.gemChip', 'shop.soundToggle',
    'failed.coinChip', 'failed.gemChip', 'failed.soundToggle'
  ];

  function migrateLegacyLeaves() {
    let changed = false;
    // Force re-seed of composite child positions when version is behind.
    // We delete the seed-suffix entries (.bg/.icon/.text/.on/.off) for each
    // listed SCREENS button so the regular seeding path recreates them
    // with the current SCREENS positions. We never touch user-created
    // children that don't match a seed suffix.
    const _curV = Number(store._uiSeedV) || 0;
    if (_curV < SEED_SCHEMA_VERSION) {
      for (const screen of SCREENS) {
        for (const el of screen.elements) {
          if (!el.seedChildren) continue;
          for (const sc of el.seedChildren) {
            const cid = el.id + '.' + sc.suffix;
            if (store[cid]) { delete store[cid]; changed = true; }
            // Drop grandchildren too (toggle .on/.off children).
            if (Array.isArray(sc.grandchildren)) {
              for (const gc of sc.grandchildren) {
                const gid = cid + '.' + gc.suffix;
                if (store[gid]) { delete store[gid]; changed = true; }
              }
            }
          }
        }
      }
      // §D19_P8§ Drop top-level stored entries whose schema changed shape
      // (e.g. play HUD now uses anchored coords). Children were already
      // dropped above by suffix; now nuke the parents so SCREENS defaults
      // win on next read.
      for (const tid of SEED_V3_FORCE_RESET) {
        if (store[tid]) { delete store[tid]; changed = true; }
      }
      store._uiSeedV = SEED_SCHEMA_VERSION;
      changed = true;
    }
    for (const screen of SCREENS) {
      for (const el of screen.elements) {
        // §D19_P6§ Toggle migration path (used by menu.soundToggle: P5→P6).
        if (el.kind === 'toggle' && el.seedChildren) {
          const parent = store[el.id] || {};
          // Detect P5 shape: stored as kind:'button' with .icon child holding
          // the sound on/off background. Capture the icon's current sprite
          // (so a user-edited mute state survives) and re-decompose.
          const isP5Shape = parent.kind === 'button' && store[el.id + '.icon'];
          if (isP5Shape) {
            // Capture user's prior icon background (probably ui-sound-on or
            // ui-sound-off) so the corresponding state branch is pre-filled.
            const priorIcon = (store[el.id + '.icon'] || {}).background || '';
            const wasMuted  = priorIcon === 'ui-sound-off';
            // Drop the P5 .icon entry; .bg stays (re-used by P6).
            delete store[el.id + '.icon'];
            changed = true;
            // Convert parent to toggle.
            const np = { ...parent, kind: 'toggle',
                         toggleState: wasMuted ? 'on' : 'off',
                         toggleStateKey: el.toggleStateKey || '' };
            if (el.action) np.action = el.action;
            store[el.id] = np;
          }
          if (!parent.kind || parent.kind !== 'toggle') {
            const cur = store[el.id] || {};
            store[el.id] = { ...cur, kind: 'toggle',
                             toggleState: cur.toggleState || 'off',
                             toggleStateKey: cur.toggleStateKey || el.toggleStateKey || '',
                             action: cur.action || el.action || '' };
            changed = true;
          }
          // Seed bg / on / off children (and any pre-filled grandchildren).
          for (const sc of el.seedChildren) {
            const cid = el.id + '.' + sc.suffix;
            if (!store[cid]) {
              const child = { kind: sc.kind, parentId: el.id, label: sc.label,
                              x: sc.x, y: sc.y, w: sc.w, h: sc.h,
                              _originX: sc.x, _originY: sc.y };
              if (sc.kind === 'image' && sc.background) child.background = sc.background;
              store[cid] = child;
              changed = true;
            }
            if (Array.isArray(sc.grandchildren)) {
              for (const gc of sc.grandchildren) {
                const gid = cid + '.' + gc.suffix;
                if (store[gid]) continue;
                const gchild = { kind: gc.kind, parentId: cid, label: gc.label,
                                 x: gc.x, y: gc.y, w: gc.w, h: gc.h,
                                 _originX: gc.x, _originY: gc.y };
                if (gc.kind === 'image' && gc.background) gchild.background = gc.background;
                store[gid] = gchild;
                changed = true;
              }
            }
          }
          continue;
        }
        if (el.kind !== 'button' || !el.seedChildren) continue;
        // Detect a legacy override on the parent id (no kind, but has any of
        // background / icon / label). Decompose into bg/icon/text children
        // when present, then strip those legacy fields from the parent.
        const parent = store[el.id];
        const isLegacyLeaf = parent && !parent.kind &&
          (parent.background || parent.icon || parent.label != null);
        if (isLegacyLeaf) {
          const legBg   = parent.background;
          const legIcon = parent.icon;
          const legLbl  = parent.label;
          for (const sc of el.seedChildren) {
            const cid = el.id + '.' + sc.suffix;
            if (store[cid]) continue; // never overwrite user data
            const child = { kind: sc.kind, parentId: el.id, label: sc.label,
                            x: sc.x, y: sc.y, w: sc.w, h: sc.h, _originX: sc.x, _originY: sc.y };
            if (sc.kind === 'image') {
              child.background = (sc.suffix === 'bg' && legBg) ? legBg
                                : (sc.suffix === 'icon' && legIcon) ? legIcon
                                : sc.background;
            } else if (sc.kind === 'text') {
              if (sc.suffix === 'text' && typeof legLbl === 'string') child.label = legLbl;
              if (sc.fontSize) child.fontSize = sc.fontSize;
              if (sc.color) child.color = sc.color;
              if (sc.boundVar) child.boundVar = sc.boundVar;
            }
            store[cid] = child;
            changed = true;
          }
          // Strip legacy fields, keep position/size on parent.
          const np = { ...parent, kind: 'button' };
          delete np.background; delete np.icon; delete np.label;
          if (el.action) np.action = el.action;
          store[el.id] = np;
          changed = true;
          continue;
        }
        // Non-legacy: ensure parent has kind:'button' and seedChildren exist.
        // §P16§ Include defaults (anchorMin/Max/pivot/x/y/w/h) in the seeded
        // parent so game.js applyUiOverride can apply anchor-based positioning
        // even when the user has not opened this element in the editor.
        if (!parent) {
          const base = { kind: 'button', action: el.action || '' };
          if (el.defaults) Object.assign(base, el.defaults);
          store[el.id] = base;
          changed = true;
        } else if (!parent.kind) {
          // §P25-FIX§ Merge defaults BEFORE existing parent fields so we get
          // anchor/x/y/w/h, but parent's user-edited values still win.
          const base = { kind: 'button', action: el.action || '' };
          if (el.defaults) Object.assign(base, el.defaults);
          store[el.id] = { ...base, ...parent, kind: 'button', action: parent.action || el.action || '' };
          changed = true;
        } else if (parent.kind === 'button' && el.defaults) {
          // §P25-FIX§ Existing button parents that lack w/h (zero-size from
          // older migration) — backfill missing dimension fields from defaults.
          const need = ['x','y','w','h','anchorMin','anchorMax','pivot'];
          let touched = false;
          for (const k of need) {
            if (parent[k] == null && el.defaults[k] != null) {
              parent[k] = JSON.parse(JSON.stringify(el.defaults[k]));
              touched = true;
            }
          }
          if (touched) changed = true;
        }
        for (const sc of el.seedChildren) {
          const cid = el.id + '.' + sc.suffix;
          if (store[cid]) continue;
          const child = { kind: sc.kind, parentId: el.id, label: sc.label,
                          x: sc.x, y: sc.y, w: sc.w, h: sc.h, _originX: sc.x, _originY: sc.y };
          if (sc.kind === 'image') child.background = sc.background;
          else if (sc.kind === 'text') {
            if (sc.fontSize) child.fontSize = sc.fontSize;
            if (sc.color) child.color = sc.color;
            if (sc.boundVar) child.boundVar = sc.boundVar;
          }
          store[cid] = child;
          changed = true;
        }
      }
      // §D19_P13§ Seed template-referenced elements (holes 1-18 etc.).
      if (screen.templates) {
        for (const el of screen.elements) {
          if (!el.template || !screen.templates[el.template]) continue;
          const tmpl = screen.templates[el.template];
          if (!store[el.id]) {
            // §P25-FIX§ Carry per-instance position/size + anchor onto the
            // template-spawned entry so the inspector doesn't show 0×0.
            const inst = { kind: tmpl.kind || 'button', action: el.action || '', _template: el.template };
            ['x','y','w','h','anchorMin','anchorMax','pivot','levelNum'].forEach((k) => {
              if (el[k] != null) inst[k] = JSON.parse(JSON.stringify(el[k]));
            });
            store[el.id] = inst;
            changed = true;
          }
          for (const sc of (tmpl.seedChildren || [])) {
            const cid = el.id + '.' + sc.suffix;
            if (store[cid]) continue;
            const child = { kind: sc.kind, parentId: el.id, label: sc.label,
                            x: Number(sc.x) || 0, y: Number(sc.y) || 0,
                            w: Number(sc.w) || 0, h: Number(sc.h) || 0 };
            if (sc.kind === 'image') child.background = sc.background;
            else if (sc.kind === 'text') {
              if (sc.fontSize) child.fontSize = sc.fontSize;
              if (sc.color) child.color = sc.color;
              if (sc.boundVar) child.boundVar = sc.boundVar;
            }
            store[cid] = child;
            changed = true;
          }
        }
      }
    }
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
        localStorage.setItem('gpc_ui_overrides_updated_at', String(Date.now()));
      } catch (_) {}
    }
    return changed;
  }

  // ----- State -----
  let store = loadStore();
  // §D19_P5§ Decompose legacy leaf overrides + seed missing children. Run
  // exactly once per page load.
  try { migrateLegacyLeaves(); } catch (e) { try { console.warn('[ui-editor] migrate failed', e); } catch (_) {} }
  let activeScreenId = 'menu';
  let selectedElementId = SCREENS[0].elements[0].id;
  let scopeCourseId = ''; // '' = global
  // Undo/redo stack — wired in boot() once UndoStack helper is available.
  let undo = null;

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      const store = obj && typeof obj === 'object' ? obj : {};
      // Migrate: any entry with absolute x but no xRel gets xRel computed
      // against design W=680 so live game (dynamic W) keeps composition
      // centered. Idempotent — re-runs are no-ops once xRel is present.
      let migrated = false;
      for (const k in store) {
        const v = store[k];
        // §D19_P6§ Skip group/empty containers AND children parented under a
        // button/toggle/empty/group (their x/y is local, not screen-absolute).
        const _par = v && v.parentId ? store[v.parentId] : null;
        const _localChild = !!(_par && (_par.kind === 'button' || _par.kind === 'toggle' || _par.kind === 'empty' || _par.kind === 'group'));
        const _isCnt = v && (v.kind === 'group' || v.kind === 'empty');
        if (v && typeof v === 'object' && !_isCnt && !_localChild && Number.isFinite(Number(v.x)) && !Number.isFinite(Number(v.xRel))) {
          v.xRel = Number(v.x) - W / 2;
          migrated = true;
        }
      }
      if (migrated) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
          localStorage.setItem('gpc_ui_overrides_updated_at', String(Date.now()));
        } catch (_) {}
      }
      return store;
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
    // Keep xRel in sync with x (design-W=680 anchored at canvas center).
    // game.js prefers xRel so live (wider W) stays centered.
    // §D19_P0§ Group nodes use absolute x/y as a bbox anchor (cascade math
    // expects raw x), so skip the xRel auto-sync for them.
    // §D19_P6§ Skip xRel auto-sync for group/empty containers AND for any node
    // that lives inside a button/toggle/empty parent (its x/y is local, not
    // a screen-absolute that needs centering).
    const _ent = store[k] || {};
    const _isContainer = (_ent.kind === 'group' || _ent.kind === 'empty');
    const _parId = _ent.parentId;
    const _par = _parId ? store[_parId] : null;
    const _isLocallyParented = !!(_par && (_par.kind === 'button' || _par.kind === 'toggle' || _par.kind === 'empty' || _par.kind === 'group'));
    const _skipXRel = _isContainer || _isLocallyParented;
    if (patch && !_skipXRel && Number.isFinite(Number(patch.x)) && !('xRel' in patch)) {
      patch = { ...patch, xRel: Number(patch.x) - W / 2 };
    }
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
        swapPreviewIframeForScreen(s.id);
      });
      root.appendChild(btn);
    }
  }

  // ----- Iframe screen swap -----
  // When user toggles between "Main menu" and "In-game HUD", reload the
  // preview iframe with the matching deep-link so the actual buttons under
  // edit are visible. Per project memory (feedback_playwright_canvas_nav_broken)
  // canvas clicks don't reliably navigate; URL params do.
  function swapPreviewIframeForScreen(screenId) {
    try {
      const iframe = document.getElementById('ui-preview-iframe');
      if (!iframe) return;
      const next = screenId === 'play'    ? './?editorSync=1&course=1&level=1'
              : screenId === 'complete' ? './?editorSync=1&course=1&level=1&forceScreen=complete'
              : screenId === 'select'   ? './?editorSync=1&course=1&forceScreen=select'
              : './?editorSync=1&menuOnly=1';
      const cur = (iframe.getAttribute('src') || '').split('#')[0];
      if (cur === next) return;
      iframe.setAttribute('src', next);
    } catch (_) {}
  }

  // ----- §D19_P0§ Hierarchy helpers ---------------------------------------
  // Tree state: parentId / childOrder / kind=group are stored ON the
  // override entry itself (in `store`) so they're persisted alongside x/y/w/h
  // edits. Group nodes are a regular store entry with kind:'group' — not in
  // SCREENS at all. Below: helpers that bridge SCREENS' static elements with
  // the dynamic group nodes.
  const TREE_COLLAPSE_KEY = 'gpc_ui_tree_collapsed';
  const TREE_COLLAPSE_INIT_KEY = 'gpc_ui_tree_collapsed_inited';
  let _collapsedNodes = (function () {
    try {
      const raw = localStorage.getItem(TREE_COLLAPSE_KEY);
      const obj = raw ? JSON.parse(raw) : null;
      // §P7§ First-ever load: no persisted state yet — default ALL parent nodes
      // to collapsed so the tree opens clean. User can expand what they need.
      // We detect "never initialised" by absence of the init sentinel key.
      if (obj && typeof obj === 'object') return obj;
      // Either null/corrupt or brand-new session — return empty; boot() will
      // seed defaults after the store is built.
      return {};
    } catch (_) { return {}; }
  })();
  function isCollapsed(id) { return !!_collapsedNodes[id]; }
  // §P7§ Track which node was just expanded so renderElementList() can apply
  // slide-in animation to its immediate children.
  let _lastExpandedId = null;
  function toggleCollapsed(id) {
    if (_collapsedNodes[id]) {
      delete _collapsedNodes[id];
      _lastExpandedId = id; // expanding — animate children
    } else {
      _collapsedNodes[id] = 1;
      _lastExpandedId = null;
    }
    try { localStorage.setItem(TREE_COLLAPSE_KEY, JSON.stringify(_collapsedNodes)); } catch (_) {}
  }

  // Stable id for a new dynamic node. Scoped to the screen + kind so ids
  // don't leak across menu/play tabs and group/button/image/text spaces.
  // §D19_P4§ Generalised from `_newGroupId` to handle 4 dynamic kinds.
  // §D19_P6§ Add `toggle` and `empty`. `group` retained for backwards compat
  // but no longer creatable via toolbar — drag-drop nesting handles grouping.
  const DYNAMIC_KINDS = ['group', 'button', 'image', 'text', 'toggle', 'empty'];
  function _newNodeId(kind) {
    const k = (DYNAMIC_KINDS.indexOf(kind) >= 0) ? kind : 'group';
    let i = 1;
    while (store[activeScreenId + '.' + k + '.' + i]) i++;
    return activeScreenId + '.' + k + '.' + i;
  }
  // Back-compat shim — unused after P4 but kept so callers in other forks don't break.
  function _newGroupId() { return _newNodeId('group'); }
  // Return all dynamic-kind entries for the active screen as virtual "elements"
  // matching the SCREENS shape. §D19_P4§ Now covers group + button + image + text.
  function getGroupNodes() {
    const out = [];
    const screenPrefix = activeScreenId + '.';
    for (const k of Object.keys(store)) {
      if (k.indexOf('@') >= 0) continue; // skip per-course
      const v = store[k];
      if (!v || DYNAMIC_KINDS.indexOf(v.kind) < 0) continue;
      if (k.indexOf(screenPrefix) !== 0) continue;
      // §D19_P5§ Two id shapes are valid:
      //   - dynamic-kind/N (e.g. menu.button.1)         → editor-created node
      //   - SCREENS-defined parent or its child suffix  → seeded composable
      // We accept both: any store entry with a recognised kind on this screen
      // is exposed as a tree node. Skip SCREENS parent ids though — those are
      // already represented via the screen.elements branch in buildTree().
      const tail = k.slice(screenPrefix.length);
      const dot = tail.indexOf('.');
      const kindSeg = dot > 0 ? tail.slice(0, dot) : '';
      const isScreensParent = SCREENS.some(s => s.id === activeScreenId
        && s.elements.some(e => e.id === k));
      if (isScreensParent) continue;
      const defaultLabel = (v.label) ? v.label
        : (kindSeg && DYNAMIC_KINDS.indexOf(kindSeg) >= 0)
          ? (kindSeg.charAt(0).toUpperCase() + kindSeg.slice(1)) + ' ' + tail.slice(dot + 1)
          : tail;
      out.push({
        id: k,
        label: typeof v.label === 'string' && v.label ? v.label : defaultLabel,
        kind: v.kind,
        defaults: {
          x: Number.isFinite(Number(v._originX)) ? Number(v._originX) : (Number(v.x) || 0),
          y: Number.isFinite(Number(v._originY)) ? Number(v._originY) : (Number(v.y) || 0),
          w: Number(v.w) || (v.kind === 'group' ? 200 : v.kind === 'image' ? 64 : v.kind === 'text' ? 120 : 120),
          h: Number(v.h) || (v.kind === 'group' ? 100 : v.kind === 'image' ? 64 : v.kind === 'text' ? 24 : 40)
        }
      });
    }
    return out;
  }
  // Wrap getElement to also resolve group ids. Function declarations create
  // mutable bindings even in strict mode, so reassignment is legal.
  const _origGetElement_d19 = getElement;
  // eslint-disable-next-line no-func-assign
  getElement = function getElementWithGroups(id) {
    const fromScreens = _origGetElement_d19(id);
    if (fromScreens) return fromScreens;
    const groups = getGroupNodes();
    return groups.find((g) => g.id === id) || null;
  };
  // §D19_P0§ Build a hierarchy tree from the active screen's leaves + groups.
  // Each node: { el, children: [...] }. Sorting: childOrder asc, then label.
  function buildTree() {
    const screen = getScreen();
    const nodes = []
      .concat(screen.elements.map((e) => {
        // §D19_P5§ Honor SCREENS-declared kind (button vs legacy leaf). Read
        // back the override-store kind too so user changes (e.g. converting
        // a kind:'leaf' into something else) survive a reload.
        const ovrKind = (store[e.id] && store[e.id].kind) || null;
        return { ...e, kind: e.kind || ovrKind || 'leaf' };
      }))
      .concat(getGroupNodes());
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = { el: n, children: [] }; });
    const roots = [];
    nodes.forEach((n) => {
      const ovr = store[n.id] || {};
      const pid = ovr.parentId;
      if (pid && byId[pid]) byId[pid].children.push(byId[n.id]);
      else roots.push(byId[n.id]);
    });
    function sortLevel(arr) {
      arr.sort((a, b) => {
        const ao = Number(((store[a.el.id] || {}).childOrder));
        const bo = Number(((store[b.el.id] || {}).childOrder));
        const aok = Number.isFinite(ao);
        const bok = Number.isFinite(bo);
        if (aok && bok && ao !== bo) return ao - bo;
        if (aok && !bok) return -1;
        if (!aok && bok) return 1;
        return (a.el.label || '').localeCompare(b.el.label || '');
      });
      arr.forEach((n) => sortLevel(n.children));
    }
    sortLevel(roots);
    return roots;
  }

  // Detect ancestry to prevent reparent cycles.
  function _isAncestor(maybeAncestorId, descendantId) {
    let cur = (store[descendantId] || {}).parentId;
    let depth = 0;
    while (cur && depth < 32) {
      if (cur === maybeAncestorId) return true;
      cur = (store[cur] || {}).parentId;
      depth++;
    }
    return false;
  }

  // §D19_P0§ Reparent a node. newParentId='' means root. Writes through the
  // global override key (no @course suffix) so cascade behaves consistently.
  function reparentNode(nodeId, newParentId) {
    if (!nodeId) return;
    if (newParentId === nodeId) return;
    if (newParentId && _isAncestor(nodeId, newParentId)) return; // cycle guard
    const cur = store[nodeId] || {};
    const next = { ...cur };
    if (newParentId) next.parentId = newParentId;
    else delete next.parentId;
    if (Object.keys(next).length) store[nodeId] = next;
    else delete store[nodeId];
    if (undo) undo.recordBefore();
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    renderElementList(); renderProps(); renderPreview();
  }
  // Reorder among siblings: set childOrder so `nodeId` lands just before
  // `siblingId` (or at end if siblingId is null).
  function reorderSibling(nodeId, siblingId) {
    if (!nodeId || nodeId === siblingId) return;
    const cur = store[nodeId] || {};
    const sib = siblingId ? (store[siblingId] || {}) : null;
    let target;
    if (sib && Number.isFinite(Number(sib.childOrder))) {
      target = Number(sib.childOrder) - 0.5;
    } else {
      target = Date.now() / 1000;
    }
    const next = { ...cur, childOrder: target };
    store[nodeId] = next;
    if (undo) undo.recordBefore();
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    renderElementList(); renderProps(); renderPreview();
  }
  // §D19_P4§ Kind-aware node defaults. group/button accept children; image/text are leafs.
  // §D19_P6§ Added `toggle` (button-like, with on/off state children) and
  // `empty` (pure transform container — no visual, no click). Group icon kept
  // distinct (▣) so legacy entries are visually distinguishable from new
  // `empty` containers (□).
  const NODE_KIND_DEFAULTS = {
    group:  { w: 200, h: 100, label: 'Group',  acceptsChildren: true,  ico: '▣' /* ▣ */ },
    button: { w: 120, h: 40,  label: 'Button', acceptsChildren: true,  ico: '■' /* ■ */, defaultAction: '' },
    image:  { w: 64,  h: 64,  label: 'Image',  acceptsChildren: false, ico: '🖼' /* 🖼 */, defaultBackground: '' },
    text:   { w: 120, h: 24,  label: 'Text',   acceptsChildren: false, ico: 'T', defaultLabel: 'Text', defaultFontSize: 14 },
    toggle: { w: 120, h: 40,  label: 'Toggle', acceptsChildren: true,  ico: '◉' /* ◉ */ },
    empty:  { w: 100, h: 60,  label: 'Empty',  acceptsChildren: true,  ico: '□' /* □ */ }
  };
  function nodeAcceptsChildren(id) {
    const v = store[id];
    if (!v) return false;
    const def = NODE_KIND_DEFAULTS[v.kind];
    return !!(def && def.acceptsChildren);
  }

  // §D19_P4§ Create any dynamic-kind node (group/button/image/text) at root,
  // or under the current selection if that selection accepts children.
  function createDynamicNode(kind) {
    const def = NODE_KIND_DEFAULTS[kind];
    if (!def) return;
    const id = _newNodeId(kind);
    let parentId = null;
    if (selectedElementId && nodeAcceptsChildren(selectedElementId)) {
      parentId = selectedElementId;
    }
    const x = 100, y = 100, w = def.w, h = def.h;
    const entry = {
      kind,
      label: def.label,
      x, y, w, h,
      _originX: x, _originY: y
    };
    if (kind === 'text') {
      entry.label = def.defaultLabel;
      entry.fontSize = def.defaultFontSize;
    }
    if (kind === 'toggle') {
      // Default state = off. Persisted to runtime via __GPC_UI_TOGGLES.
      entry.toggleState = 'off';
      entry.toggleStateKey = '';
    }
    if (parentId) entry.parentId = parentId;
    store[id] = entry;
    // §D19_P6§ Toggle seeds three children: bg image (always rendered) +
    // empty .on / .off state containers. User adds visuals inside on/off.
    if (kind === 'toggle') {
      const bgId  = id + '.bg';
      const onId  = id + '.on';
      const offId = id + '.off';
      if (!store[bgId]) {
        store[bgId] = { kind: 'image', parentId: id, label: (def.label + ' bg'),
                        background: 'ui-button-paper',
                        x: 0, y: 0, w: w, h: h, _originX: 0, _originY: 0 };
      }
      if (!store[onId]) {
        store[onId] = { kind: 'empty', parentId: id, label: 'on',
                        x: 0, y: 0, w: w, h: h, _originX: 0, _originY: 0 };
      }
      if (!store[offId]) {
        store[offId] = { kind: 'empty', parentId: id, label: 'off',
                         x: 0, y: 0, w: w, h: h, _originX: 0, _originY: 0 };
      }
    }
    if (undo) undo.recordBefore();
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    selectedElementId = id;
    selectedLayerId = null;
    renderElementList(); renderProps(); renderPreview();
    flashToast(def.label + ' created', 'success');
  }
  // Public wrappers for the toolbar buttons.
  function createGroupNode()  { createDynamicNode('group'); }
  function createButtonNode() { createDynamicNode('button'); }
  function createImageNode()  { createDynamicNode('image'); }
  function createTextNode()   { createDynamicNode('text'); }
  function createToggleNode() { createDynamicNode('toggle'); }
  function createEmptyNode()  { createDynamicNode('empty'); }

  // Delete a dynamic-kind node: remove the entry; children re-parent to root.
  function deleteDynamicNode(id) {
    const v = store[id];
    if (!v || DYNAMIC_KINDS.indexOf(v.kind) < 0) return;
    if (undo) undo.recordBefore();
    delete store[id];
    for (const k of Object.keys(store)) {
      const vv = store[k];
      if (vv && vv.parentId === id) {
        const nv = { ...vv }; delete nv.parentId;
        if (Object.keys(nv).length) store[k] = nv;
        else delete store[k];
      }
    }
    markDirty();
    saveStoreSilent();
    if (undo) undo.commit();
    if (selectedElementId === id) selectedElementId = null;
    renderElementList(); renderProps(); renderPreview();
    flashToast((v.kind.charAt(0).toUpperCase() + v.kind.slice(1)) + ' deleted', 'info');
  }
  // Back-compat alias.
  function deleteGroupNode(id) { return deleteDynamicNode(id); }

  // ----- Render: element list (now hierarchy tree) -----
  function renderElementList() {
    const root = document.getElementById('el-list');
    root.innerHTML = '';
    const screen = getScreen();
    if (!screen.elements.length && !getGroupNodes().length) {
      root.innerHTML = '<div class="empty-pane">No elements registered for this screen yet.</div>';
      return;
    }
    const tree = buildTree();
    // §D19_P4§ Build a quick lookup of descendants of the selected node so we
    // can tint them in the tree (Unity Hierarchy "child highlight").
    const descendantSet = new Set();
    if (selectedElementId) {
      const queue = [selectedElementId];
      while (queue.length) {
        const cur = queue.shift();
        for (const k of Object.keys(store)) {
          if (k.indexOf('@') >= 0) continue;
          const v = store[k];
          if (v && v.parentId === cur) {
            if (!descendantSet.has(k)) { descendantSet.add(k); queue.push(k); }
          }
        }
      }
    }
    function renderNode(node, depth, ancestorLastFlags, slideIn) {
      const el = node.el;
      const kindDef = NODE_KIND_DEFAULTS[el.kind] || null;
      const isGroup    = el.kind === 'group';
      const isButton   = el.kind === 'button';
      const isImage    = el.kind === 'image';
      const isText     = el.kind === 'text';
      const isToggle   = el.kind === 'toggle';
      const isEmpty    = el.kind === 'empty';
      const isDynamic  = !!kindDef;
      const hasChildren = node.children.length > 0;
      const collapsed = isCollapsed(el.id);
      const item = document.createElement('div');
      const scopes = scopesWithOverrides(el.id);
      const hasOvr = scopes.length > 0;
      item.className = 'el-item'
        + (el.id === selectedElementId ? ' active' : '')
        + (hasOvr ? ' has-override' : '')
        + (isGroup  ? ' is-group'  : '')
        + (isButton ? ' is-button' : '')
        + (isImage  ? ' is-image'  : '')
        + (isText   ? ' is-text'   : '')
        + (isToggle ? ' is-toggle' : '')
        + (isEmpty  ? ' is-empty'  : '')
        + (descendantSet.has(el.id) ? ' descendant-of-selected' : '')
        + (slideIn ? ' tree-slide' : '');
      item.dataset.nodeId = el.id;
      item.draggable = true;
      const badges = scopes.map((s) => {
        const lbl = s === '' ? 'G' : ('C' + s);
        const cls = s === '' ? 'ovr-badge global' : 'ovr-badge';
        const title = s === '' ? 'Global override' : ('Course ' + s + ' override');
        return `<span class="${cls}" title="${title}">${lbl}</span>`;
      }).join('');
      // Tree rail stack — one slot per ancestor depth. ancestorLastFlags[i]==true
      // means that ancestor was the last sibling at depth i, so its rail vanishes
      // for descendants (Unity-style elbow). Final slot draws the elbow.
      let railHtml = '';
      for (let i = 0; i < depth; i++) {
        const isLast = ancestorLastFlags[i];
        railHtml += `<span class="tree-rail${isLast ? ' empty' : ''}"></span>`;
      }
      if (depth > 0) {
        // Replace the deepest rail slot with the .last variant (drawn elbow).
        // Easier: append the elbow as an extra thin slot.
        railHtml = railHtml.slice(0, railHtml.lastIndexOf('<span class="tree-rail'));
        const isLastChild = ancestorLastFlags[depth - 1];
        railHtml += `<span class="tree-rail last${isLastChild ? '' : ''}"></span>`;
      }
      const chevSlot = hasChildren
        ? `<span class="tree-chev clickable" data-act="toggle">${collapsed ? '▸' : '▾'}</span>`
        : `<span class="tree-chev"></span>`;
      const ico = kindDef ? kindDef.ico : '';
      const icoSlot = ico ? `<span class="kind-ico" title="${el.kind}">${ico}</span>` : `<span class="kind-ico"></span>`;
      const metaText = isDynamic ? el.kind : el.id;
      item.innerHTML = `<span class="tree-rail-stack">${railHtml}</span>`
        + chevSlot
        + icoSlot
        + `<span class="label">${el.label}</span>`
        + `<span class="meta">${metaText}</span>`
        + (badges ? `<span class="ovr-badges">${badges}</span>` : '');
      // Click handlers
      item.addEventListener('click', (ev) => {
        if (ev.target && ev.target.dataset && ev.target.dataset.act === 'toggle') {
          toggleCollapsed(el.id);
          renderElementList();
          return;
        }
        selectedElementId = el.id;
        selectedLayerId = null;
        renderElementList(); renderProps(); renderPreview();
      });
      // Right-click: dynamic-kind context (delete)
      item.addEventListener('contextmenu', (ev) => {
        if (!isDynamic) return;
        ev.preventDefault();
        const lbl = el.kind.charAt(0).toUpperCase() + el.kind.slice(1);
        if (confirm('Delete ' + lbl.toLowerCase() + ' "' + el.label + '"? Children re-parent to root.')) {
          deleteDynamicNode(el.id);
        }
      });
      // Drag-drop: drag a node onto another to reparent / reorder.
      // §D19_P4§ image / text reject "into" drops (they don't accept children).
      item.addEventListener('dragstart', (ev) => {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', el.id);
      });
      item.addEventListener('dragover', (ev) => {
        ev.preventDefault();
        const rect = item.getBoundingClientRect();
        const inMiddle = (ev.clientY > rect.top + rect.height * 0.25 && ev.clientY < rect.top + rect.height * 0.75);
        const acceptsChildren = isGroup || isButton || isToggle || isEmpty;
        if (inMiddle && !acceptsChildren) {
          // Reject — leaf-style node, can't host children.
          item.classList.add('drag-reject');
          item.classList.remove('drag-over', 'drag-over-into');
          ev.dataTransfer.dropEffect = 'none';
          return;
        }
        const intoZone = inMiddle && acceptsChildren;
        item.classList.toggle('drag-over-into', intoZone);
        item.classList.toggle('drag-over', !intoZone);
        item.classList.remove('drag-reject');
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
        item.classList.remove('drag-over-into');
        item.classList.remove('drag-reject');
      });
      item.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const draggedId = ev.dataTransfer.getData('text/plain');
        const intoZone = item.classList.contains('drag-over-into');
        const rejected = item.classList.contains('drag-reject');
        item.classList.remove('drag-over');
        item.classList.remove('drag-over-into');
        item.classList.remove('drag-reject');
        if (rejected) return;
        if (!draggedId || draggedId === el.id) return;
        const acceptsChildren = isGroup || isButton || isToggle || isEmpty;
        if (intoZone && acceptsChildren) {
          reparentNode(draggedId, el.id);
        } else {
          const targetParent = (store[el.id] || {}).parentId || '';
          const draggedParent = (store[draggedId] || {}).parentId || '';
          if (targetParent !== draggedParent) {
            reparentNode(draggedId, targetParent || null);
          }
          reorderSibling(draggedId, el.id);
        }
      });
      root.appendChild(item);
      if (!collapsed) {
        // §P7§ Apply slide-in to direct children when their parent was just expanded.
        const parentJustExpanded = (el.id === _lastExpandedId);
        node.children.forEach((c, i) => {
          const isLastSib = (i === node.children.length - 1);
          renderNode(c, depth + 1, ancestorLastFlags.concat([isLastSib]), parentJustExpanded);
        });
      }
    }
    tree.forEach((n, i) => {
      const isLast = (i === tree.length - 1);
      renderNode(n, 0, [], false);
    });
    // Clear after one render so animation doesn't replay on next re-render.
    _lastExpandedId = null;

    // §D19_P13§ Templates panel — shown below tree when screen has templates.
    const tplContainer = document.getElementById('el-templates');
    if (tplContainer) {
      const scr = getScreen();
      if (scr.templates && Object.keys(scr.templates).length > 0) {
        tplContainer.style.display = '';
        tplContainer.innerHTML = '<div class="tpl-header">Templates</div>';
        for (const [tname, tmpl] of Object.entries(scr.templates)) {
          const instanceCount = scr.elements.filter(e => e.template === tname).length;
          const row = document.createElement('div');
          row.className = 'tpl-row' + (selectedElementId === '__tpl__' + tname ? ' active' : '');
          row.innerHTML = `<span class="tpl-name">${tmpl.label || tname}</span><span class="tpl-count">Used by ${instanceCount} instances</span>`;
          row.addEventListener('click', () => {
            selectedElementId = '__tpl__' + tname;
            renderElementList(); renderProps();
          });
          tplContainer.appendChild(row);
        }
      } else {
        tplContainer.style.display = 'none';
      }
    }
  }

  // §D19_P0§ Render parent breadcrumb in the inspector.
  function renderParentBreadcrumb() {
    const node = document.getElementById('parent-breadcrumb');
    if (!node) return;
    const el = getElement(selectedElementId);
    if (!el) { node.style.display = 'none'; node.innerHTML = ''; return; }
    const ovr = store[selectedElementId] || {};
    if (!ovr.parentId) { node.style.display = 'none'; node.innerHTML = ''; return; }
    // Walk up to root, collect labels
    const chain = [];
    let cur = ovr.parentId, depth = 0;
    while (cur && depth < 16) {
      const p = getElement(cur);
      chain.unshift(p ? p.label : cur);
      cur = (store[cur] || {}).parentId;
      depth++;
    }
    node.style.display = '';
    node.innerHTML = `<span>Parent:</span> <span class="crumb">${chain.join(' › ')}</span>`
      + `<button type="button" class="root-btn" data-act="reparent-root" title="Move to tree root">↩ root</button>`;
    const btn = node.querySelector('[data-act="reparent-root"]');
    if (btn) btn.addEventListener('click', () => reparentNode(selectedElementId, null));
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
    // Resolve effective kind (override → SCREENS default → 'leaf').
    const _ovrK = (getOverride(el.id, '') || {}).kind;
    const _kind = _ovrK || el.kind || 'leaf';
    const _kindIcon = _kind === 'group' ? '▣'
                    : _kind === 'button' ? '■'
                    : _kind === 'toggle' ? '◉'
                    : _kind === 'image' ? '🖼'
                    : _kind === 'text' ? 'T'
                    : _kind === 'empty' ? '□'
                    : '·';
    meta.innerHTML = `<span class="kind-pill" title="Node kind: ${_kind}">${_kindIcon} ${_kind.toUpperCase()}</span> <strong>${el.label}</strong> <span style="opacity:0.55">· ${el.id}</span>` + (scopeCourseId ? ` <span style="opacity:0.55">· Course ${scopeCourseId}</span>` : '');
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
    setVal('input[data-prop="label"]', typeof props.label === 'string' ? props.label : '');
    // Dynamic placeholder: when the field is empty, hint the in-code default
    // for THIS specific element (not a generic "(default)") — e.g. menu.play.text
    // hints "PLAY", menu.coinChip.text hints "0". Resolved from SCREENS seed
    // when this element is a child suffix, otherwise from the element's own
    // default label. Empty string means no hint.
    (function () {
      const el = getElement(selectedElementId);
      const inp = document.querySelector('input[data-prop="label"]');
      if (!inp) return;
      let hint = '';
      if (el) {
        // Match against parent's seedChildren when id ends in .text/.bg/.icon/etc.
        const dot = (el.id || '').lastIndexOf('.');
        if (dot > 0) {
          const parentId = el.id.slice(0, dot);
          const suffix = el.id.slice(dot + 1);
          for (const s of SCREENS) {
            const parent = s.elements.find(e => e.id === parentId);
            if (parent && parent.seedChildren) {
              const sc = parent.seedChildren.find(c => c.suffix === suffix);
              if (sc && typeof sc.label === 'string') { hint = sc.label; break; }
            }
          }
        }
        // Fallback to element's own default label.
        if (!hint && typeof el.label === 'string') hint = el.label;
      }
      inp.placeholder = hint || '';
    })();
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
    // §D19§ Re-evaluate per-section paste visibility (cheap; no-op if DOM unchanged).
    refreshClipboardUI();
    // §D19_P0§ Refresh parent-chain breadcrumb in inspector.
    renderParentBreadcrumb();
    // §D19_P1§ Refresh group-only Layout panel + per-child Flex row.
    renderLayoutSection();
    renderFlexSection();
    applyParentLayoutLockUI();
    // §D19_P4§ Kind-aware inspector sections — hide irrelevant Style controls.
    applyKindAwareInspector();
    // §D19_P14§ Anchor + Pivot + Text Alignment.
    renderAnchorSection();
    // §D19_P5§ Add the button-only Action input + text-only Bound Variable picker.
    renderD19P5Section();
  }

  // §D19_P5§ Per-kind extras: button shows an Action text input; text shows a
  // Bound Variable dropdown. Rendered as an extra panel appended to #right-panel.
  function renderD19P5Section() {
    const host = document.getElementById('right-panel') || document.getElementById('inspector') || document.body;
    let panel = document.getElementById('d19-p5-section');
    const el = getElement(selectedElementId);
    if (!el) { if (panel) panel.remove(); return; }
    const k = el.kind || 'leaf';
    if (k !== 'button' && k !== 'text' && k !== 'toggle') { if (panel) panel.remove(); return; }
    const ovr = store[selectedElementId] || {};
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'd19-p5-section';
      panel.className = 'inspector-section';
      panel.style.cssText = 'border-top:1px solid #e2d4b8;padding:10px 12px;margin-top:6px';
      // Append after layout-section if possible
      const layoutSec = document.getElementById('layout-section');
      if (layoutSec && layoutSec.parentNode) layoutSec.parentNode.insertBefore(panel, layoutSec.nextSibling);
      else host.appendChild(panel);
    }
    if (k === 'button') {
      const cur = (typeof ovr.action === 'string') ? ovr.action : '';
      panel.innerHTML = '<div class="group-title" title="Click action handler key (e.g. goto:courses, toggle:sound)">Action</div>'
        + '<div class="field-row"><label>Action</label><div class="row-input-wrap">'
        + `<input type="text" id="d19p5-action" placeholder="goto:courses" value="${cur.replace(/"/g,'&quot;')}"/>`
        + '</div></div>'
        + '<div class="hint" style="font-size:11px;opacity:0.7">Resolved at runtime by the game. Empty = no-op.</div>';
      const inp = panel.querySelector('#d19p5-action');
      inp.addEventListener('input', () => {
        const v = String(inp.value || '');
        const cur = store[selectedElementId] || {};
        const next = { ...cur, kind: 'button' };
        if (v) next.action = v; else delete next.action;
        store[selectedElementId] = next;
        markDirty(); saveStoreSilent();
      });
    } else if (k === 'toggle') {
      // §D19_P6§ Toggle inspector: state radio (preview) + Bound state key.
      const curState = (ovr.toggleState === 'on') ? 'on' : 'off';
      const curKey = (typeof ovr.toggleStateKey === 'string') ? ovr.toggleStateKey : '';
      panel.innerHTML = '<div class="group-title" title="On/off state — runtime persists this and renders the matching child branch">Toggle State</div>'
        + '<div class="field-row"><label>State</label><div class="row-input-wrap" style="display:flex;gap:10px;align-items:center">'
        + `<label style="display:flex;gap:4px;align-items:center;font-weight:normal"><input type="radio" name="d19p6-state" value="on"${curState==='on'?' checked':''}/> on</label>`
        + `<label style="display:flex;gap:4px;align-items:center;font-weight:normal"><input type="radio" name="d19p6-state" value="off"${curState==='off'?' checked':''}/> off</label>`
        + '</div></div>'
        + '<div class="field-row"><label>State key</label><div class="row-input-wrap">'
        + `<input type="text" id="d19p6-statekey" placeholder="e.g. soundMuted" value="${curKey.replace(/"/g,'&quot;')}"/>`
        + '</div></div>'
        + '<div class="hint" style="font-size:11px;opacity:0.75;background:#fef9e8;border-left:3px solid #d4a942;padding:6px 8px;margin-top:6px;border-radius:3px">'
        + 'Add visuals under <b>On</b> / <b>Off</b> children. Only the matching state-branch renders at runtime.'
        + '</div>';
      panel.querySelectorAll('input[name="d19p6-state"]').forEach((rb) => {
        rb.addEventListener('change', () => {
          if (!rb.checked) return;
          const v = rb.value === 'on' ? 'on' : 'off';
          const cur = store[selectedElementId] || {};
          store[selectedElementId] = { ...cur, kind: 'toggle', toggleState: v };
          markDirty(); saveStore();
          renderPreview();
        });
      });
      const keyInp = panel.querySelector('#d19p6-statekey');
      if (keyInp) keyInp.addEventListener('input', () => {
        const v = String(keyInp.value || '').trim();
        const cur = store[selectedElementId] || {};
        const next = { ...cur, kind: 'toggle' };
        if (v) next.toggleStateKey = v; else delete next.toggleStateKey;
        store[selectedElementId] = next;
        markDirty(); saveStoreSilent();
      });
    } else if (k === 'text') {
      const cur = (typeof ovr.boundVar === 'string') ? ovr.boundVar : '';
      const opts = ['', 'coins', 'gems', 'shots', 'maxShots', 'course', 'level'];
      panel.innerHTML = '<div class="group-title" title="Live game value to display instead of static label">Bound Variable</div>'
        + '<div class="field-row"><label>Bind to</label><div class="row-input-wrap">'
        + '<select id="d19p5-boundvar">'
        + opts.map(o => `<option value="${o}"${o===cur?' selected':''}>${o||'(none)'}</option>`).join('')
        + '</select>'
        + '</div></div>'
        + '<div class="hint" style="font-size:11px;opacity:0.7">When set, the rendered text comes from the live game state.</div>';
      const sel = panel.querySelector('#d19p5-boundvar');
      sel.addEventListener('change', () => {
        const v = String(sel.value || '');
        const cur = store[selectedElementId] || {};
        const next = { ...cur };
        if (v) next.boundVar = v; else delete next.boundVar;
        if (Object.keys(next).length) store[selectedElementId] = next;
        else delete store[selectedElementId];
        markDirty(); saveStore();
        renderPreview();
      });
    }
  }

  // §D19_P14§ Anchor presets + Pivot + Text Alignment sections.
  function renderAnchorSection() {
    const node = document.getElementById('anchor-section');
    if (!node) return;
    const el = getElement(selectedElementId);
    if (!el) { node.style.display = 'none'; node.innerHTML = ''; _removeTextAlignSection(); return; }

    const gOvr = getOverride(el.id, '') || {};
    const cOvr = scopeCourseId ? (getOverride(el.id, scopeCourseId) || {}) : {};
    const merged = { ...gOvr, ...cOvr };
    const defEl = el.defaults || {};
    const anchorMin = merged.anchorMin != null ? merged.anchorMin : (defEl.anchorMin || { x: 0, y: 0 });
    const anchorMax = merged.anchorMax != null ? merged.anchorMax : (defEl.anchorMax || { x: 0, y: 0 });
    const pivot     = merged.pivot     != null ? merged.pivot     : (defEl.pivot     || { x: 0.5, y: 1.0 });

    // 9-point presets: [label, anchorMin, anchorMax, pivotX, pivotY]
    const PRESETS = [
      ['TL', {x:0,  y:0  }, {x:0,  y:0  }, 0,   0  ],
      ['TC', {x:.5, y:0  }, {x:.5, y:0  }, 0.5, 0  ],
      ['TR', {x:1,  y:0  }, {x:1,  y:0  }, 1,   0  ],
      ['ML', {x:0,  y:.5 }, {x:0,  y:.5 }, 0,   0.5],
      ['MC', {x:.5, y:.5 }, {x:.5, y:.5 }, 0.5, 0.5],
      ['MR', {x:1,  y:.5 }, {x:1,  y:.5 }, 1,   0.5],
      ['BL', {x:0,  y:1  }, {x:0,  y:1  }, 0,   1  ],
      ['BC', {x:.5, y:1  }, {x:.5, y:1  }, 0.5, 1  ],
      ['BR', {x:1,  y:1  }, {x:1,  y:1  }, 1,   1  ]
    ];
    const STRETCH = [
      ['H-Stretch', {x:0, y:.5}, {x:1, y:.5}],
      ['V-Stretch', {x:.5,y:0 }, {x:.5,y:1 }],
      ['Full',      {x:0, y:0 }, {x:1, y:1 }]
    ];
    function _eqPt(a, b) { return a && b && a.x === b.x && a.y === b.y; }
    function _matchAnchor() {
      for (const [id,mn,mx] of PRESETS) {
        if (_eqPt(mn, anchorMin) && _eqPt(mx, anchorMax)) return id;
      }
      return null;
    }
    function _matchStretch() {
      for (const [id,mn,mx] of STRETCH) {
        if (_eqPt(mn, anchorMin) && _eqPt(mx, anchorMax)) return id;
      }
      return null;
    }
    function _matchPivot() {
      for (const [id,,, px, py] of PRESETS) {
        if (px === pivot.x && py === pivot.y) return id;
      }
      return null;
    }
    const activeAnchor  = _matchAnchor();
    const activeStretch = activeAnchor ? null : _matchStretch();
    const activePivot   = _matchPivot();

    const ORDER = [
      ['TL',1,1],['TC',1,2],['TR',1,3],
      ['ML',2,1],['MC',2,2],['MR',2,3],
      ['BL',3,1],['BC',3,2],['BR',3,3]
    ];
    const anchorGrid = ORDER.map(([id,r,c]) =>
      `<button type="button" class="ap-btn${id===activeAnchor?' active':''}" data-ap-preset="${id}" title="${id}" style="grid-row:${r};grid-column:${c}"><span class="ap-dot"></span></button>`
    ).join('');
    const stretchRow = STRETCH.map(([id]) =>
      `<button type="button" class="ap-stretch-btn${id===activeStretch?' active':''}" data-ap-stretch="${id}">${id}</button>`
    ).join('');
    const pivotGrid = ORDER.map(([id,r,c]) =>
      `<button type="button" class="ap-btn${id===activePivot?' active':''}" data-pv-preset="${id}" title="${id}" style="grid-row:${r};grid-column:${c}"><span class="ap-dot"></span></button>`
    ).join('');

    const advKey = 'gpc_ui_anchor_adv_' + (el.id || '');
    let advOpen = false;
    try { advOpen = localStorage.getItem(advKey) === '1'; } catch (_) {}
    const advBody = advOpen ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;margin-top:5px">
        <div class="field-row"><label style="font-size:10px">Min X</label><div class="row-input-wrap"><input type="number" id="ap-min-x" step="0.01" min="0" max="1" style="font-size:11px" value="${anchorMin.x}"/></div></div>
        <div class="field-row"><label style="font-size:10px">Min Y</label><div class="row-input-wrap"><input type="number" id="ap-min-y" step="0.01" min="0" max="1" style="font-size:11px" value="${anchorMin.y}"/></div></div>
        <div class="field-row"><label style="font-size:10px">Max X</label><div class="row-input-wrap"><input type="number" id="ap-max-x" step="0.01" min="0" max="1" style="font-size:11px" value="${anchorMax.x}"/></div></div>
        <div class="field-row"><label style="font-size:10px">Max Y</label><div class="row-input-wrap"><input type="number" id="ap-max-y" step="0.01" min="0" max="1" style="font-size:11px" value="${anchorMax.y}"/></div></div>
        <div class="field-row"><label style="font-size:10px">Pivot X</label><div class="row-input-wrap"><input type="number" id="ap-pv-x" step="0.01" min="0" max="1" style="font-size:11px" value="${pivot.x}"/></div></div>
        <div class="field-row"><label style="font-size:10px">Pivot Y</label><div class="row-input-wrap"><input type="number" id="ap-pv-y" step="0.01" min="0" max="1" style="font-size:11px" value="${pivot.y}"/></div></div>
      </div>` : '';

    node.style.display = '';
    node.innerHTML = `
      <div class="group-title" title="Anchor = which corner of the parent this element sticks to. Pivot = element's own origin point.">Anchor &amp; Pivot</div>
      <div class="ap-two-col">
        <div class="ap-subsection">
          <div class="ap-label">Anchor</div>
          <div class="ap-grid" id="ap-anchor-grid">${anchorGrid}</div>
          <div class="ap-stretch-row">${stretchRow}</div>
        </div>
        <div class="ap-subsection">
          <div class="ap-label">Pivot</div>
          <div class="ap-grid" id="ap-pivot-grid">${pivotGrid}</div>
          <button type="button" class="ic-reset" id="ap-pivot-reset" title="Reset pivot to default" style="margin-top:5px;font-size:10px;width:100%">↺ Reset</button>
        </div>
      </div>
      <div class="ap-advanced">
        <button type="button" class="ap-advanced-toggle" id="ap-adv-toggle">${advOpen?'▾':'▸'} Manual values</button>
        ${advBody}
      </div>
    `;

    // Wire anchor preset buttons
    node.querySelectorAll('[data-ap-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = PRESETS.find(p => p[0] === btn.dataset.apPreset);
        if (!found) return;
        patchOverride(selectedElementId, scopeCourseId, {
          anchorMin: { ...found[1] }, anchorMax: { ...found[2] },
          pivot: { x: found[3], y: found[4] }
        });
        renderProps(); renderPreview();
      });
    });
    // Wire stretch preset buttons
    node.querySelectorAll('[data-ap-stretch]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = STRETCH.find(s => s[0] === btn.dataset.apStretch);
        if (!found) return;
        patchOverride(selectedElementId, scopeCourseId, {
          anchorMin: { ...found[1] }, anchorMax: { ...found[2] }
        });
        renderProps(); renderPreview();
      });
    });
    // Wire pivot preset buttons
    node.querySelectorAll('[data-pv-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const found = PRESETS.find(p => p[0] === btn.dataset.pvPreset);
        if (!found) return;
        patchOverride(selectedElementId, scopeCourseId, {
          pivot: { x: found[3], y: found[4] }
        });
        renderProps(); renderPreview();
      });
    });
    // Reset pivot
    const pvReset = node.querySelector('#ap-pivot-reset');
    if (pvReset) pvReset.addEventListener('click', () => {
      const k = keyFor(selectedElementId, scopeCourseId);
      const next = { ...(store[k] || {}) };
      delete next.pivot;
      if (Object.keys(next).length) store[k] = next; else delete store[k];
      markDirty(); saveStore();
      renderProps(); renderPreview();
    });
    // Advanced toggle
    const advToggle = node.querySelector('#ap-adv-toggle');
    if (advToggle) advToggle.addEventListener('click', () => {
      try { localStorage.setItem(advKey, advOpen ? '0' : '1'); } catch (_) {}
      renderAnchorSection();
    });
    // Manual inputs (change events)
    function _clamp01(v) { return Math.min(1, Math.max(0, v)); }
    function _readManual() {
      const mnX = node.querySelector('#ap-min-x'); const mnY = node.querySelector('#ap-min-y');
      const mxX = node.querySelector('#ap-max-x'); const mxY = node.querySelector('#ap-max-y');
      const pvX = node.querySelector('#ap-pv-x');  const pvY = node.querySelector('#ap-pv-y');
      const patch = {};
      if (mnX && mnY && mxX && mxY) {
        const vals = [mnX.value, mnY.value, mxX.value, mxY.value].map(Number);
        if (vals.every(isFinite)) {
          patch.anchorMin = { x: _clamp01(vals[0]), y: _clamp01(vals[1]) };
          patch.anchorMax = { x: _clamp01(vals[2]), y: _clamp01(vals[3]) };
        }
      }
      if (pvX && pvY) {
        const px = Number(pvX.value), py = Number(pvY.value);
        if (isFinite(px) && isFinite(py)) patch.pivot = { x: _clamp01(px), y: _clamp01(py) };
      }
      if (Object.keys(patch).length) { patchOverride(selectedElementId, scopeCourseId, patch); renderPreview(); }
    }
    [node.querySelector('#ap-min-x'), node.querySelector('#ap-min-y'),
     node.querySelector('#ap-max-x'), node.querySelector('#ap-max-y'),
     node.querySelector('#ap-pv-x'),  node.querySelector('#ap-pv-y')
    ].forEach(inp => { if (inp) inp.addEventListener('change', _readManual); });

    // Text alignment (kind=text only)
    _renderTextAlignSection(el, merged);
  }

  function _removeTextAlignSection() {
    const s = document.getElementById('d19-textalign-section');
    if (s) s.remove();
  }

  // Inject H + V text alignment into Typography <details> when kind=text.
  function _renderTextAlignSection(el, merged) {
    _removeTextAlignSection();
    if (!el || (el.kind || 'leaf') !== 'text') return;
    const typoFold = document.getElementById('legacy-typography-fold');
    if (!typoFold) return;
    const discBody = typoFold.querySelector('.disclosure-body');
    if (!discBody) return;

    const defEl = el.defaults || {};
    const curH = merged.textAlign    || defEl.textAlign    || 'left';
    const curV = merged.verticalAlign || defEl.verticalAlign || 'middle';

    const H_OPT = [['left','≡ Left'],['center','⌷ Center'],['right','≡ Right']];
    const V_OPT = [['top','⌃ Top'],['middle','⊕ Mid'],['bottom','⌄ Bot']];
    const hBtns = H_OPT.map(([v,lbl]) =>
      `<button type="button" class="align-btn${curH===v?' active':''}" data-h-align="${v}">${lbl}</button>`
    ).join('');
    const vBtns = V_OPT.map(([v,lbl]) =>
      `<button type="button" class="align-btn${curV===v?' active':''}" data-v-align="${v}">${lbl}</button>`
    ).join('');

    const sec = document.createElement('div');
    sec.id = 'd19-textalign-section';
    sec.innerHTML = `
      <div class="field-row" style="margin-top:5px">
        <label style="font-size:11px">H Align</label>
        <div class="align-row">${hBtns}</div>
      </div>
      <div class="field-row">
        <label style="font-size:11px">V Align</label>
        <div class="align-row">${vBtns}</div>
      </div>`;
    discBody.appendChild(sec);

    sec.querySelectorAll('[data-h-align]').forEach((btn) => {
      btn.addEventListener('click', () => {
        patchOverride(selectedElementId, scopeCourseId, { textAlign: btn.dataset.hAlign });
        renderProps(); renderPreview();
      });
    });
    sec.querySelectorAll('[data-v-align]').forEach((btn) => {
      btn.addEventListener('click', () => {
        patchOverride(selectedElementId, scopeCourseId, { verticalAlign: btn.dataset.vAlign });
        renderProps(); renderPreview();
      });
    });
  }

  // §D19_P4§ Show/hide Style sub-rows based on the selected node's kind:
  //   - group  : hide entire Style block (only layout/transform makes sense)
  //   - button : hide Style → Background / Icon / Typography (button itself
  //              renders nothing; visual lives in nested image/text children)
  //   - image  : keep Background; hide Icon, Text input, Typography
  //   - text   : keep Text input + Typography; hide Background / Icon
  //   - leaf   : unchanged (legacy menu.* buttons)
  function applyKindAwareInspector() {
    const el = getElement(selectedElementId);
    if (!el) return;
    const k = el.kind || 'leaf';
    const styleGroup = document.getElementById('legacy-style-group');
    const layersSection = document.getElementById('layers-section');
    if (!styleGroup) return;
    // Identify the field rows by their data-prop / picker id so we can toggle.
    const rowOf = (sel) => {
      const node = styleGroup.querySelector(sel);
      return node ? node.closest('.field-row') : null;
    };
    const labelRow = rowOf('input[data-prop="label"]');
    const bgRow    = rowOf('#bg-picker');
    const iconRow  = rowOf('#icon-picker');
    const typoFold = document.getElementById('legacy-typography-fold');
    const cpStyleRow = styleGroup.querySelector('.d19-cp-row:last-of-type');
    const setVis = (n, vis) => { if (n) n.style.display = vis ? '' : 'none'; };
    // Default everything visible (leaf path).
    setVis(styleGroup, true);
    setVis(labelRow, true); setVis(bgRow, true); setVis(iconRow, true);
    setVis(typoFold, true); setVis(cpStyleRow, true);
    setVis(layersSection, true);
    if (k === 'group' || k === 'empty' || k === 'toggle') {
      // §D19_P6§ Empty + toggle behave like group/button — invisible parents
      // whose visuals come from nested children. Hide Style + Layers.
      setVis(styleGroup, false);
      setVis(layersSection, false);
    } else if (k === 'button') {
      // Button is invisible; only transform + layout. Hide Style + Layers entirely.
      setVis(styleGroup, false);
      setVis(layersSection, false);
    } else if (k === 'image') {
      // Image: only Background field + size.
      setVis(labelRow, false);
      setVis(iconRow, false);
      setVis(typoFold, false);
      setVis(layersSection, false);
    } else if (k === 'text') {
      // Text: label + typography.
      setVis(bgRow, false);
      setVis(iconRow, false);
      setVis(layersSection, false);
    }
  }

  // §D19_P1§ Group-only Layout subsection. Direction (free/vert/horiz/grid),
  // spacing, padding, columns. Reads from the active scope override (group
  // entries are stored under the global key — see saveStore for isGroup).
  function renderLayoutSection() {
    const node = document.getElementById('layout-section');
    if (!node) return;
    const el = getElement(selectedElementId);
    if (!el || el.kind !== 'group') { node.style.display = 'none'; node.innerHTML = ''; return; }
    const ovr = store[selectedElementId] || {};
    const dir = String(ovr.layoutDirection || 'free');
    const sp  = Number.isFinite(Number(ovr.layoutSpacing)) ? Number(ovr.layoutSpacing) : 0;
    const pad = (ovr.layoutPadding && typeof ovr.layoutPadding === 'object') ? ovr.layoutPadding : { t:0, r:0, b:0, l:0 };
    const cols = Number.isFinite(Number(ovr.gridColumns)) ? Number(ovr.gridColumns) : 2;
    const btn = (val, lbl, title) => `<button type="button" class="d19-lay-dir${dir===val?' on':''}" data-dir="${val}" title="${title}">${lbl}</button>`;
    node.style.display = '';
    node.innerHTML = ''
      + '<div class="group-title" title="Auto-arrange children of this group">Layout</div>'
      + '<div class="d19-lay-row" id="d19-lay-dirs">'
      +   btn('free',       'Free',  'Children keep their own x/y')
      +   btn('vertical',   '↕ Vert','Stack top to bottom')
      +   btn('horizontal', '↔ Horiz','Stack left to right')
      +   btn('grid',       '▦ Grid','Row-major grid')
      + '</div>'
      + (dir === 'free' ? '' :
          '<div class="field-row"><label>Spacing</label><div class="row-input-wrap">'
          + `<input type="number" data-lay="spacing" step="1" min="0" value="${sp}"/>`
          + '<button type="button" class="ic-reset" data-lay-reset="spacing" title="Reset">↺</button>'
          + '</div></div>'
          + '<div class="pos-size-grid">'
          +   `<div class="field-row"><label>Pad T</label><div class="row-input-wrap"><input type="number" data-lay-pad="t" step="1" value="${pad.t||0}"/></div></div>`
          +   `<div class="field-row"><label>Pad R</label><div class="row-input-wrap"><input type="number" data-lay-pad="r" step="1" value="${pad.r||0}"/></div></div>`
          +   `<div class="field-row"><label>Pad B</label><div class="row-input-wrap"><input type="number" data-lay-pad="b" step="1" value="${pad.b||0}"/></div></div>`
          +   `<div class="field-row"><label>Pad L</label><div class="row-input-wrap"><input type="number" data-lay-pad="l" step="1" value="${pad.l||0}"/></div></div>`
          + '</div>'
          + (dir === 'grid'
              ? `<div class="field-row"><label>Columns</label><div class="row-input-wrap"><input type="number" data-lay="columns" step="1" min="1" value="${cols}"/></div></div>`
              : '')
        );
    // Wire direction buttons
    node.querySelectorAll('[data-dir]').forEach((b) => {
      b.addEventListener('click', () => {
        const v = b.dataset.dir;
        const cur = store[selectedElementId] || {};
        const next = { ...cur };
        if (v === 'free') delete next.layoutDirection;
        else next.layoutDirection = v;
        // Seed sensible defaults on first non-free switch
        if (v !== 'free') {
          if (next.layoutSpacing == null) next.layoutSpacing = 8;
          if (!next.layoutPadding) next.layoutPadding = { t:0, r:0, b:0, l:0 };
          if (v === 'grid' && next.gridColumns == null) next.gridColumns = 2;
        }
        if (Object.keys(next).length) store[selectedElementId] = next;
        else delete store[selectedElementId];
        markDirty(); saveStore();
        renderProps(); renderPreview();
      });
    });
    // Spacing / columns inputs
    node.querySelectorAll('input[data-lay]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const prop = inp.dataset.lay;
        const cur = store[selectedElementId] || {};
        const next = { ...cur };
        if (prop === 'spacing') next.layoutSpacing = Math.max(0, v);
        else if (prop === 'columns') next.gridColumns = Math.max(1, Math.round(v));
        store[selectedElementId] = next;
        markDirty(); saveStoreSilent();
        renderPreview();
      });
    });
    // Padding inputs
    node.querySelectorAll('input[data-lay-pad]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const side = inp.dataset.layPad;
        const v = Number(inp.value);
        if (!Number.isFinite(v)) return;
        const cur = store[selectedElementId] || {};
        const next = { ...cur, layoutPadding: { ...(cur.layoutPadding || { t:0, r:0, b:0, l:0 }), [side]: v } };
        store[selectedElementId] = next;
        markDirty(); saveStoreSilent();
        renderPreview();
      });
    });
    // Spacing reset
    node.querySelectorAll('button[data-lay-reset]').forEach((b) => {
      b.addEventListener('click', () => {
        const cur = store[selectedElementId] || {};
        const next = { ...cur };
        delete next.layoutSpacing;
        store[selectedElementId] = next;
        markDirty(); saveStore();
        renderProps(); renderPreview();
      });
    });
  }

  // §D19_P1§ Per-child Flex row, visible when the selected node's parent has
  // a non-free layoutDirection.
  function renderFlexSection() {
    const node = document.getElementById('flex-section');
    if (!node) return;
    const el = getElement(selectedElementId);
    if (!el) { node.style.display = 'none'; node.innerHTML = ''; return; }
    const ovr = store[selectedElementId] || {};
    const pid = ovr.parentId;
    if (!pid) { node.style.display = 'none'; node.innerHTML = ''; return; }
    const parentOvr = store[pid] || {};
    const pdir = String(parentOvr.layoutDirection || 'free');
    if (pdir === 'free') { node.style.display = 'none'; node.innerHTML = ''; return; }
    const flex = Number.isFinite(Number(ovr.flex)) ? Number(ovr.flex) : 0;
    node.style.display = '';
    node.innerHTML = ''
      + '<div class="group-title" title="Share remaining space along the parent\'s primary axis">Flex</div>'
      + '<div class="field-row"><label>Weight</label><div class="row-input-wrap">'
      + `<input type="number" data-flex step="1" min="0" value="${flex}" placeholder="0"/>`
      + '<button type="button" class="ic-reset" data-flex-reset title="Reset">↺</button>'
      + '</div></div>'
      + '<div class="hint" style="font-size:11px;opacity:0.7">'
      + (pdir === 'grid' ? 'Grid: flex ignored (cells are uniform).' : `Auto-${pdir==='vertical'?'sized height':'sized width'} when weight &gt; 0.`)
      + '</div>';
    const inp = node.querySelector('input[data-flex]');
    if (inp) inp.addEventListener('input', () => {
      const v = Number(inp.value);
      if (!Number.isFinite(v)) return;
      const cur = store[selectedElementId] || {};
      const next = { ...cur };
      if (v > 0) next.flex = v; else delete next.flex;
      if (Object.keys(next).length) store[selectedElementId] = next;
      else delete store[selectedElementId];
      markDirty(); saveStoreSilent();
      applyParentLayoutLockUI();
      renderPreview();
    });
    const rb = node.querySelector('button[data-flex-reset]');
    if (rb) rb.addEventListener('click', () => {
      const cur = store[selectedElementId] || {};
      const next = { ...cur }; delete next.flex;
      if (Object.keys(next).length) store[selectedElementId] = next;
      else delete store[selectedElementId];
      markDirty(); saveStore();
      renderProps(); renderPreview();
    });
  }

  // §D19_P1§ Disable X/Y inputs when parent has non-free layout (auto-positioned)
  // and disable the primary-axis size input when this child has flex>0.
  function applyParentLayoutLockUI() {
    const xIn = document.querySelector('input[data-prop="x"]');
    const yIn = document.querySelector('input[data-prop="y"]');
    const wIn = document.querySelector('input[data-prop="w"]');
    const hIn = document.querySelector('input[data-prop="h"]');
    [xIn, yIn, wIn, hIn].forEach((e) => { if (!e) return; e.disabled = false; e.title = ''; });
    if (!selectedElementId) return;
    const ovr = store[selectedElementId] || {};
    const pid = ovr.parentId;
    if (!pid) return;
    const parentOvr = store[pid] || {};
    const pdir = String(parentOvr.layoutDirection || 'free');
    if (pdir === 'free') return;
    const lockMsg = 'Auto-positioned by parent layout';
    [xIn, yIn].forEach((e) => { if (!e) return; e.disabled = true; e.title = lockMsg; });
    const flex = Number.isFinite(Number(ovr.flex)) ? Number(ovr.flex) : 0;
    if (flex > 0 && pdir !== 'grid') {
      const primary = (pdir === 'vertical') ? hIn : wIn;
      if (primary) { primary.disabled = true; primary.title = 'Auto-sized by flex'; }
    }
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

    // Stage info text — rendered in the toolbar above the iframe (NOT
    // overlaid on the canvas, since that used to occlude the top-left UI
    // like the coin chip when selected).
    const el = getElement(selectedElementId);
    const info = document.getElementById('preview-info');
    if (info) {
      if (el) {
        const p = effectiveProps(el);
        info.textContent = `${el.label} · ${Math.round(p.x)},${Math.round(p.y)} · ${Math.round(p.w)}×${Math.round(p.h)}`;
        info.classList.add('has-content');
      } else {
        info.textContent = '';
        info.classList.remove('has-content');
      }
    }
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
      // No override — surface the actual in-code default for this element so
      // the user sees what's currently rendering (e.g. "ui-button-paper" /
      // "play"), not a generic "Default sprite" placeholder.
      const el = getElement(selectedElementId);
      const defKeyRaw = el ? (field === 'background' ? el.defaultBg : (field === 'icon' ? el.defaultIcon : '')) : '';
      // Short icon keys ('play', 'shop') map to full asset names ('ui-play-icon').
      // Try direct lookup first; if it fails AND the field is icon, try the
      // canonical ui-<key>-icon name.
      let defKey = defKeyRaw;
      let defEntry = defKey ? (cfg.byKey()[defKey] || _resolveSpriteEntry(defKey)) : null;
      if (!defEntry && defKeyRaw && field === 'icon') {
        defKey = 'ui-' + defKeyRaw + '-icon';
        defEntry = cfg.byKey()[defKey] || _resolveSpriteEntry(defKey);
      }
      if (defEntry) {
        thumb.classList.remove('empty');
        thumb.innerHTML = '';
        const img = document.createElement('img');
        img.src = defEntry.src; img.alt = defEntry.label;
        img.style.opacity = '0.55';
        thumb.appendChild(img);
        name.textContent = defEntry.label;
        if (sub) sub.textContent = 'in-code default · click to override';
      } else {
        thumb.classList.add('empty');
        name.textContent = defKey || 'Default render';
        if (sub) sub.textContent = defKey ? 'in-code default · click to override' : 'Click to set a sprite';
      }
      clr.style.display = 'none';
    }
    // Highlight the selected cell in the open popover. When override is
    // empty, mark the in-code default cell as active (so the user sees
    // which sprite is actually rendering, not just the abstract DEFAULT
    // tile).
    let activeKey = key || '';
    if (!activeKey) {
      const el = getElement(selectedElementId);
      const defRaw = el ? (field === 'background' ? el.defaultBg : (field === 'icon' ? el.defaultIcon : '')) : '';
      if (defRaw) {
        activeKey = (cfg.byKey()[defRaw] ? defRaw
                    : (field === 'icon' && cfg.byKey()['ui-' + defRaw + '-icon']) ? ('ui-' + defRaw + '-icon')
                    : defRaw);
      }
    }
    root.querySelectorAll('.sp-cell').forEach((c) => {
      c.classList.toggle('active', c.dataset.key === activeKey);
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

      flashToast('Publishing...');
      try {
        const res = await fetch('/api/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'ui-overrides', store })
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
    const _btnPlay = document.getElementById('btn-play-game') || document.getElementById('btn-play-game-disabled');
    if (_btnPlay) _btnPlay.addEventListener('click', () => {
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

    // §D19_P0§ Hierarchy toolbar wiring.
    (function bindHierarchyToolbar() {
      // §D19_P6§ +Group sunset from toolbar — grouping is drag-drop only now.
      // Handler kept for backwards compat (button removed from HTML).
      const addG = document.getElementById('btn-add-group');
      if (addG) addG.addEventListener('click', createGroupNode);
      // §D19_P4§ Composable node toolbar buttons.
      const addB = document.getElementById('btn-add-button');
      if (addB) addB.addEventListener('click', createButtonNode);
      const addI = document.getElementById('btn-add-image');
      if (addI) addI.addEventListener('click', createImageNode);
      const addT = document.getElementById('btn-add-text');
      if (addT) addT.addEventListener('click', createTextNode);
      // §D19_P6§ +Toggle / +Empty toolbar buttons.
      const addTg = document.getElementById('btn-add-toggle');
      if (addTg) addTg.addEventListener('click', createToggleNode);
      const addE = document.getElementById('btn-add-empty');
      if (addE) addE.addEventListener('click', createEmptyNode);
      const reparentRoot = document.getElementById('btn-reparent-root');
      if (reparentRoot) reparentRoot.addEventListener('click', () => {
        if (selectedElementId) reparentNode(selectedElementId, null);
      });
    })();

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

    // §D19§ Per-section Copy/Paste pairs. Each section's pair targets its
    // own slot in the multi-slot clipboards object. Paste hidden by default
    // and revealed by refreshClipboardUI() when its scope's slot is non-null.
    const wire = (id, fn) => { const b = document.getElementById(id); if (b) b.addEventListener('click', fn); };
    wire('btn-copy-position',   copyPosition);
    wire('btn-paste-position',  pastePosition);
    wire('btn-copy-size',       copySize);
    wire('btn-paste-size',      pasteSize);
    wire('btn-copy-style',      copyStyle);
    wire('btn-paste-style',     pasteStyle);
    wire('btn-copy-percourse',  copyPerCourse);
    wire('btn-paste-percourse', pastePerCourse);
    wire('btn-copy-full',       copyFull);
    wire('btn-paste-full',      pasteFull);
    refreshClipboardUI();

    // Cross-tab sync: another ui-editor tab copied → reload + re-evaluate.
    window.addEventListener('storage', (ev) => {
      if (ev.key !== CLIPBOARD_KEY && ev.key !== LEGACY_CLIPBOARD_KEY) return;
      clipboards = loadClipboards();
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

  // §P7§ Seed all parent-capable nodes as collapsed on first ever load.
  // "First ever load" = no gpc_ui_tree_collapsed_inited key in localStorage.
  // Persisted state from prior sessions wins; this only fires once per browser.
  function _seedInitialCollapse() {
    try {
      if (localStorage.getItem(TREE_COLLAPSE_INIT_KEY)) return; // already inited
      // Collapse all SCREENS parents (buttons/toggles) and dynamic-kind nodes
      // that accept children.
      for (const screen of SCREENS) {
        for (const el of screen.elements) {
          if (el.kind === 'button' || el.kind === 'toggle' || el.kind === 'group' || el.kind === 'empty') {
            _collapsedNodes[el.id] = 1;
          }
        }
      }
      localStorage.setItem(TREE_COLLAPSE_KEY, JSON.stringify(_collapsedNodes));
      localStorage.setItem(TREE_COLLAPSE_INIT_KEY, '1');
    } catch (_) {}
  }

  // §P7§ Panel resize — drag handles on right edge of .col.left and left
  // edge of .col.right. Widths persisted to localStorage.
  const PANEL_WIDTHS_KEY = 'gpc_ui_editor_panel_widths';
  const PANEL_LEFT_MIN = 180, PANEL_LEFT_MAX = 480;
  const PANEL_RIGHT_MIN = 240, PANEL_RIGHT_MAX = 600;
  function _loadPanelWidths() {
    try {
      const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') return obj;
      }
    } catch (_) {}
    return {};
  }
  function _savePanelWidths(left, right) {
    try { localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify({ left, right })); } catch (_) {}
  }
  function _applyPanelWidths(left, right) {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    shell.style.gridTemplateColumns = `${left}px minmax(0, 1fr) ${right}px`;
  }
  function initPanelResize() {
    const saved = _loadPanelWidths();
    let leftW  = Math.max(PANEL_LEFT_MIN,  Math.min(PANEL_LEFT_MAX,  Number(saved.left)  || 240));
    let rightW = Math.max(PANEL_RIGHT_MIN, Math.min(PANEL_RIGHT_MAX, Number(saved.right) || 320));
    _applyPanelWidths(leftW, rightW);

    const leftCol  = document.querySelector('.col.left');
    const rightCol = document.querySelector('.col.right');
    if (!leftCol || !rightCol) return;

    function _makeHandle(col, side) {
      const h = document.createElement('div');
      h.className = 'col-resize-handle';
      col.appendChild(h);
      let startX = 0, startW = 0, dragging = false;
      h.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        dragging = true;
        startX = ev.clientX;
        startW = side === 'left' ? leftW : rightW;
        h.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        function onMove(mev) {
          if (!dragging) return;
          const delta = mev.clientX - startX;
          if (side === 'left') {
            leftW = Math.max(PANEL_LEFT_MIN, Math.min(PANEL_LEFT_MAX, startW + delta));
          } else {
            rightW = Math.max(PANEL_RIGHT_MIN, Math.min(PANEL_RIGHT_MAX, startW - delta));
          }
          _applyPanelWidths(leftW, rightW);
        }
        function onUp() {
          dragging = false;
          h.classList.remove('dragging');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          _savePanelWidths(leftW, rightW);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }
    _makeHandle(leftCol, 'left');
    _makeHandle(rightCol, 'right');
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
    _seedInitialCollapse();
    initPanelResize();
    renderScreenTabs();
    renderElementList();
    renderProps();
    renderPreview();
    swapPreviewIframeForScreen(activeScreenId);
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
            onRedo: undo.redo
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
