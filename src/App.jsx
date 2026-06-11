import { AnimatePresence, motion } from 'framer-motion';
import { pinyin } from 'pinyin-pro';
import {
  Heart,
  ListMusic,
  FolderTree,
  Users,
  ListOrdered,
  Shuffle,
  Repeat,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Search,
  X,
  Square,
  Settings2,
  ChevronDown,
  Disc3,
  Volume2,
  Moon,
  Sun,
  DownloadCloud
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const SPRING = { type: 'spring', stiffness: 300, damping: 30 };
const DEFAULT_DATA = {
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
    theme: 'dark',
    backgroundImagePath: '',
    backgroundBlur: 8,
    listTextTone: 'auto',
    volume: 0.8,
    lyricEncodingMap: {}
  }
};

const electronAPI = window.electronAPI;
const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
};

const ONLINE_SOURCES = [
  { id: 'NeteaseMusicClient', label: '网易云音乐' },
  { id: 'SodaMusicClient', label: '汽水音乐' },
  { id: 'MiguMusicClient', label: '咪咕音乐' },
  { id: 'QQMusicClient', label: 'QQ音乐' },
  { id: 'KuwoMusicClient', label: '酷我音乐' }
];

function formatDuration(seconds) {
  const s = Number.isFinite(seconds) ? seconds : 0;
  const m = Math.floor(s / 60);
  const sec = `${Math.floor(s % 60)}`.padStart(2, '0');
  return `${m}:${sec}`;
}

function parseLyrics(raw) {
  if (!raw) return [];
  const text = `${raw}`.replace(/^\uFEFF/, '');
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!matches.length) return [];
      const content = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
      return matches.map((m) => {
        const time = Number(m[1]) * 60 + Number(m[2]);
        return { time, text: content };
      });
    })
    .sort((a, b) => a.time - b.time);
}

function nextSort(prev, key) {
  if (prev.key !== key) return { key, dir: 'asc' };
  return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
}

