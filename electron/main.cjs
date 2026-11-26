const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, session, Tray, nativeImage, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const { createReadStream, existsSync, mkdirSync, appendFileSync, statSync, renameSync } = require('fs');
const { Readable } = require('stream');
const { execFile, spawn, spawnSync } = require('child_process');
const mm = require('music-metadata');

const {
  AUDIO_EXT,
  LYRIC_EXT,
  IMAGE_EXT_MIME,
  AUDIO_EXT_MIME,
  ONLINE_MUSIC_SOURCES,
  normalizePath,
  normalizeId
} = require('./lib/constants.cjs');
const {
  decodeTextSmart,
  decodeTextWithEncoding,
  shiftLrcTimestamps,
  buildLrcPreservingHeaders
} = require('./lib/lyrics-utils.cjs');
const { createDataStore } = require('./lib/storage.cjs');
const {
  walk,
  scanSingleTrack,
  scanFolders,
  mergeAudioFilesIntoData
} = require('./lib/scanner.cjs');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ymusic',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

const MAX_COVER_CACHE_ENTRIES = 80;
const MAX_LOG_SIZE_BYTES = 2 * 1024 * 1024;
const LYRIC_FINDER_PARTITION = 'persist:lyric-finder';

let mainWindow;
let lyricWindow;
let lyricFinderWindow;
let appTray = null;
let isQuitting = false;
let isHandlingClose = false;
let lyricWindowOptions = {
  locked: false,
  clickThrough: false
};
let mainLogFile = '';
const coverDataUrlCache = new Map();
let lyricDownloadTarget = null;
const hookedSessions = new WeakSet();
let onlineSearchRun = null;
let cachedPythonCmd = null;
const activeHelperChildren = new Set();

function logMain(level, message, extra) {
  const ts = new Date().toISOString();
  const detail = extra ? ` ${JSON.stringify(extra)}` : '';
  const line = `[${ts}] [${level}] ${message}${detail}`;
  console.log(line);
  if (!mainLogFile) return;
  try {
    appendFileSync(mainLogFile, `${line}\n`, 'utf8');
  } catch (_) {
    // ignore file logging errors
  }
}

const dataStore = createDataStore(() => app.getPath('userData'), logMain);

function initMainLogger() {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    mainLogFile = path.join(dir, 'main.log');
    if (existsSync(mainLogFile)) {
      try {
        const st = statSync(mainLogFile);
        if (st.size > MAX_LOG_SIZE_BYTES) {
          renameSync(mainLogFile, `${mainLogFile}.old`);
        }
      } catch (_) {
        // ignore rotation failure
      }
    }
    logMain('INFO', 'logger initialized', {
      logFile: mainLogFile,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      packaged: app.isPackaged
    });
  } catch (err) {
    console.error('[logger] init failed', err);
  }
}

function resolveAppIconPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'icon.png'),
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(__dirname, '..', 'icon.png')
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || candidates[candidates.length - 1];
}

function detectPythonExecutable() {
  if (cachedPythonCmd) return cachedPythonCmd;
  const candidates = process.env.PYTHON
    ? [process.env.PYTHON]
    : process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 3000 });
      if (!probe.error && probe.status === 0) {
        cachedPythonCmd = cmd;
        return cmd;
      }
    } catch (_) {
      // try next candidate
    }
  }
  cachedPythonCmd = candidates[0];
  return cachedPythonCmd;
}

function resolveMusicdlHelperCommand() {
  const helperBase = 'ymusicdl-helper';
  const helperName = process.platform === 'win32' ? `${helperBase}.exe` : helperBase;
  const packagedCandidates = [
    path.join(process.resourcesPath || '', 'ymusicdl', helperBase, helperName),
    path.join(process.resourcesPath || '', 'ymusicdl', helperName),
    path.join(process.resourcesPath || '', helperName),
    path.join(__dirname, '..', 'resources', 'ymusicdl', helperBase, helperName),
    path.join(__dirname, '..', 'resources', 'ymusicdl', helperName)
  ].filter(Boolean);
  const packaged = packagedCandidates.find((p) => existsSync(p));
  if (packaged) return { cmd: packaged, argsPrefix: [], mode: 'binary' };

  const scriptPath = path.join(__dirname, '..', 'python', 'ymusicdl_helper.py');
  return { cmd: detectPythonExecutable(), argsPrefix: [scriptPath], mode: 'python-script' };
}

function resolveMusicdlDevPath() {
  const candidates = [
    process.env.MUSICDL_REPO,
    process.env.YMUSICDL_DEV_PATH,
    path.join(__dirname, '..', 'python', 'vendor'),
    path.resolve(__dirname, '..', '..', '..', 'python', 'musicdl')
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(path.join(candidate, 'musicdl'))) || '';
}

function killAllHelperChildren() {
  for (const child of activeHelperChildren) {
    if (child && !child.killed) {
      try { child.kill('SIGKILL'); } catch (_) {}
    }
  }
  activeHelperChildren.clear();
}

