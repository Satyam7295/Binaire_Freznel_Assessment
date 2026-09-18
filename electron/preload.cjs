const { contextBridge, ipcRenderer } = require('electron');

console.log('[DIAG] preload executed');

contextBridge.exposeInMainWorld('electronAPI', {
  appName: 'Panora',
  selectImages: () => ipcRenderer.invoke('select-images')
});