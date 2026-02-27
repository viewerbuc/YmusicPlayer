const { app, BrowserWindow, dialog, ipcMain, Menu, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const { execFile } = require('child_process');
const mm = require('music-metadata');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wma', '.wav', '.m4a', '.aac', '.ogg']);
const LYRIC_EXT = new Set(['.lrc', '.txt']);

let mainWindow;
let lyricWindow;
let appTray = null;
let isQuitting = false;
let isHandlingClose = false;
let lyricWindowOptions = {
  locked: false,
  clickThrough: false
};
const appIconPath = path.join(__dirname, '..', 'public', 'icon.png');

function execFileAsync(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 512 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function transcodeWmaToWavBuffer(filePath) {
  const args = ['-v', 'error', '-i', filePath, '-f', 'wav', '-acodec', 'pcm_s16le', '-ac', '2', '-ar', '44100', 'pipe:1'];
  try {
    const { stdout } = await execFileAsync('ffmpeg', args);
    return stdout;
  } catch (_) {
    return null;
  }
}

function ensureDataShape(raw) {
  const base = {
    scanFolders: [],
    tracks: [],
    playlists: [{ id: 'favorites', name: '我喜欢', fixed: true, trackIds: [] }],
    settings: {
      showLyrics: true,
      minimizedShowLyrics: false,
      playMode: 'sequence',
      lyricLocked: false,
      lyricClickThrough: false,
      closeBehavior: 'ask',
      backgroundImagePath: '',
      backgroundBlur: 8
    }
  };
  const merged = {
    ...base,
    ...(raw || {}),
    settings: {
      ...base.settings,
      ...((raw && raw.settings) || {})
    }
  };
  if (!Array.isArray(merged.playlists) || !merged.playlists.find((p) => p.id === 'favorites')) {
    merged.playlists = [{ id: 'favorites', name: '我喜欢', fixed: true, trackIds: [] }, ...(merged.playlists || [])];
  }
  const trackMap = new Map();
  for (const t of merged.tracks || []) {
    if (!t?.id) continue;
    if (!trackMap.has(t.id)) trackMap.set(t.id, t);
  }
  merged.tracks = [...trackMap.values()];
  const validTrackIds = new Set(merged.tracks.map((t) => t.id));
  merged.playlists = (merged.playlists || []).map((p) => ({
    ...p,
    trackIds: [...new Set((p.trackIds || []).filter((id) => validTrackIds.has(id)))]
  }));
  return merged;
}

function userDataFile() {
  return path.join(app.getPath('userData'), 'player-data.json');
}

async function loadData() {
  const fp = userDataFile();
  if (!existsSync(fp)) {
    return ensureDataShape(null);
  }
  const raw = await fs.readFile(fp, 'utf8');
  return ensureDataShape(JSON.parse(raw));
}

async function saveData(data) {
  await fs.writeFile(userDataFile(), JSON.stringify(data, null, 2), 'utf8');
}

async function walk(dir, result = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, result);
    } else {
      result.push(full);
    }
  }
  return result;
}

function normalizeId(fp) {
  return fp.replaceAll('\\\\', '/').toLowerCase();
}

