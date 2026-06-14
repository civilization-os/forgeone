import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('forgeone', {
  runTask: (params: any) => ipcRenderer.invoke('run-task', params),
  approveSession: (sessionId: string) => ipcRenderer.invoke('approve-session', sessionId),
  resumeSession: (sessionId: string) => ipcRenderer.invoke('resume-session', sessionId),
  listPending: () => ipcRenderer.invoke('list-pending'),
  listTraces: () => ipcRenderer.invoke('list-traces'),
  inspectTrace: (sessionId: string) => ipcRenderer.invoke('inspect-trace', sessionId),
  deleteTrace: (sessionId: string) => ipcRenderer.invoke('delete-trace', sessionId),
  inspectApproval: (sessionId: string) => ipcRenderer.invoke('inspect-approval', sessionId),
  pruneTraces: () => ipcRenderer.invoke('prune-traces'),
  prunePending: () => ipcRenderer.invoke('prune-pending'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getWindowState: () => ipcRenderer.invoke('window:get-state'),
  onWindowStateChange: (listener: (state: { isMaximized: boolean }) => void) => {
    const subscription = (_event: unknown, state: { isMaximized: boolean }) => listener(state);
    ipcRenderer.on('window-state-changed', subscription);
    return () => ipcRenderer.removeListener('window-state-changed', subscription);
  },
});
