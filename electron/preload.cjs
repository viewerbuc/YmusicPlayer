const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolders: () => ipcRenderer.invoke('dialog:pickFolders'),
  pickBackgroundImage: () => ipcRenderer.invoke('dialog:pickBackgroundImage'),
  pickLyricFile: () => ipcRenderer.invoke('dialog:pickLyricFile'),
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (payload) => ipcRenderer.invoke('data:save', payload),
  syncPlaybackSession: (patch) => ipcRenderer.send('session:sync', patch),
  scanFolders: (folders) => ipcRenderer.invoke('scan:folders', folders),
  scanDroppedPaths: (paths) => ipcRenderer.invoke('scan:droppedPaths', paths),
  rescanTrack: (trackPath) => ipcRenderer.invoke('scan:singleTrack', trackPath),
  getOnlineSources: () => ipcRenderer.invoke('online:sources'),
  searchOnlineMusic: (payload) => ipcRenderer.invoke('online:search', payload),
  cancelOnlineSearch: () => ipcRenderer.invoke('online:cancelSearch'),
  downloadOnlineMusic: (payload) => ipcRenderer.invoke('online:download', payload),
  pickDownloadFolder: () => ipcRenderer.invoke('dialog:pickDownloadFolder'),
  getDefaultDownloadFolder: () => ipcRenderer.invoke('online:defaultDownloadFolder'),
  readTextFile: (filePath) => ipcRenderer.invoke('file:readText', filePath),
  readTextFileWithEncoding: (filePath, encoding) => ipcRenderer.invoke('file:readTextWithEncoding', filePath, encoding),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('file:writeText', filePath, content),
  readImageDataUrl: (filePath) => ipcRenderer.invoke('file:readImageDataUrl', filePath),
  getLocalImageUrl: (filePath) => ipcRenderer.invoke('file:getImageUrl', filePath),
  readTrackCoverDataUrl: (filePath) => ipcRenderer.invoke('track:readCoverDataUrl', filePath),
  installLyricForTrack: (trackPath, lyricPath) => ipcRenderer.invoke('lyrics:installForTrack', trackPath, lyricPath),
  setLyricDownloadTarget: (trackPath) => ipcRenderer.invoke('lyrics:setDownloadTarget', trackPath),
  clearLyricDownloadTarget: () => ipcRenderer.invoke('lyrics:clearDownloadTarget'),
  openLyricFinderWindow: (payload) => ipcRenderer.invoke('lyrics:openFinderWindow', payload),
  shiftAndSaveLyrics: (lyricPath, offsetSec) => ipcRenderer.invoke('lyrics:shiftAndSave', lyricPath, offsetSec),
  saveAlignedLyrics: (payload) => ipcRenderer.invoke('lyrics:saveAligned', payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke('file:showInFolder', filePath),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  prepareAudioSource: (filePath) => ipcRenderer.invoke('audio:prepareSource', filePath),
  readAudioBuffer: (filePath) => ipcRenderer.invoke('audio:readBuffer', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile ? webUtils.getPathForFile(file) : (file?.path || '');
    } catch (_) {
      return file?.path || '';
    }
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
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
  onOnlineSearchStatus: (cb) => {
    const handler = (_, payload) => cb(payload || {});
    ipcRenderer.on('online:searchStatus', handler);
    return () => ipcRenderer.removeListener('online:searchStatus', handler);
  },
  onOnlineSearchResults: (cb) => {
    const handler = (_, payload) => cb(payload || {});
    ipcRenderer.on('online:searchResults', handler);
    return () => ipcRenderer.removeListener('online:searchResults', handler);
  },
  onCloseBehaviorUpdated: (cb) => {
    const handler = (_, behavior) => cb(behavior);
    ipcRenderer.on('settings:closeBehavior', handler);
    return () => ipcRenderer.removeListener('settings:closeBehavior', handler);
  },
  onWindowMaximizedChanged: (cb) => {
    const handler = (_, maximized) => cb(!!maximized);
    ipcRenderer.on('window:maximizedChanged', handler);
    return () => ipcRenderer.removeListener('window:maximizedChanged', handler);
  },
  onPlayerCommand: (cb) => {
    const handler = (_, command) => cb(command);
    ipcRenderer.on('player:command', handler);
    return () => ipcRenderer.removeListener('player:command', handler);
  }
});
