const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
  pickBackgroundImage: () => ipcRenderer.invoke('dialog:pickBackgroundImage'),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (payload) => ipcRenderer.invoke('data:save', payload),
  scanFolders: (folders) => ipcRenderer.invoke('scan:folders', folders),
  rescanTrack: (trackPath) => ipcRenderer.invoke('scan:singleTrack', trackPath),
  readTextFile: (filePath) => ipcRenderer.invoke('file:readText', filePath),
  readImageDataUrl: (filePath) => ipcRenderer.invoke('file:readImageDataUrl', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath),
  readAudioBuffer: (filePath) => ipcRenderer.invoke('audio:readBuffer', filePath),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  showLyricsWindow: () => ipcRenderer.invoke('lyrics:showWindow'),
  hideLyricsWindow: () => ipcRenderer.invoke('lyrics:hideWindow'),
  updateLyricsWindow: (payload) => ipcRenderer.invoke('lyrics:update', payload),
  setLyricsWindowOptions: (options) => ipcRenderer.invoke('lyrics:setOptions', options),
  onLyricsMinimized: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('lyrics:minimized', handler);
    return () => ipcRenderer.removeListener('lyrics:minimized', handler);
  },
  onCloseBehaviorUpdated: (cb) => {
    const handler = (_, behavior) => cb(behavior);
    ipcRenderer.on('settings:closeBehavior', handler);
    return () => ipcRenderer.removeListener('settings:closeBehavior', handler);
  }
});
