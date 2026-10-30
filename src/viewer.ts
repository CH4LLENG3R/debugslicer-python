import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path'; // Add this import

export class DebugSlicerPanel {
    public static currentPanel: DebugSlicerPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, npyPath: string) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (DebugSlicerPanel.currentPanel) {
            DebugSlicerPanel.currentPanel._panel.reveal(column);
            DebugSlicerPanel.currentPanel.loadNpy(npyPath);
            return;
        }

        // Extract the directory where the NPY file is saved (temp dir)
        const npyDir = vscode.Uri.file(path.dirname(npyPath));

        const panel = vscode.window.createWebviewPanel(
            'debugSlicerViewer',
            'DebugSlicer View',
            column || vscode.ViewColumn.One,
            { 
                enableScripts: true,
                // Allow webview to load resources from both the media folder AND the temp folder
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    npyDir 
                ]
            }
        );

        DebugSlicerPanel.currentPanel = new DebugSlicerPanel(panel, extensionUri);
        DebugSlicerPanel.currentPanel.loadNpy(npyPath);
    }

    // ... (Keep constructor and dispose methods exactly the same) ...
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    public dispose() {
        DebugSlicerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    public loadNpy(npyPath: string) {
        if (fs.existsSync(npyPath)) {
            // Convert the local file path into a secure webview URI
            const fileUri = vscode.Uri.file(npyPath);
            const webviewUri = this._panel.webview.asWebviewUri(fileUri);

            // Send ONLY the URI string to the webview
            this._panel.webview.postMessage({
                command: 'loadNpy',
                uri: webviewUri.toString() 
            });
        }
    }

    // ... (Keep _getHtmlForWebview exactly the same) ...
    private _getHtmlForWebview(webview: vscode.Webview) {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.html');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.js');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        const scriptUri = webview.asWebviewUri(scriptPath);
        const nonce = getNonce();
        html = html.replace('{{scriptUri}}', scriptUri.toString());
        html = html.replace(/{{nonce}}/g, nonce);
        return html;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}