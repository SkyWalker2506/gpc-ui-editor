// gpc-ui-editor — glue layer that lived inline in ui-editor.html.
// Extracted to submodule per user directive: editor logic stays in submodule.
//
// Three blocks below: viewport+zoom picker, D19 single-source-of-truth pane
// swap (legacy Style vs Layers + dirty title prefix), and EditorShell mount
// fallback safety net.

/* §VIEWPORT_PICKER§ Drives .preview-frame's CSS vars from the toolbar select.
   Game canvas widens with viewport aspect (resizeCanvas in game.js), so the
   iframe that hosts the preview honors its own innerWidth/innerHeight — i.e.
   resizing this frame == previewing that resolution. Persisted to localStorage
   so the choice survives reloads. */
(function () {
  'use strict';
  var KEY = 'gpc_ui_editor_viewport';
  var sel = document.getElementById('viewport-preset');
  var custom = document.getElementById('viewport-custom');
  var frame = document.getElementById('preview-frame');
  if (!sel || !frame) return;

  function apply (w, h) {
    if (!isFinite(w) || !isFinite(h) || w < 80 || h < 60) return;
    // Only the aspect-ratio var changes; the frame's on-screen footprint
    // stays bounded by CSS so resizing the preset doesn't elbow the side
    // panels. Pixel resolution is communicated by the picker label.
    document.documentElement.style.setProperty('--preview-aspect', w + ' / ' + h);
  }

  function parsePair (s) {
    if (!s) return null;
    var m = String(s).trim().toLowerCase().match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/);
    if (!m) return null;
    return { w: +m[1], h: +m[2] };
  }

  function persist (val, customStr) {
    try { localStorage.setItem(KEY, JSON.stringify({ val: val, custom: customStr || '' })); }
    catch (_) {}
  }
  function restore () {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || !obj.val) return;
      // Only accept val if option exists, else fall back to default.
      var has = false;
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === obj.val) { has = true; break; }
      }
      if (!has) return;
      sel.value = obj.val;
      if (obj.val === 'custom' && obj.custom) {
        custom.value = obj.custom;
      }
    } catch (_) {}
  }

  function refresh () {
    var v = sel.value;
    if (v === 'custom') {
      custom.style.display = '';
      var pair = parsePair(custom.value);
      if (pair) apply(pair.w, pair.h);
      persist(v, custom.value);
      return;
    }
    custom.style.display = 'none';
    var pair2 = parsePair(v);
    if (pair2) apply(pair2.w, pair2.h);
    persist(v, '');
  }

  restore();
  refresh();
  sel.addEventListener('change', refresh);
  custom.addEventListener('input', refresh);

  // §ZOOM§ Unity Game-window-style scale slider — pure CSS transform on
  // .preview-frame (logical resolution unchanged). Persisted to localStorage.
  var ZOOM_KEY = 'gpc_ui_editor_zoom';
  var zoom = document.getElementById('zoom-slider');
  var zoomVal = document.getElementById('zoom-val');
  if (zoom && zoomVal) {
    function applyZoom(v) {
      v = Math.max(0.25, Math.min(2, parseFloat(v) || 1));
      document.documentElement.style.setProperty('--preview-scale', String(v));
      zoomVal.textContent = Math.round(v * 100) + '%';
      try { localStorage.setItem(ZOOM_KEY, String(v)); } catch (_) {}
    }
    try {
      var saved = parseFloat(localStorage.getItem(ZOOM_KEY) || '1');
      if (isFinite(saved)) zoom.value = String(saved);
    } catch (_) {}
    applyZoom(zoom.value);
    zoom.addEventListener('input', function () { applyZoom(zoom.value); });
  }
})();
(function () {
  'use strict';
  var STORAGE_KEY = 'gpc_ui_overrides';
  var TITLE_BASE = document.title;
  var legacyGroup = document.getElementById('legacy-style-group');
  var layersSection = document.getElementById('layers-section');
  var banner = document.getElementById('legacy-disabled-banner');
  var resetLegacyBtn = document.getElementById('btn-reset-to-legacy');
  var convertBtn = document.getElementById('btn-convert-to-layers');
  var layersList = document.getElementById('layers-list');
  if (!legacyGroup || !layersSection || !banner || !layersList) return;

  // Has-layers detection: ui-editor.js renders <div class="el-item"> rows into
  // #layers-list when layers exist, and a single <div class="empty-pane"> when
  // empty. We just count the layer rows.
  function hasLayersInDom() {
    return layersList.querySelectorAll('.el-item').length > 0;
  }

  function syncPane() {
    var active = hasLayersInDom();
    legacyGroup.classList.toggle('is-hidden', active);
    banner.style.display = active ? '' : 'none';
    layersSection.classList.toggle('is-empty', !active);
  }

  // Observe the layers-list for any re-render — ui-editor.js wipes innerHTML
  // and re-builds it on every selection / store mutation, so a subtree+
  // childList observer catches every transition.
  var mo = new MutationObserver(syncPane);
  mo.observe(layersList, { childList: true, subtree: true });
  // Initial pass after first paint (ui-editor.js boots on DOMContentLoaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(syncPane, 0); });
  } else {
    setTimeout(syncPane, 0);
  }
  // Cross-tab sync: another tab edited the store → our DOM will re-render but
  // a defensive sync keeps the banner truthful even if observers miss it.
  window.addEventListener('storage', function (ev) {
    if (ev.key === STORAGE_KEY || ev.key === 'gpc_ui_overrides_updated_at') {
      setTimeout(syncPane, 50);
    }
  });

  // Reset-to-legacy: clears every composite layer on the selected element by
  // synthesising clicks on the per-row delete (✕) buttons that ui-editor.js
  // already wires. This avoids reaching into the submodule's private store —
  // we just drive its public DOM affordances. After the last delete the
  // layers-list goes empty, the legacy Style group reappears, and the
  // submodule's own undo history records each delete (so Cmd+Z restores).
  function clearLayersViaUI() {
    // Each layer row contains <button data-act="del">. The submodule's click
    // handler removes the layer + re-renders #layers-list, so we re-query
    // after every click rather than caching the NodeList.
    var safety = 50;
    while (safety-- > 0) {
      var del = document.querySelector('#layers-list .el-item button[data-act="del"]');
      if (!del) break;
      del.click();
    }
    if (window.EditorShell && typeof window.EditorShell.toast === 'function') {
      window.EditorShell.toast('Layers cleared — legacy controls re-enabled', 'info');
    }
  }
  if (resetLegacyBtn) {
    resetLegacyBtn.addEventListener('click', function () {
      if (!document.querySelector('#layers-list .el-item')) return;
      if (!confirm('Wipe composite layers and restore the legacy Background / Icon / Font controls for this button?')) return;
      clearLayersViaUI();
    });
  }
  // "+ Convert to layers" → just click the existing add-sprite-layer button.
  // ui-editor.js's addLayer() seeds in-code defaults on first add, so this
  // gives the user an editable starting point instead of a blank overlay.
  if (convertBtn) {
    convertBtn.addEventListener('click', function () {
      var addBtn = document.getElementById('btn-add-sprite-layer');
      if (addBtn) addBtn.click();
    });
  }

  // §DIRTY_TITLE_MIRROR§ Patch EditorShell.markDirty/markClean so the tab
  // title gains/loses a leading "* " — gives the user an at-a-glance signal
  // even when the editor tab is in the background.
  function applyTitle(dirty) {
    var want = (dirty ? '* ' : '') + TITLE_BASE;
    if (document.title !== want) document.title = want;
  }
  function patchShell() {
    if (!window.EditorShell) return false;
    var origDirty = window.EditorShell.markDirty;
    var origClean = window.EditorShell.markClean;
    if (typeof origDirty !== 'function' || typeof origClean !== 'function') return false;
    if (window.EditorShell.__d19TitlePatched) return true;
    window.EditorShell.markDirty = function () {
      var r = origDirty.apply(this, arguments);
      applyTitle(true);
      // Cross-tab dirty mirror for ui-editor-test.html.
      try { localStorage.setItem('gpc_ui_dirty', '1'); } catch (e) {}
      return r;
    };
    window.EditorShell.markClean = function () {
      var r = origClean.apply(this, arguments);
      applyTitle(false);
      try { localStorage.setItem('gpc_ui_dirty', '0'); } catch (e) {}
      return r;
    };
    // Publish-success detector: ui-editor.js calls flashToast('Published — <sha>')
    // (or 'Published') on a successful /api/publish. Hooking the toast lets us
    // stamp `gpc_ui_overrides_published_at` without modifying the submodule.
    var origToast = window.EditorShell.toast;
    if (typeof origToast === 'function') {
      window.EditorShell.toast = function (msg, type, opts) {
        try {
          if (typeof msg === 'string' && /^Published(\b|$| —)/.test(msg)) {
            localStorage.setItem('gpc_ui_overrides_published_at', String(Date.now()));
          }
        } catch (e) {}
        return origToast.apply(this, arguments);
      };
    }
    window.EditorShell.__d19TitlePatched = true;
    return true;
  }
  // EditorShell is loaded with `defer`, so it's likely ready immediately.
  // Retry a few times in case the editor mounts asynchronously.
  (function tryPatch(n) {
    if (patchShell()) return;
    if (n > 20) return;
    setTimeout(function () { tryPatch(n + 1); }, 50);
  })(0);

  // §D19_PASS2_TOPBAR_MORE§ Inject a "⋯ More" toggle into the shell topbar
  // that reveals Import/Export/Reset/Live/Help. Always-visible cluster shrinks
  // to: Undo, Redo, Save, Publish, Play, More, FAB Test = 7 buttons.
  function injectMore() {
    var host = document.getElementById('editor-shell-topbar');
    if (!host) return false;
    var actions = host.querySelector('.es-actions');
    if (!actions) return false;
    if (host.querySelector('.d19-more-toggle')) return true;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'd19-more-toggle';
    btn.textContent = '⋯';
    btn.title = 'More actions: Import / Export / Reset / Live / Shortcuts';
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var open = host.classList.toggle('d19-more-open');
      btn.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Close when clicking outside.
    document.addEventListener('click', function (ev) {
      if (!host.classList.contains('d19-more-open')) return;
      if (host.contains(ev.target)) return;
      host.classList.remove('d19-more-open');
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    });
    actions.appendChild(btn);
    return true;
  }
  (function tryMore(n) {
    if (injectMore()) return;
    if (n > 30) return;
    setTimeout(function () { tryMore(n + 1); }, 50);
  })(0);

  // §D19_PASS3§ Top-of-pane global Copy/Paste + checkboxes removed — replaced
  // by per-section Copy/Paste pill rows wired in ui-editor.js (multi-slot
  // clipboards: position | style | perCourse | full).
})();
  (function () {
    function fallbackMount () {
      if (!window.EditorShell) return;
      // Safety net: if ui-editor.js failed to mount (e.g. UndoStack missing),
      // ensure the topbar still renders so users aren't stranded.
      setTimeout(function () {
        if (document.querySelector('#editor-shell-topbar .es-topbar')) return;
        window.EditorShell.mount({
          title: 'Edit UI',
          subtitle: 'Reposition, resize and re-skin menu / in-game UI buttons.',
          page: 'ui', actions: {}
        });
      }, 0);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fallbackMount);
    else fallbackMount();
  })();
