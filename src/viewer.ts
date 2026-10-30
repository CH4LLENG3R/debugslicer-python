import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SavedTypes } from './pythonExpression';
import { sanitizePreferences } from './webview/colormap';

// Where saved colormaps and other settings are kept, shared across all workspaces.
const PREFERENCES_KEY = 'debugslicer.preferences';

export interface ViewedVariable {
    // Stays the same across debug runs, so reopening a variable finds its tab.
    key: string;
    name: string;
    npyPath: string;
    // Saves the variable again at a smaller type. Used when the webview runs out of memory.
    saveReduced: () => Promise<SavedTypes>;
}

export class DebugSlicerPanel {
    private static readonly _panels = new Map<string, DebugSlicerPanel>();
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _storage: vscode.Memento;
    private _variable: ViewedVariable;
    private _disposables: vscode.Disposable[] = [];
    private _isReady = false;
    private _pendingMessage: unknown;
    private _version = 0;
    private _isReduced = false;

    public static createOrShow(extensionUri: vscode.Uri, storage: vscode.Memento, variable: ViewedVariable) {
        const existing = DebugSlicerPanel._panels.get(variable.key);
        if (existing) {
            existing._variable = variable;
            existing._panel.reveal();
            existing.loadNpy();
            return;
        }

        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        const panel = vscode.window.createWebviewPanel(
            'debugSlicerViewer',
            `${variable.name} - DebugSlicer`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                // Webviews are destroyed when hidden unless retained, and reloading an array is slower than keeping it.
                retainContextWhenHidden: true,
                // Allow webview to load resources from the media and bundle folders AND the temp folder
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'dist'),
                    vscode.Uri.file(path.dirname(variable.npyPath))
                ]
            }
        );

        const instance = new DebugSlicerPanel(panel, extensionUri, storage, variable);
        DebugSlicerPanel._panels.set(variable.key, instance);
        instance.loadNpy();
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, storage: vscode.Memento, variable: ViewedVariable) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._storage = storage;
        this._variable = variable;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(message => this._onMessage(message), null, this._disposables);
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
    }

    public dispose() {
        DebugSlicerPanel._panels.delete(this._variable.key);
        fs.rmSync(this._variable.npyPath, { force: true });
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    public loadNpy(warning?: string) {
        this._isReduced = warning !== undefined;
        if (fs.existsSync(this._variable.npyPath)) {
            // The file name is reused on every save, so the version stops the webview getting a cached copy.
            const fileUri = vscode.Uri.file(this._variable.npyPath).with({ query: `v=${++this._version}` });
            const webviewUri = this._panel.webview.asWebviewUri(fileUri);

            // Send ONLY the URI string to the webview
            this._postMessage({ command: 'loadNpy', uri: webviewUri.toString(), warning });
        }
    }

    private _postMessage(message: unknown) {
        if (this._isReady) {
            this._panel.webview.postMessage(message);
        } else {
            this._pendingMessage = message;
        }
    }

    private async _onMessage(message: { command: string; error?: string; preferences?: unknown }) {
        if (message.command === 'savePreferences') {
            const preferences = sanitizePreferences(message.preferences);
            await this._storage.update(PREFERENCES_KEY, preferences);
            DebugSlicerPanel._panels.forEach(panel => {
                if (panel !== this && panel._isReady) {
                    panel._panel.webview.postMessage({ command: 'preferences', preferences });
                }
            });
        } else if (message.command === 'ready') {
            this._isReady = true;
            this._panel.webview.postMessage({
                command: 'preferences',
                preferences: sanitizePreferences(this._storage.get(PREFERENCES_KEY)),
            });
            if (this._pendingMessage) {
                this._panel.webview.postMessage(this._pendingMessage);
                this._pendingMessage = undefined;
            }
        } else if (message.command === 'loadTooLarge') {
            await this._retryWithSmallerType(message.error ?? 'out of memory');
        }
    }

    private async _retryWithSmallerType(error: string) {
        const giveUp = (reason: string) => this._postMessage({
            command: 'showError',
            message: `Array too large to load (${error}). ${reason}`
        });

        if (this._isReduced) {
            giveUp('It is already at a smaller type.');
            return;
        }

        try {
            const { original, saved } = await this._variable.saveReduced();
            if (original === saved) {
                giveUp(`Its type ${original} can't be reduced further.`);
                return;
            }
            this.loadNpy(`Too large to load as ${original}, so it is shown as ${saved}. Values may have lost precision.`);
        } catch (e) {
            giveUp(`Saving it at a smaller type failed: ${e}`);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.html');
        const scriptPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'viewer.js');
        let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'viewer.css'));
        const scriptUri = webview.asWebviewUri(scriptPath);
        const nonce = getNonce();
        html = html.replace('{{styleUri}}', styleUri.toString());
        html = html.replace('{{cspSource}}', webview.cspSource);
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
