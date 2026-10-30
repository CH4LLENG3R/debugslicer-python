import * as assert from 'assert';
import { test } from 'node:test';
import { DONATE_MESSAGES, pickDonateMessage } from '../../webview/donate';

test('any random number picks a message, and all of them can come up', () => {
    assert.strictEqual(pickDonateMessage(() => 0), DONATE_MESSAGES[0]);
    assert.strictEqual(pickDonateMessage(() => 0.999), DONATE_MESSAGES[DONATE_MESSAGES.length - 1]);
    const picked = DONATE_MESSAGES.map((_, i) => pickDonateMessage(() => i / DONATE_MESSAGES.length));
    assert.deepStrictEqual(picked, DONATE_MESSAGES);
});
