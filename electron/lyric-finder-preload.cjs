const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lyricFinderAPI', {
  onOpenUrl: (cb) => {
    const handler = (_, url) => cb(url);
    ipcRenderer.on('lyric-finder:open-url', handler);
    return () => ipcRenderer.removeListener('lyric-finder:open-url', handler);
  }
});
