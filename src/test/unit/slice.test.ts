import * as assert from 'assert';
import { test } from 'node:test';
import { computeStrides, dtypeName } from '../../webview/npy';
import {
    assignRole, Axis, AxisRole, centerPositions, colorChannels, colorHint, defaultAxes, displayRanges, isVolume, pixelColor, pixelCoords,
    PLANES, readPixel, renderSlice, sliceLayout, usesIndex,
} from '../../webview/slice';

function axes(...roles: AxisRole[]): Axis[] {
    return roles.map(role => ({ role, index: 0 }));
}

function rolesOf(shape: number[]): AxisRole[] {
    return defaultAxes(shape).map(axis => axis.role);
}

function layoutOf(shape: number[], roles: AxisRole[]) {
    return sliceLayout(shape, computeStrides(shape, false), axes(...roles))!;
}

function planeNamed(name: string) {
    return PLANES.find(plane => plane.name === name)!;
}

const GRAY_0_TO_10 = { color: { min: 0, range: 10 } };

test('picks default roles from the shape', () => {
    assert.deepStrictEqual(rolesOf([4, 5]), ['H', 'W']);
    assert.deepStrictEqual(rolesOf([512, 64, 512]), ['H', 'W', 'D']);
    assert.deepStrictEqual(rolesOf([249, 314, 4]), ['H', 'W', 'c']);
    assert.deepStrictEqual(rolesOf([249, 314, 3]), ['H', 'W', 'c']);
    assert.deepStrictEqual(rolesOf([2, 3, 4, 5]), ['H', 'W', 'D', 'const']);
});

test('makes dimensions of size 1 constants', () => {
    assert.deepStrictEqual(rolesOf([1, 512, 512]), ['const', 'H', 'W']);
    assert.deepStrictEqual(rolesOf([512, 512, 1]), ['H', 'W', 'const']);
    assert.deepStrictEqual(rolesOf([1, 249, 314, 4]), ['const', 'H', 'W', 'c']);
    assert.deepStrictEqual(rolesOf([1, 10, 1, 20, 1]), ['const', 'H', 'const', 'W', 'const']);
});

test('still draws something when almost every dimension has size 1', () => {
    assert.deepStrictEqual(rolesOf([1, 1]), ['H', 'W']);
    assert.deepStrictEqual(rolesOf([1, 7]), ['H', 'W']);
    assert.deepStrictEqual(rolesOf([5]), ['H']);
    assert.deepStrictEqual(rolesOf([]), []);
});

test('opens volumes in the middle and images at the origin', () => {
    assert.deepStrictEqual(defaultAxes([10, 20, 5, 3]).map(axis => axis.index), [5, 10, 2, 0]);
    assert.deepStrictEqual(defaultAxes([1, 10, 20]).map(axis => axis.index), [0, 0, 0]);
});

test('a volume needs H, W and D', () => {
    assert.ok(isVolume(axes('H', 'W', 'D')));
    assert.ok(isVolume(axes('const', 'D', 'c', 'H', 'W')));
    assert.ok(!isVolume(axes('H', 'W', 'c')));
    assert.ok(!isVolume(axes('H', 'const', 'D')));
});

test('centres only the positions of H, W and D', () => {
    const centred = centerPositions([10, 20, 6, 8], axes('H', 'W', 'D', 'const'));
    assert.deepStrictEqual(centred.map(axis => axis.index), [5, 10, 3, 0]);
});

test('swaps roles when a taken one is chosen', () => {
    const swapped = assignRole(axes('H', 'W', 'D'), 2, 'H');
    assert.deepStrictEqual(swapped.map(axis => axis.role), ['D', 'W', 'H']);
});

test('allows any number of constants', () => {
    const next = assignRole(assignRole(axes('H', 'W', 'D'), 0, 'const'), 2, 'const');
    assert.deepStrictEqual(next.map(axis => axis.role), ['const', 'W', 'const']);
});

