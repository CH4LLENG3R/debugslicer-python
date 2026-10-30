import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { test } from 'node:test';
import { buildSaveExpression, parseSaveResult, SUPPORTED_TYPE_PATTERN } from '../../pythonExpression';

test('accepts array and image types only', () => {
    for (const type of ['ndarray', 'Tensor', 'Parameter', 'Image', 'PngImageFile', 'JpegImageFile']) {
        assert.ok(SUPPORTED_TYPE_PATTERN.test(type), type);
    }
    for (const type of ['', 'str', 'list', 'Nifti1Image', 'ImageDraw', 'TensorDataset']) {
        assert.ok(!SUPPORTED_TYPE_PATTERN.test(type), type);
    }
});

test('the menu when clause uses the same pattern', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8'));
    const when: string = manifest.contributes.menus['debug/variables/context'][0].when;
    assert.ok(when.includes(`variableType =~ ${SUPPORTED_TYPE_PATTERN}`), when);
});

test('escapes the path and passes the variable to the outer call', () => {
    const expression = buildSaveExpression('self.x', 'C:\\temp\\a.npy', false);
    assert.ok(expression.includes('path="C:\\\\temp\\\\a.npy"'));
    assert.ok(expression.endsWith(')(self.x)'));
});

test('parses the result as shown by the debugger', () => {
    assert.deepStrictEqual(parseSaveResult("'<f8 <f4'"), { original: '<f8', saved: '<f4' });
});
