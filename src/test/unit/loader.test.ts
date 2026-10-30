import * as assert from 'assert';
import { test } from 'node:test';
import { findLabels } from '../../webview/colormap';
import { loadNpy } from '../../webview/loader';
import { NpyArray } from '../../webview/npy';
import { displayRanges, readPixel, renderSlice, sliceLayout } from '../../webview/slice';
import { npy } from './npyFile';

function fetchReturning(response: Partial<Response>): typeof fetch {
    return (async () => ({ ok: true, ...response })) as unknown as typeof fetch;
}

// Serves parts of a file the way a VS Code webview does, and records what was asked for.
function servingParts(file: ArrayBuffer, requests: string[] = []): typeof fetch {
    return (async (_uri: string, init: RequestInit) => {
        const range = (init.headers as Record<string, string>).Range;
        requests.push(range);
        const [, from, to] = range.match(/bytes=(\d+)-(\d+)/)!;
        const last = Math.min(Number(to), file.byteLength - 1);
        return new Response(file.slice(Number(from), last + 1), {
            status: 206,
            headers: { 'Content-Range': `bytes ${from}-${last}/${file.byteLength}` },
        });
    }) as unknown as typeof fetch;
}

async function loaded(file: ArrayBuffer, chunkBytes: number): Promise<NpyArray> {
    const result = await loadNpy('x', { fetchFile: servingParts(file), chunkBytes });
    assert.strictEqual(result.kind, 'ok', JSON.stringify(result));
    return (result as { array: NpyArray }).array;
}

test('reports running out of memory as too large', async () => {
    const result = await loadNpy('x', { fetchFile: fetchReturning({
        status: 200,
        arrayBuffer: async () => { throw new RangeError('Array buffer allocation failed'); },
    }) });
    assert.deepStrictEqual(result, { kind: 'tooLarge', error: 'Array buffer allocation failed' });
});

test('does not retry a bad file with a smaller type', async () => {
    const result = await loadNpy('x', { fetchFile: fetchReturning({ status: 200, arrayBuffer: async () => new ArrayBuffer(64) }) });
    assert.strictEqual(result.kind, 'error');
});

test('reports HTTP failures as errors', async () => {
    const result = await loadNpy('x', { fetchFile: fetchReturning({ ok: false, status: 404 }) });
    assert.deepStrictEqual(result, { kind: 'error', error: 'HTTP error! status: 404' });
});

test('reads the file whole if it is not served in parts', async () => {
    const file = npy('<f4', '(2,)', new Float32Array([1.5, 2.5]));
    const result = await loadNpy('x', { fetchFile: fetchReturning({ status: 200, arrayBuffer: async () => file }) });
    assert.deepStrictEqual(Array.from((result as { array: NpyArray }).array.data), [1.5, 2.5]);
});

test('splits a file across chunks and reads every value', async () => {
    const values = Float64Array.from({ length: 25 }, (_, i) => i * 1.5);
    const requests: string[] = [];
    const result = await loadNpy('x', { fetchFile: servingParts(npy('<f8', '(5, 5)', values), requests), chunkBytes: 64 });
    const array = (result as { array: NpyArray }).array;
    assert.strictEqual(array.data.chunks.length, 4);
    assert.strictEqual(requests.length, 5);
    assert.deepStrictEqual(Array.from(array.data), Array.from(values));
});

test('keeps small files in a single chunk', async () => {
    const array = await loaded(npy('|u1', '(3,)', new Uint8Array([1, 2, 3])), 512);
    assert.strictEqual(array.data.chunks.length, 1);
});

test('decodes every chunk of data that needs converting', async () => {
    const big = new DataView(new ArrayBuffer(8));
    [1, -2, 300, -400].forEach((value, i) => big.setInt16(i * 2, value, false));
    assert.deepStrictEqual(Array.from((await loaded(npy('>i2', '(4,)', big), 4)).data), [1, -2, 300, -400]);

    const wide = new BigInt64Array([1n, -2n, 3n]);
    assert.deepStrictEqual(Array.from((await loaded(npy('<i8', '(3,)', wide), 8)).data), [1, -2, 3]);

    const half = new Uint16Array([0x3e00, 0xc000, 0x7c00]);
    assert.deepStrictEqual(Array.from((await loaded(npy('<f2', '(3,)', half), 2)).data), [1.5, -2, Infinity]);
});

