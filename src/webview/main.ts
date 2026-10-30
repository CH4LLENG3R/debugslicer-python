import { createAxesPanel } from './axesPanel';
import {
    AUTO_ID, autoColormap, buildMapper, Colormap, ColorMapper, findLabels, PRESETS, Preferences, sanitizePreferences,
} from './colormap';
import { createColormapEditor } from './colormapEditor';
import { loadNpy } from './loader';
import { dtypeName, NpyArray } from './npy';
import {
    Axis, AxisRole, centerPositions, clampIndex, colorHint, defaultAxes, DisplayRanges, displayRanges, isVolume, pixelColor, pixelCoords,
    PLANES, readPixel, renderSlice, sliceLayout, SliceLayout,
} from './slice';
import { createView } from './view';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscode = acquireVsCodeApi();

const shapeDisplay = document.getElementById('shape-display')!;
const warningBanner = document.getElementById('warning')!;
const hint = document.getElementById('hint')!;
const captionField = document.getElementById('caption-field')!;
const captionSelect = document.getElementById('caption-select') as HTMLSelectElement;
const interpolationSelect = document.getElementById('interpolation-select') as HTMLSelectElement;
const colormapField = document.getElementById('colormap-field')!;
const colormapSelect = document.getElementById('colormap-select') as HTMLSelectElement;
const viewsContainer = document.getElementById('views')!;
const crosshairField = document.getElementById('crosshair-field')!;
const crosshairToggle = document.getElementById('crosshair-toggle') as HTMLInputElement;
const statusPosition = document.getElementById('status-position')!;
const statusValue = document.getElementById('status-value')!;
const statusSwatch = document.getElementById('status-swatch')!;
const swatchColor = document.getElementById('swatch-color')!;
const toast = document.getElementById('toast')!;

let array: NpyArray | undefined;
let axes: Axis[] = [];
let layouts: (SliceLayout | undefined)[] = [];
let lastShape: number[] = [];
let latestLoad = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
// Changes with every load, so that views redraw even if the new data has the same layout.
let generation = 0;
// Scanning the whole array is the slowest step, so each channel arrangement only does it once per load.
let rangesCache = new Map<string, DisplayRanges>();
let preferences: Preferences = sanitizePreferences(undefined);
let selectedColormap = AUTO_ID;
// Changes with the chosen colormap, so that views redraw in the new colours.
let colormapVersion = 0;
// Only worked out when first needed, and then kept until the next load. Undefined labels means there are none.
let analysed: { labels: number[] | undefined } | undefined;
let mapper: ColorMapper | undefined;

const colormapEditor = createColormapEditor({
    onSave(map) {
        const others = preferences.colormaps.filter(existing => existing.id !== map.id);
        savePreferences({ ...preferences, colormaps: [...others, map] });
        selectColormap(map.id);
    },
    onDelete(id) {
        savePreferences({ ...preferences, colormaps: preferences.colormaps.filter(map => map.id !== id) });
        selectColormap(AUTO_ID);
    },
});

const views = PLANES.map((plane, i) => createView(
    document.getElementById('view-template') as HTMLTemplateElement,
    viewsContainer,
    {
        onPlainWheel: () => {
            // On a narrow window the views stack up, and the wheel is needed to scroll through them.
            if (viewsContainer.scrollHeight <= viewsContainer.clientHeight) {
                showToast('Hold Ctrl and scroll to zoom. Hold Ctrl and drag to pan.');
            }
        },
        onHover: (y, x) => showPixel(i, y, x),
        onLeave: clearPixel,
        onPick: (y, x) => {
            if (isVolume(axes)) {
                setPositions([[plane.row, y], [plane.col, x]]);
            }
        },
        onSlice: index => setPositions([[plane.slice, index]]),
        onScreenshot: () => takeScreenshot(i),
    }
));

const axesPanel = createAxesPanel(document.getElementById('dim-table')!, {
    onChange(newAxes, change) {
        const enteredVolume = !isVolume(axes) && isVolume(newAxes);
        axes = newAxes;
        if (enteredVolume && array) {
            axes = centerPositions(array.shape, axes);
            axesPanel.render(array.shape, axes);
        }
        redraw(change === 'roles');
    },
});

window.addEventListener('message', async (event) => {
    const message = event.data;
    if (message.command === 'loadNpy') {
        await load(message.uri, message.warning);
    } else if (message.command === 'showError') {
        shapeDisplay.textContent = message.message;
    } else if (message.command === 'preferences') {
        applyPreferences(sanitizePreferences(message.preferences));
    }
});