function runMusicdlHelper(args, options = {}) {
  return new Promise((resolve) => {
    const helper = resolveMusicdlHelperCommand();
    const finalArgs = [...helper.argsPrefix, ...args];
    const childEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const devPath = resolveMusicdlDevPath();
    if (devPath) childEnv.YMUSICDL_DEV_PATH = devPath;
    const stateHome = path.join(app.getPath('userData'), 'helper-state');
    mkdirSync(stateHome, { recursive: true });
    childEnv.XDG_STATE_HOME = childEnv.XDG_STATE_HOME || stateHome;
    childEnv.XDG_CACHE_HOME = childEnv.XDG_CACHE_HOME || path.join(app.getPath('userData'), 'helper-cache');
    childEnv.XDG_DATA_HOME = childEnv.XDG_DATA_HOME || path.join(app.getPath('userData'), 'helper-data');
    const timeoutMs = options.timeoutMs || 1000 * 60 * 10;
    logMain('INFO', 'starting musicdl helper', { cmd: helper.cmd, args: finalArgs, mode: helper.mode, timeoutMs });
    const child = spawn(helper.cmd, finalArgs, {
      cwd: app.getPath('userData'),
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    activeHelperChildren.add(child);
    if (typeof options.onChild === 'function') options.onChild(child);

    let stdout = '';
    let stderr = '';
    let lineBuffer = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (_) {}
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (typeof options.onJsonLine === 'function') {
        lineBuffer += text;
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || '';
        for (const rawLine of lines) {
          const trimmedLine = rawLine.trim();
          if (!trimmedLine) continue;
          try {
            options.onJsonLine(JSON.parse(trimmedLine));
          } catch (_) {
            // ignore non-json stdout line
          }
        }
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      activeHelperChildren.delete(child);
      resolve({ ok: false, error: err?.message || String(err), stderr, stdout, helper });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      activeHelperChildren.delete(child);
      if (typeof options.onJsonLine === 'function' && lineBuffer.trim()) {
        try {
          options.onJsonLine(JSON.parse(lineBuffer.trim()));
        } catch (_) {
          // ignore trailing partial line
        }
      }
      if (timedOut) {
        logMain('ERROR', 'musicdl helper timed out', { cmd: helper.cmd, args: finalArgs, timeoutMs, stderr: stderr.slice(-1000) });
        resolve({ ok: false, error: `musicdl helper timed out after ${Math.round(timeoutMs / 1000)}s`, code, stdout, stderr, helper, timedOut: true });
        return;
      }
      const trimmed = stdout.trim();
      const lastLine = trimmed.split(/\r?\n/).filter(Boolean).pop() || '';
      try {
        const parsed = JSON.parse(lastLine || '{}');
        logMain(parsed?.ok === false ? 'WARN' : 'INFO', 'musicdl helper finished', { code, ok: parsed?.ok, stderr: stderr.slice(-1000) });
        resolve({ ...parsed, helper, code, stderr });
      } catch (err) {
        logMain('ERROR', 'musicdl helper returned invalid json', { code, error: err?.message || String(err), stdout: stdout.slice(-1000), stderr: stderr.slice(-1000) });
        resolve({ ok: false, error: err?.message || String(err), code, stdout, stderr, helper });
      }
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function sendOnlineSearchStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('online:searchStatus', payload || {});
  }
}

function sendOnlineSearchResults(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('online:searchResults', payload || {});
  }
}

function stopOnlineSearchRun(reason = '用户已暂停搜索') {
  if (!onlineSearchRun) return false;
  onlineSearchRun.cancelled = true;
  onlineSearchRun.reason = reason;
  if (onlineSearchRun.child && !onlineSearchRun.child.killed) {
    try { onlineSearchRun.child.kill('SIGKILL'); } catch (_) {}
  }
  sendOnlineSearchStatus({ active: false, cancelled: true, message: reason });
  return true;
}

async function pickDefaultDownloadFolder() {
  const data = await dataStore.loadData();
  const folders = (data.scanFolders || []).filter(Boolean);
  if (folders[0]) return folders[0];
  return path.join(app.getPath('music'), 'YMusicPlayer');
}

function invalidateCoverCache(filePath) {
  if (!filePath) return;
  coverDataUrlCache.delete(normalizeId(filePath));
}

function setCoverCacheEntry(key, value) {
  if (coverDataUrlCache.has(key)) coverDataUrlCache.delete(key);
  while (coverDataUrlCache.size >= MAX_COVER_CACHE_ENTRIES) {
    const oldestKey = coverDataUrlCache.keys().next().value;
    if (oldestKey === undefined) break;
    coverDataUrlCache.delete(oldestKey);
  }
  coverDataUrlCache.set(key, value);
}

async function readTrackCoverDataUrl(filePath) {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const cacheKey = normalizeId(filePath);
    if (coverDataUrlCache.has(cacheKey)) {
      const cached = coverDataUrlCache.get(cacheKey);
      // Refresh LRU position
      coverDataUrlCache.delete(cacheKey);
      coverDataUrlCache.set(cacheKey, cached);
      return cached;
    }
    const metadata = await mm.parseFile(filePath, { skipCovers: false });
    const pic = metadata?.common?.picture?.[0];
    if (!pic?.data?.length) {
      setCoverCacheEntry(cacheKey, null);
      return null;
    }
    const fmt = `${pic.format || ''}`.toLowerCase();
    const mime = fmt.includes('png') ? 'image/png' : fmt.includes('webp') ? 'image/webp' : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${Buffer.from(pic.data).toString('base64')}`;
    setCoverCacheEntry(cacheKey, dataUrl);
    return dataUrl;
  } catch (_) {
    return null;
  }
}

function buildMediaProtocolUrl(kind, filePath, version = '') {
  const params = new URLSearchParams({ path: filePath });
  if (version) params.set('v', String(version));
  return `ymusic://local/${kind}?${params.toString()}`;
}

async function registerLocalMediaProtocol() {
  protocol.handle('ymusic', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'local') {
        return new Response('Not Found', { status: 404 });
      }
      const targetPath = url.searchParams.get('path') || '';
      if (!targetPath || !existsSync(targetPath)) {
        return new Response('File Not Found', { status: 404 });
      }

      const ext = path.extname(targetPath).toLowerCase();
      let mime = '';
      if (url.pathname === '/audio') {
        if (!AUDIO_EXT.has(ext)) return new Response('Forbidden Audio Extension', { status: 403 });
        mime = AUDIO_EXT_MIME[ext] || 'audio/mpeg';
      } else if (url.pathname === '/image') {
        if (!IMAGE_EXT_MIME[ext]) return new Response('Forbidden Image Extension', { status: 403 });
        mime = IMAGE_EXT_MIME[ext];
      } else {
        return new Response('Unsupported Media Route', { status: 404 });
      }

      const stat = await fs.stat(targetPath);
      if (!stat.isFile()) {
        return new Response('Not A Regular File', { status: 403 });
      }

      const total = stat.size;
      const rangeHeader = request.headers.get('range');
      if (rangeHeader && total > 0) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
        if (match) {
          const start = match[1] ? parseInt(match[1], 10) : 0;
          const end = match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= total || start > end) {
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${total}` }
            });
          }
          const chunkSize = end - start + 1;
          const nodeStream = createReadStream(targetPath, { start, end });
          request.signal?.addEventListener('abort', () => nodeStream.destroy(), { once: true });
          return new Response(Readable.toWeb(nodeStream), {
            status: 206,
            headers: {
              'Content-Type': mime,
              'Content-Length': String(chunkSize),
              'Content-Range': `bytes ${start}-${end}/${total}`,
              'Accept-Ranges': 'bytes',
              'Cache-Control': 'no-cache'
            }
          });
        }
      }

      const nodeStream = createReadStream(targetPath);
      request.signal?.addEventListener('abort', () => nodeStream.destroy(), { once: true });
      return new Response(Readable.toWeb(nodeStream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (err) {
      logMain('ERROR', 'ymusic protocol stream failed', { url: request.url, error: err?.message || String(err) });
      return new Response('Internal Stream Error', { status: 500 });
    }
  });
}

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

async function ensureTranscodedWmaFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const cacheDir = path.join(app.getPath('userData'), 'transcode-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const hash = crypto
      .createHash('sha1')
      .update(`${normalizePath(filePath)}:${Math.trunc(stat.mtimeMs)}:${stat.size}`)
      .digest('hex');
    const outWav = path.join(cacheDir, `${hash}.wav`);
    if (existsSync(outWav)) return outWav;

    const tmpWav = `${outWav}.tmp-${process.pid}`;
    const args = ['-y', '-v', 'error', '-i', filePath, '-f', 'wav', '-acodec', 'pcm_s16le', '-ac', '2', '-ar', '44100', tmpWav];
    await execFileAsync('ffmpeg', args);
    await fs.rename(tmpWav, outWav);
    return outWav;
  } catch (_) {
    return null;
  }
}

async function transcodeWmaToWavBuffer(filePath) {
  const wavFile = await ensureTranscodedWmaFile(filePath);
  if (!wavFile) return null;
  try {
    return await fs.readFile(wavFile);
  } catch (_) {
    return null;
  }
}

function attachMainWindowDebugHooks(win) {
  if (!win) return;
  win.webContents.on('did-start-loading', () => {
    logMain('INFO', 'main webContents did-start-loading');
  });
  win.webContents.on('did-finish-load', () => {
    logMain('INFO', 'main webContents did-finish-load', { url: win.webContents.getURL() });
  });
  win.webContents.on('did-fail-load', (_, code, desc, url, isMainFrame) => {
    logMain('ERROR', 'main webContents did-fail-load', { code, desc, url, isMainFrame });
  });
  win.webContents.on('render-process-gone', (_, details) => {
    logMain('ERROR', 'main webContents render-process-gone', details || {});
  });
  win.webContents.on('console-message', (_, level, message, line, sourceId) => {
    if (level <= 1) return;
    logMain('WARN', 'renderer console-message', { level, message, line, sourceId });
  });
  win.on('unresponsive', () => {
    logMain('ERROR', 'main window unresponsive');
  });
  win.on('responsive', () => {
    logMain('INFO', 'main window responsive');
  });
}

function bindLyricAutoDownloadHook(ses) {
  if (!ses || hookedSessions.has(ses)) return;
  hookedSessions.add(ses);
  ses.on('will-download', (_, item) => {
    const target = lyricDownloadTarget;
    if (!target?.trackPath) return;
    try {
      const originalName = item.getFilename() || '';
      const originalExt = path.extname(originalName).toLowerCase();
      const mimeType = `${item.getMimeType?.() || ''}`.toLowerCase();
      const looksLikeLyric =
        LYRIC_EXT.has(originalExt) ||
        mimeType.startsWith('text/') ||
        originalName.toLowerCase().includes('.lrc');

      if (!looksLikeLyric) {
        logMain('WARN', 'skipped non-lyric download in lyric finder', { originalName, mimeType });
        return;
      }

      const trackParsed = path.parse(target.trackPath);
      const ext = originalExt === '.txt' ? '.txt' : '.lrc';
      const targetPath = path.join(trackParsed.dir, `${trackParsed.name}${ext}`);
      item.setSavePath(targetPath);
      logMain('INFO', 'auto lyric download save path set', { from: originalName, to: targetPath });
      item.once('done', (_, state) => {
        const ok = state === 'completed';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lyrics:downloaded', {
            ok,
            state,
            trackPath: target.trackPath,
            targetPath: normalizePath(targetPath)
          });
        }
        if (ok) {
          logMain('INFO', 'auto lyric download completed', { targetPath });
        } else {
          logMain('WARN', 'auto lyric download not completed', { state, targetPath });
        }
      });
    } catch (err) {
      logMain('ERROR', 'auto lyric download hook failed', { error: err?.message || String(err) });
    }
  });
}

function sendPlayerCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player:command', command);
  }
}

function getValidatedBounds(savedBounds, defaults, minW, minH) {
  if (!savedBounds || typeof savedBounds !== 'object') return defaults;
  const width = Math.max(minW, Number(savedBounds.width) || defaults.width);
  const height = Math.max(minH, Number(savedBounds.height) || defaults.height);
  const x = Number(savedBounds.x);
  const y = Number(savedBounds.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { width, height };
  }
  try {
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const wa = d.workArea;
      return x < wa.x + wa.width - 80 && x + width > wa.x + 80 && y < wa.y + wa.height - 60 && y + height > wa.y;
    });
    return visible ? { x, y, width, height } : { width, height };
  } catch (_) {
    return { width, height };
  }
}

async function createWindow() {
  const initialData = await dataStore.loadData().catch(() => null);
  const savedBounds = initialData?.settings?.windowBounds;
  const restoredBounds = getValidatedBounds(savedBounds, { width: 1440, height: 920 }, 1080, 700);
  const appIconPath = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    ...restoredBounds,
    minWidth: 1080,
    minHeight: 700,
    frame: false,
    transparent: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon: appIconPath,
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (savedBounds?.maximized) {
    mainWindow.maximize();
  }
  attachMainWindowDebugHooks(mainWindow);

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl).catch((err) => {
      logMain('ERROR', 'loadURL failed in dev mode', { devUrl, error: err?.message || String(err) });
    });
  } else {
    const prodIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (existsSync(prodIndex)) {
      mainWindow.loadFile(prodIndex).catch((err) => {
        logMain('ERROR', 'loadFile failed in packaged mode', { prodIndex, error: err?.message || String(err) });
      });
    } else {
      logMain('WARN', 'dist index not found, fallback to dev url', { prodIndex, devUrl });
      mainWindow.loadURL(devUrl).catch((err) => {
        logMain('ERROR', 'fallback loadURL failed in packaged mode', { devUrl, error: err?.message || String(err) });
      });
    }
  }
  mainWindow.setMenuBarVisibility(false);

  const recordMainBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const maximized = mainWindow.isMaximized();
    const normalBounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    dataStore.updateSessionSettings({
      windowBounds: {
        ...normalBounds,
        maximized
      }
    });
  };

  const syncMaximizedState = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    recordMainBounds();
    mainWindow.webContents.send('window:maximizedChanged', mainWindow.isMaximized());
  };
  mainWindow.on('maximize', syncMaximizedState);
  mainWindow.on('unmaximize', syncMaximizedState);
  mainWindow.on('resized', recordMainBounds);
  mainWindow.on('moved', recordMainBounds);
  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    handleMainCloseRequest();
  });
  mainWindow.on('closed', () => {
    if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.close();
    if (lyricFinderWindow && !lyricFinderWindow.isDestroyed()) lyricFinderWindow.close();
    mainWindow = null;
    lyricWindow = null;
    lyricFinderWindow = null;
  });
}

function createLyricFinderWindow(initialUrl) {
  const targetUrl = initialUrl || 'https://www.toomic.com/';
  if (lyricFinderWindow && !lyricFinderWindow.isDestroyed()) {
    lyricFinderWindow.webContents.send('lyric-finder:open-url', targetUrl);
    lyricFinderWindow.show();
    lyricFinderWindow.focus();
    return lyricFinderWindow;
  }

  bindLyricAutoDownloadHook(session.fromPartition(LYRIC_FINDER_PARTITION));
  lyricFinderWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    backgroundColor: '#101218',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'lyric-finder-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  lyricFinderWindow.setMenuBarVisibility(false);
  lyricFinderWindow.on('closed', () => {
    lyricFinderWindow = null;
    lyricDownloadTarget = null;
  });
  lyricFinderWindow.loadFile(path.join(__dirname, 'lyric-finder-window.html'), {
    query: { url: targetUrl }
  }).catch((err) => {
    logMain('ERROR', 'lyric finder load page failed', { error: err?.message || String(err) });
  });
  return lyricFinderWindow;
}

let creatingLyricWindowPromise = null;

async function createLyricWindow() {
  if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow;
  if (creatingLyricWindowPromise) return creatingLyricWindowPromise;
  creatingLyricWindowPromise = (async () => {
    try {
      const savedData = await dataStore.loadData().catch(() => null);
      if (lyricWindow && !lyricWindow.isDestroyed()) return lyricWindow;
      const restoredLyricBounds = getValidatedBounds(
        savedData?.settings?.lyricWindowBounds,
        { width: 720, height: 210 },
        420,
        130
      );
      const appIconPath = resolveAppIconPath();
      lyricWindow = new BrowserWindow({
        ...restoredLyricBounds,
        minWidth: 420,
        minHeight: 130,
        show: false,
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

      const recordLyricBounds = () => {
        if (!lyricWindow || lyricWindow.isDestroyed()) return;
        dataStore.updateSessionSettings({
          lyricWindowBounds: lyricWindow.getBounds()
        });
      };
      lyricWindow.on('moved', recordLyricBounds);
      lyricWindow.on('resized', recordLyricBounds);

      lyricWindow.loadFile(path.join(__dirname, 'lyrics-window.html')).then(() => {
        if (lyricWindow && !lyricWindow.isDestroyed()) {
          lyricWindow.webContents.send('lyrics:options', lyricWindowOptions);
        }
      });
      lyricWindow.on('closed', () => {
        lyricWindow = null;
      });
      return lyricWindow;
    } finally {
      creatingLyricWindowPromise = null;
    }
  })();
  return creatingLyricWindowPromise;
}

function createTray() {
  if (appTray) return appTray;
  const appIconPath = resolveAppIconPath();
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
    { type: 'separator' },
    {
      label: '播放 / 暂停',
      click: () => sendPlayerCommand('toggle-play')
    },
    {
      label: '上一首',
      click: () => sendPlayerCommand('prev')
    },
    {
      label: '下一首',
      click: () => sendPlayerCommand('next')
    },
    {
      label: '显示 / 隐藏桌面歌词',
      click: () => sendPlayerCommand('toggle-lyrics')
    },
    { type: 'separator' },
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
    await dataStore.mutateData((data) => ({
      ...data,
      settings: {
        ...(data.settings || {}),
        closeBehavior: nextBehavior
      }
    }));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('settings:closeBehavior', nextBehavior);
    }
  } catch (_) {
    // ignore persist failure
  }
}

async function resolveCloseBehavior() {
  const data = await dataStore.loadData();
  const current = data.settings?.closeBehavior || 'ask';
  if (current !== 'ask') return { action: current, data };

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

  if (result.response === 2) return { action: 'cancel', data };
  const selected = result.response === 0 ? 'tray' : 'exit';
  if (result.checkboxChecked) {
    await persistCloseBehavior(selected);
  }
  return { action: selected, data };
}

async function handleMainCloseRequest() {
  if (isHandlingClose || !mainWindow || mainWindow.isDestroyed()) return;
  isHandlingClose = true;
  try {
    const { action, data } = await resolveCloseBehavior();
    if (action === 'cancel') return;
    if (action === 'tray') {
      createTray();
      dataStore.flushSync();
      const keepDesktopLyrics = data?.settings?.showLyrics && data?.settings?.minimizedShowLyrics !== false;
      if (!keepDesktopLyrics && lyricWindow && !lyricWindow.isDestroyed()) {
        lyricWindow.hide();
      }
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

app.whenReady().then(async () => {
  initMainLogger();
  logMain('INFO', 'app ready');
  await registerLocalMediaProtocol();
  Menu.setApplicationMenu(null);
  app.on('web-contents-created', (_, contents) => {
    if (contents.getType?.() === 'webview') {
      bindLyricAutoDownloadHook(contents.session);
      contents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url || '')) {
          contents.loadURL(url).catch(() => {});
        }
        return { action: 'deny' };
      });
    }
  });
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
});

process.on('uncaughtException', (err) => {
  logMain('ERROR', 'uncaughtException', { error: err?.stack || err?.message || String(err) });
});

process.on('unhandledRejection', (reason) => {
  const text = reason?.stack || reason?.message || String(reason);
  logMain('ERROR', 'unhandledRejection', { error: text });
});

app.on('before-quit', () => {
  isQuitting = true;
  dataStore.flushSync();
  killAllHelperChildren();
});

ipcMain.on('session:sync', (_, patch) => {
  dataStore.updateSessionSettings(patch);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) app.quit();
});

ipcMain.handle('dialog:pickFolders', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections']
  });
  if (result.canceled) return [];
  return result.filePaths.map(normalizePath);
});

ipcMain.handle('dialog:pickBackgroundImage', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }
    ]
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return normalizePath(result.filePaths[0]);
});

ipcMain.handle('dialog:pickLyricFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Lyrics', extensions: ['lrc', 'txt'] }
    ]
  });
  if (result.canceled || !result.filePaths?.length) return null;
  return normalizePath(result.filePaths[0]);
});

ipcMain.handle('data:load', async () => dataStore.loadData());
ipcMain.handle('data:save', async (_, data) => dataStore.saveData(data));

ipcMain.handle('scan:folders', async (_, folders) => {
  return dataStore.mutateData((prevData) => scanFolders(folders, prevData));
});

ipcMain.handle('scan:droppedPaths', async (_, rawPaths) => {
  const cleanPaths = (Array.isArray(rawPaths) ? rawPaths : []).filter(Boolean);
  if (!cleanPaths.length) return dataStore.loadData();

  const directories = [];
  const audioFiles = [];
  for (const item of cleanPaths) {
    try {
      const st = await fs.stat(item);
      if (st.isDirectory()) {
        directories.push(normalizePath(item));
      } else if (st.isFile() && AUDIO_EXT.has(path.extname(item).toLowerCase())) {
        audioFiles.push(item);
      }
    } catch (_) {
      // ignore invalid path
    }
  }

  return dataStore.mutateData(async (prevData) => {
    let workingData = prevData;
    if (directories.length) {
      const mergedFolders = [...new Set([...(workingData.scanFolders || []), ...directories])];
      workingData = await scanFolders(mergedFolders, workingData);
    }
    if (audioFiles.length) {
      const merged = await mergeAudioFilesIntoData(audioFiles, workingData);
      workingData = merged.nextData;
    }
    return workingData;
  });
});

ipcMain.handle('scan:singleTrack', async (_, trackPath) => {
  if (!trackPath) return null;
  invalidateCoverCache(trackPath);
  const track = await scanSingleTrack(trackPath);
  await dataStore.mutateData((data) => {
    const nextTracks = [...(data.tracks || [])];
    const idx = nextTracks.findIndex((t) => t.id === track.id);
    if (idx >= 0) {
      track.liked = !!nextTracks[idx].liked;
      nextTracks[idx] = track;
    }
    return { ...data, tracks: nextTracks };
  });
  return track;
});

ipcMain.handle('online:sources', async () => ONLINE_MUSIC_SOURCES);

ipcMain.handle('dialog:pickDownloadFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: '选择下载保存目录'
  });
  if (result.canceled || !result.filePaths.length) return null;
  return normalizePath(result.filePaths[0]);
});

ipcMain.handle('online:defaultDownloadFolder', async () => pickDefaultDownloadFolder());

ipcMain.handle('online:cancelSearch', async () => stopOnlineSearchRun('已暂停搜索，保留已找到的结果'));

ipcMain.handle('online:search', async (_, payload) => {
  const keyword = `${payload?.keyword || ''}`.trim();
  if (!keyword) return { ok: false, error: '请输入搜索关键词' };
  stopOnlineSearchRun('已开始新的搜索');

  const sourceIds = Array.isArray(payload?.sources) && payload.sources.length
    ? payload.sources
    : ONLINE_MUSIC_SOURCES.map((source) => source.id);
  const workDir = path.join(app.getPath('userData'), 'musicdl-search-cache');
  mkdirSync(workDir, { recursive: true });
  const limitPerSource = Math.max(1, Math.min(20, Number(payload?.limitPerSource) || 15));
  const totalTimeoutMs = Number(payload?.timeoutMs) || Math.max(120000, sourceIds.length * 45000);

  const accumulatedResults = [];
  const errors = [];
  const runState = { cancelled: false, reason: '', child: null };
  let completedSources = 0;
  onlineSearchRun = runState;

  sendOnlineSearchStatus({
    active: true,
    current: '',
    completed: 0,
    total: sourceIds.length,
    message: `正在并发搜索 ${sourceIds.length} 个音乐源（每源最多 ${limitPerSource} 首）...`
  });

  const result = await runMusicdlHelper([
    'search',
    '--keyword', keyword,
    '--sources', sourceIds.join(','),
    '--work-dir', workDir,
    '--limit-per-source', `${limitPerSource}`,
    '--stream'
  ], {
    timeoutMs: totalTimeoutMs,
    onChild: (child) => {
      if (onlineSearchRun === runState) runState.child = child;
    },
    onJsonLine: (event) => {
      if (runState.cancelled || !event || typeof event !== 'object') return;
      if (event.type === 'source_start') {
        sendOnlineSearchStatus({
          active: true,
          current: event.source,
          sourceLabel: event.source_label,
          completed: completedSources,
          total: sourceIds.length,
          message: `正在搜索 ${event.source_label}...`
        });
      } else if (event.type === 'source_result') {
        completedSources += 1;
        const sourceResults = Array.isArray(event.results) ? event.results : [];
        accumulatedResults.push(...sourceResults);
        sendOnlineSearchResults({
          append: sourceResults,
          results: [...accumulatedResults],
          sourceId: event.source,
          sourceLabel: event.source_label
        });
        sendOnlineSearchStatus({
          active: true,
          current: event.source,
          sourceLabel: event.source_label,
          completed: completedSources,
          total: sourceIds.length,
          message: `${event.source_label} 已返回 ${sourceResults.length} 首`
        });
      } else if (event.type === 'source_error') {
        completedSources += 1;
        errors.push({
          source: event.source,
          sourceLabel: event.source_label,
          error: event.error || '搜索失败'
        });
        sendOnlineSearchStatus({
          active: true,
          current: event.source,
          sourceLabel: event.source_label,
          completed: completedSources,
          total: sourceIds.length,
          message: `${event.source_label} 搜索异常，继续其余源`
        });
      }
    }
  });

  const cancelled = runState.cancelled;
  if (onlineSearchRun === runState) onlineSearchRun = null;

  const finalResults = accumulatedResults.length ? accumulatedResults : (result.results || []);
  const finalErrors = errors.length ? errors : (result.errors || []);

  sendOnlineSearchStatus({
    active: false,
    cancelled,
    current: '',
    completed: completedSources || (result.ok ? sourceIds.length : 0),
    total: sourceIds.length,
    message: cancelled ? (runState.reason || '已暂停搜索') : '搜索结束'
  });

  if (!cancelled && !result.ok && !finalResults.length) {
    logMain('ERROR', 'online music search failed', { error: result.error, stderr: result.stderr, helper: result.helper });
    return {
      ok: false,
      cancelled: false,
      results: [],
      errors: finalErrors,
      error: result.error || finalErrors[0]?.error || '搜索失败，请检查 Python / musicdl 环境'
    };
  }

  return {
    ok: cancelled || finalResults.length > 0 || finalErrors.length < sourceIds.length,
    cancelled,
    results: finalResults,
    errors: finalErrors,
    error: finalResults.length || cancelled ? '' : (finalErrors[0]?.error || '未找到可下载歌曲')
  };
});

ipcMain.handle('online:download', async (_, payload) => {
  const songs = Array.isArray(payload?.songs) ? payload.songs : [];
  if (!songs.length) return { ok: false, error: '请选择要下载的歌曲' };
  const targetDir = payload?.targetDir || await pickDefaultDownloadFolder();
  mkdirSync(targetDir, { recursive: true });
  const sourceIds = [...new Set(songs.map((song) => song?.source).filter(Boolean))];
  const input = JSON.stringify({ songs, target_dir: targetDir, sources: sourceIds });
  const result = await runMusicdlHelper(['download', '--target-dir', targetDir], {
    input,
    timeoutMs: 1000 * 60 * 20
  });
  if (!result.ok) {
    logMain('ERROR', 'online music download failed', { error: result.error, stderr: result.stderr, helper: result.helper });
    return result;
  }

  const audioPaths = (result.downloaded || [])
    .map((item) => item?.audio_path || item?._save_path)
    .filter((fp) => fp && existsSync(fp));
  for (const fp of audioPaths) invalidateCoverCache(fp);

  const merged = await dataStore.mutateData((prevData) => mergeAudioFilesIntoData(audioPaths, prevData));
  return {
    ...result,
    data: merged.data,
    tracks: merged.tracks
  };
});

ipcMain.handle('file:readText', async (_, filePath) => {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const buf = await fs.readFile(filePath);
    return decodeTextSmart(buf);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('file:readTextWithEncoding', async (_, filePath, encoding) => {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const buf = await fs.readFile(filePath);
    return decodeTextWithEncoding(buf, encoding);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('file:writeText', async (_, filePath, content) => {
  try {
    if (!filePath) return false;
    const ext = path.extname(filePath).toLowerCase();
    if (!LYRIC_EXT.has(ext)) {
      logMain('WARN', 'blocked file:writeText for non-lyric extension', { filePath });
      return false;
    }
    await fs.writeFile(filePath, `${content || ''}`, 'utf8');
    return true;
  } catch (_) {
    return false;
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

ipcMain.handle('external:open', async (_, url) => {
  try {
    if (!url) return false;
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      logMain('WARN', 'blocked external:open for disallowed protocol', { url });
      return false;
    }
    await shell.openExternal(url);
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('file:getImageUrl', async (_, filePath) => {
  try {
    if (!filePath || !existsSync(filePath)) return '';
    const ext = path.extname(filePath).toLowerCase();
    if (!IMAGE_EXT_MIME[ext]) return '';
    const stat = await fs.stat(filePath);
    return buildMediaProtocolUrl('image', filePath, Math.trunc(stat.mtimeMs));
  } catch (_) {
    return '';
  }
});

ipcMain.handle('file:readImageDataUrl', async (_, filePath) => {
  try {
    if (!filePath) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mime = IMAGE_EXT_MIME[ext] || 'image/png';
    const buf = await fs.readFile(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (_) {
    return null;
  }
});

ipcMain.handle('audio:prepareSource', async (_, filePath) => {
  try {
    if (!filePath || !existsSync(filePath)) {
      return { ok: false, error: '该歌曲文件不存在，请尝试重新扫描' };
    }
    const ext = path.extname(filePath).toLowerCase();
    if (!AUDIO_EXT.has(ext)) {
      return { ok: false, error: '不支持的音频文件格式' };
    }
    if (ext === '.wma') {
      const transcodedWav = await ensureTranscodedWmaFile(filePath);
      if (transcodedWav) {
        return {
          ok: true,
          kind: 'wav-transcoded',
          url: buildMediaProtocolUrl('audio', transcodedWav)
        };
      }
      return {
        ok: true,
        kind: 'wma-raw',
        url: buildMediaProtocolUrl('audio', filePath)
      };
    }
    return {
      ok: true,
      kind: 'stream',
      url: buildMediaProtocolUrl('audio', filePath)
    };
  } catch (err) {
    return { ok: false, error: err?.message || '音频准备失败' };
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

ipcMain.handle('track:readCoverDataUrl', async (_, filePath) => {
  return readTrackCoverDataUrl(filePath);
});

ipcMain.handle('lyrics:installForTrack', async (_, trackPath, lyricPath) => {
  try {
    if (!trackPath || !lyricPath || !existsSync(lyricPath)) return null;
    const trackParsed = path.parse(trackPath);
    const srcExt = path.extname(lyricPath).toLowerCase();
    const ext = srcExt === '.txt' ? '.txt' : '.lrc';
    const targetPath = path.join(trackParsed.dir, `${trackParsed.name}${ext}`);
    if (normalizeId(lyricPath) !== normalizeId(targetPath)) {
      await fs.copyFile(lyricPath, targetPath);
    }
    return normalizePath(targetPath);
  } catch (_) {
    return null;
  }
});

ipcMain.handle('lyrics:setDownloadTarget', async (_, trackPath) => {
  if (!trackPath) return false;
  lyricDownloadTarget = { trackPath };
  return true;
});

ipcMain.handle('lyrics:clearDownloadTarget', async () => {
  lyricDownloadTarget = null;
  return true;
});

ipcMain.handle('lyrics:openFinderWindow', async (_, payload) => {
  const url = payload?.url || 'https://www.toomic.com/';
  const trackPath = payload?.trackPath || '';
  if (trackPath) lyricDownloadTarget = { trackPath };
  const win = createLyricFinderWindow(url);
  if (!win || win.isDestroyed()) return false;
  win.show();
  win.focus();
  return true;
});

ipcMain.handle('lyrics:shiftAndSave', async (_, lyricPath, offsetSec) => {
  try {
    if (!lyricPath || !existsSync(lyricPath)) return false;
    const ext = path.extname(lyricPath).toLowerCase();
    if (!LYRIC_EXT.has(ext)) return false;
    const buf = await fs.readFile(lyricPath);
    const decoded = decodeTextSmart(buf);
    const shifted = shiftLrcTimestamps(decoded, Number(offsetSec) || 0);
    await fs.writeFile(lyricPath, shifted, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('lyrics:saveAligned', async (_, payload) => {
  try {
    const lyricPath = payload?.lyricPath || '';
    if (!lyricPath) return { ok: false, error: '未指定歌词文件路径' };
    const ext = path.extname(lyricPath).toLowerCase();
    if (!LYRIC_EXT.has(ext)) return { ok: false, error: '仅支持保存 .lrc 或 .txt 歌词文件' };

    const offsetSec = Number(payload?.offsetSec) || 0;
    const dirty = !!payload?.dirty;
    const encoding = payload?.encoding || 'auto';
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];

    let rawOriginal = '';
    if (existsSync(lyricPath)) {
      const buf = await fs.readFile(lyricPath);
      rawOriginal = decodeTextWithEncoding(buf, encoding);
    }

    let nextContent = '';
    if (!dirty && rawOriginal) {
      nextContent = shiftLrcTimestamps(rawOriginal, offsetSec);
    } else {
      const shiftedLines = lines.map((line) => ({
        ...line,
        time: Math.max(0, (Number(line?.time) || 0) - offsetSec)
      }));
      nextContent = buildLrcPreservingHeaders(rawOriginal, shiftedLines);
    }

    await fs.writeFile(lyricPath, nextContent, 'utf8');
    return { ok: true, content: nextContent };
  } catch (err) {
    return { ok: false, error: err?.message || '歌词保存失败' };
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

ipcMain.handle('window:isMaximized', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isMaximized();
});

ipcMain.handle('window:close', () => {
  handleMainCloseRequest();
});

ipcMain.handle('lyrics:showWindow', async () => {
  const win = await createLyricWindow();
  if (!win || win.isDestroyed()) return;
  if (typeof win.showInactive === 'function') win.showInactive();
  else win.show();
});

ipcMain.handle('lyrics:hideWindow', () => {
  if (lyricWindow && !lyricWindow.isDestroyed()) lyricWindow.hide();
});

ipcMain.handle('lyrics:update', (_, payload) => {
  if (!lyricWindow || lyricWindow.isDestroyed()) return;
  lyricWindow.webContents.send('lyrics:update', payload || {});
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
