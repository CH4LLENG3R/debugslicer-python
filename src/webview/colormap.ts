import { NumericArray } from './npy';

export type ColormapKind = 'continuous' | 'step';

export interface Colormap {
    id: string;
    name: string;
    kind: ColormapKind;
    // Evenly spaced '#rrggbb' colours. A continuous map blends between them, a step map doesn't.
    colors: string[];
}

export interface Preferences {
    colormaps: Colormap[];
    captions: 'names' | 'planes';
}

// Turns a value into a pixel, packed as 0xAABBGGRR so that it can be written straight into a Uint32Array.
export type ColorMapper = (value: number) => number;

export const AUTO_ID = 'auto';
// Past this many distinct values, a step map treats the data as continuous and cuts it into bands.
const MAX_LABELS = 4096;
// More distinct values than this is an image that happens to hold whole numbers, not a segmentation.
const AUTO_LABEL_LIMIT = 64;
const LUT_SIZE = 256;
const MAX_DENSE_SPAN = 1 << 20;
// NaN and the infinities have no place on a scale, so they get a colour that stands out from the presets.
const INVALID_COLOR = packColor(255, 0, 255);

export const GRAY: Colormap = { id: 'gray', name: 'Gray', kind: 'continuous', colors: ['#000000', '#ffffff'] };

export const LABELS: Colormap = {
    id: 'labels',
    name: 'Labels',
    kind: 'step',
    colors: [
        '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe',
        '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3', '#808000', '#ffd8b1', '#000075', '#808080',
    ],
};

export const PRESETS: Colormap[] = [
    GRAY,
    {
        id: 'viridis',
        name: 'Viridis',
        kind: 'continuous',
        colors: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
    },
    {
        id: 'magma',
        name: 'Magma',
        kind: 'continuous',
        colors: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'],
    },
    {
        id: 'turbo',
        name: 'Turbo',
        kind: 'continuous',
        colors: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#cb2a04', '#7a0403'],
    },
    {
        id: 'coolwarm',
        name: 'Cool-warm',
        kind: 'continuous',
        colors: ['#3b4cc0', '#8db0fe', '#dddddd', '#f4987a', '#b40426'],
    },
    LABELS,
];

export function packColor(r: number, g: number, b: number, a = 255): number {
    return (r | (g << 8) | (b << 16) | (a << 24)) >>> 0;
}

export function unpackColor(packed: number): [number, number, number, number] {
    return [packed & 255, (packed >>> 8) & 255, (packed >>> 16) & 255, packed >>> 24];
}

