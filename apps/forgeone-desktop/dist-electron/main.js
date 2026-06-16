"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = require("path");
const http = require("http");
const https = require("https");
const child_process_1 = require("child_process");
const fs = require("fs/promises");
let mainWindow = null;
let serverProcess = null;
const pendingRequests = new Map();
let requestIdCounter = 1;
const allowDevTools = process.env.FORGEONE_ENABLE_DEVTOOLS === '1';
function emitWindowState(window = mainWindow) {
    if (!window)
        return;
    window.webContents.send('window-state-changed', {
        isMaximized: window.isMaximized(),
    });
}
function isDevToolsShortcut(input) {
    const key = input.key.toLowerCase();
    return (!allowDevTools &&
        (key === 'f12' ||
            ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key))));
}
function canReachUrl(url, timeoutMs = 1200) {
    return new Promise((resolve) => {
        const transport = url.startsWith('https:') ? https : http;
        const request = transport.request(url, { method: 'GET', timeout: timeoutMs }, (response) => {
            response.resume();
            resolve(true);
        });
        request.on('timeout', () => {
            request.destroy();
            resolve(false);
        });
        request.on('error', () => resolve(false));
        request.end();
    });
}
function startSidecar() {
    const isDev = !electron_1.app.isPackaged;
    let binPath = '';
    if (isDev) {
        // __dirname is dist-electron. target/debug is at ../../../target/debug/
        binPath = path.join(__dirname, '../../../target/debug/forgeone-server.exe');
    }
    else {
        binPath = path.join(process.resourcesPath, 'forgeone-server.exe');
    }
    console.log(`Spawning sidecar backend from: ${binPath}`);
    serverProcess = (0, child_process_1.spawn)(binPath);
    // Buffer incomplete lines
    let buffer = '';
    serverProcess.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line
        for (const line of lines) {
            if (!line.trim())
                continue;
            try {
                const response = JSON.parse(line);
                if (response.id !== undefined && response.id !== null) {
                    const pending = pendingRequests.get(response.id);
                    if (pending) {
                        pendingRequests.delete(response.id);
                        if (response.error) {
                            pending.reject(response.error);
                        }
                        else {
                            pending.resolve(response.result);
                        }
                    }
                }
            }
            catch (e) {
                console.error('Failed to parse line from sidecar:', line, e);
            }
        }
    });
    serverProcess.stderr.on('data', (data) => {
        console.error(`Sidecar Stderr: ${data}`);
    });
    serverProcess.on('close', (code) => {
        console.log(`Sidecar exited with code ${code}`);
        serverProcess = null;
    });
}
function sendRpcRequest(method, params) {
    return new Promise((resolve, reject) => {
        if (!serverProcess) {
            return reject(new Error('Sidecar backend is not running.'));
        }
        const id = requestIdCounter++;
        pendingRequests.set(id, { resolve, reject });
        const requestPayload = {
            jsonrpc: '2.0',
            id,
            method,
            params,
        };
        serverProcess.stdin.write(JSON.stringify(requestPayload) + '\n');
    });
}
async function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1100,
        minHeight: 720,
        frame: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: false,
        autoHideMenuBar: true,
        backgroundColor: '#f9f9f7',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            devTools: allowDevTools,
        },
    });
    electron_1.Menu.setApplicationMenu(null);
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (isDevToolsShortcut(input)) {
            event.preventDefault();
        }
    });
    const devServerUrl = 'http://localhost:5173';
    const builtIndexPath = path.join(__dirname, '../dist/index.html');
    const shouldUseDevServer = !electron_1.app.isPackaged && await canReachUrl(devServerUrl);
    if (shouldUseDevServer) {
        await mainWindow.loadURL(devServerUrl);
        if (allowDevTools) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
    }
    else {
        await mainWindow.loadFile(builtIndexPath);
    }
    mainWindow.on('maximize', () => emitWindowState(mainWindow));
    mainWindow.on('unmaximize', () => emitWindowState(mainWindow));
    mainWindow.on('enter-full-screen', () => emitWindowState(mainWindow));
    mainWindow.on('leave-full-screen', () => emitWindowState(mainWindow));
    mainWindow.once('ready-to-show', () => emitWindowState(mainWindow));
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
electron_1.app.whenReady().then(async () => {
    startSidecar();
    await createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// Register IPC handlers to forward calls to the Rust Sidecar
electron_1.ipcMain.handle('run-task', async (_, params) => {
    return sendRpcRequest('run', params);
});
electron_1.ipcMain.handle('approve-session', async (_, sessionId) => {
    return sendRpcRequest('approve', { session_id: sessionId });
});
electron_1.ipcMain.handle('resume-session', async (_, sessionId) => {
    return sendRpcRequest('resume', { session_id: sessionId });
});
electron_1.ipcMain.handle('list-pending', async () => {
    return sendRpcRequest('list_pending');
});
electron_1.ipcMain.handle('list-traces', async () => {
    return sendRpcRequest('list_traces');
});
electron_1.ipcMain.handle('inspect-trace', async (_, sessionId) => {
    return sendRpcRequest('inspect_trace', { session_id: sessionId });
});
electron_1.ipcMain.handle('delete-trace', async (_, sessionId) => {
    return sendRpcRequest('delete_trace', { session_id: sessionId });
});
electron_1.ipcMain.handle('inspect-approval', async (_, sessionId) => {
    return sendRpcRequest('inspect_approval', { session_id: sessionId });
});
electron_1.ipcMain.handle('prune-traces', async () => {
    return sendRpcRequest('prune_traces');
});
electron_1.ipcMain.handle('prune-pending', async () => {
    return sendRpcRequest('prune_pending');
});
electron_1.ipcMain.handle('window:minimize', (event) => {
    electron_1.BrowserWindow.fromWebContents(event.sender)?.minimize();
});
electron_1.ipcMain.handle('window:toggle-maximize', (event) => {
    const window = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return;
    if (window.isMaximized()) {
        window.unmaximize();
    }
    else {
        window.maximize();
    }
});
electron_1.ipcMain.handle('window:close', (event) => {
    electron_1.BrowserWindow.fromWebContents(event.sender)?.close();
});
electron_1.ipcMain.handle('window:get-state', (event) => {
    const window = electron_1.BrowserWindow.fromWebContents(event.sender);
    return {
        isMaximized: window?.isMaximized() ?? false,
    };
});
electron_1.ipcMain.handle('fs:select-dir', async (event) => {
    const window = electron_1.BrowserWindow.fromWebContents(event.sender);
    if (!window)
        return null;
    const result = await electron_1.dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});
electron_1.ipcMain.handle('fs:read-dir', async (_, dirPath) => {
    try {
        const resolvedPath = path.resolve(dirPath);
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
        return entries
            .filter(entry => !['node_modules', '.git', 'dist', 'dist-electron', '.gemini', '.idea', '.vscode'].includes(entry.name))
            .map(entry => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
            path: path.join(resolvedPath, entry.name),
        }));
    }
    catch (err) {
        return { error: err.message };
    }
});
electron_1.ipcMain.handle('fs:read-file', async (_, filePath) => {
    try {
        const content = await fs.readFile(path.resolve(filePath), 'utf-8');
        return { content };
    }
    catch (err) {
        return { error: err.message };
    }
});
electron_1.ipcMain.handle('fs:write-file', async (_, filePath, content) => {
    try {
        await fs.writeFile(path.resolve(filePath), content, 'utf-8');
        return { success: true };
    }
    catch (err) {
        return { error: err.message };
    }
});
