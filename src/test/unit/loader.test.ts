import * as assert from 'assert';
import { test } from 'node:test';
import { loadNpy } from '../../webview/loader';

function fetchReturning(response: Partial<Response>): typeof fetch {
    return (async () => ({ ok: true, ...response })) as unknown as typeof fetch;
}

test('reports running out of memory as too large', async () => {
    const result = await loadNpy('x', fetchReturning({
        arrayBuffer: async () => { throw new RangeError('Array buffer allocation failed'); },
    }));
    assert.deepStrictEqual(result, { kind: 'tooLarge', error: 'Array buffer allocation failed' });
});

test('does not retry a bad file with a smaller type', async () => {
    const result = await loadNpy('x', fetchReturning({ arrayBuffer: async () => new ArrayBuffer(64) }));
    assert.strictEqual(result.kind, 'error');
});

test('reports HTTP failures as errors', async () => {
    const result = await loadNpy('x', fetchReturning({ ok: false, status: 404 }));
    assert.deepStrictEqual(result, { kind: 'error', error: 'HTTP error! status: 404' });
});
