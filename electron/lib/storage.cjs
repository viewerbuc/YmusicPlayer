const path = require('path');
const fs = require('fs/promises');
const { existsSync, mkdirSync, writeFileSync, copyFileSync, renameSync, unlinkSync, readFileSync } = require('fs');
const { normalizePath, normalizeId } = require('./constants.cjs');

function ensureDataShape(raw) {
  const base = {
    scanFolders: [],
    tracks: [],
    playlists: [{ id: 'favorites', name: '我喜欢', fixed: true, trackIds: [] }],
    settings: {
      showLyrics: true,
      minimizedShowLyrics: true,
      playMode: 'sequence',
      lyricLocked: false,
      lyricClickThrough: false,
      closeBehavior: 'ask',
      theme: 'dark',
      backgroundImagePath: '',
      backgroundBlur: 8,
      listTextTone: 'auto',
      volume: 0.8,
      lyricEncodingMap: {},
      lastTrackId: null,
      lastPositionSec: 0,
      lastPlaylistId: 'all',
      lastView: 'songs',
      sort: { key: 'title', dir: 'asc' },
      windowBounds: null,
      lyricWindowBounds: null
    }
  };

  const rawSettings = (raw && raw.settings) || {};
  const normalizedEncodingMap = {};
  if (rawSettings.lyricEncodingMap && typeof rawSettings.lyricEncodingMap === 'object') {
    for (const [k, v] of Object.entries(rawSettings.lyricEncodingMap)) {
      if (k && v) normalizedEncodingMap[normalizeId(k)] = v;
    }
  }

  const merged = {
    ...base,
    ...(raw || {}),
    scanFolders: [...new Set(((raw && raw.scanFolders) || []).filter(Boolean).map(normalizePath))],
    settings: {
      ...base.settings,
      ...rawSettings,
      lyricEncodingMap: normalizedEncodingMap,
      lastTrackId: rawSettings.lastTrackId ? normalizeId(rawSettings.lastTrackId) : null,
      lastPositionSec: Number.isFinite(Number(rawSettings.lastPositionSec))
        ? Math.max(0, Number(rawSettings.lastPositionSec))
        : 0
    }
  };

  if (!Array.isArray(merged.playlists) || !merged.playlists.find((p) => p.id === 'favorites')) {
    merged.playlists = [{ id: 'favorites', name: '我喜欢', fixed: true, trackIds: [] }, ...(merged.playlists || [])];
  }

  const trackMap = new Map();
  for (const t of merged.tracks || []) {
    if (!t?.path && !t?.id) continue;
    const normalizedPath = normalizePath(t.path || t.id);
    const id = normalizeId(normalizedPath);
    const normalizedTrack = {
      ...t,
      id,
      path: normalizedPath,
      folder: normalizePath(t.folder || path.dirname(normalizedPath)),
      lyricPath: t.lyricPath ? normalizePath(t.lyricPath) : null,
      liked: !!t.liked
    };
    const existing = trackMap.get(id);
    if (!existing) {
      trackMap.set(id, normalizedTrack);
    } else if (normalizedTrack.liked && !existing.liked) {
      trackMap.set(id, { ...existing, liked: true });
    }
  }
  merged.tracks = [...trackMap.values()];

  const validTrackIds = new Set(merged.tracks.map((t) => t.id));
  const likedTrackIds = merged.tracks.filter((t) => t.liked).map((t) => t.id);

  merged.playlists = (merged.playlists || []).map((p) => {
    if (p.id === 'favorites') {
      const mergedFavs = [...new Set([
        ...likedTrackIds,
        ...((p.trackIds || []).map(normalizeId).filter((id) => validTrackIds.has(id)))
      ])];
      return { ...p, fixed: true, trackIds: mergedFavs };
    }
    return {
      ...p,
      trackIds: [...new Set((p.trackIds || []).map(normalizeId).filter((id) => validTrackIds.has(id)))]
    };
  });

  // Sync track.liked with favorites playlist
  const favSet = new Set(merged.playlists.find((p) => p.id === 'favorites')?.trackIds || []);
  merged.tracks = merged.tracks.map((t) => (favSet.has(t.id) && !t.liked ? { ...t, liked: true } : t));

  return merged;
}

