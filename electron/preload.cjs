const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
  pickBackgroundImage: () => ipcRenderer.invoke('dialog:pickBackgroundImage'),
  pickLyricFile: () => ipcRenderer.invoke('dialog:pickLyricFile'),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (payload) => ipcRenderer.invoke('data:save', payload),
  scanFolders: (folders) => ipcRenderer.invoke('scan:folders', folders),
  rescanTrack: (trackPath) => ipcRenderer.invoke('scan:singleTrack', trackPath),
  readTextFile: (filePath) => ipcRenderer.invoke('file:readText', filePath),
  readTextFileWithEncoding: (filePath, encoding) => ipcRenderer.invoke('file:readTextWithEncoding', filePath, encoding),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('file:writeText', filePath, content),
  readImageDataUrl: (filePath) => ipcRenderer.invoke('file:readImageDataUrl', filePath),
  readTrackCoverDataUrl: (filePath) => ipcRenderer.invoke('track:readCoverDataUrl', filePath),
  installLyricForTrack: (trackPath, lyricPath) => ipcRenderer.invoke('lyrics:installForTrack', trackPath, lyricPath),
  setLyricDownloadTarget: (trackPath) => ipcRenderer.invoke('lyrics:setDownloadTarget', trackPath),
  clearLyricDownloadTarget: () => ipcRenderer.invoke('lyrics:clearDownloadTarget'),
  openLyricFinderWindow: (payload) => ipcRenderer.invoke('lyrics:openFinderWindow', payload),
  shiftAndSaveLyrics: (lyricPath, offsetSec) => ipcRenderer.invoke('lyrics:shiftAndSave', lyricPath, offsetSec),
  showItemInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
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
  onLyricDownloaded: (cb) => {
    const handler = (_, payload) => cb(payload);
    ipcRenderer.on('lyrics:downloaded', handler);
    return () => ipcRenderer.removeListener('lyrics:downloaded', handler);
  },
  onCloseBehaviorUpdated: (cb) => {
    const handler = (_, behavior) => cb(behavior);
    ipcRenderer.on('settings:closeBehavior', handler);
    return () => ipcRenderer.removeListener('settings:closeBehavior', handler);
  }
});
