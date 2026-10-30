import { createAxesPanel } from './axesPanel';
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

const views = PLANES.map((plane, i) => createView(
    document.getElementById('view-template') as HTMLTemplateElement,
    document.getElementById('views')!,
    {
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
    }
});

captionSelect.addEventListener('change', () => redraw(false));
crosshairToggle.addEventListener('change', () => {
    views.forEach(view => view.setCrosshairVisible(crosshairToggle.checked));
});
interpolationSelect.addEventListener('change', () => {
    views.forEach(view => view.setSmooth(interpolationSelect.value === 'bilinear'));
});

vscode.postMessage({ command: 'ready' });

async function load(uri: string, warning?: string) {
    const thisLoad = ++latestLoad;
    // Free the previous array first, in case both wouldn't fit in memory at once.
    array = undefined;
    rangesCache = new Map();
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
        view.draw(layout, `${generation}|${JSON.stringify(layout)}`, () => renderSlice(loaded.data, layout!, rangesFor(loaded, layout!)));
        if (refit) {
            view.fit();
        }
    });

    updateHint(loaded, layouts[0]);
}

function caption(name: string, row: AxisRole, col: AxisRole): string {
    return captionSelect.value === 'planes' ? `${row}×${col}` : name;
}

function slicePosition(loaded: NpyArray, role: AxisRole) {
    const dim = axes.findIndex(axis => axis.role === role);
    return { index: clampIndex(axes[dim].index, loaded.shape[dim]), last: loaded.shape[dim] - 1 };
}

function rangesFor(loaded: NpyArray, layout: SliceLayout): DisplayRanges {
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
    const [r, g, b, a] = pixelColor(values, rangesFor(array, layout));
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
