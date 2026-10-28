import * as vscode from 'vscode';
import * as fs from 'fs';
import { DebugSlicerPanel } from './viewer';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('debugslicer.view', async (contextNode) => {
        const session = vscode.debug.activeDebugSession;
        if (!session) {return;}

        const dapVariable = contextNode?.variable || contextNode;
        
        // 1. Grab the variable type string returned by the debugger
        const varType = dapVariable?.type || '';
        const varName = dapVariable?.evaluateName || dapVariable?.name;

        if (!varName) {return;}

        // 2. Check if the type string contains our target classes
        // This safely matches 'ndarray', 'Tensor', 'Image', 'PngImageFile', etc.
        const isSupportedType = /ndarray|Tensor|Image/i.test(varType);

        if (!isSupportedType) {
            vscode.window.showWarningMessage(`DebugSlicer: '${varName}' of type '${varType}' is not a supported array or image.`);
            return; // Exit early, do nothing else
        }

        // Fetch the active frameId
        let activeFrameId: number | undefined;
        try {
            const threads = await session.customRequest('threads');
            for (const thread of threads.threads) {
                try {
                    const stack = await session.customRequest('stackTrace', { threadId: thread.id, levels: 1 });
                    if (stack.stackFrames && stack.stackFrames.length > 0) {
                        activeFrameId = stack.stackFrames[0].id;
                        break;
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error('Could not fetch threads:', e);
        }

        // Build and execute the Python expression
        const pyExpr = `(lambda v, path=__import__('os').path.join(__import__('tempfile').gettempdir(), 'ds_out.npy'), np=__import__('numpy'): (np.save(path, v.detach().cpu().numpy() if type(v).__name__ == 'Tensor' else np.array(v)), path)[1])(${varName})`;

        try {
            const response = await session.customRequest('evaluate', {
                expression: pyExpr,
                context: 'repl',
                frameId: activeFrameId 
            });

            const savedPath = response.result.replace(/(^'|'$)/g, ''); 
            
            if (fs.existsSync(savedPath)) {
                // Replace the toast message with this line to open the Webview!
                DebugSlicerPanel.createOrShow(context.extensionUri, savedPath);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to evaluate variable: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}