test('shows colour only for 2D images with 2 to 4 channels', () => {
    assert.strictEqual(colorChannels([5, 6, 3], axes('H', 'W', 'c')), 3);
    assert.strictEqual(colorChannels([5, 6, 2], axes('H', 'W', 'c')), 2);
    assert.strictEqual(colorChannels([1, 5, 6, 4], axes('const', 'H', 'W', 'c')), 4);
    // A slice axis makes it a volume, and a channel needs 2 to 4 values
    assert.strictEqual(colorChannels([5, 6, 7, 3], axes('H', 'W', 'D', 'c')), 1);
    assert.strictEqual(colorChannels([5, 6, 5], axes('H', 'W', 'c')), 1);
    assert.strictEqual(colorChannels([5, 6, 3], axes('H', 'W', 'const')), 1);
});

test('explains why colour is not shown', () => {
    assert.strictEqual(colorHint([5, 6, 3], axes('H', 'W', 'c')), undefined);
    assert.match(colorHint([5, 6, 7, 3], axes('H', 'W', 'D', 'c'))!, /2D images/);
    assert.match(colorHint([5, 6, 5], axes('H', 'W', 'c'))!, /2 to 4 values/);
});

test('H and W only take an index in a volume', () => {
    const volume = axes('H', 'W', 'D', 'c');
    assert.deepStrictEqual([0, 1, 2, 3].map(dim => usesIndex([5, 6, 7, 3], volume, dim)), [true, true, true, true]);
    assert.deepStrictEqual([0, 1, 2].map(dim => usesIndex([5, 6, 3], axes('H', 'W', 'c'), dim)), [false, false, false]);
    assert.strictEqual(usesIndex([5, 6, 3], axes('H', 'W', 'const'), 2), true);
});

test('holds constants at their index', () => {
    const shape = [3, 4, 5];
    const held: Axis[] = [{ role: 'const', index: 2 }, { role: 'H', index: 0 }, { role: 'W', index: 0 }];
    assert.strictEqual(sliceLayout(shape, computeStrides(shape, false), held)!.base, 2 * 20);
    // An index beyond the size is held at the last value
    held[0].index = 99;
    assert.strictEqual(sliceLayout(shape, computeStrides(shape, false), held)!.base, 2 * 20);
});

test('has no layout without both H and W', () => {
    assert.strictEqual(sliceLayout([3], [1], axes('H')), undefined);
    assert.strictEqual(sliceLayout([3, 4], [4, 1], axes('const', 'W')), undefined);
});

test('each plane shows its own rows and columns and holds the third axis', () => {
    // data[h, w, d] = 100h + 10w + d
    const shape = [2, 3, 4];
    const data = new Float64Array(24);
    for (let h = 0; h < 2; h++) { for (let w = 0; w < 3; w++) { for (let d = 0; d < 4; d++) {
        data[h * 12 + w * 4 + d] = 100 * h + 10 * w + d;
    } } }
    const position: Axis[] = [{ role: 'H', index: 1 }, { role: 'W', index: 2 }, { role: 'D', index: 3 }];
    const strides = computeStrides(shape, false);

    const axial = sliceLayout(shape, strides, position, planeNamed('Axial'))!;
    assert.deepStrictEqual([axial.height, axial.width], [2, 3]);
    assert.deepStrictEqual(readPixel(data, axial, 0, 1), [13]);

    const sagittal = sliceLayout(shape, strides, position, planeNamed('Sagittal'))!;
    assert.deepStrictEqual([sagittal.height, sagittal.width], [4, 2]);
    assert.deepStrictEqual(readPixel(data, sagittal, 1, 0), [21]);
    assert.deepStrictEqual(pixelCoords(position, sagittal, 1, 0), [0, 2, 1]);

    const coronal = sliceLayout(shape, strides, position, planeNamed('Coronal'))!;
    assert.deepStrictEqual([coronal.height, coronal.width], [4, 3]);
    assert.deepStrictEqual(readPixel(data, coronal, 2, 1), [112]);
    assert.deepStrictEqual(pixelCoords(position, coronal, 2, 1), [1, 1, 2]);
});

