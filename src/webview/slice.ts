import { buildMapper, ColorMapper, GRAY, unpackColor } from './colormap';
import { ArrayData, asChunked, ChunkedArray } from './npy';

export type AxisRole = 'H' | 'W' | 'D' | 'c' | 'const';

export const AXIS_ROLES: AxisRole[] = ['H', 'W', 'D', 'c', 'const'];

// What a dimension is used for. `index` is where it is held when a view doesn't show it across the image.
export interface Axis {
    role: AxisRole;
    index: number;
}

// Which roles a view shows as rows and columns, and which role it slices along.
export interface Plane {
    name: string;
    row: AxisRole;
    col: AxisRole;
    slice: AxisRole;
}

export const PLANES: Plane[] = [
    { name: 'Axial', row: 'H', col: 'W', slice: 'D' },
    { name: 'Sagittal', row: 'D', col: 'H', slice: 'W' },
    { name: 'Coronal', row: 'D', col: 'W', slice: 'H' },
];

export interface SliceLayout {
    rowDim: number;
    colDim: number;
    height: number;
    width: number;
    // Flat index of pixel (0, 0), and how far one step in y or x moves through the data.
    base: number;
    stepY: number;
    stepX: number;
    // Colour channels sit stepC apart. One channel means grayscale.
    channels: number;
    stepC: number;
}

export interface ValueRange {
    min: number;
    range: number;
}

export interface DisplayRanges {
    color: ValueRange;
    alpha?: ValueRange;
}

export type Rgba = [number, number, number, number];

export function defaultAxes(shape: number[]): Axis[] {
    const roles = shape.map((): AxisRole => 'const');

    // Size-1 dimensions have nothing to show, so they start as constants.
    // Only if that would leave too few to draw an image are some of them used anyway.
    const used = shape.flatMap((size, dim) => size > 1 ? [dim] : []);
    for (let dim = 0; used.length < Math.min(2, shape.length) && dim < shape.length; dim++) {
        if (!used.includes(dim)) {
            used.push(dim);
        }
    }
    used.sort((a, b) => a - b);

    const isColor = used.length === 3 && (shape[used[2]] === 3 || shape[used[2]] === 4);
    const assigned: AxisRole[] = isColor ? ['H', 'W', 'c'] : ['H', 'W', 'D'];
    used.slice(0, assigned.length).forEach((dim, i) => { roles[dim] = assigned[i]; });

    const axes = roles.map(role => ({ role, index: 0 }));
    return isVolume(axes) ? centerPositions(shape, axes) : axes;
}

export function isVolume(axes: Axis[]): boolean {
    return (['H', 'W', 'D'] as AxisRole[]).every(role => axes.some(axis => axis.role === role));
}

// Puts the three linked views in the middle of a volume, where there is usually something to see.
export function centerPositions(shape: number[], axes: Axis[]): Axis[] {
    return axes.map((axis, dim) => ['H', 'W', 'D'].includes(axis.role) ? { ...axis, index: Math.floor(shape[dim] / 2) } : axis);
}

// H, W, D and c are each held by one dimension at most, so picking one that is taken swaps the roles.
export function assignRole(axes: Axis[], dim: number, role: AxisRole): Axis[] {
    const next = axes.map(axis => ({ ...axis }));
    if (role !== 'const') {
        const holder = next.findIndex((axis, i) => i !== dim && axis.role === role);
        if (holder !== -1) {
            next[holder].role = next[dim].role;
        }
    }
    next[dim].role = role;
    return next;
}

export function clampIndex(index: number, size: number): number {
    return Math.min(Math.max(Math.trunc(index) || 0, 0), Math.max(size - 1, 0));
}

// Colour only applies to 2D images (H, W, c and constants). With a slice axis the channel is just a constant.
export function colorChannels(shape: number[], axes: Axis[]): number {
    const dim = axes.findIndex(axis => axis.role === 'c');
    if (dim === -1 || axes.some(axis => axis.role === 'D')) {
        return 1;
    }
    return shape[dim] >= 2 && shape[dim] <= 4 ? shape[dim] : 1;
}

// Whether a dimension is held at an index, which is what the index input edits.
export function usesIndex(shape: number[], axes: Axis[], dim: number): boolean {
    const role = axes[dim].role;
    if (role === 'H' || role === 'W') {
        return isVolume(axes);
    }
    return role === 'const' || role === 'D' || (role === 'c' && colorChannels(shape, axes) === 1);
}

export function colorHint(shape: number[], axes: Axis[]): string | undefined {
    const dim = axes.findIndex(axis => axis.role === 'c');
    if (dim === -1 || colorChannels(shape, axes) > 1) {
        return undefined;
    }
    if (axes.some(axis => axis.role === 'D')) {
        return "Colour is only shown for 2D images, so 'c' acts as a constant while 'D' is assigned.";
    }
    return `A colour channel needs 2 to 4 values, but dimension ${dim} has ${shape[dim]}, so 'c' acts as a constant.`;
}

export function sliceLayout(shape: number[], strides: number[], axes: Axis[], plane: Plane = PLANES[0]): SliceLayout | undefined {
    const rowDim = axes.findIndex(axis => axis.role === plane.row);
    const colDim = axes.findIndex(axis => axis.role === plane.col);
    if (rowDim === -1 || colDim === -1) {
        return undefined;
    }

    const channels = colorChannels(shape, axes);
    let base = 0;
    let stepC = 0;
    axes.forEach((axis, dim) => {
        if (dim === rowDim || dim === colDim) {
            return;
        }
        if (axis.role === 'c' && channels > 1) {
            stepC = strides[dim];
        } else {
            base += clampIndex(axis.index, shape[dim]) * strides[dim];
        }
    });

    return {
        rowDim,
        colDim,
        height: shape[rowDim],
        width: shape[colDim],
        base,
        stepY: strides[rowDim],
        stepX: strides[colDim],
        channels,
        stepC,
    };
}

