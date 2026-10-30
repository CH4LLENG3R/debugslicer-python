export type NumericArray =
    | Float64Array
    | Float32Array
    | Int32Array
    | Uint32Array
    | Int16Array
    | Uint16Array
    | Int8Array
    | Uint8Array;

// One array stored in several typed arrays. A webview can't allocate a single buffer of about
// 2 GB or more, however much memory is free, so large arrays have to be split up.
export class ChunkedArray {
    public readonly length: number;

    // Every chunk holds chunkLength elements, except that the last may hold fewer.
    constructor(public readonly chunks: NumericArray[], public readonly chunkLength: number, length: number) {
        this.length = length;
    }

    public at(index: number): number {
        const chunk = index < this.chunkLength ? 0 : Math.floor(index / this.chunkLength);
        return this.chunks[chunk][index - chunk * this.chunkLength];
    }

    public *[Symbol.iterator](): IterableIterator<number> {
        for (const chunk of this.chunks) {
            yield* chunk;
        }
    }
}

export type ArrayData = ChunkedArray | NumericArray;

export function asChunked(data: ArrayData): ChunkedArray {
    return data instanceof ChunkedArray ? data : new ChunkedArray([data], Math.max(data.length, 1), data.length);
}

export interface NpyHeader {
    shape: number[];
    strides: number[];
    dtype: string;
    dataOffset: number;
    count: number;
    elementSize: number;
}

export interface NpyArray {
    shape: number[];
    strides: number[];
    data: ChunkedArray;
    dtype: string;
}

// The file is malformed or holds something we can't show, so retrying with a smaller type won't help.
export class NpyFormatError extends Error {}

const SUPPORTED_TYPES = ['f8', 'f4', 'f2', 'i8', 'i4', 'i2', 'i1', 'u8', 'u4', 'u2', 'u1', 'b1'];

// Reads the header from the start of a file, which is all that this buffer needs to hold.
export function parseNpyHeader(buffer: ArrayBuffer): NpyHeader {
    const magic = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
    if (buffer.byteLength < 10 || !magic.every((byte, i) => new Uint8Array(buffer)[i] === byte)) {
        throw new NpyFormatError('Not a valid .npy file.');
    }

    const view = new DataView(buffer);
    const major = view.getUint8(6);
    const headerLen = major === 1 ? view.getUint16(8, true) : view.getUint32(8, true);
    const headerOffset = major === 1 ? 10 : 12;
    if (headerOffset + headerLen > buffer.byteLength) {
        throw new NpyFormatError('The .npy header is larger than expected.');
    }
    const header = new TextDecoder().decode(new Uint8Array(buffer, headerOffset, headerLen));

    const descr = header.match(/'descr':\s*'([^']+)'/)?.[1];
    const shapeText = header.match(/'shape':\s*\((.*?)\)/)?.[1];
    if (descr === undefined || shapeText === undefined) {
        throw new NpyFormatError('Unsupported .npy header: ' + header.trim());
    }

    const shape = shapeText.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const fortranOrder = /'fortran_order':\s*True/.test(header);

    return {
        shape,
        strides: computeStrides(shape, fortranOrder),
        dtype: descr,
        dataOffset: headerOffset + headerLen,
        count: shape.reduce((total, dim) => total * dim, 1),
        elementSize: parseDescr(descr).size,
    };
}

// Reads a complete file that is held in one buffer.
export function parseNpy(buffer: ArrayBuffer): NpyArray {
    const header = parseNpyHeader(buffer);
    const data = decodeData(buffer, header.dataOffset, header.count, header.dtype);
    return {
        shape: header.shape,
        strides: header.strides,
        data: asChunked(data),
        dtype: header.dtype,
    };
}

function parseDescr(descr: string) {
    const match = descr.match(/^([<>|=]?)([a-z])(\d+)$/);
    if (!match || !SUPPORTED_TYPES.includes(match[2] + match[3])) {
        throw new NpyFormatError(`Unsupported dtype '${descr}'.`);
    }
    return { byteOrder: match[1], type: match[2] + match[3], size: parseInt(match[3]) };
}

// Readable type name for display, for example '<f8' becomes 'float64'.
export function dtypeName(descr: string): string {
    const match = descr.match(/^[<>|=]?([a-z])(\d+)$/);
    if (!match) {
        return descr;
    }
    const [, kind, size] = match;
    const names: Record<string, string> = { f: 'float', i: 'int', u: 'uint' };
    if (kind === 'b') {
        return 'bool';
    }
    return names[kind] ? names[kind] + parseInt(size) * 8 : descr;
}

export function computeStrides(shape: number[], fortranOrder: boolean): number[] {
    const strides = new Array<number>(shape.length);
    let stride = 1;
    for (let i = 0; i < shape.length; i++) {
        const dim = fortranOrder ? i : shape.length - 1 - i;
        strides[dim] = stride;
        stride *= shape[dim];
    }
    return strides;
}

export function decodeData(buffer: ArrayBuffer, offset: number, count: number, descr: string): NumericArray {
    const { byteOrder, type, size } = parseDescr(descr);

    if (offset + count * size > buffer.byteLength) {
        throw new NpyFormatError('The .npy file is shorter than its header says.');
    }

    // Typed arrays read in platform order, which is little-endian everywhere VS Code runs.
    // A copy is only needed to swap bytes or when the data isn't aligned to its element size.
    let source = buffer;
    let start = offset;
    const swap = byteOrder === '>' && size > 1;
    if (swap || offset % size !== 0) {
        source = buffer.slice(offset, offset + count * size);
        start = 0;
        if (swap) {
            swapBytes(new Uint8Array(source), size);
        }
    }

    switch (type) {
        case 'f8': return new Float64Array(source, start, count);
        case 'f4': return new Float32Array(source, start, count);
        case 'i4': return new Int32Array(source, start, count);
        case 'u4': return new Uint32Array(source, start, count);
        case 'i2': return new Int16Array(source, start, count);
        case 'u2': return new Uint16Array(source, start, count);
        case 'i1': return new Int8Array(source, start, count);
        case 'f2': return halfToFloat32(new Uint16Array(source, start, count));
        // Values above 2^53 lose precision here, which doesn't matter for display.
        case 'i8': return Float64Array.from(new BigInt64Array(source, start, count), Number);
        case 'u8': return Float64Array.from(new BigUint64Array(source, start, count), Number);
        default: return new Uint8Array(source, start, count);
    }
}

function swapBytes(bytes: Uint8Array, size: number) {
    for (let i = 0; i + size <= bytes.length; i += size) {
        for (let a = i, b = i + size - 1; a < b; a++, b--) {
            const tmp = bytes[a];
            bytes[a] = bytes[b];
            bytes[b] = tmp;
        }
    }
}

function halfToFloat32(half: Uint16Array): Float32Array {
    const out = new Float32Array(half.length);
    for (let i = 0; i < half.length; i++) {
        const sign = half[i] & 0x8000 ? -1 : 1;
        const exponent = (half[i] >> 10) & 0x1f;
        const fraction = half[i] & 0x3ff;
        if (exponent === 0) {
            out[i] = sign * fraction * 2 ** -24;
        } else if (exponent === 31) {
            out[i] = fraction ? NaN : sign * Infinity;
        } else {
            out[i] = sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
        }
    }
    return out;
}