test('every plane reads a Fortran-order array the same as a C-order one', () => {
    const shape = [2, 3, 4];
    const cData = new Float64Array(24);
    const fData = new Float64Array(24);
    for (let h = 0; h < 2; h++) { for (let w = 0; w < 3; w++) { for (let d = 0; d < 4; d++) {
        const value = 100 * h + 10 * w + d;
        cData[h * 12 + w * 4 + d] = value;
        fData[h + w * 2 + d * 6] = value;
    } } }
    const position: Axis[] = [{ role: 'H', index: 1 }, { role: 'W', index: 2 }, { role: 'D', index: 3 }];

    for (const plane of PLANES) {
        const cLayout = sliceLayout(shape, computeStrides(shape, false), position, plane)!;
        const fLayout = sliceLayout(shape, computeStrides(shape, true), position, plane)!;
        for (let y = 0; y < cLayout.height; y++) {
            for (let x = 0; x < cLayout.width; x++) {
                assert.deepStrictEqual(readPixel(fData, fLayout, y, x), readPixel(cData, cLayout, y, x));
            }
        }
    }
});

test('steps through a Fortran-order slice correctly', () => {
    // A 2x3 slice stored column by column: rows are [0, 2, 4] and [1, 3, 5].
    const shape = [2, 3];
    const layout = sliceLayout(shape, computeStrides(shape, true), axes('H', 'W'))!;
    const data = new Float64Array([0, 1, 2, 3, 4, 5]);
    const pixels = renderSlice(data, layout, displayRanges(data, 1, 0, false));
    assert.deepStrictEqual([pixels[0], pixels[4], pixels[8]], [0, 102, 204]);
});

test('normalises gray over the whole array, not the slice', () => {
    // Two slices: the first holds 0 and 5, the second 0 and 10.
    const shape = [2, 1, 2];
    const data = new Float64Array([0, 0, 5, 10]);
    const slice: Axis[] = [{ role: 'H', index: 0 }, { role: 'W', index: 0 }, { role: 'D', index: 0 }];
    const layout = sliceLayout(shape, computeStrides(shape, false), slice)!;
    const pixels = renderSlice(data, layout, displayRanges(data, 1, 0, false));
    assert.deepStrictEqual([pixels[0], pixels[4]], [0, 128]);
});

test('stretches 8-bit grayscale too', () => {
    assert.deepStrictEqual(displayRanges(new Uint8Array([50, 150]), 1, 0, true), { color: { min: 50, range: 100 }, alpha: undefined });
});

test('ignores NaN and infinity when normalising', () => {
    const layout = layoutOf([1, 4], ['H', 'W']);
    const data = new Float64Array([0, NaN, Infinity, 10]);
    const pixels = renderSlice(data, layout, displayRanges(data, 1, 0, false));
    assert.strictEqual(pixels[0], 0);
    assert.strictEqual(pixels[12], 255);
});

test('renders a constant array without dividing by zero', () => {
    const layout = layoutOf([1, 2], ['H', 'W']);
    const data = new Float64Array([7, 7]);
    const pixels = renderSlice(data, layout, displayRanges(data, 1, 0, false));
    assert.deepStrictEqual(Array.from(pixels), [0, 0, 0, 255, 0, 0, 0, 255]);
});

test('renders 8-bit RGB as it is', () => {
    const layout = layoutOf([1, 2, 3], ['H', 'W', 'c']);
    const data = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const pixels = renderSlice(data, layout, displayRanges(data, 3, layout.stepC, true));
    assert.deepStrictEqual(Array.from(pixels), [10, 20, 30, 255, 40, 50, 60, 255]);
});

test('renders RGBA with its alpha', () => {
    const layout = layoutOf([1, 1, 4], ['H', 'W', 'c']);
    const data = new Uint8Array([255, 0, 0, 128]);
    assert.deepStrictEqual(Array.from(renderSlice(data, layout, displayRanges(data, 4, layout.stepC, true))), [255, 0, 0, 128]);
});

test('renders gray + alpha', () => {
    const layout = layoutOf([1, 1, 2], ['H', 'W', 'c']);
    const data = new Uint8Array([100, 50]);
    assert.deepStrictEqual(Array.from(renderSlice(data, layout, displayRanges(data, 2, layout.stepC, true))), [100, 100, 100, 50]);
});

test('takes floats within 0 to 1 as already normalised', () => {
    const layout = layoutOf([1, 1, 4], ['H', 'W', 'c']);
    const data = new Float32Array([1, 0.5, 0, 0.25]);
    assert.deepStrictEqual(Array.from(renderSlice(data, layout, displayRanges(data, 4, layout.stepC, false))), [255, 128, 0, 64]);
});

