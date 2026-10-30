# DebugSlicer roadmap

Status: Sprints 1 to 3 are coded and tested, and await a manual check in a real debug session. Sprint 4 is next.

## Product direction

DebugSlicer is a utility for debugging processing steps by looking at the arrays and images in them. It is not a medical tool.

- Physical spacing, orientation and other scan metadata are out of scope for now.
- NIfTI and DICOM objects don't need to open from debug variables.
- Opening NumPy and NIfTI files from the Explorer is a nice-to-have.
- Opening the window must stay fast, so anything expensive is opt-in.
- Very large data isn't a design driver yet. If an array can't be loaded, reduce its type and warn the user in the tab.

## Requested features

| # | Request | Sprint |
|---|---------|--------|
| F1 | Constant role for a dimension, with a chosen index. Dimensions of size 1 become constant at 0 automatically | 2 |
| F2 | Axial, sagittal and coronal views for volumes | 3 |
| F3 | Position and value readout in a fixed place, shown for whichever view the cursor is in, with a colour swatch next to the value | 3 |
| F4 | Optional 3D render for segmentations and float images: voxel display, plus edge smoothing with a join/disjoin checkbox | 6 |
| F5 | Colormaps when no colour channel is chosen: presets or user-defined and saved, continuous or step, with a unique colour per label for segmentations | 4 |
| F6 | Screenshot button on each view, copying to the clipboard with a confirmation message | 3 |
| F7 | Open `.npy` and NIfTI files from the Explorer | 5 |
| F8 | If a file can't be loaded, reduce its type and show a warning in the tab | 1 |
| X1 | Fix the visual appearance of the view | 2 |
| X2 | Fix colour rendering for the channel dimension, with a gray checkerboard behind alpha | 2 |
| X3 | Show "View with DebugSlicer" only for accepted types | 1 |
| F9 | One tab per variable, reusing the previous tab when the same variable is reopened in a later debug run | 1 |

## Plan

Each sprint leaves the extension usable. Sizes are relative: S, M, L.

### Sprint 1: correct data and a testable base (L)

Nothing built later can be trusted until the pixels are right, and the viewer needs splitting up before it grows.

- Honour `fortran_order` and byte order in the `.npy` parser.
- Support all numeric dtypes: `i1`, `i2`, `i8`, `u2`, `u4`, `u8`, `f2`, `b1`. `i8` and `u8` need `BigInt` arrays converted to a form the viewer can use.
- **X3:** filter the menu with a `when` clause on `variableType`, and keep the runtime check as a fallback. The clause only sees the type's name, so it needs an explicit list: `ndarray`, `Tensor`, `Parameter`, `Image` and `*ImageFile`. Restrict it to `debugType == debugpy`.
- Remove `Nifti1Image` from the accepted types, and handle tensor subclasses such as `Parameter`.
- Evaluate in the frame selected in the UI, using `vscode.debug.activeStackItem`, instead of the first thread's top frame.
- Keep the image when the panel is hidden, by restoring it from memory or re-sending the file.
- **F9:** replace the singleton panel with one tab per variable, titled `<variable> - DebugSlicer`.
  - Identify a variable by its source file, function name and expression. Reopening it in a later debug run then reuses its tab, while an `x` in a different function gets its own.
  - Give each tab its own temp file, deleted when the tab closes.
  - When the shape is unchanged, keep the tab's axis roles and view position.
  - Tabs are matched only while they stay open. Reconnecting them after a VS Code window reload is out of scope.
- **F8:** if loading fails, have the debuggee re-save at a smaller type and show a warning banner stating the original and new types. Convert `f8` to `f4`, and `i8`/`u8` to 32-bit when the values fit, otherwise to `f4`.
- Split `viewer.js` into TypeScript modules bundled by a second esbuild entry point: parsing, axis model, rendering, interaction.
- Add unit tests for the parser and slice indexing, which need no VS Code instance.
- Exclude `test_project/` from the `.vsix`, and remove the medical wording from `package.json`.

**Done when:** `mri.nii.gz` renders correctly, an `int16` array shows true values, the menu item is absent on a `str` variable, a forced load failure shows the warning, two variables open in two tabs, and restarting the debug run and reopening a variable returns to its existing tab with the new data.

