import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcessWithoutNullStreams | null = null;
const pendingRequests = new Map<number | string, { resolve: (val: any) => void; reject: (err: any) => void }>();
let requestIdCounter = 1;

function startSidecar() {
  const isDev = !app.isPackaged;
  let binPath = '';
  if (isDev) {
    // __dirname is dist-electron. target/debug is at ../../../target/debug/
    binPath = path.join(__dirname, '../../../target/debug/forgeone-server.exe');
  } else {
    binPath = path.join(process.resourcesPath, 'forgeone-server.exe');
  }

  console.log(`Spawning sidecar backend from: ${binPath}`);
  serverProcess = spawn(binPath);

  // Buffer incomplete lines
  let buffer = '';

  serverProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (response.id !== undefined && response.id !== null) {
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(response.error);
            } else {
              pending.resolve(response.result);
            }
          }
        }
      } catch (e) {
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

function sendRpcRequest(method: string, params?: any): Promise<any> {
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f172a',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startSidecar();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Register IPC handlers to forward calls to the Rust Sidecar
ipcMain.handle('run-task', async (_, params) => {
  return sendRpcRequest('run', params);
});

ipcMain.handle('approve-session', async (_, sessionId) => {
  return sendRpcRequest('approve', { session_id: sessionId });
});

ipcMain.handle('resume-session', async (_, sessionId) => {
  return sendRpcRequest('resume', { session_id: sessionId });
});

ipcMain.handle('list-pending', async () => {
  return sendRpcRequest('list_pending');
});

ipcMain.handle('list-traces', async () => {
  return sendRpcRequest('list_traces');
});

ipcMain.handle('inspect-trace', async (_, sessionId) => {
  return sendRpcRequest('inspect_trace', { session_id: sessionId });
});

ipcMain.handle('inspect-approval', async (_, sessionId) => {
  return sendRpcRequest('inspect_approval', { session_id: sessionId });
});

ipcMain.handle('prune-traces', async () => {
  return sendRpcRequest('prune_traces');
});

ipcMain.handle('prune-pending', async () => {
  return sendRpcRequest('prune_pending');
});
