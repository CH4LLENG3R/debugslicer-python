import * as vscode from 'vscode';
import * as fs from 'fs';

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

        const panel = vscode.window.createWebviewPanel(
            'debugSlicerViewer',
            'DebugSlicer View',
            column || vscode.ViewColumn.One,
            { 
                enableScripts: true,
                // Restrict the webview to only load content from our extension's `media` directory.
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        DebugSlicerPanel.currentPanel = new DebugSlicerPanel(panel, extensionUri);
        DebugSlicerPanel.currentPanel.loadNpy(npyPath);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Build the HTML by loading it from the media folder
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    public loadNpy(npyPath: string) {
        if (fs.existsSync(npyPath)) {
            const fileData = fs.readFileSync(npyPath);
            this._panel.webview.postMessage({
                command: 'loadNpy',
                bufferData: fileData 
            });
        }
    }

    public dispose() {
        DebugSlicerPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // 1. Get paths to the HTML and JS files
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.html');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.js');

        // 2. Read the raw HTML file from disk
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

        // 3. Convert the JS file path to a special URI that VS Code allows in webviews
        const scriptUri = webview.asWebviewUri(scriptPath);

        // 4. Generate a random nonce for the Content Security Policy
        const nonce = getNonce();

        // 5. Inject the URI and Nonce into the HTML string
        html = html.replace('{{scriptUri}}', scriptUri.toString());
        html = html.replace(/{{nonce}}/g, nonce);

        return html;
    }
}

// Helper to generate a random string for Content Security Policy
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}