### Sprint 2: axis model and visual overhaul (M)

- **F1:** add a constant role with its own index control, set automatically for size-1 dimensions. This also replaces today's hidden behaviour of fixing unassigned axes at 0.
- Choose better default roles, for example treating a trailing dimension of size 3 or 4 as `c`.
- **X2:** render RGB and RGBA (and gray+alpha) from the `c` axis, with the gray checkerboard behind transparent pixels. Colour applies to 2D images only (`H`, `W`, `c` and constants). With a slice axis `D`, the channel is held as a constant instead, and a hint says so.
- **X1:** rewrite the HTML with a clear structure and move the CSS to its own file.
  - Lay out dimensions as an invisible table: one column per dimension, with its size on top and its role dropdown or constant value underneath.
  - Make all toolbar buttons the same size, including `+` and `-`.
  - Open images fitted and centred, group the controls, follow the VS Code theme, and scale properly with the panel size.

**Done when:** `noot-noot.png` shows correct colours and transparency, and a `(1, 512, 512)` array opens as an image with no manual setup.

### Sprint 3: multi-view and inspection (M)

- **F2:** show three linked slice views when `H`, `W` and `D` are all assigned, with one slice position per view and a crosshair showing where the others cut. A 3D image opens in this view straight away, and 2D data keeps the single view.
- Add an option to switch the view captions between anatomical names and plane names: axial or `H×W`, coronal or `D×W`, sagittal or `D×H`. The anatomical names are nominal, since no orientation data is used.
- **F3:** add a fixed status bar showing position, value and a colour swatch, updated from whichever view is hovered.
- **F6:** add a screenshot button per view, with a short confirmation message. It captures what the view shows, including zoom and pan, but without the crosshair. Bilinear display is only CSS today, so the capture must redraw it with canvas smoothing.
- Normalise across the whole array rather than per slice, so that brightness is stable and the three views agree. Compute the range once on load.

**Done when:** all three views stay in sync on the MRI sample, and a screenshot pastes correctly into an image editor.

### Sprint 4: colormaps (M)

- **F5:** apply a colormap whenever no `c` axis is assigned, using a lookup table so that redraws stay fast.
- Presets: gray, viridis, magma, turbo, and a categorical label palette.
- An editor for custom colormaps, either continuous (interpolated stops) or step (discrete colours per value).
- Save custom colormaps in the extension's `globalState`, so that they're available in every workspace.
- Auto-select the label palette for integer data with few unique values, giving each label a distinct colour.
- The status bar swatch from Sprint 3 shows the mapped colour.

**Done when:** a segmentation opens with unique label colours, and a custom colormap survives a VS Code restart.

### Sprint 5: open from the Explorer (S)

- **F7:** register a custom read-only editor for `.npy`, `.nii` and `.nii.gz`, reusing the Sprint 1 to 4 viewer.
- Add a small NIfTI reader, decompressing with the browser's `DecompressionStream`, with no scan metadata applied.
- There's no debuggee to re-save a smaller type, so a file too large to load gets a clear error.

**Done when:** double-clicking `test_project/mri.nii.gz` opens it with no debug session running.

### Sprint 6: optional 3D render (L)

Kept last because it is the largest and most self-contained piece, and it depends on the colormaps.

- **F4:** add a "Render 3D" button. The renderer (three.js) goes in a separate bundle that loads only when clicked, and meshing runs in a Web Worker, so normal opening stays as fast as before.
- **Voxel mode:** draw only surface voxels, using instanced cubes.
- **Smooth mode:** build a smoothed surface for each label.
- **Join/disjoin checkbox:** "join" makes neighbouring labels share one seamless boundary. "Disjoin" smooths each label separately, so small gaps can open between them.
- **Float images:** a threshold slider chooses which voxels count as the object, since there are no labels to separate them.
- Colours come from the active colormap. Large volumes are downsampled automatically, with a notice in the tab.

**Done when:** the MRI (with a threshold) and a segmentation both render in both modes, and opening a volume without clicking "Render 3D" takes no longer than before.

## Later ideas

Not requested, and not scheduled:

- Manual value range or window/level control.
- A button to refresh a tab with the variable's current value after stepping.
- Loading slices on demand for very large arrays.
