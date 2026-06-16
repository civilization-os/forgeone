"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('forgeone', {
    runTask: (params) => electron_1.ipcRenderer.invoke('run-task', params),
    approveSession: (sessionId) => electron_1.ipcRenderer.invoke('approve-session', sessionId),
    resumeSession: (sessionId) => electron_1.ipcRenderer.invoke('resume-session', sessionId),
    listPending: () => electron_1.ipcRenderer.invoke('list-pending'),
    listTraces: () => electron_1.ipcRenderer.invoke('list-traces'),
    inspectTrace: (sessionId) => electron_1.ipcRenderer.invoke('inspect-trace', sessionId),
    deleteTrace: (sessionId) => electron_1.ipcRenderer.invoke('delete-trace', sessionId),
    inspectApproval: (sessionId) => electron_1.ipcRenderer.invoke('inspect-approval', sessionId),
    pruneTraces: () => electron_1.ipcRenderer.invoke('prune-traces'),
    prunePending: () => electron_1.ipcRenderer.invoke('prune-pending'),
    minimizeWindow: () => electron_1.ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => electron_1.ipcRenderer.invoke('window:toggle-maximize'),
    closeWindow: () => electron_1.ipcRenderer.invoke('window:close'),
    getWindowState: () => electron_1.ipcRenderer.invoke('window:get-state'),
    onWindowStateChange: (listener) => {
        const subscription = (_event, state) => listener(state);
        electron_1.ipcRenderer.on('window-state-changed', subscription);
        return () => electron_1.ipcRenderer.removeListener('window-state-changed', subscription);
    },
    readDir: (dirPath) => electron_1.ipcRenderer.invoke('fs:read-dir', dirPath),
    readFile: (filePath) => electron_1.ipcRenderer.invoke('fs:read-file', filePath),
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('fs:write-file', filePath, content),
    selectDir: () => electron_1.ipcRenderer.invoke('fs:select-dir'),
});