function hexToRgb(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function hexToPacked(hex: string): number {
    const [r, g, b] = hexToRgb(hex);
    return packColor(r, g, b);
}

export function isHexColor(text: string): boolean {
    return /^#[0-9a-fA-F]{6}$/.test(text);
}

// The sorted distinct values if the data looks like labels: finite whole numbers, and not too many of them.
export function findLabels(data: NumericArray, min: number, max: number, limit = MAX_LABELS): number[] | undefined {
    if (!Number.isFinite(min)) {
        return [];
    }
    // Most arrays span a small range, where a table is far faster than a Set.
    const span = max - min;
    const table = span < MAX_DENSE_SPAN ? new Uint8Array(Math.floor(span) + 1) : undefined;
    const seen = new Set<number>();
    let count = 0;

    for (let i = 0; i < data.length; i++) {
        const val = data[i];
        if (!Number.isFinite(val)) {
            continue;
        }
        if (!Number.isInteger(val)) {
            return undefined;
        }
        if (table) {
            const slot = val - min;
            if (table[slot] === 0) {
                table[slot] = 1;
                if (++count > limit) {
                    return undefined;
                }
            }
        } else {
            seen.add(val);
            if (seen.size > limit) {
                return undefined;
            }
        }
    }

    if (!table) {
        return Array.from(seen).sort((a, b) => a - b);
    }
    const labels: number[] = [];
    table.forEach((flag, slot) => {
        if (flag) {
            labels.push(min + slot);
        }
    });
    return labels;
}

// What "Auto" means for this data.
export function autoColormap(labels: number[] | undefined): Colormap {
    return labels && labels.length <= AUTO_LABEL_LIMIT ? LABELS : GRAY;
}

// One distinct colour per rank. The Labels preset goes on past its list with generated hues, others repeat.
function labelColors(map: Colormap, count: number): number[] {
    if (map.id !== LABELS.id) {
        return Array.from({ length: count }, (_, rank) => hexToPacked(map.colors[rank % map.colors.length]));
    }

    const colors = LABELS.colors.slice(0, count).map(hexToPacked);
    const used = new Set([...colors, packColor(0, 0, 0)]);
    for (let n = 0; colors.length < count; n++) {
        // Stepping by the golden angle keeps each new hue far from the ones before it.
        const color = hslToPacked((n * 137.508) % 360, 0.65 + (n % 3) * 0.15, 0.45 + (n % 4) * 0.1);
        if (!used.has(color)) {
            used.add(color);
            colors.push(color);
        }
    }
    return colors;
}

function hslToPacked(hue: number, saturation: number, lightness: number): number {
    const channel = (offset: number) => {
        const k = (offset + hue / 30) % 12;
        const a = saturation * Math.min(lightness, 1 - lightness);
        return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return packColor(channel(0), channel(8), channel(4));
}

function labelMapper(map: Colormap, labels: number[]): ColorMapper {
    // In the Labels preset, 0 is the background and stays black whatever else the data holds.
    const isBackground = (label: number) => map.id === LABELS.id && label === 0;
    const colored = labels.filter(label => !isBackground(label));
    const colors = labelColors(map, colored.length);
    const colorByLabel = new Map<number, number>(colored.map((label, rank) => [label, colors[rank]]));
    if (labels.some(isBackground)) {
        colorByLabel.set(0, packColor(0, 0, 0));
    }

    const min = labels[0];
    const span = labels.length ? labels[labels.length - 1] - min : 0;
    if (span < MAX_DENSE_SPAN) {
        const table = new Uint32Array(span + 1).fill(INVALID_COLOR);
        colorByLabel.forEach((color, label) => { table[label - min] = color; });
        return value => Number.isFinite(value) ? table[value - min] ?? INVALID_COLOR : INVALID_COLOR;
    }
    return value => colorByLabel.get(value) ?? INVALID_COLOR;
}

function bandMapper(map: Colormap, min: number, range: number): ColorMapper {
    const colors = map.colors.map(hexToPacked);
    const last = colors.length - 1;
    return value => {
        if (!Number.isFinite(value)) {
            return INVALID_COLOR;
        }
        const band = Math.floor(((value - min) / range) * colors.length);
        return colors[Math.min(Math.max(band, 0), last)];
    };
}

function continuousMapper(map: Colormap, min: number, range: number): ColorMapper {
    const stops = map.colors.map(hexToRgb);
    const lut = new Uint32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) {
        const position = (i / (LUT_SIZE - 1)) * (stops.length - 1);
        const lower = Math.min(Math.floor(position), stops.length - 2);
        const blend = position - lower;
        const mix = (channel: number) => Math.round(stops[lower][channel] + (stops[lower + 1][channel] - stops[lower][channel]) * blend);
        lut[i] = packColor(mix(0), mix(1), mix(2));
    }
    return value => {
        if (!Number.isFinite(value)) {
            return INVALID_COLOR;
        }
        const index = Math.floor(((value - min) / range) * (LUT_SIZE - 1) + 0.5);
        return lut[index < 0 ? 0 : index >= LUT_SIZE ? LUT_SIZE - 1 : index];
    };
}

// A step map colours each label when the data has labels, and otherwise cuts the range into equal bands.
export function buildMapper(map: Colormap, min: number, range: number, labels?: number[]): ColorMapper {
    if (map.kind === 'continuous') {
        return continuousMapper(map, min, range);
    }
    return labels ? labelMapper(map, labels) : bandMapper(map, min, range);
}

// A CSS background showing the map, for the editor's preview.
export function previewBackground(map: Pick<Colormap, 'kind' | 'colors'>): string {
    const count = map.colors.length;
    const stops = map.kind === 'continuous'
        ? map.colors
        : map.colors.map((color, i) => `${color} ${(i / count) * 100}% ${((i + 1) / count) * 100}%`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
}

// Stored preferences come back from outside the code, so anything unusable is dropped rather than trusted.
export function sanitizePreferences(stored: unknown): Preferences {
    const source = (stored ?? {}) as Partial<Preferences>;
    const colormaps = Array.isArray(source.colormaps) ? source.colormaps.filter(isColormap) : [];
    return { colormaps, captions: source.captions === 'planes' ? 'planes' : 'names' };
}

function isColormap(map: Partial<Colormap>): map is Colormap {
    return !!map
        && typeof map.id === 'string'
        && typeof map.name === 'string'
        && (map.kind === 'continuous' || map.kind === 'step')
        && Array.isArray(map.colors)
        && map.colors.length >= 2
        && map.colors.every(color => typeof color === 'string' && isHexColor(color));
}