function normalizeSearchText(value) {
  return `${value || ''}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSearchTokens(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(' ').map((x) => x.trim()).filter(Boolean);
}

function trackMatchesTokens(track, tokens) {
  if (!tokens.length) return true;
  const searchable = `${normalizeSearchText(track?.title)} ${normalizeSearchText(track?.artist)}`.trim();
  if (!searchable) return false;
  return tokens.every((token) => searchable.includes(token));
}

function dedupeTracksById(tracks) {
  const map = new Map();
  for (const t of tracks || []) {
    if (!t?.id) continue;
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}

function cyclePlayMode(mode) {
  if (mode === 'sequence') return 'random';
  if (mode === 'random') return 'loop';
  return 'sequence';
}

const MIXED_COLLATOR = new Intl.Collator(['zh-Hans', 'en'], {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true
});

function toMixedSortKey(value) {
  const text = normalizeSearchText(value);
  if (!text) return '';
  const py = pinyin(text, { toneType: 'none' });
  return normalizeSearchText(py || text);
}

function App() {
  const [data, setData] = useState(DEFAULT_DATA);
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(DEFAULT_DATA.settings.theme === 'dark');
  const [view, setView] = useState('songs');
  const [playlistId, setPlaylistId] = useState('all');
  const [sort, setSort] = useState({ key: 'title', dir: 'asc' });
  const [query, setQuery] = useState('');
  const [currentTrackId, setCurrentTrackId] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [mini, setMini] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [lyricsRaw, setLyricsRaw] = useState('');
  const [pendingQueue, setPendingQueue] = useState([]);
  const [trackDuration, setTrackDuration] = useState(0);
  const [playError, setPlayError] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState(null);
  const [bgDataUrl, setBgDataUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
  const [currentCoverDataUrl, setCurrentCoverDataUrl] = useState('');
  const [lyricDebugPath, setLyricDebugPath] = useState('');
  const [encodingMenuOpen, setEncodingMenuOpen] = useState(false);
  const [closeBehaviorMenuOpen, setCloseBehaviorMenuOpen] = useState(false);
  const [lyricOffsetSec, setLyricOffsetSec] = useState(0);
  const [lyricAdjustMode, setLyricAdjustMode] = useState(false);
  const [holdLyricIdx, setHoldLyricIdx] = useState(null);
  const [lyricLines, setLyricLines] = useState([]);
  const [lyricAlignNotice, setLyricAlignNotice] = useState('');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineSources, setOnlineSources] = useState(ONLINE_SOURCES);
  const [selectedOnlineSources, setSelectedOnlineSources] = useState(ONLINE_SOURCES.map((source) => source.id));
  const [onlineResults, setOnlineResults] = useState([]);
  const [selectedOnlineKeys, setSelectedOnlineKeys] = useState([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineDownloading, setOnlineDownloading] = useState(false);
  const [onlineNotice, setOnlineNotice] = useState('');
  const [onlineSearchStatus, setOnlineSearchStatus] = useState(null);
  const [onlineLimitPerSource, setOnlineLimitPerSource] = useState(15);
  const [downloadFolder, setDownloadFolder] = useState('');

  const audioRef = useRef(null);
  const panelLyricsScrollRef = useRef(null);
  const sourceSwitchingRef = useRef(false);
  const playHistoryRef = useRef([]);
  const audioLoadSeqRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  const toggleTheme = () => {
    const nextTheme = dark ? 'light' : 'dark';
    setDark(nextTheme === 'dark');
    setData((prev) => ({ ...prev, settings: { ...prev.settings, theme: nextTheme } }));
  };

  useEffect(() => {
    const load = async () => {
      if (!electronAPI) {
        setLoaded(true);
        return;
      }
      const saved = await electronAPI.loadData();
      setData(saved);
      setDark((saved.settings?.theme || DEFAULT_DATA.settings.theme) === 'dark');
      setLoaded(true);
    };
    load();
  }, []);

  useEffect(() => {
    const loadOnlineMeta = async () => {
      if (!electronAPI) return;
      const sources = await electronAPI.getOnlineSources?.();
      if (Array.isArray(sources) && sources.length) {
        setOnlineSources(sources);
        setSelectedOnlineSources(sources.map((source) => source.id));
      }
      const folder = await electronAPI.getDefaultDownloadFolder?.();
      if (folder) setDownloadFolder(folder);
    };
    loadOnlineMeta();
  }, []);

  useEffect(() => {
    if (!electronAPI?.onOnlineSearchStatus) return;
    const off = electronAPI.onOnlineSearchStatus((status) => {
      setOnlineSearchStatus(status || null);
      if (status?.message) setOnlineNotice(status.message);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onOnlineSearchResults) return;
    const off = electronAPI.onOnlineSearchResults((payload) => {
      if (Array.isArray(payload?.results)) {
        setOnlineResults(payload.results);
      } else if (Array.isArray(payload?.append) && payload.append.length) {
        setOnlineResults((prev) => [...prev, ...payload.append]);
      }
      if (payload?.sourceLabel) setOnlineNotice(`${payload.sourceLabel} 已返回结果，可先选择下载`);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!loaded || !electronAPI) return;
    const timer = setTimeout(() => {
      electronAPI.saveData(data);
    }, 250);
    return () => clearTimeout(timer);
  }, [data, loaded]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    const close = () => setEncodingMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    const close = () => setCloseBehaviorMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    let canceled = false;
    const loadBg = async () => {
      const bgPath = data.settings?.backgroundImagePath;
      if (!bgPath || !electronAPI?.readImageDataUrl) {
        setBgDataUrl('');
        return;
      }
      const dataUrl = await electronAPI.readImageDataUrl(bgPath);
      if (!canceled) setBgDataUrl(dataUrl || '');
    };
    loadBg();
    return () => {
      canceled = true;
    };
  }, [data.settings?.backgroundImagePath]);

  const uniqueTracks = useMemo(() => dedupeTracksById(data.tracks), [data.tracks]);

  const baseTracks = useMemo(() => {
    if (playlistId === 'all') return uniqueTracks;
    const p = data.playlists.find((x) => x.id === playlistId);
    if (!p) return uniqueTracks;
    const ids = new Set(p.trackIds);
    return uniqueTracks.filter((t) => ids.has(t.id));
  }, [uniqueTracks, data.playlists, playlistId]);

  const filteredTracks = useMemo(() => {
    const tokens = splitSearchTokens(query);
    if (!tokens.length) return baseTracks;
    return baseTracks.filter((t) => trackMatchesTokens(t, tokens));
  }, [baseTracks, query]);

  const queryTokens = useMemo(() => splitSearchTokens(query), [query]);

  const sortedTracks = useMemo(() => {
    const arr = [...filteredTracks];
    const dir = sort.dir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      const ak = toMixedSortKey(av);
      const bk = toMixedSortKey(bv);
      const primary = MIXED_COLLATOR.compare(ak, bk) * dir;
      if (primary !== 0) return primary;
      return MIXED_COLLATOR.compare(`${av ?? ''}`, `${bv ?? ''}`) * dir;
    });
    return arr;
  }, [filteredTracks, sort]);

  const trackMap = useMemo(() => new Map(uniqueTracks.map((t) => [t.id, t])), [uniqueTracks]);
  const currentTrack = currentTrackId ? trackMap.get(currentTrackId) : null;
  const playMode = data.settings.playMode;
  const lyricsEnabled = !!currentTrack && isPlaying && data.settings.showLyrics && (!mini || data.settings.minimizedShowLyrics);
  const floatingLyricsEnabled = lyricsEnabled && !playerPanelOpen;
  const bgBlur = Number.isFinite(Number(data.settings.backgroundBlur)) ? Number(data.settings.backgroundBlur) : 8;
  const listTextTone = ['auto', 'dark', 'light'].includes(data.settings.listTextTone) ? data.settings.listTextTone : 'auto';
  const listTextClass = listTextTone === 'light'
    ? 'text-white/90'
    : listTextTone === 'dark'
      ? 'text-black'
      : 'text-black/85 dark:text-white/90';
  const listMutedTextClass = listTextTone === 'light'
    ? 'text-white/70'
    : listTextTone === 'dark'
      ? 'text-black/82'
      : 'text-black/60 dark:text-white/60';
  const listFaintTextClass = listTextTone === 'light'
    ? 'text-white/58'
    : listTextTone === 'dark'
      ? 'text-black/68'
      : 'text-black/45 dark:text-white/45';
  const listAccentTextClass = listTextTone === 'auto'
    ? 'text-[#0066d6] dark:text-[#9accff]'
    : listMutedTextClass;
  const listHeaderClass = 'font-semibold text-black/85 dark:text-white/95';
  const volume = Math.max(0, Math.min(1, Number.isFinite(Number(data.settings.volume)) ? Number(data.settings.volume) : 0.8));
  const lyricEncoding = currentTrackId ? (data.settings.lyricEncodingMap?.[currentTrackId] || 'auto') : 'auto';
  const adjustedLyricTime = time + lyricOffsetSec;
  const encodingLabelMap = {
    auto: '编码: 自动',
    'utf-8': 'UTF-8',
    gb18030: 'GB18030',
    gbk: 'GBK',
    shift_jis: 'Shift_JIS',
    'euc-kr': 'EUC-KR',
    'utf-16le': 'UTF-16LE',
    'utf-16be': 'UTF-16BE'
  };
  const encodingOptions = Object.entries(encodingLabelMap);

  useEffect(() => {
    let canceled = false;
    const loadSeq = audioLoadSeqRef.current + 1;
    audioLoadSeqRef.current = loadSeq;
    const isCurrentLoad = () => !canceled && audioLoadSeqRef.current === loadSeq;
    let ownedBlobUrl = '';
    const loadSource = async () => {
      const audio = audioRef.current;
      if (!audio || !currentTrack || !electronAPI?.readAudioBuffer) return;
      sourceSwitchingRef.current = true;
      setPlayError('');
      try {
        const raw = await electronAPI.readAudioBuffer(currentTrack.path);
        if (!isCurrentLoad()) return;
        if (!raw) {
          setPlayError('该歌曲无法读取或解码');
          setIsPlaying(false);
          return;
        }
        const payload = raw?.data ?? raw;
        const mime = raw?.kind === 'wav-transcoded' ? 'audio/wav' : (MIME_BY_EXT[currentTrack.ext] || 'audio/mpeg');
        const bytes = payload?.type === 'Buffer' && Array.isArray(payload.data)
          ? new Uint8Array(payload.data)
          : payload instanceof Uint8Array
            ? payload
            : new Uint8Array(payload);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        ownedBlobUrl = blobUrl;
        const prevUrl = audio.dataset.blobUrl;
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        audio.dataset.blobUrl = blobUrl;
        audio.pause();
        audio.src = blobUrl;
        audio.load();
        audio.volume = volume;
        audio.currentTime = 0;
        setTime(0);
        setTrackDuration(currentTrack.duration || 0);
        setPlayError(
          raw?.kind === 'wav-transcoded'
            ? 'WMA 已自动转码播放'
            : raw?.kind === 'wma-raw'
              ? '检测到 WMA 原始流，若无法播放请安装 ffmpeg'
              : ''
        );
        if (isPlaying) {
          await audio.play().catch(() => {
            if (!isCurrentLoad()) return;
            setPlayError('当前格式暂不支持播放');
            setIsPlaying(false);
          });
        }
      } catch (_) {
        if (!isCurrentLoad()) return;
        setPlayError('音频读取失败，请尝试重新扫描');
        setIsPlaying(false);
      } finally {
        if (isCurrentLoad()) sourceSwitchingRef.current = false;
      }
    };
    loadSource();
    return () => {
      audioLoadSeqRef.current += 1;
      const audio = audioRef.current;
      if (ownedBlobUrl) {
        URL.revokeObjectURL(ownedBlobUrl);
        if (audio?.dataset?.blobUrl === ownedBlobUrl) delete audio.dataset.blobUrl;
      }
      sourceSwitchingRef.current = false;
      canceled = true;
    };
  }, [currentTrackId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (sourceSwitchingRef.current) return;
    if (isPlaying) {
      const playSeq = audioLoadSeqRef.current;
      audio.play().catch(() => {
        if (audioLoadSeqRef.current !== playSeq) return;
        setPlayError('当前格式暂不支持播放');
        setIsPlaying(false);
      });
    }
    else audio.pause();
  }, [isPlaying]);

  useEffect(() => {
    const loadLyrics = async () => {
      if (!currentTrack?.path || !electronAPI?.readTextFile) {
        setLyricsRaw('');
        setLyricLines([]);
        return;
      }
      const candidates = [];
      if (currentTrack.lyricPath) candidates.push(currentTrack.lyricPath);
      const dot = currentTrack.path.lastIndexOf('.');
      const base = dot > 0 ? currentTrack.path.slice(0, dot) : currentTrack.path;
      candidates.push(`${base}.lrc`, `${base}.LRC`, `${base}.txt`, `${base}.TXT`);
      const uniqueCandidates = [...new Set(candidates)];
      for (const lyricPath of uniqueCandidates) {
        const txt = electronAPI.readTextFileWithEncoding
          ? await electronAPI.readTextFileWithEncoding(lyricPath, lyricEncoding)
          : await electronAPI.readTextFile(lyricPath);
        if (!txt) continue;
        const parsed = parseLyrics(txt);
        if (parsed.length > 0) {
          setLyricDebugPath(lyricPath);
          setLyricsRaw(txt);
          setLyricLines(parsed);
          return;
        }
      }
      setLyricDebugPath(uniqueCandidates[0] || '');
      setLyricsRaw('');
      setLyricLines([]);
    };
    loadLyrics();
  }, [currentTrack?.lyricPath, currentTrack?.path, lyricEncoding]);

  useEffect(() => {
    setLyricOffsetSec(0);
    setLyricAdjustMode(false);
    setHoldLyricIdx(null);
    setLyricAlignNotice('');
  }, [currentTrackId]);

  useEffect(() => {
    let canceled = false;
    const loadCover = async () => {
      if (!currentTrack?.path || !electronAPI?.readTrackCoverDataUrl) {
        setCurrentCoverDataUrl('');
        return;
      }
      const dataUrl = await electronAPI.readTrackCoverDataUrl(currentTrack.path);
      if (!canceled) setCurrentCoverDataUrl(dataUrl || '');
    };
    loadCover();
    return () => {
      canceled = true;
    };
  }, [currentTrack?.path]);

  const activeLyricIdx = useMemo(() => {
    if (!lyricLines.length) return -1;
    for (let i = lyricLines.length - 1; i >= 0; i -= 1) {
      if (adjustedLyricTime >= lyricLines[i].time) return i;
    }
    return -1;
  }, [lyricLines, adjustedLyricTime]);

  const currentLyricLine = useMemo(() => {
    if (!lyricLines.length) return '';
    if (activeLyricIdx < 0) return lyricLines[0]?.text || '';
    return lyricLines[activeLyricIdx]?.text || '';
  }, [lyricLines, activeLyricIdx]);

  const heldLyricLineText = useMemo(() => {
    if (holdLyricIdx == null) return '';
    return lyricLines[holdLyricIdx]?.text || '';
  }, [holdLyricIdx, lyricLines]);

  const nextLyricLine = useMemo(() => {
    if (!lyricLines.length) return '';
    if (activeLyricIdx < 0) return lyricLines[1]?.text || '';
    return lyricLines[activeLyricIdx + 1]?.text || '';
  }, [lyricLines, activeLyricIdx]);

  useEffect(() => {
    if (!electronAPI?.showLyricsWindow || !electronAPI?.hideLyricsWindow) return;
    if (floatingLyricsEnabled) electronAPI.showLyricsWindow();
    else electronAPI.hideLyricsWindow();
    return () => {
      electronAPI.hideLyricsWindow();
    };
  }, [floatingLyricsEnabled]);

  useEffect(() => {
    if (!electronAPI?.updateLyricsWindow) return;
    if (!floatingLyricsEnabled) return;
    electronAPI.updateLyricsWindow({
      hasLyrics: lyricLines.length > 0,
      current: currentLyricLine,
      next: nextLyricLine,
      dark,
      title: currentTrack?.title || '',
      artist: currentTrack?.artist || ''
    });
  }, [floatingLyricsEnabled, lyricLines.length, currentLyricLine, nextLyricLine, dark, currentTrack?.title, currentTrack?.artist]);

  useEffect(() => {
    if (!electronAPI?.setLyricsWindowOptions) return;
    electronAPI.setLyricsWindowOptions({
      locked: !!data.settings.lyricLocked,
      clickThrough: !!data.settings.lyricClickThrough
    });
  }, [data.settings.lyricLocked, data.settings.lyricClickThrough]);

  useEffect(() => {
    if (!electronAPI?.onLyricsMinimized) return;
    const off = electronAPI.onLyricsMinimized(() => {
      setData((prev) => ({ ...prev, settings: { ...prev.settings, showLyrics: false } }));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onCloseBehaviorUpdated) return;
    const off = electronAPI.onCloseBehaviorUpdated((behavior) => {
      setData((prev) => ({ ...prev, settings: { ...prev.settings, closeBehavior: behavior || 'ask' } }));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onWindowMaximizedChanged) return;
    const off = electronAPI.onWindowMaximizedChanged((maxed) => {
      setIsWindowMaximized(!!maxed);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const loadWindowMax = async () => {
      if (!electronAPI?.windowIsMaximized) return;
      const maxed = await electronAPI.windowIsMaximized();
      if (!canceled) setIsWindowMaximized(!!maxed);
    };
    loadWindowMax();
    return () => {
      canceled = true;
    };
  }, []);

  const playTrack = (id, options = {}) => {
    if (currentTrackId && currentTrackId !== id && options.recordHistory !== false) {
      playHistoryRef.current = [...playHistoryRef.current, currentTrackId].slice(-100);
    }
    setCurrentTrackId(id);
    setLyricAdjustMode(false);
    setHoldLyricIdx(null);
    setLyricOffsetSec(0);
    setIsPlaying(true);
  };

  const playNext = () => {
    const activePlayList = view === 'folders' ? groupedByFolder.flatMap(([, tracks]) => tracks) : displayTracks;
    if (!activePlayList.length) return;
    if (pendingQueue.length > 0) {
      const [next, ...rest] = pendingQueue;
      setPendingQueue(rest);
      playTrack(next);
      return;
    }
    if (!currentTrackId) {
      playTrack(activePlayList[0].id);
      return;
    }
    if (playMode === 'random') {
      const pool = activePlayList.filter((t) => t.id !== currentTrackId);
      if (!pool.length) return;
      const next = pool[Math.floor(Math.random() * pool.length)];
      playTrack(next.id);
      return;
    }
    if (playMode === 'loop') {
      if (currentTrackId) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => setIsPlaying(false));
        } else {
          playTrack(currentTrackId);
        }
      }
      return;
    }
    const idx = activePlayList.findIndex((t) => t.id === currentTrackId);
    if (idx < 0) {
      playTrack(activePlayList[0].id);
      return;
    }
    if (idx >= activePlayList.length - 1) {
      setIsPlaying(false);
      return;
    }
    const next = activePlayList[idx + 1];
    playTrack(next.id);
  };

  const playPrev = () => {
    const activePlayList = view === 'folders' ? groupedByFolder.flatMap(([, tracks]) => tracks) : displayTracks;
    if (!activePlayList.length) return;
    if (!currentTrackId) {
      playTrack(activePlayList[0].id);
      return;
    }
    if (playMode === 'random') {
      const activeIds = new Set(activePlayList.map((track) => track.id));
      while (playHistoryRef.current.length) {
        const prevId = playHistoryRef.current.pop();
        if (prevId && prevId !== currentTrackId && activeIds.has(prevId)) {
          playTrack(prevId, { recordHistory: false });
          return;
        }
      }
    }
    const idx = activePlayList.findIndex((t) => t.id === currentTrackId);
    if (idx < 0) {
      playTrack(activePlayList[0].id);
      return;
    }
    if (idx === 0) {
      if (playMode === 'loop') {
        playTrack(activePlayList[activePlayList.length - 1].id);
      }
      return;
    }
    const prev = activePlayList[idx - 1];
    playTrack(prev.id);
  };

  const toggleLike = (id) => {
    setData((prev) => {
      const tracks = prev.tracks.map((t) => (t.id === id ? { ...t, liked: !t.liked } : t));
      const likedSet = new Set(tracks.filter((t) => t.liked).map((t) => t.id));
      const playlists = prev.playlists.map((p) =>
        p.id === 'favorites' ? { ...p, trackIds: [...likedSet] } : p
      );
      return { ...prev, tracks, playlists };
    });
  };

  const addPlaylist = (nameInput) => {
    const name = `${nameInput || ''}`.trim();
    if (!name) return;
    const id = `playlist-${Date.now()}`;
    setData((prev) => ({ ...prev, playlists: [...prev.playlists, { id, name: name.trim(), fixed: false, trackIds: [] }] }));
    setNewPlaylistName('');
    setCreatingPlaylist(false);
  };

  const removePlaylist = (id) => {
    const target = data.playlists.find((p) => p.id === id);
    if (!target) return;
    setPlaylistToDelete(target);
  };

  const confirmRemovePlaylist = () => {
    if (!playlistToDelete) return;
    const id = playlistToDelete.id;
    setData((prev) => ({ ...prev, playlists: prev.playlists.filter((p) => p.id !== id) }));
    if (playlistId === id) setPlaylistId('all');
    setPlaylistToDelete(null);
  };

  const pickBackgroundImage = async () => {
    if (!electronAPI?.pickBackgroundImage) return;
    const selected = await electronAPI.pickBackgroundImage();
    if (!selected) return;
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, backgroundImagePath: selected }
    }));
  };

  const clearBackgroundImage = () => {
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, backgroundImagePath: '' }
    }));
  };

  const addTrackToPlaylist = (trackId, targetId) => {
    setData((prev) => {
      const playlists = prev.playlists.map((p) => {
        if (p.id !== targetId) return p;
        if (p.trackIds.includes(trackId)) return p;
        return { ...p, trackIds: [...p.trackIds, trackId] };
      });
      return { ...prev, playlists };
    });
  };

  const removeTrack = (trackId) => {
    setData((prev) => {
      const tracks = prev.tracks.filter((t) => t.id !== trackId);
      const playlists = prev.playlists.map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => id !== trackId) }));
      return { ...prev, tracks, playlists };
    });
    if (currentTrackId === trackId) {
      setCurrentTrackId(null);
      setIsPlaying(false);
    }
  };

  const pickAndScanFolders = async () => {
    if (!electronAPI) return;
    const folders = await electronAPI.pickFolders();
    if (!folders?.length) return;
    const prev = data.scanFolders || [];
    const merged = [...new Set([...prev, ...folders])];
    setScanBusy(true);
    try {
      const scanned = await electronAPI.scanFolders(merged);
      setData(scanned);
    } finally {
      setScanBusy(false);
    }
  };

  const rescanManagedFolders = async () => {
    if (!electronAPI) return;
    setScanBusy(true);
    try {
      const scanned = await electronAPI.scanFolders(data.scanFolders || []);
      setData(scanned);
    } finally {
      setScanBusy(false);
    }
  };

  const removeManagedFolder = async (folderPath) => {
    if (!electronAPI) return;
    const nextFolders = (data.scanFolders || []).filter((f) => f !== folderPath);
    setScanBusy(true);
    try {
      const scanned = await electronAPI.scanFolders(nextFolders);
      setData(scanned);
      if (currentTrackId && !scanned.tracks.some((t) => t.id === currentTrackId)) {
        setCurrentTrackId(scanned.tracks[0]?.id || null);
        if (!scanned.tracks.length) setIsPlaying(false);
      }
    } finally {
      setScanBusy(false);
    }
  };

  const rescanSingle = async (track) => {
    if (!electronAPI) return;
    const fresh = await electronAPI.rescanTrack(track.path);
    setData((prev) => ({ ...prev, tracks: prev.tracks.map((t) => (t.id === fresh.id ? { ...fresh, liked: t.liked } : t)) }));
    return fresh;
  };

  const toggleOnlineSource = (sourceId) => {
    setSelectedOnlineSources((prev) => {
      if (prev.includes(sourceId)) {
        const next = prev.filter((id) => id !== sourceId);
        return next.length ? next : prev;
      }
      return [...prev, sourceId];
    });
  };

  const toggleOnlineSelection = (key) => {
    setSelectedOnlineKeys((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  };

  const searchOnlineMusic = async () => {
    const keyword = onlineQuery.trim();
    if (!keyword || !electronAPI?.searchOnlineMusic) return;
    setOnlineBusy(true);
    setOnlineSearchStatus({ active: true, completed: 0, total: selectedOnlineSources.length, message: `准备启动 musicdl，每源最多 ${onlineLimitPerSource} 首...` });
    setOnlineNotice('正在搜索在线音乐...');
    setSelectedOnlineKeys([]);
    try {
      const result = await electronAPI.searchOnlineMusic({
        keyword,
        sources: selectedOnlineSources,
        limitPerSource: onlineLimitPerSource
      });
      if (!result?.ok) {
        setOnlineResults([]);
        setOnlineNotice(result?.error || '搜索失败，请稍后重试');
        setOnlineSearchStatus(null);
        return;
      }
      setOnlineResults(result.results || []);
      if (result.cancelled) {
        setOnlineNotice((result.results || []).length ? `已暂停搜索，保留 ${result.results.length} 首结果` : '已暂停搜索，暂未找到结果');
        return;
      }
      const errorText = result.errors?.length ? `，${result.errors.length} 个源失败/超时` : '';
      setOnlineNotice((result.results || []).length ? `找到 ${result.results.length} 首可下载歌曲${errorText}` : '未找到可下载歌曲');
    } finally {
      setOnlineBusy(false);
      setOnlineSearchStatus(null);
    }
  };

  const pauseOnlineSearch = async () => {
    if (!electronAPI?.cancelOnlineSearch) return;
    setOnlineNotice('正在暂停搜索，保留已找到的结果...');
    await electronAPI.cancelOnlineSearch();
  };

  const pickOnlineDownloadFolder = async () => {
    const selected = await electronAPI?.pickDownloadFolder?.();
    if (selected) setDownloadFolder(selected);
  };

  const downloadSelectedOnlineMusic = async () => {
    if (!electronAPI?.downloadOnlineMusic) return;
    const selectedSongs = onlineResults.filter((item) => selectedOnlineKeys.includes(item.key));
    if (!selectedSongs.length) {
      setOnlineNotice('请先选择要下载的歌曲');
      return;
    }
    setOnlineDownloading(true);
    setOnlineNotice(`正在下载 ${selectedSongs.length} 首歌曲...`);
    try {
      const result = await electronAPI.downloadOnlineMusic({
        songs: selectedSongs,
        targetDir: downloadFolder
      });
      if (!result?.ok) {
        setOnlineNotice(result?.error || '下载失败，请稍后重试');
        return;
      }
      if (result.data) setData(result.data);
      setSelectedOnlineKeys([]);
      setOnlineNotice(`下载完成，已导入 ${result.tracks?.length || 0} 首歌曲`);
    } finally {
      setOnlineDownloading(false);
    }
  };

  const openLyricFinder = () => {
    if (!currentTrack || !electronAPI?.openLyricFinderWindow) return;
    const keyword = `${currentTrack.artist || ''} - ${currentTrack.title || ''}`.trim();
    const searchUrl = `https://www.toomic.com/?search=${encodeURIComponent(keyword)}`;
    electronAPI.openLyricFinderWindow({
      url: searchUrl,
      trackPath: currentTrack.path
    });
  };

  const adjustLyricOffset = (delta) => {
    setLyricOffsetSec((v) => {
      const next = Math.max(-30, Math.min(30, Number((v + delta).toFixed(2))));
      return next;
    });
    const audio = audioRef.current;
    if (audio) {
      setTime(audio.currentTime || 0);
    }
  };

  const saveLyricOffsetToFile = async () => {
    if (!electronAPI?.writeTextFile || !lyricDebugPath || !lyricLines.length) return;
    const shiftedLines = lyricLines.map((line) => ({
      ...line,
      time: Math.max(0, line.time - lyricOffsetSec)
    }));
    const toLrc = shiftedLines
      .map((line) => {
        const ms = Math.round(line.time * 1000);
        const mm = Math.floor(ms / 60000);
        const sec = (ms - mm * 60000) / 1000;
        return `[${String(mm).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}]${line.text || ''}`;
      })
      .join('\n');
    const ok = await electronAPI.writeTextFile(lyricDebugPath, toLrc);
    if (!ok) {
      setPlayError('歌词偏移保存失败');
      return;
    }
    setLyricsRaw(toLrc);
    setLyricLines(shiftedLines);
    setLyricOffsetSec(0);
    setLyricAdjustMode(false);
    setHoldLyricIdx(null);
    setPlayError('');
  };

  const applyAlignAtCurrent = (idx) => {
    let appliedDelta = 0;
    setLyricLines((prev) => {
      if (!prev.length || idx < 0 || idx >= prev.length) return prev;
      const currentAtRelease = (audioRef.current?.currentTime ?? time) + lyricOffsetSec;
      const roundedCurrent = Math.max(0, Math.round(currentAtRelease * 10) / 10);
      const base = prev[idx].time;
      const minTarget = idx > 0 ? prev[idx - 1].time + 0.1 : 0;
      const target = Math.max(minTarget, roundedCurrent);
      const delta = target - base;
      if (Math.abs(delta) < 0.001) return prev;
      appliedDelta = delta;
      return prev.map((line, i) => (i < idx ? line : { ...line, time: Math.max(0, line.time + delta) }));
    });
    if (Math.abs(appliedDelta) >= 0.001) {
      const sign = appliedDelta > 0 ? '+' : '';
      setLyricAlignNotice(`已调整：从该句开始整体 ${sign}${appliedDelta.toFixed(1)}s`);
    } else {
      setLyricAlignNotice('已调整：该句时间无需变化');
    }
  };

  useEffect(() => {
    if (!lyricAlignNotice) return;
    const t = setTimeout(() => setLyricAlignNotice(''), 2400);
    return () => clearTimeout(t);
  }, [lyricAlignNotice]);

  useEffect(() => {
    if (!electronAPI?.onLyricDownloaded) return;
    const off = electronAPI.onLyricDownloaded(async (payload) => {
      if (!payload?.ok || !payload?.trackPath) {
        setPlayError('歌词下载失败，请重试');
        return;
      }
      const fresh = await electronAPI.rescanTrack(payload.trackPath);
      if (fresh?.id) {
        setData((prev) => ({ ...prev, tracks: prev.tracks.map((t) => (t.id === fresh.id ? { ...fresh, liked: t.liked } : t)) }));
      }
      if (currentTrack?.path === payload.trackPath && fresh?.lyricPath && electronAPI.readTextFile) {
        const txt = await electronAPI.readTextFile(fresh.lyricPath);
        setLyricsRaw(txt || '');
        setLyricLines(parseLyrics(txt || ''));
      }
      setPlayError('');
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [currentTrack?.path]);

  const displayTracks = useMemo(
    () => sortedTracks.filter((t) => trackMatchesTokens(t, queryTokens)),
    [sortedTracks, queryTokens]
  );

  const groupedByFolder = useMemo(() => {
    const map = new Map();
    for (const t of displayTracks) {
      const arr = map.get(t.folder) || [];
      arr.push(t);
      map.set(t.folder, arr);
    }
    return [...map.entries()].sort((a, b) => {
      const primary = MIXED_COLLATOR.compare(toMixedSortKey(a[0]), toMixedSortKey(b[0]));
      if (primary !== 0) return primary;
      return MIXED_COLLATOR.compare(a[0], b[0]);
    });
  }, [displayTracks]);

  const groupedByArtist = useMemo(() => {
    const map = new Map();
    for (const t of displayTracks) {
      const arr = map.get(t.artist) || [];
      arr.push(t);
      map.set(t.artist, arr);
    }
    return [...map.entries()].sort((a, b) => {
      const primary = MIXED_COLLATOR.compare(toMixedSortKey(a[0]), toMixedSortKey(b[0]));
      if (primary !== 0) return primary;
      return MIXED_COLLATOR.compare(a[0], b[0]);
    });
  }, [displayTracks]);

  const PlayModeIcon = playMode === 'sequence' ? ListOrdered : playMode === 'random' ? Shuffle : Repeat;
  const activePanelLyricId = activeLyricIdx >= 0 ? `panel-lyric-${activeLyricIdx}` : '';

  useEffect(() => {
    if (!playerPanelOpen || !activePanelLyricId || holdLyricIdx != null) return;
    const scroller = panelLyricsScrollRef.current;
    const el = document.getElementById(activePanelLyricId);
    if (!scroller || !el) return;
    const nextTop = Math.max(0, el.offsetTop - scroller.clientHeight * 0.45);
    scroller.scrollTo({ top: nextTop, behavior: 'smooth' });
  }, [activePanelLyricId, playerPanelOpen, currentTrackId, lyricOffsetSec, holdLyricIdx]);

  const renderOnlineDownloadPanel = () => (
    <div className="p-4 pb-8 space-y-4">
      <section className="rounded-2xl bg-white/50 dark:bg-[#1e1e1e]/55 backdrop-blur-md border border-black/5 dark:border-white/10 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/70 dark:bg-white/8 border border-black/5 dark:border-white/10 px-3 py-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
            <Search size={17} className="text-black/40 dark:text-white/45" />
            <input
              value={onlineQuery}
              onChange={(e) => setOnlineQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') searchOnlineMusic();
              }}
              placeholder="输入歌曲名、歌手或歌词关键词"
              className="min-w-0 flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium text-white bg-gradient-to-b from-blue-500 to-blue-600 disabled:opacity-55"
            onClick={searchOnlineMusic}
            disabled={onlineBusy || !onlineQuery.trim() || !selectedOnlineSources.length}
          >
            {onlineBusy ? `搜索中 ${onlineSearchStatus?.completed || 0}/${onlineSearchStatus?.total || selectedOnlineSources.length}` : '搜索'}
          </button>
          {onlineBusy && (
            <button
              className="rounded-xl px-4 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10"
              onClick={pauseOnlineSearch}
            >
              暂停搜索
            </button>
          )}
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10 disabled:opacity-55"
            onClick={downloadSelectedOnlineMusic}
            disabled={onlineDownloading || !selectedOnlineKeys.length}
          >
            {onlineDownloading ? '下载中...' : `下载选中 (${selectedOnlineKeys.length})`}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {onlineSources.map((source) => {
            const active = selectedOnlineSources.includes(source.id);
            return (
              <button
                key={source.id}
                className={`rounded-full px-3 py-1.5 border transition-colors ${
                  active
                    ? 'border-[#007aff]/40 bg-[#007aff]/12 text-[#0066d6] dark:text-[#9accff]'
                    : 'border-black/8 dark:border-white/10 bg-black/4 dark:bg-white/6 text-black/52 dark:text-white/52 hover:bg-black/8 hover:dark:bg-white/10'
                }`}
                onClick={() => toggleOnlineSource(source.id)}
              >
                {source.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-black/8 dark:border-white/10 bg-black/4 dark:bg-white/6 px-3 py-1.5 text-black/52 dark:text-white/52 transition-colors hover:bg-black/8 hover:dark:bg-white/10">
            <span className="text-black/52 dark:text-white/52">每个音乐源</span>
            <select
              value={onlineLimitPerSource}
              onChange={(e) => setOnlineLimitPerSource(Number(e.target.value) || 15)}
              className="appearance-none bg-transparent pr-4 outline-none font-medium text-[#0066d6] dark:text-[#9accff]"
              disabled={onlineBusy}
              style={{ backgroundImage: 'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)', backgroundPosition: 'calc(100% - 7px) 52%, calc(100% - 3px) 52%', backgroundSize: '4px 4px, 4px 4px', backgroundRepeat: 'no-repeat' }}
            >
              {[10, 15, 20].map((value) => (
                <option key={value} value={value} className="bg-white text-black dark:bg-[#111722] dark:text-white">{value} 首</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-xs text-black/55 dark:text-white/55 lg:flex-row lg:items-center">
          <div className="truncate" title={downloadFolder || '默认音乐目录'}>
            保存到：{downloadFolder || '默认音乐目录'}
          </div>
          <button className="w-fit rounded-lg px-2.5 py-1 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10" onClick={pickOnlineDownloadFolder}>
            更换目录
          </button>
        </div>

        {(!!onlineNotice || onlineSearchStatus?.active) && (
          <div className="mt-3 rounded-lg bg-black/5 dark:bg-white/8 border border-black/5 dark:border-white/10 px-3 py-2 text-xs text-black/58 dark:text-white/62">
            <div className="flex items-center justify-between gap-3">
              <span>{onlineNotice || '正在运行 musicdl...'}</span>
              {onlineSearchStatus?.active && (
                <span className="shrink-0 text-[#0066d6] dark:text-[#9accff]">
                  musicdl {onlineSearchStatus.completed || 0}/{onlineSearchStatus.total || selectedOnlineSources.length}
                </span>
              )}
            </div>
            {onlineSearchStatus?.active && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-[#007aff] transition-all duration-300"
                  style={{ width: `${Math.max(6, Math.round(((onlineSearchStatus.completed || 0) / Math.max(1, onlineSearchStatus.total || selectedOnlineSources.length)) * 100))}%` }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white/70 dark:bg-[#1e1e1e]/80 backdrop-blur-md border border-black/5 dark:border-white/10">
        <div className={`grid grid-cols-[44px_2fr_1.2fr_1.1fr_88px_96px] px-3 py-2 text-xs tracking-wide uppercase bg-[rgba(226,232,238,0.88)] dark:bg-[rgba(48,56,64,0.94)] border-b border-black/5 dark:border-white/10 ${listHeaderClass}`}>
          <span />
          <span>歌曲名</span>
          <span>作者</span>
          <span>专辑</span>
          <span className="text-right">大小</span>
          <span className="text-right pr-2">来源</span>
        </div>
        {onlineResults.map((item) => {
          const checked = selectedOnlineKeys.includes(item.key);
          return (
            <div
              key={item.key}
              className={`grid grid-cols-[44px_2fr_1.2fr_1.1fr_88px_96px] items-center px-3 py-2 text-sm border-b border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/8 apple-pointer ${listTextClass} ${
                checked ? 'bg-[#007aff]/10 dark:bg-[#007aff]/18' : ''
              }`}
              onClick={() => toggleOnlineSelection(item.key)}
            >
              <input type="checkbox" checked={checked} readOnly className="mx-auto accent-[#007aff]" />
              <div className="min-w-0">
                <div className={`truncate font-medium ${listTextClass}`}>{item.song_name}</div>
                <div className={`truncate text-[11px] ${listFaintTextClass}`}>
                  {item.ext || 'audio'} · {item.duration || '-:-:-'} {item.has_lyric ? '· 有歌词' : ''}
                </div>
              </div>
              <div className={`truncate ${listMutedTextClass}`}>{item.singers}</div>
              <div className={`truncate ${listMutedTextClass}`}>{item.album}</div>
              <div className={`text-right ${listMutedTextClass}`}>{item.file_size}</div>
              <div className={`text-right pr-2 ${listAccentTextClass}`}>{item.source_label || item.source}</div>
            </div>
          );
        })}
        {!onlineResults.length && (
          <div className={`py-16 text-center text-sm ${listFaintTextClass}`}>
            输入关键词后可从网易云、汽水、咪咕、QQ、酷我搜索并下载到本地曲库
          </div>
        )}
      </section>
    </div>
  );

  const renderRow = (track, rowKey) => {
    const isActive = currentTrackId === track.id;
    return (
      <div
        key={rowKey}
        className={`relative grid grid-cols-[48px_2fr_1.2fr_1.2fr_90px] items-center px-2 py-1.5 text-sm border-b border-black/5 dark:border-white/10 even:bg-black/[0.02] dark:even:bg-white/[0.03] hover:bg-black/5 dark:hover:bg-white/10 apple-pointer select-none ${listTextClass} ${
          isActive ? 'bg-[#007aff]/12 dark:bg-[#007aff]/22' : ''
        }`}
        onClick={() => playTrack(track.id)}
        onDoubleClick={() => playTrack(track.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, trackId: track.id });
        }}
      >
        {isActive && <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r bg-[#007aff]" />}
      <button
        className="mx-auto"
        onClick={(e) => {
          e.stopPropagation();
          toggleLike(track.id);
        }}
      >
        <Heart size={16} className={track.liked ? 'fill-red-500 text-red-500' : 'text-black/40 dark:text-white/40'} />
      </button>
      <div className={`truncate apple-pointer ${isActive ? 'text-[#0066d6] dark:text-[#86bcff] font-medium' : ''}`}>{track.title}</div>
      <div className={`truncate apple-pointer ${listMutedTextClass}`}>{track.artist}</div>
      <div className={`truncate apple-pointer ${listMutedTextClass}`}>{track.album}</div>
      <div className={`text-right pr-2 apple-pointer ${listMutedTextClass}`}>{formatDuration(track.duration)}</div>
      </div>
    );
  };

  return (
    <div className="h-full w-full p-0 text-black/85 dark:text-white/90">
      <audio
        ref={audioRef}
        onPlay={() => {
          if (sourceSwitchingRef.current) return;
          setIsPlaying(true);
        }}
        onPause={() => {
          if (sourceSwitchingRef.current) return;
          setIsPlaying(false);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime || 0)}
        onLoadedMetadata={(e) => setTrackDuration(e.currentTarget.duration || currentTrack?.duration || 0)}
        onEnded={playNext}
        onError={(e) => {
          if (sourceSwitchingRef.current || !e.currentTarget.currentSrc) return;
          setPlayError('音频播放失败，请尝试 MP3/FLAC');
          setIsPlaying(false);
        }}
      />

      <div className={`relative h-full w-full ${isWindowMaximized ? 'rounded-none' : 'rounded-[10px]'} app-window-shell shadow-[0px_14px_30px_-10px_rgba(0,0,0,0.16)] noise-layer overflow-hidden`}>
        {!!bgDataUrl && (
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-[0.16] dark:opacity-[0.06] transition-opacity duration-200"
              style={{ backgroundImage: `url("${bgDataUrl}")` }}
            />
            <div
              className="absolute inset-[-10%] bg-cover bg-center"
              style={{
                backgroundImage: `url("${bgDataUrl}")`,
                filter: `blur(${Math.max(0, bgBlur * 1.6)}px) saturate(108%) brightness(${dark ? 0.62 : 0.98}) contrast(${dark ? 0.92 : 1})`,
                transform: 'scale(1.1)'
              }}
            />
            <div className="absolute inset-0 bg-white/8 dark:bg-black/38" />
          </div>
        )}
        <div className="relative z-10 grid h-full min-h-0 grid-cols-[280px_1fr]">
          <aside className="relative flex min-h-0 flex-col p-4 bg-white/20 dark:bg-black/22 backdrop-blur-2xl border-r border-black/5 dark:border-white/10">
            <div className="mb-2 no-drag flex items-center gap-2 text-xs shrink-0">
              <button onClick={() => setSettingsOpen(true)} className="no-drag rounded-md p-1.5 bg-black/5 dark:bg-white/10" title="设置"><Settings2 size={16} /></button>
              <button onClick={toggleTheme} className="no-drag rounded-md p-1.5 bg-black/5 dark:bg-white/10" title="主题">
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>
            <div className="mb-3 shrink-0">
              <div className="text-xs tracking-wide uppercase text-black/50 dark:text-white/40">Library</div>
            </div>

            <div className="apple-scroll min-h-0 flex-1 overflow-y-auto pr-1">
              <nav className="space-y-1 text-sm">
                <button className={`w-full rounded-md px-2 py-1.5 text-left ${playlistId === 'all' ? 'bg-[#007aff] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`} onClick={() => setPlaylistId('all')}>所有歌曲 ({uniqueTracks.length})</button>
                {data.playlists.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <button className={`flex-1 rounded-md px-2 py-1.5 text-left ${playlistId === p.id ? 'bg-[#007aff] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`} onClick={() => setPlaylistId(p.id)}>{p.name} ({p.trackIds.length})</button>
                    {!p.fixed && (
                      <button onClick={() => removePlaylist(p.id)} className="p-1 text-black/40 dark:text-white/40 hover:text-red-400"><X size={14} /></button>
                    )}
                  </div>
                ))}
              </nav>
            </div>

            <div className="mt-3 shrink-0">
              {!creatingPlaylist && (
                <button
                  className="w-full rounded-md px-2 py-1.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20"
                  onClick={() => setCreatingPlaylist(true)}
                >
                  新建歌单
                </button>
              )}
              {creatingPlaylist && (
                <div className="rounded-md bg-white/60 dark:bg-white/5 p-2 space-y-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
                  <input
                    autoFocus
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addPlaylist(newPlaylistName);
                      if (e.key === 'Escape') {
                        setCreatingPlaylist(false);
                        setNewPlaylistName('');
                      }
                    }}
                    placeholder="输入歌单名称"
                    className="w-full rounded-[5px] px-2 py-1.5 text-sm bg-white dark:bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:ring-4 focus:ring-blue-500/20"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      className="flex-1 rounded-md py-1.5 text-xs bg-gradient-to-b from-blue-500 to-blue-600 text-white border border-white/20"
                      onClick={() => addPlaylist(newPlaylistName)}
                    >
                      创建
                    </button>
                    <button
                      className="flex-1 rounded-md py-1.5 text-xs bg-black/5 dark:bg-white/10"
                      onClick={() => {
                        setCreatingPlaylist(false);
                        setNewPlaylistName('');
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 rounded-lg bg-gray-200/50 dark:bg-white/10 p-[2px] flex gap-1 shrink-0">
              {[
                ['songs', <ListMusic size={16} />, '歌曲'],
                ['artists', <Users size={16} />, '作者'],
                ['folders', <FolderTree size={16} />, '文件夹'],
                ['online', <DownloadCloud size={16} />, '下载']
              ].map(([id, icon, label]) => (
                <button key={id} onClick={() => setView(id)} className="relative flex-1 rounded-[6px] py-1.5 text-xs tracking-wide">
                  {view === id && (
                    <motion.div
                      layoutId="view-tab"
                      transition={SPRING}
                      className="absolute inset-0 rounded-[6px] bg-white dark:bg-gray-600 shadow-sm"
                    />
                  )}
                  <span className="relative z-10 flex items-center justify-center gap-1">{icon}{label}</span>
                </button>
              ))}
            </div>
          </aside>

          <main className="relative flex min-h-0 flex-col min-w-0">
            <div className="drag-region relative flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/5 dark:border-white/10">
              {view !== 'online' ? (
                <div className="no-drag flex items-center gap-2 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
                  <Search size={16} className="text-black/40 dark:text-white/40" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索歌曲/歌手" className="no-drag bg-transparent outline-none text-sm w-56" />
                  {query.trim() && (
                    <button
                      className="no-drag rounded-full p-0.5 text-black/45 dark:text-white/45 hover:bg-black/10 dark:hover:bg-white/10"
                      onClick={() => setQuery('')}
                      title="清空搜索"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <div className="no-drag flex items-center gap-2 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-1.5 text-sm text-black/60 dark:text-white/65">
                  <DownloadCloud size={16} />
                  在线搜索下载
                </div>
              )}
              {view !== 'online' && query.trim() && (
                <div className="no-drag rounded-md px-2 py-1 text-xs bg-black/5 dark:bg-white/10 text-black/55 dark:text-white/55">
                  搜索中: {query.trim()}
                </div>
              )}
              <div className="no-drag pointer-events-none absolute left-[44%] top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-black/50 dark:text-white/50">
                已扫描 {uniqueTracks.length} 首
              </div>
              <div className="no-drag -mr-2 -mt-2 flex items-center text-black/70 dark:text-white/75">
                <button
                  className="no-drag flex h-8 w-11 items-center justify-center hover:bg-black/8 dark:hover:bg-white/12"
                  onClick={() => electronAPI?.windowMinimize?.()}
                  title="最小化"
                >
                  <span className="block h-[1.5px] w-3 rounded-full bg-current" />
                </button>
                <button
                  className="no-drag flex h-8 w-11 items-center justify-center hover:bg-black/8 dark:hover:bg-white/12"
                  onClick={async () => {
                    const next = await electronAPI?.windowToggleMaximize?.();
                    if (typeof next === 'boolean') setIsWindowMaximized(next);
                  }}
                  title="最大化/还原"
                >
                  {isWindowMaximized ? (
                    <Square size={12} strokeWidth={1.8} />
                  ) : (
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <rect x="5" y="3" width="8" height="8" />
                      <rect x="3" y="5" width="8" height="8" />
                    </svg>
                  )}
                </button>
                <button
                  className="no-drag flex h-8 w-12 items-center justify-center hover:bg-[#e81123] hover:text-white"
                  onClick={() => electronAPI?.windowClose?.()}
                  title="关闭"
                >
                  <X size={15} strokeWidth={1.8} />
                </button>
              </div>
            </div>

            {!mini && (
              <div className="apple-scroll flex-1 min-h-0 overflow-auto px-3 pb-56">
                {view !== 'online' && <div className={`sticky top-0 z-10 grid grid-cols-[48px_2fr_1.2fr_1.2fr_90px] px-2 py-2 text-xs tracking-wide uppercase bg-[rgba(226,232,238,0.88)] dark:bg-[rgba(48,56,64,0.94)] border-b border-black/5 dark:border-white/10 ${listHeaderClass}`}>
                  <span className="text-center">喜欢</span>
                  <button className="text-left apple-pointer" onClick={() => setSort((s) => nextSort(s, 'title'))}>歌曲名</button>
                  <button className="text-left apple-pointer" onClick={() => setSort((s) => nextSort(s, 'artist'))}>作者</button>
                  <button className="text-left apple-pointer" onClick={() => setSort((s) => nextSort(s, 'album'))}>专辑</button>
                  <button className="text-right pr-2 apple-pointer" onClick={() => setSort((s) => nextSort(s, 'duration'))}>时长</button>
                </div>}

                {view === 'songs' && displayTracks.map((track, idx) => renderRow(track, `songs-${track.id}-${idx}`))}

                {view === 'artists' && groupedByArtist.map(([artist, tracks]) => (
                  <section key={artist}>
                    <div className="mt-2 flex items-center gap-2 px-2 py-1 text-xs font-semibold tracking-wide text-black/50 dark:text-white/50">
                      <span className="h-px w-3 bg-black/18 dark:bg-white/18" />
                      <span className="min-w-0 truncate">{artist} ({tracks.length})</span>
                      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                    </div>
                    {tracks.map((track, idx) => renderRow(track, `artists-${artist}-${track.id}-${idx}`))}
                  </section>
                ))}

                {view === 'folders' && groupedByFolder.map(([folder, tracks]) => (
                  <section key={folder}>
                    <div className="mt-2 flex items-center gap-2 px-2 py-1 text-xs font-semibold tracking-wide text-black/50 dark:text-white/50">
                      <span className="h-px w-3 bg-black/18 dark:bg-white/18" />
                      <span className="min-w-0 truncate">{folder} ({tracks.length})</span>
                      <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                    </div>
                    {tracks.map((track, idx) => renderRow(track, `folders-${folder}-${track.id}-${idx}`))}
                  </section>
                ))}
                {view === 'online' && renderOnlineDownloadPanel()}
                {view !== 'online' && displayTracks.length === 0 && (
                  <div className={`py-16 text-center text-sm ${listFaintTextClass}`}>
                    没有匹配歌曲，请按歌曲名或歌手名搜索
                  </div>
                )}
              </div>
            )}

            <AnimatePresence>
              {playerPanelOpen && currentTrack && (
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={SPRING}
                  className="absolute inset-x-4 top-4 bottom-[128px] z-[95] rounded-2xl border border-black/8 dark:border-white/12 bg-white/78 dark:bg-[#1f1f1f]/86 backdrop-blur-3xl shadow-2xl shadow-black/20 overflow-hidden"
                >
                  <div className="flex h-full flex-col p-5">
                    <div className="relative z-10 flex shrink-0 items-center justify-between">
                      <div className="relative z-20 flex items-center gap-2">
                        <button
                          className="no-drag rounded-lg p-3 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                          onClick={() => setPlayerPanelOpen(false)}
                          onMouseDown={(e) => e.stopPropagation()}
                          title="收起"
                        >
                          <ChevronDown size={22} />
                        </button>
                        {!!lyricLines.length && (
                          <button
                            className="no-drag rounded-lg px-4 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                            onClick={openLyricFinder}
                            onMouseDown={(e) => e.stopPropagation()}
                            title="查找并导入歌词"
                          >
                            查找歌词
                          </button>
                        )}
                        <div className="relative no-drag" onMouseDown={(e) => e.stopPropagation()}>
                          <button
                            className="no-drag rounded-lg px-3 py-2 text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEncodingMenuOpen((v) => !v);
                            }}
                            title="歌词编码"
                          >
                            {encodingLabelMap[lyricEncoding] || '编码: 自动'}
                          </button>
                          {encodingMenuOpen && (
                            <div
                              className="absolute left-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-black/10 dark:border-white/15 bg-white/95 dark:bg-[#2a2a2a]/95 backdrop-blur-xl shadow-xl overflow-hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {encodingOptions.map(([value, label]) => (
                                <button
                                  key={value}
                                  className={`w-full text-left px-3 py-2 text-sm ${
                                    lyricEncoding === value
                                      ? 'bg-[#007aff] text-white'
                                      : 'text-black/85 dark:text-white/90 hover:bg-black/5 dark:hover:bg-white/10'
                                  }`}
                                  onClick={() => {
                                    if (!currentTrackId) return;
                                    setData((prev) => ({
                                      ...prev,
                                      settings: {
                                        ...prev.settings,
                                        lyricEncodingMap: {
                                          ...(prev.settings.lyricEncodingMap || {}),
                                          [currentTrackId]: value
                                        }
                                      }
                                    }));
                                    setEncodingMenuOpen(false);
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="no-drag flex items-center gap-1 rounded-lg px-2 py-1.5 bg-black/5 dark:bg-white/10" onMouseDown={(e) => e.stopPropagation()}>
                          <button
                            className={`rounded-md px-2 py-1 text-xs ${lyricAdjustMode ? 'bg-[#007aff] text-white' : 'hover:bg-black/10 dark:hover:bg-white/15'}`}
                            onClick={() => {
                              setLyricAdjustMode((v) => !v);
                              setHoldLyricIdx(null);
                              setLyricAlignNotice('');
                            }}
                            title="调整歌词：点一下按住，再点一下放开并生效"
                          >
                            调整歌词 {lyricAdjustMode ? '开' : '关'}
                          </button>
                          <button
                            className="rounded-md px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/15"
                            onClick={() => adjustLyricOffset(-0.5)}
                            title="歌词延后 0.5 秒"
                          >
                            延后
                          </button>
                          <div className="w-16 text-center text-xs text-black/70 dark:text-white/75">
                            {lyricOffsetSec > 0 ? `+${lyricOffsetSec.toFixed(1)}` : lyricOffsetSec.toFixed(1)}s
                          </div>
                          <button
                            className="rounded-md px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/15"
                            onClick={() => adjustLyricOffset(0.5)}
                            title="歌词提前 0.5 秒"
                          >
                            提前
                          </button>
                          <button
                            className={`rounded-md px-2 py-1 text-xs ${lyricDebugPath && lyricLines.length ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10 text-black/45 dark:text-white/45'}`}
                            disabled={!lyricDebugPath || !lyricLines.length}
                            onClick={saveLyricOffsetToFile}
                            title="保存当前偏移到 LRC 文件"
                          >
                            保存到LRC
                          </button>
                        </div>
                      </div>
                      {(lyricAdjustMode || lyricAlignNotice) && (
                        <div className="mt-2 px-2 text-xs">
                          {lyricAlignNotice ? (
                            <div className="text-[#007aff] dark:text-[#8ec1ff]">{lyricAlignNotice}</div>
                          ) : holdLyricIdx != null ? (
                            <div className="text-black/65 dark:text-white/72">
                              已按住第 {holdLyricIdx + 1} 句：{heldLyricLineText || '...'}。再次点击同一句即可放开并在当前位置生效
                            </div>
                          ) : (
                            <div className="text-black/55 dark:text-white/62">调整歌词已开启：点一下某句按住，到目标播放时间再点一次该句放开并生效</div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)] gap-4">
                      <div className="flex min-h-0 flex-col justify-start">
                        <div className="relative mx-auto w-[170px] overflow-hidden rounded-2xl border border-black/8 dark:border-white/12 bg-white/22 dark:bg-white/8 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.28)]">
                          <div className="aspect-square w-full">
                            {currentCoverDataUrl ? (
                              <img
                                src={currentCoverDataUrl}
                                alt="cover"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <motion.div
                                  animate={isPlaying ? { rotate: 360 } : { rotate: 0 }}
                                  transition={isPlaying ? { repeat: Infinity, duration: 6, ease: 'linear' } : { duration: 0.2 }}
                                >
                                  <Disc3 size={64} className="text-black/65 dark:text-white/80" />
                                </motion.div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 px-2 text-center text-sm text-black/60 dark:text-white/65 truncate">{currentTrack.album}</div>
                      </div>

                      <div className="min-h-0 pr-1 flex flex-col">
                        <div className="shrink-0 px-2 pb-2">
                          <div className="text-[30px] leading-tight tracking-tight font-semibold">{currentTrack.title}</div>
                          <div className="mt-1 text-[19px] leading-snug text-black/60 dark:text-white/68">{currentTrack.artist} · {currentTrack.album}</div>
                          {!!lyricDebugPath && (
                            <div className="mt-1 text-[11px] text-black/45 dark:text-white/45 truncate" title={lyricDebugPath}>
                              歌词文件: {lyricDebugPath}
                            </div>
                          )}
                        </div>
                        <div ref={panelLyricsScrollRef} className="apple-scroll min-h-0 flex-1 overflow-auto">
                          {!lyricLines.length && (
                            <div className="h-full flex flex-col items-center justify-center gap-4 text-sm text-black/45 dark:text-white/45">
                              <div>未找到可用歌词</div>
                              {!!lyricsRaw && (
                                <pre className="max-w-[90%] max-h-28 overflow-auto text-[11px] text-left whitespace-pre-wrap bg-black/5 dark:bg-white/10 rounded-md p-2">
                                  {lyricsRaw.split(/\r?\n/).slice(0, 4).join('\n')}
                                </pre>
                              )}
                              <button
                                className="no-drag rounded-lg px-5 py-2.5 text-lg font-medium bg-black/6 dark:bg-white/12 hover:bg-black/10 dark:hover:bg-white/18 text-black/80 dark:text-white/90"
                                onClick={openLyricFinder}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                查找歌词
                              </button>
                            </div>
                          )}
                          {!!lyricLines.length && (
                            <div className="space-y-2 pt-2 pb-12">
                              {lyricLines.map((line, idx) => (
                                <div
                                  key={`${line.time}-${idx}`}
                                  id={`panel-lyric-${idx}`}
                                  className={`px-2 py-1.5 text-[15px] ${
                                    holdLyricIdx === idx ? 'bg-[#007aff]/20 rounded-md ring-1 ring-[#007aff]/40' : ''
                                  } ${
                                    idx === activeLyricIdx
                                      ? 'text-[#0069e5] dark:text-[#9accff] font-semibold'
                                      : 'text-black/62 dark:text-white/62'
                                  }`}
                                  onClick={(e) => {
                                    if (!lyricAdjustMode) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (holdLyricIdx == null) {
                                      setHoldLyricIdx(idx);
                                      setLyricAlignNotice('已按住这句歌词');
                                      return;
                                    }
                                    if (holdLyricIdx === idx) {
                                      applyAlignAtCurrent(idx);
                                      setHoldLyricIdx(null);
                                      return;
                                    }
                                    setHoldLyricIdx(idx);
                                    setLyricAlignNotice('已切换按住目标歌词');
                                  }}
                                >
                                  <span>{line.text || '...'}</span>
                                  {holdLyricIdx === idx && (
                                    <span className="ml-2 text-[11px] text-[#007aff] dark:text-[#9accff]">按住中，再点一次生效</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="absolute bottom-0 inset-x-0 px-4 pb-4">
              <div className="rounded-xl bg-white/90 dark:bg-[#323232]/90 backdrop-blur-xl shadow-2xl shadow-black/20 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <button
                    className="min-w-0 flex-[1.25] text-left rounded-lg px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    onClick={() => {
                      if (currentTrack) setPlayerPanelOpen((v) => !v);
                    }}
                    title="打开正在播放详情"
                  >
                    <div className="truncate text-[16px] leading-tight tracking-tight font-medium">{currentTrack?.title || '未选择歌曲'}</div>
                    <div className="mt-0.5 truncate text-[11px] leading-tight text-black/52 dark:text-white/52">{currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : '扫描本地文件夹开始播放'}</div>
                  </button>
                  <div className="flex items-center justify-center gap-2.5 flex-[0.95] min-w-0">
                    <button className="rounded-xl p-3.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15" onClick={playPrev}><SkipBack size={26} /></button>
                    <motion.button whileTap={{ scale: 0.96 }} transition={SPRING} className="rounded-xl px-6 py-3.5 bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-sm border border-white/20" onClick={() => (currentTrack ? setIsPlaying((v) => !v) : sortedTracks[0] && playTrack(sortedTracks[0].id))}>{isPlaying ? <Pause size={28} /> : <Play size={28} />}</motion.button>
                    <button className="rounded-xl p-3.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15" onClick={playNext}><SkipForward size={26} /></button>
                  </div>
                  <div className="flex items-center justify-end gap-2 flex-1 min-w-0">
                    <button
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/5 dark:bg-white/10"
                      title={playMode === 'sequence' ? '顺序播放' : playMode === 'random' ? '随机播放' : '循环播放'}
                      onClick={() => setData((prev) => ({ ...prev, settings: { ...prev.settings, playMode: cyclePlayMode(prev.settings.playMode) } }))}
                    >
                      <PlayModeIcon size={16} />
                    </button>
                    <button className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm leading-none ${data.settings.showLyrics ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10'}`} onClick={() => setData((prev) => ({ ...prev, settings: { ...prev.settings, showLyrics: !prev.settings.showLyrics } }))}>词</button>
                    <button
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm leading-none ${data.settings.lyricClickThrough ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10'}`}
                      onClick={() => setData((prev) => ({ ...prev, settings: { ...prev.settings, lyricClickThrough: !prev.settings.lyricClickThrough } }))}
                    >
                      穿
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="w-10 text-right text-xs text-black/50 dark:text-white/50">{formatDuration(time)}</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(trackDuration || currentTrack?.duration || 0, 1)}
                    step={1}
                    value={Math.min(time, trackDuration || currentTrack?.duration || 0)}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      const audio = audioRef.current;
                      if (!audio) return;
                      audio.currentTime = next;
                      setTime(next);
                    }}
                    className="h-1.5 flex-1 appearance-none rounded-full bg-black/10 dark:bg-white/15 accent-[#007aff]"
                  />
                  <span className="w-10 text-xs text-black/50 dark:text-white/50">{formatDuration(trackDuration || currentTrack?.duration || 0)}</span>
                  <div className="ml-2 flex items-center gap-2 rounded-md px-2 py-1 bg-black/5 dark:bg-white/10">
                    <Volume2 size={14} className="text-black/55 dark:text-white/60" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round(volume * 100)}
                      onChange={(e) => {
                        const next = Math.max(0, Math.min(100, Number(e.target.value)));
                        setData((prev) => ({ ...prev, settings: { ...prev.settings, volume: next / 100 } }));
                      }}
                      className="h-1.5 w-24 appearance-none rounded-full bg-black/10 dark:bg-white/15 accent-[#007aff]"
                      title="音量"
                    />
                    <span className="w-9 text-right text-[11px] text-black/55 dark:text-white/60">{Math.round(volume * 100)}%</span>
                  </div>
                </div>
                {playError && (
                  <div className="mt-1 text-xs text-red-500">{playError}</div>
                )}
              </div>
            </div>
          </main>
        </div>

        <AnimatePresence>
          {contextMenu && (() => {
            const t = trackMap.get(contextMenu.trackId);
            if (!t) return null;
            return (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={SPRING} style={{ left: contextMenu.x, top: contextMenu.y }} className="absolute z-50 w-52 rounded-lg border border-black/10 dark:border-white/15 bg-white/80 dark:bg-[#323232]/90 backdrop-blur-xl shadow-2xl">
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { setPendingQueue((q) => [t.id, ...q]); setContextMenu(null); }}>下一首播放</button>
                <div className="h-px bg-black/5 dark:bg-white/10 my-1" />
                {data.playlists.map((p) => (
                  <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { addTrackToPlaylist(t.id, p.id); setContextMenu(null); }}>添加到 {p.name}</button>
                ))}
                <div className="h-px bg-black/5 dark:bg-white/10 my-1" />
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { electronAPI?.showItemInFolder?.(t.path); setContextMenu(null); }}>打开文件所在位置</button>
                <button className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10" onClick={() => { rescanSingle(t); setContextMenu(null); }}>重新扫描这首歌曲</button>
                <button className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10" onClick={() => { removeTrack(t.id); setContextMenu(null); }}>从播放器移除</button>
              </motion.div>
            );
          })()}
        </AnimatePresence>

      </div>

      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
            className={`absolute inset-0 z-[110] flex items-center justify-center ${dark ? 'bg-black/32' : 'bg-black/10'}`}
            onClick={() => setSettingsOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.97, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, y: 6 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
              className={`w-[580px] rounded-2xl border shadow-2xl shadow-black/20 p-5 ${
                dark ? 'border-[#3a3a3a] bg-[#242424] text-white' : 'border-black/10 bg-[#f7f8fa] text-black'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-base tracking-tight font-medium">设置</div>
                <button className="rounded-md p-1.5 bg-black/5 dark:bg-white/10" onClick={() => setSettingsOpen(false)}><X size={16} /></button>
              </div>

              <div className="mt-4 space-y-4">
                <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
                  <div className="mb-1 text-xs text-black/60 dark:text-white/70">文件夹管理</div>
                  <div className="flex items-center gap-2 mb-2">
                    <button className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10" onClick={pickAndScanFolders} disabled={scanBusy}>
                      {scanBusy ? '扫描中...' : '添加文件夹'}
                    </button>
                    <button className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10" onClick={rescanManagedFolders} disabled={scanBusy || !(data.scanFolders || []).length}>
                      重扫全部
                    </button>
                  </div>
                  <div className="apple-scroll max-h-32 overflow-auto space-y-1 pr-1">
                    {(data.scanFolders || []).map((folder) => (
                      <div key={folder} className="flex items-center gap-2 rounded-md px-2 py-1 bg-black/[0.04] dark:bg-white/[0.08]">
                        <div className="flex-1 truncate text-xs text-black/70 dark:text-white/75" title={folder}>{folder}</div>
                        <button className="rounded px-1.5 py-0.5 text-xs bg-black/5 dark:bg-white/10" onClick={() => removeManagedFolder(folder)} disabled={scanBusy}>移除</button>
                      </div>
                    ))}
                    {!(data.scanFolders || []).length && <div className="text-xs text-black/50 dark:text-white/55">未添加目录</div>}
                  </div>
                </section>

                <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
                  <div className="mb-1 text-xs text-black/60 dark:text-white/70">背景图</div>
                  <div className="flex items-center gap-2 mb-2">
                    <button className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10" onClick={pickBackgroundImage}>更换背景图</button>
                    <button className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10" onClick={clearBackgroundImage}>清除</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-black/60 dark:text-white/70 w-20">模糊度</span>
                    <input
                      type="range"
                      min={0}
                      max={24}
                      step={1}
                      value={bgBlur}
                      onChange={(e) =>
                        setData((prev) => ({
                          ...prev,
                          settings: { ...prev.settings, backgroundBlur: Number(e.target.value) }
                        }))
                      }
                      className="h-1.5 flex-1 appearance-none rounded-full bg-black/10 dark:bg-white/15 accent-[#007aff]"
                    />
                    <span className="text-xs text-black/60 dark:text-white/70 w-8 text-right">{bgBlur}</span>
                  </div>
                </section>

                <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
                  <div className="mb-1 text-xs text-black/60 dark:text-white/70">列表文字</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['auto', '跟随主题'],
                      ['dark', '深色文字'],
                      ['light', '浅色文字']
                    ].map(([value, label]) => {
                      const active = listTextTone === value;
                      return (
                        <button
                          key={value}
                          className={`rounded px-2.5 py-1 text-xs transition-colors ${
                            active
                              ? 'bg-[#007aff] text-white'
                              : 'bg-black/5 dark:bg-white/10 text-black/75 dark:text-white/80 hover:bg-black/10 dark:hover:bg-white/15'
                          }`}
                          onClick={() => setData((prev) => ({
                            ...prev,
                            settings: { ...prev.settings, listTextTone: value }
                          }))}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] text-black/50 dark:text-white/55">
                    “跟随主题”保持原来的列表文字效果；背景太亮可选深色文字，背景太暗可选浅色文字。
                  </div>
                </section>

                <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
                  <div className="mb-1 text-xs text-black/60 dark:text-white/70">关闭按钮行为</div>
                  <div className="relative no-drag" onMouseDown={(e) => e.stopPropagation()}>
                    <button
                      className="w-full rounded-[5px] px-2 py-1.5 text-xs text-left bg-white dark:bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] hover:bg-black/5 dark:hover:bg-white/15"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCloseBehaviorMenuOpen((v) => !v);
                      }}
                    >
                      {data.settings.closeBehavior === 'tray'
                        ? '最小化到托盘'
                        : data.settings.closeBehavior === 'exit'
                          ? '直接关闭'
                          : '每次询问'}
                    </button>
                    {closeBehaviorMenuOpen && (
                      <div
                        className="absolute left-0 top-[calc(100%+6px)] z-30 w-full rounded-lg border border-black/10 dark:border-white/15 bg-white/95 dark:bg-[#2a2a2a]/95 backdrop-blur-xl shadow-xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {[
                          ['ask', '每次询问'],
                          ['tray', '最小化到托盘'],
                          ['exit', '直接关闭']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            className={`w-full text-left px-3 py-2 text-xs ${
                              (data.settings.closeBehavior || 'ask') === value
                                ? 'bg-[#007aff] text-white'
                                : 'text-black/85 dark:text-white/90 hover:bg-black/5 dark:hover:bg-white/10'
                            }`}
                            onClick={() => {
                              setData((prev) => ({
                                ...prev,
                                settings: { ...prev.settings, closeBehavior: value }
                              }));
                              setCloseBehaviorMenuOpen(false);
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!!playlistToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SPRING}
            className={`absolute inset-0 z-[120] flex items-center justify-center ${
              dark ? 'bg-black/32' : 'bg-black/10'
            }`}
            onClick={() => setPlaylistToDelete(null)}
          >
            <motion.div
              initial={{ scale: 0.97, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, y: 6 }}
              transition={SPRING}
              onClick={(e) => e.stopPropagation()}
              className={`w-[420px] rounded-2xl border shadow-2xl shadow-black/20 p-4 ${
                dark
                  ? 'border-[#3a3a3a] bg-[#242424] text-white'
                  : 'border-black/10 bg-[#f7f8fa] text-black'
              }`}
            >
              <div className="text-base tracking-tight font-medium">删除歌单</div>
              <div className={`mt-2 text-sm ${dark ? 'text-white/82' : 'text-black/70'}`}>
                确定删除歌单「{playlistToDelete.name}」吗？该操作不会删除本地歌曲文件。
              </div>
              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  className={`rounded-md px-3 py-1.5 text-sm ${dark ? 'bg-white/10 text-white' : 'bg-black/5 text-black'}`}
                  onClick={() => setPlaylistToDelete(null)}
                >
                  取消
                </button>
                <button
                  className="rounded-md px-3 py-1.5 text-sm text-white bg-gradient-to-b from-red-500 to-red-600 border border-white/20"
                  onClick={confirmRemovePlaylist}
                >
                  删除
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
