/**
 * Safe Exam Browser - Preload Bridge
 * Exposes safe, read-only system metadata to the candidate portal
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('safeExamBrowser', {
  isSafeExamBrowser: true,
  version: '1.0.0',
  platform: process.platform,
  requestQuit: (password) => ipcRenderer.invoke('seb-request-quit', password),
  triggerExitPrompt: () => ipcRenderer.invoke('seb-trigger-exit-prompt'),
  confirmExit: () => ipcRenderer.invoke('seb-confirm-exit'),
  cancelExitModal: () => ipcRenderer.invoke('seb-cancel-exit-modal'),
  onExitModalState: (callback) => {
    const handler = (_event, isOpen) => callback(isOpen);
    ipcRenderer.on('seb-exit-modal-state', handler);
    return () => ipcRenderer.removeListener('seb-exit-modal-state', handler);
  },
  onSecurityAlert: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('seb-security-alert', handler);
    return () => ipcRenderer.removeListener('seb-security-alert', handler);
  }
});
