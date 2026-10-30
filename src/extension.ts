import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSaveExpression, parseSaveResult, SavedTypes, SUPPORTED_TYPE_PATTERN } from './pythonExpression';
import { DebugSlicerPanel } from './viewer';

interface FrameInfo {
    frameId?: number;
    // Identifies the frame across debug runs, unlike frameId.
    location: string;
}

export function activate(context: vscode.ExtensionContext) {
    // Each tab saves its variable to its own file in here.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debugslicer-'));
    context.subscriptions.push({ dispose: () => fs.rmSync(tempDir, { recursive: true, force: true }) });

    let disposable = vscode.commands.registerCommand('debugslicer.view', async (contextNode) => {
        const session = vscode.debug.activeDebugSession;
        if (!session) {return;}

        const dapVariable = contextNode?.variable || contextNode;

        // 1. Grab the variable type string returned by the debugger
        const varType = dapVariable?.type || '';
        const varName = dapVariable?.evaluateName || dapVariable?.name;

        if (!varName) {return;}

        // 2. The menu's when clause already filters on this, but the command can be run from elsewhere
        if (!SUPPORTED_TYPE_PATTERN.test(varType)) {
            vscode.window.showWarningMessage(`DebugSlicer: '${varName}' of type '${varType}' is not a supported array or image.`);
            return; // Exit early, do nothing else
        }

        const frame = await resolveFrame(session);
        const key = `${frame.location}|${varName}`;
        const npyPath = path.join(tempDir, crypto.createHash('sha1').update(key).digest('hex') + '.npy');

        try {
            await saveVariable(session, varName, npyPath, frame.frameId, false);

            if (fs.existsSync(npyPath)) {
                DebugSlicerPanel.createOrShow(context.extensionUri, context.globalState, {
                    key,
                    name: varName,
                    npyPath,
                    saveReduced: () => saveVariable(session, varName, npyPath, frame.frameId, true),
                });
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to evaluate variable: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
}

async function saveVariable(session: vscode.DebugSession, varName: string, npyPath: string, frameId: number | undefined, reduce: boolean): Promise<SavedTypes> {
    // Large arrays take a while to write, and no tab is open yet to show that something is happening.
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `DebugSlicer: reading ${varName}` }, async () => {
        const response = await session.customRequest('evaluate', {
            expression: buildSaveExpression(varName, npyPath, reduce),
            context: 'repl',
            frameId
        });
        return parseSaveResult(response.result);
    });
}

// Uses the frame selected in the UI, falling back to the top frame of the first thread that has one.
async function resolveFrame(session: vscode.DebugSession): Promise<FrameInfo> {
    const item = vscode.debug.activeStackItem;
    const isOurs = item?.session.id === session.id;
    const selectedFrameId = isOurs && item instanceof vscode.DebugStackFrame ? item.frameId : undefined;

    try {
        const threadIds: number[] = isOurs
            ? [item.threadId]
            : (await session.customRequest('threads')).threads.map((thread: { id: number }) => thread.id);

        for (const threadId of threadIds) {
            const stack = await session.customRequest('stackTrace', { threadId });
            const frames: { id: number; name: string; source?: { path?: string } }[] = stack.stackFrames ?? [];
            const frame = frames.find(f => f.id === selectedFrameId) ?? frames[0];
            if (frame) {
                return { frameId: selectedFrameId ?? frame.id, location: `${frame.source?.path}|${frame.name}` };
            }
        }
    } catch (e) {
        console.error('Could not fetch stack frames:', e);
    }
    return { frameId: selectedFrameId, location: '' };
}

export function deactivate() {}