test('stretches other colour data and its alpha separately', () => {
    const layout = layoutOf([1, 2, 4], ['H', 'W', 'c']);
    const data = new Float64Array([0, 10, 20, 100, 20, 0, 10, 300]);
    const pixels = renderSlice(data, layout, displayRanges(data, 4, layout.stepC, false));
    assert.deepStrictEqual(Array.from(pixels), [0, 128, 255, 0, 255, 0, 128, 255]);
});

test('finds the alpha channel in Fortran order and with other dimensions', () => {
    // Shape (c=2, H=1, W=2) in C order and (H=1, W=2, c=2) in Fortran order put alpha at different places.
    const cFirst = sliceLayout([2, 1, 2], computeStrides([2, 1, 2], false), axes('c', 'H', 'W'))!;
    const interleaved = new Float32Array([0, 2, 100, 300]);
    assert.deepStrictEqual(displayRanges(interleaved, 2, cFirst.stepC, false).alpha, { min: 100, range: 200 });

    const fLast = sliceLayout([1, 2, 2], computeStrides([1, 2, 2], true), axes('H', 'W', 'c'))!;
    assert.deepStrictEqual(displayRanges(interleaved, 2, fLast.stepC, false).alpha, { min: 100, range: 200 });
});

test('colour ranges cover the whole array, across constant dimensions', () => {
    // Two RGB images in a batch: the second is brighter, and must not be stretched on its own.
    const shape = [2, 1, 1, 3];
    const data = new Float64Array([0, 1, 2, 2, 3, 4]);
    const held: Axis[] = [{ role: 'const', index: 0 }, { role: 'H', index: 0 }, { role: 'W', index: 0 }, { role: 'c', index: 0 }];
    const layout = sliceLayout(shape, computeStrides(shape, false), held)!;
    assert.deepStrictEqual(displayRanges(data, 3, layout.stepC, false).color, { min: 0, range: 4 });
});

test('colour data is read in Fortran order too', () => {
    // 1x2 pixels with 3 channels, stored channel by channel
    const shape = [1, 2, 3];
    const layout = sliceLayout(shape, computeStrides(shape, true), axes('H', 'W', 'c'))!;
    const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
    assert.deepStrictEqual(Array.from(renderSlice(data, layout, displayRanges(data, 3, layout.stepC, true))), [1, 3, 5, 255, 2, 4, 6, 255]);
});

test('reports the colour a pixel is drawn in', () => {
    assert.deepStrictEqual(pixelColor([5], GRAY_0_TO_10), [128, 128, 128, 255]);
    const bytes = { color: { min: 0, range: 255 }, alpha: { min: 0, range: 255 } };
    assert.deepStrictEqual(pixelColor([100, 50], bytes), [100, 100, 100, 50]);
    assert.deepStrictEqual(pixelColor([10, 20, 30, 40], bytes), [10, 20, 30, 40]);
    assert.deepStrictEqual(pixelColor([10, 20, 30], { color: bytes.color }), [10, 20, 30, 255]);
    assert.deepStrictEqual(pixelColor([NaN], GRAY_0_TO_10), [0, 0, 0, 255]);
});

test('reads every channel of a pixel and marks the colour dimension in its position', () => {
    const layout = layoutOf([1, 2, 3], ['H', 'W', 'c']);
    assert.deepStrictEqual(readPixel(new Uint8Array([10, 20, 30, 40, 50, 60]), layout, 0, 1), [40, 50, 60]);
    assert.deepStrictEqual(pixelCoords(axes('H', 'W', 'c'), layout, 0, 1), [0, 1, ':']);
    assert.deepStrictEqual(pixelCoords(axes('const', 'H', 'W'), layoutOf([2, 4, 5], ['const', 'H', 'W']), 3, 4), [0, 3, 4]);
});

test('names dtypes readably', () => {
    assert.strictEqual(dtypeName('<f8'), 'float64');
    assert.strictEqual(dtypeName('|u1'), 'uint8');
    assert.strictEqual(dtypeName('>i2'), 'int16');
    assert.strictEqual(dtypeName('|b1'), 'bool');
    assert.strictEqual(dtypeName('<c16'), '<c16');
});
