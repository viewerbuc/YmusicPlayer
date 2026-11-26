const path = require('path');
const fs = require('fs/promises');
const { existsSync } = require('fs');
const mm = require('music-metadata');
const { AUDIO_EXT, LYRIC_EXT, normalizePath, normalizeId } = require('./constants.cjs');
const { findLyricsForAudio } = require('./lyrics-utils.cjs');

const PARSE_CONCURRENCY = 12;

async function walk(dir, result = [], visitedDirs = new Set()) {
  let realDir = dir;
  try {
    realDir = await fs.realpath(dir);
  } catch (_) {
    return result;
  }
  const dirKey = normalizeId(realDir);
  if (visitedDirs.has(dirKey)) return result;
  visitedDirs.add(dirKey);

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return result;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(full, result, visitedDirs);
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

async function listSameDirLyrics(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const lyricFiles = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (LYRIC_EXT.has(path.extname(entry.name).toLowerCase())) {
        lyricFiles.push(normalizePath(path.join(dir, entry.name)));
      }
    }
    return lyricFiles;
  } catch (_) {
    return [];
  }
}

function buildLyricDirMap(lyricFiles) {
  const map = new Map();
  for (const file of lyricFiles || []) {
    const dirKey = normalizeId(path.dirname(file));
    let bucket = map.get(dirKey);
    if (!bucket) {
      bucket = [];
      map.set(dirKey, bucket);
    }
    bucket.push(file);
  }
  return map;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) break;
      results[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function parseTrack(file, lyricSource, statInfo = null) {
  const normalizedFile = normalizePath(file);
  let stat = statInfo;
  if (!stat) {
    try {
      stat = await fs.stat(file);
    } catch (_) {
      stat = null;
    }
  }

  let metadata = null;
  try {
    metadata = await mm.parseFile(file, { skipCovers: true });
  } catch (_) {
    metadata = null;
  }

  const common = metadata?.common || {};
  const format = metadata?.format || {};
  return {
    id: normalizeId(normalizedFile),
    path: normalizedFile,
    title: common.title || path.parse(normalizedFile).name,
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: Number.isFinite(format.duration) ? Math.round(format.duration) : 0,
    folder: normalizePath(path.dirname(normalizedFile)),
    ext: path.extname(normalizedFile).toLowerCase(),
    lyricPath: findLyricsForAudio(normalizedFile, lyricSource),
    liked: false,
    mtimeMs: stat ? Math.trunc(stat.mtimeMs) : 0,
    size: stat ? stat.size : 0
  };
}

async function scanSingleTrack(trackPath) {
  const normalizedTrackPath = normalizePath(trackPath);
  const lyricFiles = await listSameDirLyrics(path.dirname(trackPath));
  return parseTrack(normalizedTrackPath, lyricFiles);
}

async function scanFolders(folders, prevData) {
  const cleanFolders = [...new Set((folders || []).filter(Boolean).map(normalizePath))];
  const allFiles = [];
  const visitedDirs = new Set();
  for (const folder of cleanFolders) {
    if (existsSync(folder)) {
      await walk(folder, allFiles, visitedDirs);
    }
  }

  const normalized = allFiles.map(normalizePath);
  const lyricFiles = normalized.filter((f) => LYRIC_EXT.has(path.extname(f).toLowerCase()));
  const audioFiles = normalized.filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  const lyricByDir = buildLyricDirMap(lyricFiles);

  const prevTracksById = new Map((prevData.tracks || []).map((t) => [t.id, t]));
  const prevLiked = new Set((prevData.tracks || []).filter((t) => t.liked).map((t) => t.id));

  const uniqAudioEntries = [];
  const seenIds = new Set();
  for (const af of audioFiles) {
    const id = normalizeId(af);
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqAudioEntries.push({ id, path: af });
    }
  }

  const tracks = await mapWithConcurrency(uniqAudioEntries, PARSE_CONCURRENCY, async ({ id, path: af }) => {
    let stat = null;
    try {
      stat = await fs.stat(af);
    } catch (_) {
      stat = null;
    }

    const prev = prevTracksById.get(id);
    const mtimeMs = stat ? Math.trunc(stat.mtimeMs) : 0;
    const size = stat ? stat.size : 0;

    if (prev && mtimeMs > 0 && prev.mtimeMs === mtimeMs && prev.size === size && prev.title) {
      return {
        ...prev,
        id,
        path: af,
        folder: normalizePath(path.dirname(af)),
        lyricPath: findLyricsForAudio(af, lyricByDir),
        liked: prevLiked.has(id)
      };
    }

    const fresh = await parseTrack(af, lyricByDir, stat);
    fresh.liked = prevLiked.has(id);
    return fresh;
  });

  const validTrackIds = new Set(tracks.map((t) => t.id));
  const favorites = prevData.playlists.find((p) => p.id === 'favorites') || {
    id: 'favorites',
    name: '我喜欢',
    fixed: true,
    trackIds: []
  };
  favorites.trackIds = tracks.filter((t) => t.liked).map((t) => t.id);

  const otherPlaylists = prevData.playlists.filter((p) => p.id !== 'favorites').map((p) => ({
    ...p,
    trackIds: [...new Set((p.trackIds || []).map(normalizeId).filter((id) => validTrackIds.has(id)))]
  }));

  return {
    ...prevData,
    scanFolders: cleanFolders,
    tracks,
    playlists: [favorites, ...otherPlaylists]
  };
}

async function mergeAudioFilesIntoData(audioPaths, prevData) {
  const nextTracks = [...(prevData.tracks || [])];
  const byId = new Map(nextTracks.map((track, index) => [track.id, index]));
  const added = [];
  const dirLyricCache = new Map();

  for (const rawAudioPath of audioPaths || []) {
    if (!rawAudioPath || !existsSync(rawAudioPath)) continue;
    const normalizedAudio = normalizePath(rawAudioPath);
    const dirKey = normalizeId(path.dirname(normalizedAudio));
    let lyricFiles = dirLyricCache.get(dirKey);
    if (!lyricFiles) {
      lyricFiles = await listSameDirLyrics(path.dirname(rawAudioPath));
      dirLyricCache.set(dirKey, lyricFiles);
    }
    const track = await parseTrack(normalizedAudio, lyricFiles);
    const prevIndex = byId.get(track.id);
    if (prevIndex == null) {
      nextTracks.push(track);
      byId.set(track.id, nextTracks.length - 1);
      added.push(track);
    } else {
      track.liked = !!nextTracks[prevIndex].liked;
      nextTracks[prevIndex] = track;
      added.push(track);
    }
  }

  const scanFoldersList = [
    ...new Set([
      ...(prevData.scanFolders || []).map(normalizePath),
      ...added.map((track) => track.folder)
    ])
  ];
  const validTrackIds = new Set(nextTracks.map((track) => track.id));
  const playlists = (prevData.playlists || []).map((playlist) => ({
    ...playlist,
    trackIds: [...new Set((playlist.trackIds || []).map(normalizeId).filter((id) => validTrackIds.has(id)))]
  }));

  return {
    nextData: { ...prevData, scanFolders: scanFoldersList, tracks: nextTracks, playlists },
    tracks: added
  };
}

module.exports = {
  walk,
  listSameDirLyrics,
  buildLyricDirMap,
  parseTrack,
  scanSingleTrack,
  scanFolders,
  mergeAudioFilesIntoData
};
