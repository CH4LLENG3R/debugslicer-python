import { ChunkedArray, decodeData, NpyArray, NpyFormatError, NpyHeader, NumericArray, parseNpy, parseNpyHeader } from './npy';

export type LoadResult =
    | { kind: 'ok'; array: NpyArray }
    | { kind: 'tooLarge'; error: string }
    | { kind: 'error'; error: string };

export interface LoadOptions {
    fetchFile?: typeof fetch;
    signal?: AbortSignal;
    // Well below the size of about 2 GB where a webview stops being able to allocate a buffer.
    chunkBytes?: number;
    onHeader?(header: NpyHeader): void;
    onProgress?(loadedBytes: number, totalBytes: number): void;
}

const DEFAULT_CHUNK_BYTES = 512 * 2 ** 20;
const HEADER_BYTES = 2 ** 16;

class HttpError extends Error {}

export async function loadNpy(uri: string, options: LoadOptions = {}): Promise<LoadResult> {
    const { fetchFile = fetch, signal } = options;

    let first: Response;
    try {
        first = await fetchFile(uri, { headers: { Range: `bytes=0-${HEADER_BYTES - 1}` }, signal });
    } catch (error) {
        return { kind: 'error', error: messageOf(error) };
    }
    if (!first.ok) {
        return { kind: 'error', error: `HTTP error! status: ${first.status}` };
    }

    // Past this point, anything that isn't a format or HTTP problem means we ran out of memory.
    try {
        if (first.status !== 206) {
            // The file wasn't served in parts, so it can only be read whole.
            return { kind: 'ok', array: parseNpy(await first.arrayBuffer()) };
        }
        return { kind: 'ok', array: await loadChunks(uri, first, options) };
    } catch (error) {
        const isFatal = error instanceof NpyFormatError || error instanceof HttpError || signal?.aborted;
        return { kind: isFatal ? 'error' : 'tooLarge', error: messageOf(error) };
    }
}

async function loadChunks(uri: string, first: Response, options: LoadOptions): Promise<NpyArray> {
    const { fetchFile = fetch, signal, chunkBytes = DEFAULT_CHUNK_BYTES, onHeader, onProgress } = options;

    const header = parseNpyHeader(await first.arrayBuffer());
    const { count, elementSize, dataOffset, dtype } = header;
    const totalBytes = count * elementSize;
    const fileSize = Number(first.headers?.get('Content-Range')?.split('/')[1]);
    if (dataOffset + totalBytes > fileSize) {
        throw new NpyFormatError('The .npy file is shorter than its header says.');
    }
    onHeader?.(header);

    const chunkLength = Math.max(Math.floor(chunkBytes / elementSize), 1);
    const chunks: NumericArray[] = [];
    let loadedBytes = 0;
    for (let start = 0; start < count; start += chunkLength) {
        const length = Math.min(chunkLength, count - start);
        const buffer = new ArrayBuffer(length * elementSize);
        const from = dataOffset + start * elementSize;
        const response = await fetchFile(uri, {
            headers: { Range: `bytes=${from}-${from + buffer.byteLength - 1}` },
            signal,
        });
        if (response.status !== 206) {
            throw new HttpError(`HTTP error! status: ${response.status}`);
        }
        await readInto(response, new Uint8Array(buffer), received => {
            onProgress?.(loadedBytes + received, totalBytes);
        });
        loadedBytes += buffer.byteLength;
        chunks.push(decodeData(buffer, 0, length, dtype));
    }

    return {
        shape: header.shape,
        strides: header.strides,
        data: new ChunkedArray(chunks, chunkLength, count),
        dtype,
    };
}

// Streaming into a buffer that already exists avoids holding the data twice, and reports progress as it arrives.
async function readInto(response: Response, target: Uint8Array, onProgress: (received: number) => void) {
    const reader = response.body!.getReader();
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        target.set(value, received);
        received += value.length;
        onProgress(received);
    }
    if (received !== target.length) {
        throw new NpyFormatError('The .npy file is shorter than its header says.');
    }
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
