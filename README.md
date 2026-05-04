# gpc-ui-editor

Generic UI button reskin/reposition tool for browser games. WYSIWYG canvas-preview editor that lets a designer override position, size, visibility, icon, font size, background sprite, and layered sprite/text composites of named UI buttons WITHOUT touching game code.

Overrides are persisted to `localStorage` and read by the game runtime at draw time. Per-scope overrides supported via `id@N` keys (e.g. `play.restart@3` for course 3).

Originally extracted from Golf Paper Craft. Project-agnostic — consumes the following globals:

- `window.GPC_ASSETS` — asset library with `.list({anyTag:[...]})`, `.byName(key)`, `.ready()`, `.on('change', cb)`
- `window.UIButtonRender` — composite-layer canvas renderer ([gpc-ui-button-render](https://github.com/SkyWalker2506/gpc-ui-button-render))
- `window.EditorShell` — shared editor topbar/theme shell (optional)
- `window.UndoStack` — undo/redo helper ([gpc-undo-stack](https://github.com/SkyWalker2506/gpc-undo-stack))

## Storage keys

- `gpc_ui_overrides` — main overrides map
- `gpc_ui_clipboard` — copy/paste style buffer

(Schema is preserved for backward compatibility with existing Golf Paper Craft saves; rename in a future version if you fork for a new game.)

## Usage

```html
<script src="./lib/ui-button-render/ui-button-render.js"></script>
<script src="./lib/undo-stack/undo-stack.js"></script>
<script src="./lib/editor-shell/src/editor-shell.js" defer></script>
<script src="./lib/asset-system/asset-library.js"></script>
<!-- after globals are wired -->
<script src="./lib/ui-editor/ui-editor.js"></script>
```

The editor self-mounts on DOMContentLoaded against the page's `#preview-canvas`, palette panel, and inspector. Required DOM ids match the original `ui-editor.html` page in Golf Paper Craft — see that file for the canonical layout.

## Features

- Element list with menu/in-game scope filter
- WYSIWYG canvas preview (drag to move, handle to resize)
- Per-course override scope via `id@N` keys
- Composite layers (sprite + text + 9-point anchors)
- Copy / paste style across elements
- Undo / redo (via `UndoStack`)
- Font picker, font size, weight controls
- Visibility toggle, reset-to-default

## License

MIT
