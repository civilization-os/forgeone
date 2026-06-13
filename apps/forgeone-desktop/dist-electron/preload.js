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
    inspectApproval: (sessionId) => electron_1.ipcRenderer.invoke('inspect-approval', sessionId),
    pruneTraces: () => electron_1.ipcRenderer.invoke('prune-traces'),
    prunePending: () => electron_1.ipcRenderer.invoke('prune-pending'),
});