// The value ranges used for display, over the whole array so that every slice and view agree.
// Grayscale is stretched to its finite min and max. For colour, bytes are taken as 0..255 and
// floats already within 0..1 as 0..1. Anything else is stretched, with alpha separate from colour.
export function displayRanges(data: ArrayData, channels: number, stepC: number, isByte: boolean): DisplayRanges {
    const hasAlpha = channels === 2 || channels === 4;
    if (channels > 1 && isByte) {
        return { color: { min: 0, range: 255 }, alpha: hasAlpha ? { min: 0, range: 255 } : undefined };
    }

    let min = Infinity;
    let max = -Infinity;
    let alphaMin = Infinity;
    let alphaMax = -Infinity;
    const { chunks, chunkLength } = asChunked(data);
    chunks.forEach((chunk, chunkIndex) => {
        const offset = chunkIndex * chunkLength;
        for (let i = 0; i < chunk.length; i++) {
            const val = chunk[i];
            if (!Number.isFinite(val)) {
                continue;
            }
            if (hasAlpha && Math.floor((offset + i) / stepC) % channels === channels - 1) {
                if (val < alphaMin) { alphaMin = val; }
                if (val > alphaMax) { alphaMax = val; }
            } else {
                if (val < min) { min = val; }
                if (val > max) { max = val; }
            }
        }
    });

    return {
        color: channels > 1 ? colorRange(min, max) : stretchRange(min, max),
        alpha: hasAlpha ? colorRange(alphaMin, alphaMax) : undefined,
    };
}

function stretchRange(min: number, max: number): ValueRange {
    return { min, range: max - min > 0 ? max - min : 1 };
}

function colorRange(min: number, max: number): ValueRange {
    return min >= 0 && max <= 1 ? { min: 0, range: 1 } : stretchRange(min, max);
}

// Without colour channels, the mapper decides each pixel's colour. It defaults to gray.
export function renderSlice(data: ArrayData, layout: SliceLayout, ranges: DisplayRanges, mapper?: ColorMapper): Uint8ClampedArray {
    const source = asChunked(data);
    if (layout.channels > 1) {
        return renderColor(source, layout, ranges);
    }
    return renderMapped(source, layout, mapper ?? buildMapper(GRAY, ranges.color.min, ranges.color.range));
}

function renderMapped(data: ChunkedArray, layout: SliceLayout, mapper: ColorMapper): Uint8ClampedArray {
    const { height, width, base, stepY, stepX } = layout;
    const pixels = new Uint8ClampedArray(height * width * 4);
    const packed = new Uint32Array(pixels.buffer);
    let ptr = 0;
    for (let y = 0; y < height; y++) {
        let index = base + y * stepY;
        for (let x = 0; x < width; x++) {
            packed[ptr++] = mapper(data.at(index));
            index += stepX;
        }
    }
    return pixels;
}

// 2 channels are gray + alpha, 3 are RGB and 4 are RGBA.
function renderColor(data: ChunkedArray, layout: SliceLayout, ranges: DisplayRanges): Uint8ClampedArray {
    const { height, width, base, stepY, stepX, channels, stepC } = layout;
    const { color, alpha } = ranges;
    const colorCount = alpha ? channels - 1 : channels;

    const pixels = new Uint8ClampedArray(height * width * 4);
    let ptr = 0;
    for (let y = 0; y < height; y++) {
        let index = base + y * stepY;
        for (let x = 0; x < width; x++) {
            const r = ((data.at(index) - color.min) / color.range) * 255;
            pixels[ptr++] = r;
            pixels[ptr++] = colorCount === 3 ? ((data.at(index + stepC) - color.min) / color.range) * 255 : r;
            pixels[ptr++] = colorCount === 3 ? ((data.at(index + 2 * stepC) - color.min) / color.range) * 255 : r;
            pixels[ptr++] = alpha ? ((data.at(index + colorCount * stepC) - alpha.min) / alpha.range) * 255 : 255;
            index += stepX;
        }
    }
    return pixels;
}

// The colour a pixel with these channel values is drawn in.
export function pixelColor(values: number[], ranges: DisplayRanges, mapper?: ColorMapper): Rgba {
    const { color, alpha } = ranges;
    if (values.length === 1) {
        return unpackColor((mapper ?? buildMapper(GRAY, color.min, color.range))(values[0]));
    }
    const colorCount = alpha ? values.length - 1 : values.length;
    const shade = (i: number) => toByte(values[i], color);
    const opacity = alpha ? toByte(values[colorCount], alpha) : 255;
    return colorCount === 3 ? [shade(0), shade(1), shade(2), opacity] : [shade(0), shade(0), shade(0), opacity];
}

function toByte(value: number, range: ValueRange): number {
    return new Uint8ClampedArray([((value - range.min) / range.range) * 255])[0];
}

// Array coordinates of a pixel. The colour dimension is shown as ':' since the pixel covers all of it.
export function pixelCoords(axes: Axis[], layout: SliceLayout, y: number, x: number): (number | string)[] {
    return axes.map((axis, dim) => {
        if (dim === layout.rowDim) { return y; }
        if (dim === layout.colDim) { return x; }
        return axis.role === 'c' && layout.channels > 1 ? ':' : axis.index;
    });
}

export function readPixel(data: ArrayData, layout: SliceLayout, y: number, x: number): number[] {
    const source = asChunked(data);
    const index = layout.base + y * layout.stepY + x * layout.stepX;
    return Array.from({ length: layout.channels }, (_, channel) => source.at(index + channel * layout.stepC));
}
