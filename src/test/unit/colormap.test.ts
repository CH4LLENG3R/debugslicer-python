import * as assert from 'assert';
import { test } from 'node:test';
import {
    autoColormap, buildMapper, Colormap, findLabels, GRAY, LABELS, packColor, PRESETS, previewBackground, sanitizePreferences, unpackColor,
} from '../../webview/colormap';

const RED_BLUE: Colormap = { id: 'x', name: 'x', kind: 'continuous', colors: ['#ff0000', '#0000ff'] };
const STEPS: Colormap = { id: 's', name: 's', kind: 'step', colors: ['#ff0000', '#00ff00', '#0000ff'] };
const MAGENTA = [255, 0, 255, 255];

test('packs and unpacks colours', () => {
    assert.deepStrictEqual(unpackColor(packColor(1, 2, 3, 4)), [1, 2, 3, 4]);
    assert.deepStrictEqual(unpackColor(packColor(255, 255, 255)), [255, 255, 255, 255]);
});

test('every preset is well formed and has a unique id', () => {
    assert.strictEqual(new Set(PRESETS.map(map => map.id)).size, PRESETS.length);
    const kept = sanitizePreferences({ colormaps: PRESETS }).colormaps;
    assert.strictEqual(kept.length, PRESETS.length);
});

test('continuous maps blend between their colours', () => {
    const mapper = buildMapper(RED_BLUE, 0, 10);
    assert.deepStrictEqual(unpackColor(mapper(0)), [255, 0, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(10)), [0, 0, 255, 255]);
    const [r, , b] = unpackColor(mapper(5));
    assert.ok(Math.abs(r - 127) <= 1 && Math.abs(b - 128) <= 1, `${r} ${b}`);
});

test('values outside the range stay on its ends', () => {
    const mapper = buildMapper(RED_BLUE, 0, 10);
    assert.deepStrictEqual(unpackColor(mapper(-5)), [255, 0, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(50)), [0, 0, 255, 255]);
});

test('invalid values get their own colour in every kind of map', () => {
    for (const mapper of [buildMapper(RED_BLUE, 0, 10), buildMapper(STEPS, 0, 10), buildMapper(STEPS, 0, 10, [0, 1])]) {
        for (const value of [NaN, Infinity, -Infinity]) {
            assert.deepStrictEqual(unpackColor(mapper(value)), MAGENTA);
        }
    }
});

test('step maps cut data without labels into equal bands', () => {
    const mapper = buildMapper(STEPS, 0, 3);
    assert.deepStrictEqual(unpackColor(mapper(0.5)), [255, 0, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(1.5)), [0, 255, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(3)), [0, 0, 255, 255]);
});

test('step maps give labels their colours in order, repeating when they run out', () => {
    const mapper = buildMapper(STEPS, 0, 100, [1, 5, 100, 200]);
    assert.deepStrictEqual(unpackColor(mapper(1)), [255, 0, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(5)), [0, 255, 0, 255]);
    assert.deepStrictEqual(unpackColor(mapper(100)), [0, 0, 255, 255]);
    assert.deepStrictEqual(unpackColor(mapper(200)), [255, 0, 0, 255]);
});

test('the Labels preset keeps 0 black and gives every other label a unique colour', () => {
    const labels = Array.from({ length: 300 }, (_, i) => i);
    const mapper = buildMapper(LABELS, 0, 299, labels);
    assert.deepStrictEqual(unpackColor(mapper(0)), [0, 0, 0, 255]);
    assert.strictEqual(new Set(labels.map(mapper)).size, 300);
});

test('labels far apart and negative labels are unique too', () => {
    const labels = [-5, 0, 3, 17, 200, 1000, 70000, 5000000];
    const mapper = buildMapper(LABELS, -5, 5000005, labels);
    assert.strictEqual(new Set(labels.map(mapper)).size, labels.length);
    assert.deepStrictEqual(unpackColor(mapper(0)), [0, 0, 0, 255]);
    assert.notDeepStrictEqual(unpackColor(mapper(-5)), MAGENTA);
});

test('finds labels in any numeric type, sorted', () => {
    assert.deepStrictEqual(findLabels(new Uint8Array([3, 1, 3, 2]), 1, 3), [1, 2, 3]);
    assert.deepStrictEqual(findLabels(new Int32Array([-5, 70000, 0]), -5, 70000), [-5, 0, 70000]);
    assert.deepStrictEqual(findLabels(new Int32Array([-2000000, 2000000]), -2000000, 2000000), [-2000000, 2000000]);
    assert.deepStrictEqual(findLabels(new Float64Array([1, 2, 1]), 1, 2), [1, 2]);
    assert.deepStrictEqual(findLabels(new Float64Array([1, NaN, Infinity]), 1, 2), [1]);
});

test('finds no labels in fractional data or when there are too many', () => {
    assert.strictEqual(findLabels(new Float32Array([0.5, 1]), 0.5, 1), undefined);
    assert.strictEqual(findLabels(new Uint8Array([1, 2, 3]), 1, 3, 2), undefined);
    assert.strictEqual(findLabels(new Int32Array([-2000000, 0, 2000000]), -2000000, 2000000, 2), undefined);
});

test('an array with no finite values has no labels and does not throw', () => {
    assert.deepStrictEqual(findLabels(new Float32Array([NaN]), Infinity, -Infinity), []);
});

test('auto uses labels only for few distinct whole numbers', () => {
    assert.strictEqual(autoColormap([0, 1, 2]), LABELS);
    assert.strictEqual(autoColormap(Array.from({ length: 64 }, (_, i) => i)), LABELS);
    assert.strictEqual(autoColormap(Array.from({ length: 65 }, (_, i) => i)), GRAY);
    assert.strictEqual(autoColormap(undefined), GRAY);
});

test('previews show blends and hard steps', () => {
    assert.strictEqual(previewBackground(RED_BLUE), 'linear-gradient(to right, #ff0000, #0000ff)');
    assert.match(previewBackground({ kind: 'step', colors: ['#ff0000', '#0000ff'] }), /#ff0000 0% 50%, #0000ff 50% 100%/);
});

test('drops stored preferences that are not usable', () => {
    assert.deepStrictEqual(sanitizePreferences(undefined), { colormaps: [], captions: 'names' });
    assert.deepStrictEqual(sanitizePreferences('nonsense'), { colormaps: [], captions: 'names' });
    const good = { id: 'a', name: 'A', kind: 'step', colors: ['#000000', '#ffffff'] };
    const bad = [{ id: 'b' }, { ...good, colors: ['red', 'blue'] }, { ...good, colors: ['#000000'] }, { ...good, kind: 'other' }, null];
    const kept = sanitizePreferences({ colormaps: [good, ...bad], captions: 'planes' });
    assert.deepStrictEqual(kept, { colormaps: [good], captions: 'planes' });
});