function decodeUtf16be(buf) {
  if (buf.length < 2) return '';
  const evenLen = buf.length - (buf.length % 2);
  const swapped = Buffer.allocUnsafe(evenLen);
  for (let i = 0; i < evenLen; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return new TextDecoder('utf-16le').decode(swapped);
}

function scoreDecodedText(txt) {
  if (!txt) return -1e9;
  const bad = (txt.match(/\uFFFD/g) || []).length;
  const hasLrcTag = /\[\d{1,2}:\d{1,2}(?:\.\d+)?\]/.test(txt);
  const cjk = (txt.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  return (hasLrcTag ? 150 : 0) + cjk * 0.2 - bad * 30;
}

function decodeTextSmart(buf) {
  if (!buf || !buf.length) return '';

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return decodeUtf16be(buf.subarray(2));
  }

  const encodings = ['utf-8', 'gb18030', 'gbk', 'big5', 'shift_jis', 'euc-kr', 'utf-16le'];
  let best = '';
  let bestScore = -1e9;
  for (const enc of encodings) {
    try {
      const txt = new TextDecoder(enc).decode(buf);
      const score = scoreDecodedText(txt);
      if (score > bestScore) {
        bestScore = score;
        best = txt;
      }
    } catch (_) {
      // ignore unsupported encoding in runtime
    }
  }
  return best || new TextDecoder('utf-8').decode(buf);
}

function findLyricsForAudio(audioFile, lyricFiles) {
  const parsed = path.parse(audioFile);
  const exactLrc = `${parsed.dir}/${parsed.name}.lrc`;
  const exactTxt = `${parsed.dir}/${parsed.name}.txt`;
  return lyricFiles.find((f) => f === exactLrc || f === exactTxt) || null;
}

async function parseTrack(file, lyricFiles) {
  let metadata = null;
  try {
    metadata = await mm.parseFile(file);
  } catch (_) {
    metadata = null;
  }

  const common = metadata?.common || {};
  const format = metadata?.format || {};
  return {
    id: normalizeId(file),
    path: file,
    title: common.title || path.parse(file).name,
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: Number.isFinite(format.duration) ? Math.round(format.duration) : 0,
    folder: path.dirname(file),
    ext: path.extname(file).toLowerCase(),
    lyricPath: findLyricsForAudio(file, lyricFiles),
    liked: false
  };
}

async function scanFolders(folders, prevData) {
  const allFiles = [];
  for (const folder of folders) {
    if (existsSync(folder)) {
      const files = await walk(folder);
      allFiles.push(...files);
    }
  }

  const normalized = allFiles.map((f) => f.replaceAll('\\\\', '/'));
  const lyricFiles = normalized.filter((f) => LYRIC_EXT.has(path.extname(f).toLowerCase()));
  const audioFiles = normalized.filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));

  const prevLiked = new Set((prevData.tracks || []).filter((t) => t.liked).map((t) => t.id));
  const uniqAudioById = new Map();
  for (const af of audioFiles) {
    const id = normalizeId(af);
    if (!uniqAudioById.has(id)) uniqAudioById.set(id, af);
  }

  const tracks = [];
  for (const af of uniqAudioById.values()) {
    const track = await parseTrack(af, lyricFiles);
    track.liked = prevLiked.has(track.id);
    tracks.push(track);
  }

  const favorites = prevData.playlists.find((p) => p.id === 'favorites') || {
    id: 'favorites',
    name: '我喜欢',
    fixed: true,
    trackIds: []
  };
  favorites.trackIds = tracks.filter((t) => t.liked).map((t) => t.id);

  const otherPlaylists = prevData.playlists.filter((p) => p.id !== 'favorites').map((p) => ({
    ...p,
    trackIds: p.trackIds.filter((id) => tracks.some((t) => t.id === id))
  }));

  return {
    ...prevData,
    scanFolders: folders,
    tracks,
    playlists: [favorites, ...otherPlaylists]
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#101218',
    icon: appIconPath,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl);
  } else {
    const prodIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (existsSync(prodIndex)) mainWindow.loadFile(prodIndex);
    else mainWindow.loadURL(devUrl);
  }
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    handleMainCloseRequest();
  });
  mainWindow.on('closed', () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
    mainWindow = null;
    lyricWindow = null;
  });
}

function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow;
  lyricWindow = new BrowserWindow({
    width: 720,
    height: 210,
    minWidth: 420,
    minHeight: 130,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'lyric-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  lyricWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lyricWindow.setMovable(!lyricWindowOptions.locked);
  lyricWindow.setResizable(!lyricWindowOptions.locked);
  lyricWindow.setIgnoreMouseEvents(!!lyricWindowOptions.clickThrough, { forward: true });
  lyricWindow.loadFile(path.join(__dirname, 'lyrics-window.html'));
  lyricWindow.on('closed', () => {
    lyricWindow = null;
  });
  return lyricWindow;
}

function createTray() {
  if (appTray) return appTray;
  let trayIcon = nativeImage.createFromPath(appIconPath);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAQAAAC1QeVaAAAAI0lEQVR42mP8z8Dwn4EIwDiqA0YxjGIMYxjDGBgYGNQAAHQDBf4l9f7wAAAAAElFTkSuQmCC'
    );
  }
  trayIcon = trayIcon.resize({ width: 18, height: 18 });
  appTray = new Tray(trayIcon);
  appTray.setToolTip('YMusicPlayer');
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开播放器',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        if (appTray) {
          appTray.destroy();
          appTray = null;
        }
        app.quit();
      }
    }
  ]);
  appTray.setContextMenu(contextMenu);
  appTray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  return appTray;
}

async function persistCloseBehavior(nextBehavior) {
  try {
    const data = await loadData();
    data.settings = data.settings || {};
    data.settings.closeBehavior = nextBehavior;
    await saveData(data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings:closeBehavior', nextBehavior);
    }
  } catch (_) {
    // ignore persist failure
  }
}