test('reports the header first, then progress up to the total', async () => {
    const events: string[] = [];
    const fractions: number[] = [];
    await loadNpy('x', {
        fetchFile: servingParts(npy('<f4', '(8,)', new Float32Array(8))),
        chunkBytes: 8,
        onHeader: header => events.push(`shape ${header.shape}`),
        onProgress: (bytes, total) => {
            events.push('progress');
            fractions.push(bytes / total);
        },
    });
    assert.strictEqual(events[0], 'shape 8');
    assert.ok(fractions.every((fraction, i) => i === 0 || fraction >= fractions[i - 1]));
    assert.strictEqual(fractions[fractions.length - 1], 1);
});

test('reports a file shorter than its header says', async () => {
    const result = await loadNpy('x', { fetchFile: servingParts(npy('<f8', '(5,)', new Float64Array(2))) });
    assert.match((result as { error: string }).error, /shorter/);
    assert.strictEqual(result.kind, 'error');
});

test('reports running out of memory partway through as too large', async () => {
    const file = npy('<f8', '(4,)', new Float64Array(4));
    const parts = servingParts(file);
    let calls = 0;
    const failing = ((uri: string, init: RequestInit) => {
        if (++calls === 3) {
            throw new TypeError('Failed to fetch');
        }
        return parts(uri, init);
    }) as unknown as typeof fetch;
    const result = await loadNpy('x', { fetchFile: failing, chunkBytes: 8 });
    assert.deepStrictEqual(result, { kind: 'tooLarge', error: 'Failed to fetch' });
});

test('a cancelled load is not treated as running out of memory', async () => {
    const controller = new AbortController();
    const parts = servingParts(npy('<f8', '(4,)', new Float64Array(4)));
    const aborting = ((uri: string, init: RequestInit) => {
        if ((init.headers as Record<string, string>).Range !== 'bytes=0-65535') {
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
        }
        return parts(uri, init);
    }) as unknown as typeof fetch;
    const result = await loadNpy('x', { fetchFile: aborting, signal: controller.signal, chunkBytes: 8 });
    assert.strictEqual(result.kind, 'error');
});

test('slices, ranges and labels agree whether or not the array is split', async () => {
    const shape = [3, 4, 5];
    const values = Int32Array.from({ length: 60 }, (_, i) => i % 7);
    for (const fortran of [false, true]) {
        const file = npy('<i4', '(3, 4, 5)', values, fortran);
        const whole = await loaded(file, 1024);
        const split = await loaded(file, 28);
        assert.ok(split.data.chunks.length > 1);

        const position = [{ role: 'H', index: 1 }, { role: 'W', index: 2 }, { role: 'D', index: 3 }] as Parameters<typeof sliceLayout>[2];
        const layout = sliceLayout(shape, split.strides, position)!;
        const ranges = displayRanges(split.data, 1, 0, false);
        assert.deepStrictEqual(ranges, displayRanges(whole.data, 1, 0, false));
        assert.deepStrictEqual(renderSlice(split.data, layout, ranges), renderSlice(whole.data, layout, ranges));
        assert.deepStrictEqual(readPixel(split.data, layout, 2, 3), readPixel(whole.data, layout, 2, 3));
        assert.deepStrictEqual(findLabels(split.data, 0, 6), [0, 1, 2, 3, 4, 5, 6]);
    }
});

test('finds the alpha channel when it falls across chunks', async () => {
    const values = new Float32Array([0, 1, 2, 100, 3, 4, 5, 300, 6, 7, 8, 200]);
    const split = await loaded(npy('<f4', '(1, 3, 4)', values), 12);
    assert.deepStrictEqual(displayRanges(split.data, 4, 1, false), {
        color: { min: 0, range: 8 },
        alpha: { min: 100, range: 200 },
    });
});
