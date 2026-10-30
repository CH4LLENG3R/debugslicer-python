# DebugSlicer roadmap

Status: Sprints 1 to 4 and large array loading are done. Sprint 5 is next.

## Product direction

DebugSlicer is a utility for debugging processing steps by looking at the arrays and images in them. It handles MRI and CT volumes, but it is not a medical tool.

- Physical spacing, orientation and other scan metadata are out of scope for now.
- NIfTI and DICOM objects don't need to open from debug variables.
- Opening NumPy and NIfTI files from the Explorer is a nice-to-have.
- Opening the window must stay fast, so anything expensive is opt-in.
- Very large data isn't a design driver yet. If an array can't be loaded, reduce its type and warn the user in the tab.

## Requested features

| # | Request | Sprint | Status |
|---|---------|--------|--------|
| F1 | Constant role for a dimension, with a chosen index. Dimensions of size 1 become constant at 0 automatically | 2 | ✅ Done |
| F2 | Axial, sagittal and coronal views for volumes, with switchable captions | 3 | ✅ Done |
| F3 | Position and value readout in a fixed place, shown for whichever view the cursor is in, with a colour swatch next to the value | 3 | ✅ Done |
| F4 | Optional 3D render for segmentations and float images: voxel display, plus edge smoothing with a join/disjoin checkbox | 6 | Planned |
| F5 | Colormaps when no colour channel is chosen: presets or user-defined and saved, continuous or step, with a unique colour per label for segmentations | 4 | ✅ Done |
| F6 | Screenshot button on each view, copying to the clipboard with a confirmation message | 3 | ✅ Done |
| F7 | Open `.npy` and NIfTI files from the Explorer | 5 | Planned |
| F8 | If a file can't be loaded, reduce its type and show a warning in the tab | 1 | ✅ Done |
| F9 | One tab per variable, reusing the previous tab when the same variable is reopened in a later debug run | 1 | ✅ Done |
| F10 | Ctrl + drag pans, plain drag moves the crosshair, and a checkbox shows or hides the crosshair | 3 | ✅ Done |
| F11 | On-screen information that Ctrl pans and zooms | 4 | ✅ Done |
| F12 | Load arrays over 2 GB in pieces, with a progress bar | - | ✅ Done |
| F13 | View MONAI `MetaTensor` variables | - | ✅ Done |
| X1 | Fix the visual appearance of the view | 2 | ✅ Done |
| X2 | Fix colour rendering for the channel dimension, with a gray checkerboard behind alpha | 2 | ✅ Done |
| X3 | Show "View with DebugSlicer" only for accepted types | 1 | ✅ Done |

## Sprints

### ✅ Sprint 1: correct data and a testable base

- Honoured Fortran order and byte order, and added all numeric dtypes.
- Filtered the menu by variable type, and handled tensor subclasses such as `Parameter`.
- Evaluates in the frame selected in the UI, and keeps the image when a tab is hidden.
- One tab per variable, titled `<variable> - DebugSlicer`. A variable is identified by its source file, function name and expression, each tab has its own temp file, and axis roles and view position are kept when the shape is unchanged. Tabs are matched only while they stay open, not after a window reload.
- Re-saves at a smaller type with a warning banner when an array is too large to load.
- Split the viewer into TypeScript modules with unit tests, and excluded `test_project/` from the package.

### ✅ Sprint 2: axis model and visual overhaul

- Added the constant role, automatic for size-1 dimensions, and better default roles.
- RGB, RGBA and gray+alpha rendering with the gray checkerboard, for 2D images only. With a slice axis `D`, the channel is held as a constant and a hint says so.
- Rewrote the HTML and moved the CSS to its own file. Dimensions are laid out as an invisible table, all buttons have the same size, and images open fitted and centred.

### ✅ Sprint 3: multi-view and inspection

- Three linked views open straight away for any image with `H`, `W` and `D`, with a crosshair, one slider per view, and switchable captions.
- A fixed status bar shows position, value and a colour swatch.
- A screenshot button per view captures zoom, pan and interpolation, but not the crosshair.
- Brightness is normalised over the whole array.
- Plain drag moves the crosshair, Ctrl + drag pans, and a checkbox shows or hides the crosshair.

### ✅ Sprint 4: colormaps

- Presets: Gray, Viridis, Magma, Turbo, Cool-warm and Labels.
- Custom colormaps, continuous or step, saved for every workspace along with the caption setting.
- Auto picks unique label colours for up to 64 distinct whole numbers, including floats holding whole numbers, and gray otherwise.
- NaN and infinite values have their own colour.
- The status bar shows that Ctrl pans and zooms, and scrolling without Ctrl says so too.
- Wrote the README, with usage instructions and screenshots.

### ✅ Large arrays and MONAI

- Measured the limits in a real webview: one buffer can't reach 2 GB, and one tab holds about 15.5 GB in total, regardless of free RAM.
- Arrays are read in pieces of up to 512 MB into a `ChunkedArray`, with a progress bar. The smaller-type fallback remains for arrays over the total limit.
- MONAI `MetaTensor` joined the supported types.

### Sprint 5: open from the Explorer (S)

- **F7:** register a custom read-only editor for `.npy`, `.nii` and `.nii.gz`, reusing the existing viewer.
- Add a small NIfTI reader, decompressing with the browser's `DecompressionStream`, with no scan metadata applied.
- There's no debuggee to re-save a smaller type, so a file over the limit of a tab gets a clear error.

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
- A colour bar or label legend next to the views.
- A button to refresh a tab with the variable's current value after stepping.
- Loading slices on demand for arrays over the 15 GB limit of a tab.
