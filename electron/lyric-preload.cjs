const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricAPI', {
  onUpdate: (cb) => {
    const handler = (_, payload) => cb(payload || {});
    ipcRenderer.on('lyrics:update', handler);
    return () => ipcRenderer.removeListener('lyrics:update', handler);
  },
  onOptions: (cb) => {
    const handler = (_, options) => cb(options || {});
    ipcRenderer.on('lyrics:options', handler);
    return () => ipcRenderer.removeListener('lyrics:options', handler);
  },
  minimizeWindow: () => ipcRenderer.invoke('lyrics:minimizeFromWindow')
});
