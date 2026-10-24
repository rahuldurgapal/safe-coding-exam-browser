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
  onSecurityAlert: (callback) => {
    ipcRenderer.on('seb-security-alert', (_event, data) => callback(data));
  }
});
