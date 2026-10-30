# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DebugSlicer is a VS Code extension for debugging processing steps by viewing the image data held in variables during a Python debug session: RGB, ARGB and mono 2D images, plus voxel volumes. It is a general debugging utility, not a medical tool, so physical spacing and other scan metadata are out of scope. Opening the viewer must stay fast, so expensive features are opt-in. It is currently a proof of concept. `README.md` and `vsc-extension-quickstart.md` are unedited scaffold text.

Planned features and sprint order are in `docs/ROADMAP.md`.

## Commands

```bash
npm run compile        # type-check, lint, then bundle to dist/
npm run watch          # esbuild and tsc in watch mode (default VS Code build task)
npm run check-types    # tsc --noEmit
npm run lint           # eslint src
npm run package        # production bundle

npm run test:unit                     # logic tests in src/test/unit/, no VS Code needed
npm test                              # compiles to out/, then runs src/test/*.test.ts in a downloaded VS Code
npx vscode-test --grep "reuses"       # single VS Code test by name; run `npm run compile-tests` first
```

Unit tests use `node:test`, and VS Code tests use mocha's TDD globals. Code that doesn't need `vscode` or the DOM should stay importable from unit tests.

## Manual testing

1. Press F5 with the "Run Extension" launch config. It starts the watch task and opens `test_project/` in an Extension Development Host.
2. In that window, run the "Run test" config on `test_project/test.py`. The script needs `numpy`, `torch`, `pillow` and `nibabel`, and uses paths relative to `test_project/`.
3. The script raises on purpose so that its locals stay inspectable. Choose the sample by switching the call at the bottom of the file: `argb_image()` or `volume()`.
4. In the Variables pane, right-click a variable and choose "View with DebugSlicer".

The "Run colormap test" config runs `test_project/test_colormaps.py` instead, which only needs `numpy`. It holds continuous volumes and integer label volumes whose shapes touch, for testing colormaps and the 3D render.

Open tabs keep the old webview script, so reopen the panel after a webview change. Changes in `src/` outside `src/webview/` need the Development Host to be reloaded.

## Architecture

Data moves through three stages, using a `.npy` file in the temp directory as the transfer format:

1. **Debuggee (`src/extension.ts`, `src/pythonExpression.ts`).** The `debugslicer.view` command sends a DAP `evaluate` request for the frame selected in the UI. Its single Python expression runs inside the user's process, converts the value to NumPy and saves it to a path the extension chose. It requires NumPy in the debuggee and assumes a Python debugger.
2. **Extension host (`src/viewer.ts`).** `DebugSlicerPanel` keeps one webview panel per variable, keyed by source file, function name and expression so that a variable finds its tab again in a later debug run. It waits for the webview's `ready` message, then posts `loadNpy` with the file's webview URI. The array data never goes through `postMessage`. Each panel owns its temp file and deletes it on close.
3. **Webview (`src/webview/`, bundled to `dist/viewer.js`; markup in `media/viewer.html`, styles in `media/viewer.css`).** `loader.ts` fetches the file and `npy.ts` parses it into a typed array with strides. `slice.ts` holds the pure axis model, indexing and rendering logic. `axesPanel.ts` builds the per-dimension table. `view.ts` is one image with its caption, slider and buttons, using `viewport.ts` for fit, pan, zoom and crosshair through CSS transforms and `screenshot.ts` for clipboard capture. `main.ts` holds the state and connects these to the DOM.

Each dimension has a role: `H`, `W`, `D` (slice axis), `c` (colour channel) or `const` (held at an index). `H`, `W`, `D` and `c` belong to one dimension at most, so choosing a taken role swaps roles. Colour (2 to 4 channels: gray+alpha, RGB, RGBA) only applies to 2D images, so `c` acts as a constant while `D` is assigned. Dimensions of size 1 start as `const`.

With `H`, `W` and `D` all assigned, three views (`PLANES` in `slice.ts`) show the array, otherwise one does. A dimension's `index` is the shared position: a view shows two axes across its image and holds the others at their index, so moving one view's position re-slices the other views. Display ranges are computed once per load over the whole array and cached per channel arrangement, so every slice and view agree.

If the webview runs out of memory, it posts `loadTooLarge`. The panel then has the debuggee re-save the variable at a smaller type and reloads it with a warning, once only.

## Things to keep in sync

- The supported type list exists both as `SUPPORTED_TYPE_PATTERN` in `src/pythonExpression.ts` and in the menu's `when` clause in `package.json`, because a `when` clause can't import code. A unit test fails if they differ.
- The webview's CSP allows styles only from the extension's own files. Set styles from script through `element.style` (allowed), never through inline `style` attributes or `<style>` tags in markup.
- Plain Chrome has no VS Code theme variables, so previewing `media/viewer.html` outside VS Code needs them defined (fonts, colours and borders otherwise look unstyled).
- The checkerboard colours exist in both `media/viewer.css` and `src/webview/screenshot.ts`, so that screenshots match the view.
