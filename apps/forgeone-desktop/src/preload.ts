import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('forgeone', {
  runTask: (params: any) => ipcRenderer.invoke('run-task', params),
  approveSession: (sessionId: string) => ipcRenderer.invoke('approve-session', sessionId),
  resumeSession: (sessionId: string) => ipcRenderer.invoke('resume-session', sessionId),
  listPending: () => ipcRenderer.invoke('list-pending'),
  listTraces: () => ipcRenderer.invoke('list-traces'),
  inspectTrace: (sessionId: string) => ipcRenderer.invoke('inspect-trace', sessionId),
  inspectApproval: (sessionId: string) => ipcRenderer.invoke('inspect-approval', sessionId),
  pruneTraces: () => ipcRenderer.invoke('prune-traces'),
  prunePending: () => ipcRenderer.invoke('prune-pending'),
});
