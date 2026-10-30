import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DebugSlicerPanel, ViewedVariable } from '../viewer';

const extensionUri = vscode.Uri.file(path.join(__dirname, '../..'));

function openTabLabels(): string[] {
    return vscode.window.tabGroups.all
        .flatMap(group => group.tabs)
        .filter(tab => tab.input instanceof vscode.TabInputWebview)
        .map(tab => tab.label);
}

// VS Code updates its tab list asynchronously after a panel is created.
async function waitForTabs(count: number): Promise<string[]> {
    for (let i = 0; i < 50 && openTabLabels().length !== count; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    return openTabLabels();
}

suite('DebugSlicer tabs', () => {
    let dir: string;

    function variable(key: string, name: string): ViewedVariable {
        const npyPath = path.join(dir, key + '.npy');
        fs.writeFileSync(npyPath, '');
        return {
            key,
            name,
            npyPath,
            saveReduced: async () => ({ original: '<f8', saved: '<f4' }),
        };
    }

    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'debugslicer-test-'));
    });

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('opens a tab named after each variable', async () => {
        DebugSlicerPanel.createOrShow(extensionUri, variable('a', 'image'));
        DebugSlicerPanel.createOrShow(extensionUri, variable('b', 'mask'));
        assert.deepStrictEqual((await waitForTabs(2)).sort(), ['image - DebugSlicer', 'mask - DebugSlicer']);
    });

    test('reuses the tab when the same variable is reopened', async () => {
        DebugSlicerPanel.createOrShow(extensionUri, variable('a', 'image'));
        await waitForTabs(1);
        DebugSlicerPanel.createOrShow(extensionUri, variable('a', 'image'));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.deepStrictEqual(openTabLabels(), ['image - DebugSlicer']);
    });

    test('keeps same-named variables from different frames apart', async () => {
        DebugSlicerPanel.createOrShow(extensionUri, variable('f-x', 'x'));
        DebugSlicerPanel.createOrShow(extensionUri, variable('g-x', 'x'));
        assert.strictEqual((await waitForTabs(2)).length, 2);
    });

    test('deletes the temp file when the tab closes', async () => {
        const viewed = variable('a', 'image');
        DebugSlicerPanel.createOrShow(extensionUri, viewed);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        assert.ok(!fs.existsSync(viewed.npyPath));
    });
});
