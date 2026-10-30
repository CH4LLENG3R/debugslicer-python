import * as assert from 'assert';
import { test } from 'node:test';
import { asChunked, ChunkedArray, computeStrides, NpyFormatError, parseNpy } from '../../webview/npy';
import { npy } from './npyFile';

test('computes C and Fortran strides', () => {
    assert.deepStrictEqual(computeStrides([2, 3, 4], false), [12, 4, 1]);
    assert.deepStrictEqual(computeStrides([2, 3, 4], true), [1, 2, 6]);
});

test('parses the Fortran order flag', () => {
    const parsed = parseNpy(npy('<f8', '(2, 3)', new Float64Array(6), true));
    assert.deepStrictEqual(parsed.shape, [2, 3]);
    assert.deepStrictEqual(parsed.strides, [1, 2]);
});

test('reads every little-endian numeric dtype', () => {
    const cases: [string, ArrayBufferView & ArrayLike<number | bigint>][] = [
        ['<f8', new Float64Array([1.5, -2])],
        ['<f4', new Float32Array([1.5, -2])],
        ['<i4', new Int32Array([1, -2])],
        ['<u4', new Uint32Array([1, 4000000000])],
        ['<i2', new Int16Array([1, -2])],
        ['<u2', new Uint16Array([1, 60000])],
        ['|i1', new Int8Array([1, -2])],
        ['|u1', new Uint8Array([1, 200])],
        ['|b1', new Uint8Array([1, 0])],
        ['<i8', new BigInt64Array([1n, -2n])],
        ['<u8', new BigUint64Array([1n, 2n])],
    ];
    for (const [descr, values] of cases) {
        const parsed = parseNpy(npy(descr, '(2,)', values));
        assert.deepStrictEqual(Array.from(parsed.data), Array.from(values, Number), descr);
    }
});

test('decodes half floats', () => {
    // 1.5, -2, infinity
    const parsed = parseNpy(npy('<f2', '(3,)', new Uint16Array([0x3e00, 0xc000, 0x7c00])));
    assert.deepStrictEqual(Array.from(parsed.data), [1.5, -2, Infinity]);
});

test('swaps bytes for big-endian data', () => {
    const payload = new DataView(new ArrayBuffer(4));
    payload.setInt16(0, -2, false);
    payload.setInt16(2, 300, false);
    assert.deepStrictEqual(Array.from(parseNpy(npy('>i2', '(2,)', payload)).data), [-2, 300]);
});

test('rejects what it cannot show with a format error', () => {
    assert.throws(() => parseNpy(new ArrayBuffer(64)), NpyFormatError);
    assert.throws(() => parseNpy(npy('<c16', '(1,)', new Float64Array(2))), NpyFormatError);
    assert.throws(() => parseNpy(npy('|O', '(1,)', new Uint8Array(8))), NpyFormatError);
    assert.throws(() => parseNpy(npy('<f8', '(5,)', new Float64Array(2))), NpyFormatError);
});

test('finds elements across chunks', () => {
    const data = new ChunkedArray([new Float64Array([0, 1, 2]), new Float64Array([3, 4, 5]), new Float64Array([6])], 3, 7);
    assert.deepStrictEqual(Array.from({ length: 7 }, (_, i) => data.at(i)), [0, 1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(Array.from(data), [0, 1, 2, 3, 4, 5, 6]);
});

test('finds elements beyond the 32-bit range', () => {
    // Only the last chunk holds anything, as if the chunks before it were full.
    const size = 2 ** 30;
    const chunks = [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0), new Uint8Array(0), new Uint8Array([9, 8])];
    const data = new ChunkedArray(chunks, size, 4 * size + 2);
    assert.strictEqual(data.at(4 * size + 1), 8);
});

test('wraps a plain array as one chunk, even when it is empty', () => {
    assert.strictEqual(asChunked(new Uint8Array([5, 6])).at(1), 6);
    assert.strictEqual(asChunked(new Uint8Array(0)).length, 0);
});