async function resolveCloseBehavior() {
  const data = await loadData();
  const current = data.settings?.closeBehavior || 'ask';
  if (current !== 'ask') return current;

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '关闭播放器',
    message: '请选择关闭行为',
    detail: '可最小化到系统托盘（Windows 通知区域 / Ubuntu 顶栏托盘）或直接关闭。',
    buttons: ['最小化到托盘', '直接关闭', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    checkboxLabel: '记住我的选择',
    checkboxChecked: false
  });

  if (result.response === 2) return 'cancel';
  const selected = result.response === 0 ? 'tray' : 'exit';
  if (result.checkboxChecked) {
    await persistCloseBehavior(selected);
  }
  return selected;
}

async function handleMainCloseRequest() {
  if (isHandlingClose || !mainWindow || mainWindow.isDestroyed()) return;
  isHandlingClose = true;
  try {
    const behavior = await resolveCloseBehavior();
    if (behavior === 'cancel') return;
    if (behavior === 'tray') {
      createTray();
      if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.hide();
      mainWindow.hide();
      return;
    }
    isQuitting = true;
    if (appTray) {
      appTray.destroy();
      appTray = null;
    }
    app.quit();
  } finally {
    isHandlingClose = false;
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

ipcMain.handle('dialog:pickFolders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:pickBackgroundImage', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
    ]
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('data:load', async () => loadData());
ipcMain.handle('data:save', async (_, data) => saveData(data));
ipcMain.handle('scan:folders', async (_, folders) => {
  const data = await loadData();
  const scanned = await scanFolders(folders, data);
  await saveData(scanned);
  return scanned;
});

ipcMain.handle('scan:singleTrack', async (_, trackPath) => {
  const data = await loadData();
  const files = await walk(path.dirname(trackPath));
  const normalized = files.map((f) => f.replaceAll('\\\\', '/'));
  const lyricFiles = normalized.filter((f) => LYRIC_EXT.has(path.extname(f).toLowerCase()));
  const track = await parseTrack(trackPath.replaceAll('\\\\', '/'), lyricFiles);

  const idx = data.tracks.findIndex((t) => t.id === track.id);
  if (idx >= 0) {
    track.liked = data.tracks[idx].liked;
    data.tracks[idx] = track;
  }

  await saveData(data);
  return track;
});

ipcMain.handle('file:readText', async (_, filePath) => {
  try {
    const buf = await fs.readFile(filePath);
    return decodeTextSmart(buf);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('file:showInFolder', async (_, filePath) => {
  try {
    if (!filePath) return false;
    shell.showItemInFolder(filePath);
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('file:readImageDataUrl', async (_, filePath) => {
  try {
    if (!filePath) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.gif': 'image/gif'
    };
    const mime = mimeMap[ext] || 'image/png';
    const buf = await fs.readFile(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
});

ipcMain.handle('audio:readBuffer', async (_, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.wma') {
      const transcoded = await transcodeWmaToWavBuffer(filePath);
      if (transcoded) {
        return {
          kind: 'wav-transcoded',
          data: transcoded
        };
      }
      const raw = await fs.readFile(filePath);
      return {
        kind: 'wma-raw',
        data: raw
      };
    }
    const buf = await fs.readFile(filePath);
    return {
      kind: 'raw',
      data: buf
    };
  } catch (_) {
    return null;
  }
});

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('window:toggleMaximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  handleMainCloseRequest();
});

ipcMain.handle('lyrics:showWindow', () => {
  const win = createLyricWindow();
  win.show();
  win.focus();
});

ipcMain.handle('lyrics:hideWindow', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.hide();
});

ipcMain.handle('lyrics:update', (_, payload) => {
  const win = createLyricWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('lyrics:update', payload || {});
});

ipcMain.handle('lyrics:minimizeFromWindow', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lyrics:minimized');
  }
});

ipcMain.handle('lyrics:setOptions', (_, options) => {
  lyricWindowOptions = {
    ...lyricWindowOptions,
    ...(options || {})
  };
  if (!lyricWindow || lyricWindow.isDestroyed()) return lyricWindowOptions;
  lyricWindow.setMovable(!lyricWindowOptions.locked);
  lyricWindow.setResizable(!lyricWindowOptions.locked);
  lyricWindow.setIgnoreMouseEvents(!!lyricWindowOptions.clickThrough, { forward: true });
  lyricWindow.webContents.send('lyrics:options', lyricWindowOptions);
  return lyricWindowOptions;
});