function createDataStore(getUserDataDir, logMain) {
  let ioQueue = Promise.resolve();
  let cachedData = null;
  let sessionSettingsPatch = {};
  let dirtySessionPatch = false;

  function dataFilePath() {
    return path.join(getUserDataDir(), 'player-data.json');
  }

  function backupFilePath() {
    return path.join(getUserDataDir(), 'player-data.json.bak');
  }

  function applySessionPatch(dataObj) {
    if (!dataObj || !Object.keys(sessionSettingsPatch).length) return dataObj;
    return {
      ...dataObj,
      settings: {
        ...(dataObj.settings || {}),
        ...sessionSettingsPatch
      }
    };
  }

  async function readFromDisk() {
    const fp = dataFilePath();
    const bak = backupFilePath();
    if (existsSync(fp)) {
      try {
        const raw = await fs.readFile(fp, 'utf8');
        const parsed = ensureDataShape(applySessionPatch(JSON.parse(raw)));
        cachedData = parsed;
        return parsed;
      } catch (err) {
        logMain?.('WARN', 'failed to parse player-data.json, trying backup', { error: err?.message || String(err) });
      }
    }
    if (existsSync(bak)) {
      try {
        const rawBak = await fs.readFile(bak, 'utf8');
        const parsed = ensureDataShape(applySessionPatch(JSON.parse(rawBak)));
        cachedData = parsed;
        return parsed;
      } catch (err) {
        logMain?.('ERROR', 'failed to parse backup player-data.json.bak', { error: err?.message || String(err) });
      }
    }
    const fallback = ensureDataShape(applySessionPatch(null));
    cachedData = fallback;
    return fallback;
  }

  async function writeAtomically(nextData) {
    const shaped = ensureDataShape(applySessionPatch(nextData));
    cachedData = shaped;
    dirtySessionPatch = false;
    const fp = dataFilePath();
    const bak = backupFilePath();
    const tmp = `${fp}.tmp-${process.pid}-${Date.now()}`;
    const serialized = JSON.stringify(shaped, null, 2);

    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(tmp, serialized, 'utf8');
    if (existsSync(fp)) {
      try {
        await fs.copyFile(fp, bak);
      } catch (_) {
        // ignore backup failure
      }
    }
    try {
      await fs.rename(tmp, fp);
    } catch (_) {
      await fs.writeFile(fp, serialized, 'utf8');
      await fs.unlink(tmp).catch(() => {});
    }
    return shaped;
  }

  function updateSessionSettings(patch) {
    if (!patch || typeof patch !== 'object') return;
    const sanitized = { ...patch };
    if ('lastTrackId' in sanitized) {
      sanitized.lastTrackId = sanitized.lastTrackId ? normalizeId(sanitized.lastTrackId) : null;
    }
    if ('lastPositionSec' in sanitized) {
      const n = Number(sanitized.lastPositionSec);
      sanitized.lastPositionSec = Number.isFinite(n) ? Math.max(0, Math.round(n * 10) / 10) : 0;
    }
    sessionSettingsPatch = {
      ...sessionSettingsPatch,
      ...sanitized
    };
    if (cachedData) {
      cachedData = {
        ...cachedData,
        settings: {
          ...(cachedData.settings || {}),
          ...sanitized
        }
      };
    }
    dirtySessionPatch = true;
  }

  function flushSync() {
    if (!dirtySessionPatch && !cachedData) return;
    try {
      const fp = dataFilePath();
      const bak = backupFilePath();
      let baseObj = cachedData;
      if (!baseObj && existsSync(fp)) {
        try {
          baseObj = JSON.parse(readFileSync(fp, 'utf8'));
        } catch (_) {
          baseObj = null;
        }
      }
      const shaped = ensureDataShape(applySessionPatch(baseObj));
      cachedData = shaped;
      dirtySessionPatch = false;
      mkdirSync(path.dirname(fp), { recursive: true });
      const tmp = `${fp}.tmp-sync-${process.pid}`;
      const serialized = JSON.stringify(shaped, null, 2);
      writeFileSync(tmp, serialized, 'utf8');
      if (existsSync(fp)) {
        try { copyFileSync(fp, bak); } catch (_) {}
      }
      try {
        renameSync(tmp, fp);
      } catch (_) {
        writeFileSync(fp, serialized, 'utf8');
        try { unlinkSync(tmp); } catch (_) {}
      }
    } catch (err) {
      logMain?.('ERROR', 'flushSync failed', { error: err?.message || String(err) });
    }
  }

  function enqueue(fn) {
    const run = ioQueue.then(fn, fn);
    ioQueue = run.catch(() => {});
    return run;
  }

  return {
    ensureDataShape,
    updateSessionSettings,
    flushSync,
    loadData: () => enqueue(async () => {
      if (cachedData) return cachedData;
      return readFromDisk();
    }),
    saveData: (data) => enqueue(() => writeAtomically(data)),
    mutateData: (mutator) => enqueue(async () => {
      const current = cachedData || await readFromDisk();
      const result = await mutator(current);
      if (result && typeof result === 'object' && 'nextData' in result) {
        const saved = await writeAtomically(result.nextData);
        return { ...result, data: saved };
      }
      const saved = await writeAtomically(result || current);
      return saved;
    })
  };
}

module.exports = {
  ensureDataShape,
  createDataStore
};