captionSelect.addEventListener('change', () => {
    savePreferences({ ...preferences, captions: captionSelect.value === 'planes' ? 'planes' : 'names' });
    redraw(false);
});
colormapSelect.addEventListener('change', () => selectColormap(colormapSelect.value));
document.getElementById('colormap-edit')!.addEventListener('click', () => {
    const current = currentColormap();
    const isSaved = preferences.colormaps.some(map => map.id === current.id);
    colormapEditor.open(
        isSaved ? current : { ...current, id: `custom-${Date.now()}`, name: `${current.name} copy` },
        isSaved
    );
});
crosshairToggle.addEventListener('change', () => {
    views.forEach(view => view.setCrosshairVisible(crosshairToggle.checked));
});
interpolationSelect.addEventListener('change', () => {
    views.forEach(view => view.setSmooth(interpolationSelect.value === 'bilinear'));
});

renderColormapOptions();
vscode.postMessage({ command: 'ready' });

async function load(uri: string, warning?: string) {
    const thisLoad = ++latestLoad;
    // Free the previous array first, in case both wouldn't fit in memory at once.
    array = undefined;
    rangesCache = new Map();
    analysed = undefined;
    mapper = undefined;
    showWarning(warning);

    const result = await loadNpy(uri);
    if (thisLoad !== latestLoad) {
        return;
    }

    if (result.kind === 'tooLarge') {
        shapeDisplay.textContent = 'Array too large to load, trying a smaller type...';
        vscode.postMessage({ command: 'loadTooLarge', error: result.error });
    } else if (result.kind === 'error') {
        shapeDisplay.textContent = 'Failed to load array: ' + result.error;
    } else {
        showArray(result.array);
    }
}

function showArray(loaded: NpyArray) {
    array = loaded;
    generation++;
    shapeDisplay.textContent = `Shape [${loaded.shape.join(', ')}] · ${dtypeName(loaded.dtype)}`;

    // Reopening a variable with the same shape keeps the axis roles and view position.
    const sameShape = loaded.shape.join() === lastShape.join() && axes.length > 0;
    lastShape = loaded.shape;
    if (!sameShape) {
        axes = defaultAxes(loaded.shape);
        axesPanel.render(loaded.shape, axes);
    }
    redraw(!sameShape);
}

function showWarning(warning?: string) {
    warningBanner.textContent = warning ?? '';
    warningBanner.hidden = !warning;
}

function redraw(refit: boolean) {
    if (!array) {
        return;
    }
    const loaded = array;
    const volume = isVolume(axes);
    captionField.hidden = !volume;
    crosshairField.hidden = !volume;

    // Which views are shown decides how wide each one is, so settle that before any of them fits its image.
    views.forEach((view, i) => view.setVisible(i === 0 || volume));

    views.forEach((view, i) => {
        const plane = PLANES[i];
        const visible = i === 0 || volume;
        const layout = visible ? sliceLayout(loaded.shape, loaded.strides, axes, plane) : undefined;
        layouts[i] = layout;
        if (!visible) {
            return;
        }

        view.setCaption(volume ? caption(plane.name, plane.row, plane.col) : 'Image');
        view.setSlice(volume ? slicePosition(loaded, plane.slice) : undefined);
        view.setCrosshair(volume && layout ? [
            clampIndex(axes[layout.rowDim].index, layout.height),
            clampIndex(axes[layout.colDim].index, layout.width),
        ] : undefined);
        view.draw(layout, `${generation}|${colormapVersion}|${JSON.stringify(layout)}`, () => renderSlice(
            loaded.data,
            layout!,
            rangesFor(loaded, layout!),
            layout!.channels === 1 ? mapperFor(loaded, layout!) : undefined
        ));
        if (refit) {
            view.fit();
        }
    });

    updateHint(loaded, layouts[0]);
    updateColormapField(loaded);
}

// The colormap only applies when no colour channels are in use.
function updateColormapField(loaded: NpyArray) {
    const usesColormap = layouts[0]?.channels === 1;
    colormapField.hidden = !usesColormap;
    if (!usesColormap) {
        colormapEditor.close();
        return;
    }
    const auto = colormapSelect.querySelector(`option[value="${AUTO_ID}"]`);
    if (auto) {
        auto.textContent = `Auto (${autoColormap(labelsOf(loaded)).name})`;
    }
}

function labelsOf(loaded: NpyArray): number[] | undefined {
    if (!analysed) {
        const { min, range } = rangesFor(loaded, { channels: 1, stepC: 0 }).color;
        analysed = { labels: findLabels(loaded.data, min, min + range) };
    }
    return analysed.labels;
}

function currentColormap(): Colormap {
    const all = [...PRESETS, ...preferences.colormaps];
    const chosen = all.find(map => map.id === selectedColormap);
    return chosen ?? autoColormap(array ? labelsOf(array) : undefined);
}

function mapperFor(loaded: NpyArray, layout: SliceLayout): ColorMapper {
    if (!mapper) {
        const { min, range } = rangesFor(loaded, layout).color;
        mapper = buildMapper(currentColormap(), min, range, labelsOf(loaded));
    }
    return mapper;
}

function selectColormap(id: string) {
    selectedColormap = id;
    colormapSelect.value = id;
    mapper = undefined;
    colormapVersion++;
    redraw(false);
}

function renderColormapOptions() {
    const option = (id: string, name: string) => {
        const element = document.createElement('option');
        element.value = id;
        element.textContent = name;
        return element;
    };
    const group = (label: string, maps: Colormap[]) => {
        const element = document.createElement('optgroup');
        element.label = label;
        element.append(...maps.map(map => option(map.id, map.name)));
        return element;
    };
    colormapSelect.replaceChildren(
        option(AUTO_ID, 'Auto'),
        group('Presets', PRESETS),
        ...(preferences.colormaps.length ? [group('Saved', preferences.colormaps)] : [])
    );
    colormapSelect.value = selectedColormap;
}

function applyPreferences(next: Preferences) {
    preferences = next;
    captionSelect.value = next.captions;
    if (selectedColormap !== AUTO_ID && ![...PRESETS, ...next.colormaps].some(map => map.id === selectedColormap)) {
        selectedColormap = AUTO_ID;
    }
    renderColormapOptions();
    mapper = undefined;
    colormapVersion++;
    redraw(false);
}

// The extension stores these, and passes them to the other open tabs.
function savePreferences(next: Preferences) {
    preferences = next;
    renderColormapOptions();
    vscode.postMessage({ command: 'savePreferences', preferences: next });
}

function caption(name: string, row: AxisRole, col: AxisRole): string {
    return captionSelect.value === 'planes' ? `${row}×${col}` : name;
}

function slicePosition(loaded: NpyArray, role: AxisRole) {
    const dim = axes.findIndex(axis => axis.role === role);
    return { index: clampIndex(axes[dim].index, loaded.shape[dim]), last: loaded.shape[dim] - 1 };
}

function rangesFor(loaded: NpyArray, layout: Pick<SliceLayout, 'channels' | 'stepC'>): DisplayRanges {
    const key = `${layout.channels}|${layout.stepC}`;
    let ranges = rangesCache.get(key);
    if (!ranges) {
        ranges = displayRanges(loaded.data, layout.channels, layout.stepC, /u1$/.test(loaded.dtype));
        rangesCache.set(key, ranges);
    }
    return ranges;
}

// Moves the linked views: a view's slice is the position along the axis it doesn't show.
function setPositions(positions: [AxisRole, number][]) {
    positions.forEach(([role, index]) => {
        const dim = axes.findIndex(axis => axis.role === role);
        axes = axes.map((axis, i) => i === dim ? { ...axis, index } : axis);
        axesPanel.setIndex(dim, index);
    });
    redraw(false);
}

function updateHint(loaded: NpyArray, layout: SliceLayout | undefined) {
    const messages: string[] = [];
    if (!layout) {
        messages.push(loaded.shape.length < 2
            ? 'An image needs at least 2 dimensions.'
            : 'Set one dimension to H and one to W to draw an image.');
    }
    const color = colorHint(loaded.shape, axes);
    if (color) {
        messages.push(color);
    }
    hint.textContent = messages.join(' ');
    hint.hidden = messages.length === 0;
}

function formatValue(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function isInside(layout: SliceLayout | undefined, y: number, x: number): boolean {
    return !!layout && x >= 0 && x < layout.width && y >= 0 && y < layout.height;
}

function showPixel(viewIndex: number, y: number, x: number) {
    const layout = layouts[viewIndex];
    if (!array || !layout || !isInside(layout, y, x)) {
        clearPixel();
        return;
    }

    const values = readPixel(array.data, layout, y, x);
    const shown = values.map(formatValue);
    const [r, g, b, a] = pixelColor(values, rangesFor(array, layout), layout.channels === 1 ? mapperFor(array, layout) : undefined);
    statusPosition.textContent = `[${pixelCoords(axes, layout, y, x).join(', ')}]`;
    statusValue.textContent = shown.length > 1 ? `[${shown.join(', ')}]` : shown[0];
    swatchColor.style.backgroundColor = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    statusSwatch.hidden = false;
}

function clearPixel() {
    statusPosition.textContent = '--';
    statusValue.textContent = '--';
    statusSwatch.hidden = true;
}

async function takeScreenshot(viewIndex: number) {
    const name = captionSelect.value === 'planes' || !isVolume(axes) ? 'view' : PLANES[viewIndex].name.toLowerCase() + ' view';
    try {
        await views[viewIndex].copyToClipboard();
        showToast(`Screenshot of the ${name} copied to the clipboard.`);
    } catch (error) {
        showToast(`Could not copy the screenshot: ${error instanceof Error ? error.message : error}`);
    }
}

function showToast(message: string) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}
