import { AnimatePresence } from 'framer-motion';
import { DownloadCloud, Search, Square, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import DeletePlaylistModal from './components/DeletePlaylistModal';
import NowPlayingPanel from './components/NowPlayingPanel';
import OnlineDownloadPanel from './components/OnlineDownloadPanel';
import PlayerBar from './components/PlayerBar';
import SettingsModal from './components/SettingsModal';
import Sidebar from './components/Sidebar';
import TrackContextMenu from './components/TrackContextMenu';
import VirtualTrackList from './components/VirtualTrackList';
import { DEFAULT_DATA, MIME_BY_EXT, ONLINE_SOURCES } from './constants/player';
import { findActiveLyricIndex, parseLyrics } from './utils/lyrics';
import {
  MIXED_COLLATOR,
  cyclePlayMode,
  dedupeTracksById,
  getTextToneClasses,
  nextSort,
  sortTracks,
  splitSearchTokens,
  toMixedSortKey,
  trackMatchesTokens
} from './utils/tracks';

const electronAPI = window.electronAPI;
const LYRIC_DROP_EXT = /\.(lrc|txt)$/i;

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
  const [contextMenu, setContextMenu] = useState(null);
  const [lyricsRaw, setLyricsRaw] = useState('');
  const [lyricLines, setLyricLines] = useState([]);
  const [lyricDebugPath, setLyricDebugPath] = useState('');
  const [lyricOffsetSec, setLyricOffsetSec] = useState(0);
  const [lyricsDirty, setLyricsDirty] = useState(false);
  const [lyricAdjustMode, setLyricAdjustMode] = useState(false);
  const [holdLyricIdx, setHoldLyricIdx] = useState(null);
  const [lyricAlignNotice, setLyricAlignNotice] = useState('');
  const [pendingQueue, setPendingQueue] = useState([]);
  const [trackDuration, setTrackDuration] = useState(0);
  const [playError, setPlayError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [playlistToDelete, setPlaylistToDelete] = useState(null);
  const [bgImageUrl, setBgImageUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
  const [currentCoverDataUrl, setCurrentCoverDataUrl] = useState('');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [scrollToTrackRequest, setScrollToTrackRequest] = useState({ seq: 0, trackId: null, behavior: 'auto' });

  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineSources, setOnlineSources] = useState(ONLINE_SOURCES);
  const [selectedOnlineSources, setSelectedOnlineSources] = useState(ONLINE_SOURCES.map((s) => s.id));
  const [onlineResults, setOnlineResults] = useState([]);
  const [selectedOnlineKeys, setSelectedOnlineKeys] = useState([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineDownloading, setOnlineDownloading] = useState(false);
  const [onlineNotice, setOnlineNotice] = useState('');
  const [onlineSearchStatus, setOnlineSearchStatus] = useState(null);
  const [onlineLimitPerSource, setOnlineLimitPerSource] = useState(15);
  const [downloadFolder, setDownloadFolder] = useState('');

  const audioRef = useRef(null);
  const searchInputRef = useRef(null);
  const sourceSwitchingRef = useRef(false);
  const playHistoryRef = useRef([]);
  const audioLoadSeqRef = useRef(0);
  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.8);
  const timeRef = useRef(0);
  const lastSyncedTimeRef = useRef(-1);
  const pendingRestoreSeekRef = useRef(null);
  const pendingAudioSeekSecRef = useRef(0);
  const currentSourceKindRef = useRef('stream');
  const lastLibraryViewRef = useRef('songs');

  isPlayingRef.current = isPlaying;
  timeRef.current = time;
  if (view !== 'online') {
    lastLibraryViewRef.current = view;
  }

  const volume = Math.max(
    0,
    Math.min(1, Number.isFinite(Number(data.settings.volume)) ? Number(data.settings.volume) : 0.8)
  );
  volumeRef.current = volume;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const load = async () => {
      if (!electronAPI) {
        setLoaded(true);
        return;
      }
      const saved = await electronAPI.loadData();
      setData(saved);
      setDark((saved.settings?.theme || DEFAULT_DATA.settings.theme) === 'dark');
      if (['songs', 'artists', 'folders', 'online'].includes(saved.settings?.lastView)) {
        setView(saved.settings.lastView);
        if (saved.settings.lastView !== 'online') {
          lastLibraryViewRef.current = saved.settings.lastView;
        }
      }
      if (saved.settings?.lastPlaylistId) {
        const exists =
          saved.settings.lastPlaylistId === 'all' ||
          (saved.playlists || []).some((p) => p.id === saved.settings.lastPlaylistId);
        if (exists) setPlaylistId(saved.settings.lastPlaylistId);
      }
      if (saved.settings?.sort?.key) {
        setSort(saved.settings.sort);
      }
      const savedTrackId = saved.settings?.lastTrackId;
      if (savedTrackId && (saved.tracks || []).some((t) => t.id === savedTrackId)) {
        const restoredSec = Math.max(0, Number(saved.settings?.lastPositionSec) || 0);
        pendingRestoreSeekRef.current = { trackId: savedTrackId, time: restoredSec };
        setCurrentTrackId(savedTrackId);
        setTime(restoredSec);
        setScrollToTrackRequest({ seq: 1, trackId: savedTrackId, behavior: 'auto' });
      }
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
    if (!electronAPI?.onOnlineSearchStatus) return undefined;
    const off = electronAPI.onOnlineSearchStatus((status) => {
      setOnlineSearchStatus(status || null);
      if (status?.message) setOnlineNotice(status.message);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onOnlineSearchResults) return undefined;
    const off = electronAPI.onOnlineSearchResults((payload) => {
      if (Array.isArray(payload?.results)) {
        setOnlineResults(payload.results);
      } else if (Array.isArray(payload?.append) && payload.append.length) {
        setOnlineResults((prev) => [...prev, ...payload.append]);
      }
      if (payload?.sourceLabel) {
        setOnlineNotice(`${payload.sourceLabel} 已返回结果，可先勾选下载`);
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!loaded || !electronAPI) return undefined;
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
    let canceled = false;
    const loadBg = async () => {
      const bgPath = data.settings?.backgroundImagePath;
      if (!bgPath || !electronAPI) {
        setBgImageUrl('');
        return;
      }
      if (electronAPI.getLocalImageUrl) {
        const streamUrl = await electronAPI.getLocalImageUrl(bgPath);
        if (!canceled && streamUrl) {
          setBgImageUrl(streamUrl);
          return;
        }
      }
      if (electronAPI.readImageDataUrl) {
        const dataUrl = await electronAPI.readImageDataUrl(bgPath);
        if (!canceled) setBgImageUrl(dataUrl || '');
      }
    };
    loadBg();
    return () => {
      canceled = true;
    };
  }, [data.settings?.backgroundImagePath]);

  const uniqueTracks = useMemo(() => dedupeTracksById(data.tracks), [data.tracks]);
  const trackMap = useMemo(() => new Map(uniqueTracks.map((t) => [t.id, t])), [uniqueTracks]);
  const currentTrack = currentTrackId ? trackMap.get(currentTrackId) : null;

  const baseTracks = useMemo(() => {
    if (playlistId === 'all') return uniqueTracks;
    const p = data.playlists.find((x) => x.id === playlistId);
    if (!p) return uniqueTracks;
    const ids = new Set(p.trackIds);
    return uniqueTracks.filter((t) => ids.has(t.id));
  }, [uniqueTracks, data.playlists, playlistId]);

  const queryTokens = useMemo(() => splitSearchTokens(query), [query]);

  const filteredTracks = useMemo(() => {
    if (!queryTokens.length) return baseTracks;
    return baseTracks.filter((t) => trackMatchesTokens(t, queryTokens));
  }, [baseTracks, queryTokens]);

  const displayTracks = useMemo(() => sortTracks(filteredTracks, sort), [filteredTracks, sort]);

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

  const activePlayList = useMemo(() => {
    if (view === 'folders') return groupedByFolder.flatMap(([, tracks]) => tracks);
    if (view === 'artists') return groupedByArtist.flatMap(([, tracks]) => tracks);
    return displayTracks;
  }, [view, groupedByFolder, groupedByArtist, displayTracks]);

  const playMode = data.settings.playMode || 'sequence';
  const lyricsEnabled = Boolean(currentTrack && isPlaying && data.settings.showLyrics);
  const floatingLyricsEnabled = lyricsEnabled && !playerPanelOpen;
  const bgBlur = Number.isFinite(Number(data.settings.backgroundBlur)) ? Number(data.settings.backgroundBlur) : 8;
  const toneClasses = useMemo(() => getTextToneClasses(data.settings.listTextTone), [data.settings.listTextTone]);
  const lyricEncoding = currentTrackId ? (data.settings.lyricEncodingMap?.[currentTrackId] || 'auto') : 'auto';
  const adjustedLyricTime = time + lyricOffsetSec;

  // Audio source loader (zero-copy streaming via ymusic:// protocol with fallback)
  useEffect(() => {
    let canceled = false;
    const loadSeq = audioLoadSeqRef.current + 1;
    audioLoadSeqRef.current = loadSeq;
    const isCurrentLoad = () => !canceled && audioLoadSeqRef.current === loadSeq;
    let ownedBlobUrl = '';

    const loadSource = async () => {
      const audio = audioRef.current;
      if (!audio || !currentTrack || !electronAPI) return;
      sourceSwitchingRef.current = true;
      setPlayError('');

      try {
        let nextSrc = '';
        let sourceKind = 'stream';

        if (electronAPI.prepareAudioSource) {
          const prepared = await electronAPI.prepareAudioSource(currentTrack.path);
          if (!isCurrentLoad()) return;
          if (!prepared?.ok || !prepared.url) {
            setPlayError(prepared?.error || '该歌曲无法读取或解码');
            setIsPlaying(false);
            return;
          }
          nextSrc = prepared.url;
          sourceKind = prepared.kind || 'stream';
        } else if (electronAPI.readAudioBuffer) {
          const raw = await electronAPI.readAudioBuffer(currentTrack.path);
          if (!isCurrentLoad()) return;
          if (!raw) {
            setPlayError('该歌曲无法读取或解码');
            setIsPlaying(false);
            return;
          }
          const payload = raw?.data ?? raw;
          sourceKind = raw?.kind || 'raw';
          const mime = sourceKind === 'wav-transcoded' ? 'audio/wav' : (MIME_BY_EXT[currentTrack.ext] || 'audio/mpeg');
          const bytes =
            payload?.type === 'Buffer' && Array.isArray(payload.data)
              ? new Uint8Array(payload.data)
              : payload instanceof Uint8Array
                ? payload
                : new Uint8Array(payload);
          ownedBlobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
          nextSrc = ownedBlobUrl;
        }

        const prevBlobUrl = audio.dataset.blobUrl;
        if (prevBlobUrl) {
          URL.revokeObjectURL(prevBlobUrl);
          delete audio.dataset.blobUrl;
        }
        if (ownedBlobUrl) audio.dataset.blobUrl = ownedBlobUrl;

        let initialTime = 0;
        if (pendingRestoreSeekRef.current?.trackId === currentTrack.id) {
          initialTime = Math.max(0, Number(pendingRestoreSeekRef.current.time) || 0);
          pendingRestoreSeekRef.current = null;
        }
        pendingAudioSeekSecRef.current = initialTime;

        audio.pause();
        audio.src = nextSrc;
        audio.load();
        audio.volume = volumeRef.current;
        if (initialTime <= 0) {
          audio.currentTime = 0;
        }
        currentSourceKindRef.current = sourceKind;
        setTime(initialTime);
        setTrackDuration(currentTrack.duration || 0);
        setPlayError('');

        if (isPlayingRef.current) {
          await audio.play().catch(() => {
            if (!isCurrentLoad()) return;
            setPlayError(
              sourceKind === 'wma-raw'
                ? 'WMA 播放失败，请安装 ffmpeg 以支持自动转码播放'
                : '当前格式暂不支持播放'
            );
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
  }, [currentTrack?.id, currentTrack?.path]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || sourceSwitchingRef.current || !audio.src) return;
    if (isPlaying) {
      const playSeq = audioLoadSeqRef.current;
      audio.play().catch(() => {
        if (audioLoadSeqRef.current !== playSeq) return;
        setPlayError(
          currentSourceKindRef.current === 'wma-raw'
            ? 'WMA 播放失败，请安装 ffmpeg 以支持自动转码播放'
            : '当前格式暂不支持播放'
        );
        setIsPlaying(false);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying]);

  const loadLyricsForTrack = useCallback(async (track, encoding) => {
    if (!track?.path || !electronAPI?.readTextFile) {
      setLyricsRaw('');
      setLyricLines([]);
      setLyricDebugPath('');
      return;
    }
    const candidates = [];
    if (track.lyricPath) candidates.push(track.lyricPath);
    const dot = track.path.lastIndexOf('.');
    const base = dot > 0 ? track.path.slice(0, dot) : track.path;
    candidates.push(`${base}.lrc`, `${base}.LRC`, `${base}.txt`, `${base}.TXT`);
    const uniqueCandidates = [...new Set(candidates)];

    for (const lyricPath of uniqueCandidates) {
      const txt = electronAPI.readTextFileWithEncoding
        ? await electronAPI.readTextFileWithEncoding(lyricPath, encoding)
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
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!currentTrack) {
        setLyricsRaw('');
        setLyricLines([]);
        setLyricDebugPath('');
        return;
      }
      if (!canceled) {
        await loadLyricsForTrack(currentTrack, lyricEncoding);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [currentTrack?.lyricPath, currentTrack?.path, lyricEncoding, loadLyricsForTrack]);

  useEffect(() => {
    setLyricOffsetSec(0);
    setLyricsDirty(false);
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

  const activeLyricIdx = useMemo(
    () => findActiveLyricIndex(lyricLines, adjustedLyricTime),
    [lyricLines, adjustedLyricTime]
  );

  const currentLyricLine = useMemo(() => {
    if (!lyricLines.length) return '';
    if (activeLyricIdx < 0) return lyricLines[0]?.text || '';
    return lyricLines[activeLyricIdx]?.text || '';
  }, [lyricLines, activeLyricIdx]);

  const nextLyricLine = useMemo(() => {
    if (!lyricLines.length) return '';
    if (activeLyricIdx < 0) return lyricLines[1]?.text || '';
    return lyricLines[activeLyricIdx + 1]?.text || '';
  }, [lyricLines, activeLyricIdx]);

  useEffect(() => {
    if (!electronAPI?.showLyricsWindow || !electronAPI?.hideLyricsWindow) return undefined;
    if (floatingLyricsEnabled) electronAPI.showLyricsWindow();
    else electronAPI.hideLyricsWindow();
    return () => {
      electronAPI.hideLyricsWindow();
    };
  }, [floatingLyricsEnabled]);

  useEffect(() => {
    if (!electronAPI?.updateLyricsWindow || !floatingLyricsEnabled) return;
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
    if (!electronAPI?.onLyricsMinimized) return undefined;
    const off = electronAPI.onLyricsMinimized(() => {
      setData((prev) => ({ ...prev, settings: { ...prev.settings, showLyrics: false } }));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onCloseBehaviorUpdated) return undefined;
    const off = electronAPI.onCloseBehaviorUpdated((behavior) => {
      setData((prev) => ({ ...prev, settings: { ...prev.settings, closeBehavior: behavior || 'ask' } }));
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    if (!electronAPI?.onWindowMaximizedChanged) return undefined;
    const off = electronAPI.onWindowMaximizedChanged((maxed) => {
      setIsWindowMaximized(!!maxed);
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    (async () => {
      if (!electronAPI?.windowIsMaximized) return;
      const maxed = await electronAPI.windowIsMaximized();
      if (!canceled) setIsWindowMaximized(!!maxed);
    })();
    return () => {
      canceled = true;
    };
  }, []);

  const syncSessionToMain = useCallback((patch) => {
    electronAPI?.syncPlaybackSession?.(patch);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    syncSessionToMain({
      lastTrackId: currentTrackId,
      lastView: view,
      lastPlaylistId: playlistId,
      sort
    });
  }, [loaded, currentTrackId, view, playlistId, sort, syncSessionToMain]);

  useEffect(() => {
    if (!loaded) return undefined;
    const handleBeforeUnload = () => {
      syncSessionToMain({
        lastTrackId: currentTrackId,
        lastPositionSec: audioRef.current?.currentTime ?? timeRef.current ?? 0,
        lastView: view,
        lastPlaylistId: playlistId,
        sort
      });
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [loaded, currentTrackId, view, playlistId, sort, syncSessionToMain]);

  const playTrack = useCallback((id, options = {}) => {
    setCurrentTrackId((prevId) => {
      const isSwitching = prevId !== id;
      if (isSwitching) {
        pendingRestoreSeekRef.current = null;
        pendingAudioSeekSecRef.current = 0;
        lastSyncedTimeRef.current = 0;
        if (prevId && options.recordHistory !== false) {
          playHistoryRef.current = [...playHistoryRef.current, prevId].slice(-100);
        }
        setData((prev) =>
          prev.settings.lastTrackId === id && prev.settings.lastPositionSec === 0
            ? prev
            : { ...prev, settings: { ...prev.settings, lastTrackId: id, lastPositionSec: 0 } }
        );
        syncSessionToMain({ lastTrackId: id, lastPositionSec: 0 });
        setLyricAdjustMode(false);
        setHoldLyricIdx(null);
        setLyricOffsetSec(0);
        setLyricsDirty(false);
      }
      return id;
    });
    setIsPlaying(true);
  }, [syncSessionToMain]);

  const advanceTrack = useCallback(
    ({ isAutoEnded = false } = {}) => {
      if (!activePlayList.length) {
        if (isAutoEnded) setIsPlaying(false);
        return;
      }

      if (isAutoEnded && playMode === 'loop' && currentTrackId) {
        const audio = audioRef.current;
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => setIsPlaying(false));
        } else {
          playTrack(currentTrackId);
        }
        return;
      }

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
        if (!pool.length) {
          const audio = audioRef.current;
          if (audio) audio.currentTime = 0;
          setTime(0);
          if (isAutoEnded) setIsPlaying(false);
          return;
        }
        const next = pool[Math.floor(Math.random() * pool.length)];
        playTrack(next.id);
        return;
      }

      const idx = activePlayList.findIndex((t) => t.id === currentTrackId);
      if (idx < 0) {
        playTrack(activePlayList[0].id);
        return;
      }
      if (idx >= activePlayList.length - 1) {
        if (isAutoEnded && playMode === 'sequence') {
          const audio = audioRef.current;
          if (audio) audio.currentTime = 0;
          setIsPlaying(false);
          setTime(0);
          syncSessionToMain({ lastPositionSec: 0 });
          return;
        }
        playTrack(activePlayList[0].id);
        return;
      }
      playTrack(activePlayList[idx + 1].id);
    },
    [activePlayList, currentTrackId, pendingQueue, playMode, playTrack]
  );

  const playNext = useCallback(() => advanceTrack({ isAutoEnded: false }), [advanceTrack]);
  const handleTrackEnded = useCallback(() => advanceTrack({ isAutoEnded: true }), [advanceTrack]);

  const playPrev = useCallback(() => {
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
      if (playMode === 'list-loop' || playMode === 'loop') {
        playTrack(activePlayList[activePlayList.length - 1].id);
      } else {
        const audio = audioRef.current;
        if (audio) audio.currentTime = 0;
        setTime(0);
      }
      return;
    }
    playTrack(activePlayList[idx - 1].id);
  }, [activePlayList, currentTrackId, playMode, playTrack]);

  const handleTogglePlay = useCallback(() => {
    if (currentTrack) {
      setIsPlaying((v) => !v);
    } else if (activePlayList[0]) {
      playTrack(activePlayList[0].id);
    }
  }, [currentTrack, activePlayList, playTrack]);

  const handleSeek = useCallback((targetSec) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Number(targetSec) || 0);
    if (audio) audio.currentTime = clamped;
    setTime(clamped);
    lastSyncedTimeRef.current = clamped;
    syncSessionToMain({ lastPositionSec: clamped });
  }, [syncSessionToMain]);

  const handleLocateCurrentTrack = useCallback(() => {
    if (!currentTrackId) return;
    setPlayerPanelOpen(false);
    if (view === 'online') {
      const fallbackView = lastLibraryViewRef.current || 'songs';
      setView(fallbackView);
      setData((prev) => ({ ...prev, settings: { ...prev.settings, lastView: fallbackView } }));
    }
    if (playlistId !== 'all') {
      const targetPl = data.playlists.find((p) => p.id === playlistId);
      if (targetPl && !targetPl.trackIds.includes(currentTrackId)) {
        setPlaylistId('all');
        setData((prev) => ({ ...prev, settings: { ...prev.settings, lastPlaylistId: 'all' } }));
      }
    }
    if (query.trim() && !displayTracks.some((t) => t.id === currentTrackId)) {
      setQuery('');
    }
    setScrollToTrackRequest((prev) => ({
      seq: prev.seq + 1,
      trackId: currentTrackId,
      behavior: 'smooth',
      flash: true
    }));
  }, [currentTrackId, view, playlistId, data.playlists, query, displayTracks]);

  const handleChangeVolume = useCallback((nextVolume) => {
    const clamped = Math.max(0, Math.min(1, Number(nextVolume) || 0));
    setData((prev) => ({ ...prev, settings: { ...prev.settings, volume: clamped } }));
  }, []);

  // Tray & system MediaSession integration
  useEffect(() => {
    if (!electronAPI?.onPlayerCommand) return undefined;
    const off = electronAPI.onPlayerCommand((command) => {
      if (command === 'toggle-play') handleTogglePlay();
      else if (command === 'prev') playPrev();
      else if (command === 'next') playNext();
      else if (command === 'toggle-lyrics') {
        setData((prev) => ({
          ...prev,
          settings: { ...prev.settings, showLyrics: !prev.settings.showLyrics }
        }));
      }
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [handleTogglePlay, playPrev, playNext]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      return;
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Song',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'Unknown Album',
        artwork: currentCoverDataUrl ? [{ src: currentCoverDataUrl }] : []
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (_) {
      // ignore unsupported MediaMetadata format
    }
  }, [currentTrack, currentCoverDataUrl, isPlaying]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    const handlers = [
      ['play', () => setIsPlaying(true)],
      ['pause', () => setIsPlaying(false)],
      ['previoustrack', playPrev],
      ['nexttrack', playNext],
      ['seekto', (details) => { if (Number.isFinite(details?.seekTime)) handleSeek(details.seekTime); }],
      ['seekbackward', (details) => handleSeek(timeRef.current - (details?.seekOffset || 5))],
      ['seekforward', (details) => handleSeek(timeRef.current + (details?.seekOffset || 5))]
    ];
    for (const [action, fn] of handlers) {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch (_) {}
    }
    return () => {
      for (const [action] of handlers) {
        try { navigator.mediaSession.setActionHandler(action, null); } catch (_) {}
      }
    };
  }, [playPrev, playNext, handleSeek]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (contextMenu) setContextMenu(null);
        else if (playlistToDelete) setPlaylistToDelete(null);
        else if (settingsOpen) setSettingsOpen(false);
        else if (playerPanelOpen) setPlayerPanelOpen(false);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        if (view !== 'online' && searchInputRef.current) {
          e.preventDefault();
          searchInputRef.current.focus();
          searchInputRef.current.select();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        if (currentTrackId) {
          e.preventDefault();
          handleLocateCurrentTrack();
        }
        return;
      }

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) playPrev();
        else handleSeek(timeRef.current - 5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) playNext();
        else handleSeek(Math.min(trackDuration || currentTrack?.duration || 0, timeRef.current + 5));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleChangeVolume(volumeRef.current + 0.05);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleChangeVolume(volumeRef.current - 0.05);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    contextMenu,
    playlistToDelete,
    settingsOpen,
    playerPanelOpen,
    view,
    handleTogglePlay,
    playPrev,
    playNext,
    handleSeek,
    handleChangeVolume,
    trackDuration,
    currentTrack?.duration,
    currentTrackId,
    handleLocateCurrentTrack
  ]);

  const toggleTheme = useCallback(() => {
    setDark((prevDark) => {
      const nextDark = !prevDark;
      setData((prev) => ({ ...prev, settings: { ...prev.settings, theme: nextDark ? 'dark' : 'light' } }));
      return nextDark;
    });
  }, []);

  const handleSelectPlaylist = useCallback((id) => {
    setPlaylistId(id);
    setData((prev) => ({ ...prev, settings: { ...prev.settings, lastPlaylistId: id } }));
  }, []);

  const handleChangeView = useCallback((nextView) => {
    setView(nextView);
    setData((prev) => ({ ...prev, settings: { ...prev.settings, lastView: nextView } }));
  }, []);

  const handleToggleSort = useCallback((colKey) => {
    setSort((prevSort) => {
      const updated = nextSort(prevSort, colKey);
      setData((prev) => ({ ...prev, settings: { ...prev.settings, sort: updated } }));
      return updated;
    });
  }, []);

  const toggleLike = useCallback((id) => {
    setData((prev) => {
      const tracks = prev.tracks.map((t) => (t.id === id ? { ...t, liked: !t.liked } : t));
      const likedSet = new Set(tracks.filter((t) => t.liked).map((t) => t.id));
      const playlists = prev.playlists.map((p) =>
        p.id === 'favorites' ? { ...p, trackIds: [...likedSet] } : p
      );
      return { ...prev, tracks, playlists };
    });
  }, []);

  const addPlaylist = useCallback((nameInput) => {
    const name = `${nameInput || ''}`.trim();
    if (!name) return;
    const id = `playlist-${Date.now()}`;
    setData((prev) => ({
      ...prev,
      playlists: [...prev.playlists, { id, name, fixed: false, trackIds: [] }]
    }));
  }, []);

  const removePlaylist = useCallback(
    (id) => {
      const target = data.playlists.find((p) => p.id === id);
      if (target) setPlaylistToDelete(target);
    },
    [data.playlists]
  );

  const confirmRemovePlaylist = useCallback(() => {
    if (!playlistToDelete) return;
    const id = playlistToDelete.id;
    setData((prev) => ({ ...prev, playlists: prev.playlists.filter((p) => p.id !== id) }));
    if (playlistId === id) handleSelectPlaylist('all');
    setPlaylistToDelete(null);
  }, [playlistToDelete, playlistId, handleSelectPlaylist]);

  const pickBackgroundImage = useCallback(async () => {
    if (!electronAPI?.pickBackgroundImage) return;
    const selected = await electronAPI.pickBackgroundImage();
    if (!selected) return;
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, backgroundImagePath: selected }
    }));
  }, []);

  const clearBackgroundImage = useCallback(() => {
    setData((prev) => ({
      ...prev,
      settings: { ...prev.settings, backgroundImagePath: '' }
    }));
  }, []);

  const addTrackToPlaylist = useCallback((trackId, targetId) => {
    setData((prev) => {
      const isFav = targetId === 'favorites';
      const tracks = isFav
        ? prev.tracks.map((t) => (t.id === trackId ? { ...t, liked: true } : t))
        : prev.tracks;
      const playlists = prev.playlists.map((p) => {
        if (p.id !== targetId) return p;
        if (p.trackIds.includes(trackId)) return p;
        return { ...p, trackIds: [...p.trackIds, trackId] };
      });
      return { ...prev, tracks, playlists };
    });
  }, []);

  const removeTrackFromPlaylist = useCallback((trackId, targetPlaylistId) => {
    setData((prev) => ({
      ...prev,
      playlists: prev.playlists.map((p) =>
        p.id === targetPlaylistId ? { ...p, trackIds: p.trackIds.filter((id) => id !== trackId) } : p
      )
    }));
  }, []);

  const removeTrack = useCallback(
    (trackId) => {
      setData((prev) => {
        const tracks = prev.tracks.filter((t) => t.id !== trackId);
        const playlists = prev.playlists.map((p) => ({
          ...p,
          trackIds: p.trackIds.filter((id) => id !== trackId)
        }));
        return { ...prev, tracks, playlists };
      });
      if (currentTrackId === trackId) {
        setCurrentTrackId(null);
        setIsPlaying(false);
      }
    },
    [currentTrackId]
  );

  const pickAndScanFolders = useCallback(async () => {
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
  }, [data.scanFolders]);

  const rescanManagedFolders = useCallback(async () => {
    if (!electronAPI) return;
    setScanBusy(true);
    try {
      const scanned = await electronAPI.scanFolders(data.scanFolders || []);
      setData(scanned);
    } finally {
      setScanBusy(false);
    }
  }, [data.scanFolders]);

  const removeManagedFolder = useCallback(
    async (folderPath) => {
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
    },
    [data.scanFolders, currentTrackId]
  );

  const rescanSingle = useCallback(async (track) => {
    if (!electronAPI || !track?.path) return null;
    const fresh = await electronAPI.rescanTrack(track.path);
    if (fresh?.id) {
      setData((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) => (t.id === fresh.id ? { ...fresh, liked: t.liked } : t))
      }));
    }
    return fresh;
  }, []);

  // Online music handlers
  const toggleOnlineSource = useCallback((sourceId) => {
    setSelectedOnlineSources((prev) => {
      if (prev.includes(sourceId)) {
        const next = prev.filter((id) => id !== sourceId);
        return next.length ? next : prev;
      }
      return [...prev, sourceId];
    });
  }, []);

  const toggleOnlineSelection = useCallback((key) => {
    setSelectedOnlineKeys((prev) => (prev.includes(key) ? prev.filter((id) => id !== key) : [...prev, key]));
  }, []);

  const toggleSelectAllOnline = useCallback(() => {
    setSelectedOnlineKeys((prev) =>
      prev.length === onlineResults.length ? [] : onlineResults.map((item) => item.key)
    );
  }, [onlineResults]);

  const searchOnlineMusic = useCallback(async () => {
    const keyword = onlineQuery.trim();
    if (!keyword || !electronAPI?.searchOnlineMusic) return;
    setOnlineBusy(true);
    setOnlineResults([]);
    setSelectedOnlineKeys([]);
    setOnlineSearchStatus({
      active: true,
      completed: 0,
      total: selectedOnlineSources.length,
      message: `正在并发启动 musicdl（每源最多 ${onlineLimitPerSource} 首）...`
    });
    setOnlineNotice('正在搜索在线音乐...');
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
        setOnlineNotice(
          (result.results || []).length
            ? `已暂停搜索，保留 ${result.results.length} 首结果`
            : '已暂停搜索，暂未找到结果'
        );
        return;
      }
      const errorText = result.errors?.length ? `，${result.errors.length} 个源失败/超时` : '';
      setOnlineNotice(
        (result.results || []).length ? `找到 ${result.results.length} 首可下载歌曲${errorText}` : '未找到可下载歌曲'
      );
    } finally {
      setOnlineBusy(false);
      setOnlineSearchStatus(null);
    }
  }, [onlineQuery, selectedOnlineSources, onlineLimitPerSource]);

  const pauseOnlineSearch = useCallback(async () => {
    if (!electronAPI?.cancelOnlineSearch) return;
    setOnlineNotice('正在暂停搜索，保留已找到的结果...');
    await electronAPI.cancelOnlineSearch();
  }, []);

  const pickOnlineDownloadFolder = useCallback(async () => {
    const selected = await electronAPI?.pickDownloadFolder?.();
    if (selected) setDownloadFolder(selected);
  }, []);

  const downloadSelectedOnlineMusic = useCallback(async () => {
    if (!electronAPI?.downloadOnlineMusic) return;
    const selectedSet = new Set(selectedOnlineKeys);
    const selectedSongs = onlineResults.filter((item) => selectedSet.has(item.key));
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
      setOnlineNotice(`下载完成，已自动导入 ${result.tracks?.length || 0} 首歌曲到曲库`);
    } finally {
      setOnlineDownloading(false);
    }
  }, [selectedOnlineKeys, onlineResults, downloadFolder]);

  // Lyric Finder & Local Import & Alignment
  const openLyricFinder = useCallback(() => {
    if (!currentTrack || !electronAPI?.openLyricFinderWindow) return;
    const keyword = `${currentTrack.artist || ''} - ${currentTrack.title || ''}`.trim();
    const searchUrl = `https://www.toomic.com/?search=${encodeURIComponent(keyword)}`;
    electronAPI.openLyricFinderWindow({
      url: searchUrl,
      trackPath: currentTrack.path
    });
  }, [currentTrack]);

  const installLyricFileForCurrentTrack = useCallback(
    async (sourceLyricPath) => {
      if (!currentTrack?.path || !sourceLyricPath || !electronAPI?.installLyricForTrack) return;
      const installedPath = await electronAPI.installLyricForTrack(currentTrack.path, sourceLyricPath);
      if (!installedPath) {
        setPlayError('歌词文件导入失败');
        return;
      }
      const fresh = await rescanSingle(currentTrack);
      await loadLyricsForTrack(fresh || { ...currentTrack, lyricPath: installedPath }, lyricEncoding);
      setLyricAlignNotice('已成功导入本地歌词');
      setPlayError('');
    },
    [currentTrack, rescanSingle, loadLyricsForTrack, lyricEncoding]
  );

  const importLocalLyric = useCallback(async () => {
    if (!currentTrack || !electronAPI?.pickLyricFile) return;
    const picked = await electronAPI.pickLyricFile();
    if (!picked) return;
    await installLyricFileForCurrentTrack(picked);
  }, [currentTrack, installLyricFileForCurrentTrack]);

  const adjustLyricOffset = useCallback((delta) => {
    setLyricOffsetSec((v) => Math.max(-30, Math.min(30, Number((v + delta).toFixed(2)))));
    const audio = audioRef.current;
    if (audio) setTime(audio.currentTime || 0);
  }, []);

  const applyAlignAtCurrent = useCallback(
    (idx) => {
      let appliedDelta = 0;
      const pendingGlobalOffset = lyricOffsetSec;

      setLyricLines((prev) => {
        if (!prev.length || idx < 0 || idx >= prev.length) return prev;
        // Fold any active global offset into line timestamps first so offsets never stack twice
        const normalizedLines =
          Math.abs(pendingGlobalOffset) > 0.001
            ? prev.map((line) => ({ ...line, time: Math.max(0, line.time - pendingGlobalOffset) }))
            : prev;

        const currentPlayback = audioRef.current?.currentTime ?? timeRef.current;
        const roundedCurrent = Math.max(0, Math.round(currentPlayback * 10) / 10);
        const base = normalizedLines[idx].time;
        const minTarget = idx > 0 ? normalizedLines[idx - 1].time + 0.1 : 0;
        const target = Math.max(minTarget, roundedCurrent);
        const delta = target - base;
        appliedDelta = delta;
        if (Math.abs(delta) < 0.001 && Math.abs(pendingGlobalOffset) < 0.001) return prev;
        return normalizedLines.map((line, i) =>
          i < idx ? line : { ...line, time: Math.max(0, line.time + delta) }
        );
      });

      if (Math.abs(pendingGlobalOffset) > 0.001) {
        setLyricOffsetSec(0);
      }

      if (Math.abs(appliedDelta) >= 0.001 || Math.abs(pendingGlobalOffset) >= 0.001) {
        setLyricsDirty(true);
        const sign = appliedDelta > 0 ? '+' : '';
        setLyricAlignNotice(`已调整：从该句开始整体 ${sign}${appliedDelta.toFixed(1)}s`);
      } else {
        setLyricAlignNotice('已调整：该句时间无需变化');
      }
    },
    [lyricOffsetSec]
  );

  const handleLineClickInAdjustMode = useCallback(
    (idx) => {
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
    },
    [holdLyricIdx, applyAlignAtCurrent]
  );

  const saveLyricOffsetToFile = useCallback(async () => {
    if (!lyricDebugPath || !lyricLines.length || !electronAPI) return;

    if (electronAPI.saveAlignedLyrics) {
      const result = await electronAPI.saveAlignedLyrics({
        lyricPath: lyricDebugPath,
        offsetSec: lyricOffsetSec,
        dirty: lyricsDirty,
        encoding: lyricEncoding,
        lines: lyricLines
      });
      if (!result?.ok) {
        setPlayError(result?.error || '歌词偏移保存失败');
        return;
      }
      if (currentTrackId && lyricEncoding !== 'auto' && lyricEncoding !== 'utf-8') {
        setData((prev) => ({
          ...prev,
          settings: {
            ...prev.settings,
            lyricEncodingMap: {
              ...(prev.settings.lyricEncodingMap || {}),
              [currentTrackId]: 'utf-8'
            }
          }
        }));
      }
      setLyricsRaw(result.content || '');
      setLyricLines(parseLyrics(result.content || ''));
      setLyricOffsetSec(0);
      setLyricsDirty(false);
      setLyricAdjustMode(false);
      setHoldLyricIdx(null);
      setLyricAlignNotice('已保存到 LRC 文件');
      setPlayError('');
    }
  }, [lyricDebugPath, lyricLines, lyricOffsetSec, lyricsDirty, lyricEncoding, currentTrackId]);

  useEffect(() => {
    if (!lyricAlignNotice) return undefined;
    const t = setTimeout(() => setLyricAlignNotice(''), 2400);
    return () => clearTimeout(t);
  }, [lyricAlignNotice]);

  useEffect(() => {
    if (!electronAPI?.onLyricDownloaded) return undefined;
    const off = electronAPI.onLyricDownloaded(async (payload) => {
      if (!payload?.ok || !payload?.trackPath) {
        setPlayError('歌词下载失败，请重试');
        return;
      }
      const fresh = await electronAPI.rescanTrack(payload.trackPath);
      if (fresh?.id) {
        setData((prev) => ({
          ...prev,
          tracks: prev.tracks.map((t) => (t.id === fresh.id ? { ...fresh, liked: t.liked } : t))
        }));
      }
      if (currentTrack?.path === payload.trackPath && fresh) {
        await loadLyricsForTrack(fresh, lyricEncoding);
        setLyricAlignNotice('已自动关联下载的歌词');
      }
      setPlayError('');
    });
    return () => {
      if (typeof off === 'function') off();
    };
  }, [currentTrack?.path, lyricEncoding, loadLyricsForTrack]);

  // Drag & drop folders / audio files / .lrc files
  const handleDropFiles = useCallback(
    async (e) => {
      e.preventDefault();
      setDragActive(false);
      if (!electronAPI) return;
      const files = Array.from(e.dataTransfer?.files || []);
      if (!files.length) return;
      const paths = files
        .map((f) => electronAPI.getPathForFile?.(f) || f.path || '')
        .filter(Boolean);
      if (!paths.length) return;

      if (paths.length === 1 && LYRIC_DROP_EXT.test(paths[0]) && currentTrack) {
        await installLyricFileForCurrentTrack(paths[0]);
        return;
      }

      if (electronAPI.scanDroppedPaths) {
        setScanBusy(true);
        try {
          const updatedData = await electronAPI.scanDroppedPaths(paths);
          if (updatedData) setData(updatedData);
        } finally {
          setScanBusy(false);
        }
      }
    },
    [currentTrack, installLyricFileForCurrentTrack]
  );

  const handleOpenContextMenu = useCallback((x, y, trackId) => {
    setContextMenu({ x, y, trackId });
  }, []);

  const handlePlayNextInQueue = useCallback((trackId) => {
    setPendingQueue((q) => [trackId, ...q]);
  }, []);

  const handleShowInFolder = useCallback((filePath) => {
    electronAPI?.showItemInFolder?.(filePath);
  }, []);

  const activePlaylistObj = useMemo(
    () => (playlistId === 'all' ? null : data.playlists.find((p) => p.id === playlistId) || null),
    [playlistId, data.playlists]
  );

  const contextTrack = contextMenu ? trackMap.get(contextMenu.trackId) : null;

  return (
    <div
      className="h-full w-full p-0 text-black/85 dark:text-white/90"
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragActive(false);
      }}
      onDrop={handleDropFiles}
    >
      <audio
        ref={audioRef}
        onPlay={() => {
          if (sourceSwitchingRef.current) return;
          setIsPlaying(true);
        }}
        onPause={(e) => {
          if (sourceSwitchingRef.current) return;
          setIsPlaying(false);
          const pausedAt = e.currentTarget.currentTime || 0;
          lastSyncedTimeRef.current = pausedAt;
          syncSessionToMain({ lastPositionSec: pausedAt });
        }}
        onTimeUpdate={(e) => {
          const cur = e.currentTarget.currentTime || 0;
          setTime(cur);
          if (Math.abs(cur - lastSyncedTimeRef.current) >= 2) {
            lastSyncedTimeRef.current = cur;
            syncSessionToMain({ lastPositionSec: cur });
          }
        }}
        onLoadedMetadata={(e) => {
          const dur = e.currentTarget.duration || currentTrack?.duration || 0;
          setTrackDuration(dur);
          if (pendingAudioSeekSecRef.current > 0) {
            const rawTarget = pendingAudioSeekSecRef.current;
            pendingAudioSeekSecRef.current = 0;
            const safeTarget = dur > 3 && rawTarget >= dur - 1.5 ? 0 : Math.max(0, rawTarget);
            e.currentTarget.currentTime = safeTarget;
            setTime(safeTarget);
            lastSyncedTimeRef.current = safeTarget;
          }
        }}
        onEnded={handleTrackEnded}
        onError={(e) => {
          if (sourceSwitchingRef.current || !e.currentTarget.currentSrc) return;
          setPlayError(
            currentSourceKindRef.current === 'wma-raw'
              ? 'WMA 播放失败，请安装 ffmpeg 以支持自动转码播放'
              : '音频播放失败，请尝试 MP3/FLAC 或检查文件是否存在'
          );
          setIsPlaying(false);
        }}
      />

      <div
        className={`relative h-full w-full ${
          isWindowMaximized ? 'rounded-none' : 'rounded-[10px]'
        } app-window-shell shadow-[0px_14px_30px_-10px_rgba(0,0,0,0.16)] noise-layer overflow-hidden`}
      >
        {!!bgImageUrl && (
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-[0.16] dark:opacity-[0.06] transition-opacity duration-200"
              style={{ backgroundImage: `url("${bgImageUrl}")` }}
            />
            <div
              className="absolute inset-[-10%] bg-cover bg-center"
              style={{
                backgroundImage: `url("${bgImageUrl}")`,
                filter: `blur(${Math.max(0, bgBlur * 1.6)}px) saturate(108%) brightness(${dark ? 0.62 : 0.98}) contrast(${dark ? 0.92 : 1})`,
                transform: 'scale(1.1)'
              }}
            />
            <div className="absolute inset-0 bg-white/8 dark:bg-black/38" />
          </div>
        )}

        {dragActive && (
          <div className="pointer-events-none absolute inset-3 z-[140] flex items-center justify-center rounded-2xl border-2 border-dashed border-[#007aff] bg-[#007aff]/10 backdrop-blur-sm">
            <div className="rounded-xl bg-white/90 dark:bg-[#1e1e1e]/90 px-5 py-3 text-sm font-medium shadow-lg">
              {currentTrack ? '松开鼠标以导入音乐目录 / 歌曲，或为当前歌曲绑定 .lrc 歌词' : '松开鼠标以导入音乐文件夹或音频文件'}
            </div>
          </div>
        )}

        <div className="relative z-10 grid h-full min-h-0 grid-cols-[280px_1fr]">
          <Sidebar
            dark={dark}
            view={view}
            playlistId={playlistId}
            playlists={data.playlists}
            totalTrackCount={uniqueTracks.length}
            onOpenSettings={() => setSettingsOpen(true)}
            onToggleTheme={toggleTheme}
            onSelectPlaylist={handleSelectPlaylist}
            onRemovePlaylist={removePlaylist}
            onAddPlaylist={addPlaylist}
            onChangeView={handleChangeView}
          />

          <main className="relative flex min-h-0 flex-col min-w-0">
            <div className="drag-region relative flex items-center justify-between px-5 pt-4 pb-3 border-b border-black/5 dark:border-white/10">
              {view !== 'online' ? (
                <div className="no-drag flex items-center gap-2 rounded-lg bg-white/60 dark:bg-white/5 px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
                  <Search size={16} className="text-black/40 dark:text-white/40" />
                  <input
                    ref={searchInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="搜索歌名/歌手/拼音 (Ctrl+F)"
                    className="no-drag bg-transparent outline-none text-sm w-56"
                  />
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
                  匹配 {displayTracks.length} 首
                </div>
              )}

              <div className="no-drag pointer-events-none absolute left-[46%] top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs text-black/50 dark:text-white/50">
                {scanBusy ? '正在扫描曲库...' : `已扫描 ${uniqueTracks.length} 首`}
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

            {view !== 'online' ? (
              <VirtualTrackList
                view={view}
                displayTracks={displayTracks}
                groupedByArtist={groupedByArtist}
                groupedByFolder={groupedByFolder}
                totalTrackCount={uniqueTracks.length}
                currentTrackId={currentTrackId}
                scrollToTrackRequest={scrollToTrackRequest}
                sort={sort}
                toneClasses={toneClasses}
                scanBusy={scanBusy}
                onToggleSort={handleToggleSort}
                onPlayTrack={playTrack}
                onToggleLike={toggleLike}
                onOpenContextMenu={handleOpenContextMenu}
                onPickAndScanFolders={pickAndScanFolders}
                onLocateCurrentTrack={handleLocateCurrentTrack}
              />
            ) : (
              <OnlineDownloadPanel
                onlineQuery={onlineQuery}
                onlineSources={onlineSources}
                selectedOnlineSources={selectedOnlineSources}
                onlineResults={onlineResults}
                selectedOnlineKeys={selectedOnlineKeys}
                onlineBusy={onlineBusy}
                onlineDownloading={onlineDownloading}
                onlineNotice={onlineNotice}
                onlineSearchStatus={onlineSearchStatus}
                onlineLimitPerSource={onlineLimitPerSource}
                downloadFolder={downloadFolder}
                localTracks={uniqueTracks}
                toneClasses={toneClasses}
                onChangeOnlineQuery={setOnlineQuery}
                onSearchOnlineMusic={searchOnlineMusic}
                onPauseOnlineSearch={pauseOnlineSearch}
                onDownloadSelected={downloadSelectedOnlineMusic}
                onToggleOnlineSource={toggleOnlineSource}
                onChangeLimitPerSource={setOnlineLimitPerSource}
                onPickDownloadFolder={pickOnlineDownloadFolder}
                onToggleSelection={toggleOnlineSelection}
                onToggleSelectAll={toggleSelectAllOnline}
              />
            )}

            <AnimatePresence>
              {playerPanelOpen && currentTrack && (
                <NowPlayingPanel
                  currentTrack={currentTrack}
                  currentCoverDataUrl={currentCoverDataUrl}
                  isPlaying={isPlaying}
                  lyricLines={lyricLines}
                  lyricsRaw={lyricsRaw}
                  lyricDebugPath={lyricDebugPath}
                  lyricEncoding={lyricEncoding}
                  activeLyricIdx={activeLyricIdx}
                  lyricOffsetSec={lyricOffsetSec}
                  lyricsDirty={lyricsDirty}
                  lyricAdjustMode={lyricAdjustMode}
                  holdLyricIdx={holdLyricIdx}
                  lyricAlignNotice={lyricAlignNotice}
                  onClose={() => setPlayerPanelOpen(false)}
                  onLocateCurrentTrack={handleLocateCurrentTrack}
                  onOpenLyricFinder={openLyricFinder}
                  onImportLocalLyric={importLocalLyric}
                  onChangeEncoding={(value) => {
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
                  }}
                  onToggleAdjustMode={() => {
                    setLyricAdjustMode((v) => !v);
                    setHoldLyricIdx(null);
                    setLyricAlignNotice('');
                  }}
                  onAdjustOffset={adjustLyricOffset}
                  onSaveLyricsToFile={saveLyricOffsetToFile}
                  onLineClickInAdjustMode={handleLineClickInAdjustMode}
                  onSeekToLyricLine={(lineTime) => handleSeek(Math.max(0, lineTime - lyricOffsetSec))}
                />
              )}
            </AnimatePresence>

            <PlayerBar
              currentTrack={currentTrack}
              currentCoverDataUrl={currentCoverDataUrl}
              isPlaying={isPlaying}
              time={time}
              duration={trackDuration}
              volume={volume}
              playMode={playMode}
              showLyrics={!!data.settings.showLyrics}
              lyricLocked={!!data.settings.lyricLocked}
              lyricClickThrough={!!data.settings.lyricClickThrough}
              playError={playError}
              onTogglePanel={() => setPlayerPanelOpen((v) => !v)}
              onPlayPrev={playPrev}
              onTogglePlay={handleTogglePlay}
              onPlayNext={playNext}
              onCyclePlayMode={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, playMode: cyclePlayMode(prev.settings.playMode) }
                }))
              }
              onToggleShowLyrics={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, showLyrics: !prev.settings.showLyrics }
                }))
              }
              onToggleLyricLocked={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, lyricLocked: !prev.settings.lyricLocked }
                }))
              }
              onToggleLyricClickThrough={() =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, lyricClickThrough: !prev.settings.lyricClickThrough }
                }))
              }
              onLocateCurrentTrack={handleLocateCurrentTrack}
              onSeek={handleSeek}
              onChangeVolume={handleChangeVolume}
            />
          </main>
        </div>

        <AnimatePresence>
          {contextMenu && contextTrack && (
            <TrackContextMenu
              contextMenu={contextMenu}
              track={contextTrack}
              playlists={data.playlists}
              activePlaylist={activePlaylistObj}
              onPlayNextInQueue={handlePlayNextInQueue}
              onAddTrackToPlaylist={addTrackToPlaylist}
              onRemoveFromCurrentPlaylist={removeTrackFromPlaylist}
              onShowInFolder={handleShowInFolder}
              onRescanSingle={rescanSingle}
              onRemoveTrack={removeTrack}
              onClose={() => setContextMenu(null)}
            />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            dark={dark}
            scanFolders={data.scanFolders || []}
            scanBusy={scanBusy}
            bgBlur={bgBlur}
            listTextTone={toneClasses.listTextTone}
            closeBehavior={data.settings.closeBehavior || 'ask'}
            minimizedShowLyrics={data.settings.minimizedShowLyrics !== false}
            lyricLocked={!!data.settings.lyricLocked}
            onClose={() => setSettingsOpen(false)}
            onPickAndScanFolders={pickAndScanFolders}
            onRescanManagedFolders={rescanManagedFolders}
            onRemoveManagedFolder={removeManagedFolder}
            onPickBackgroundImage={pickBackgroundImage}
            onClearBackgroundImage={clearBackgroundImage}
            onChangeBgBlur={(val) =>
              setData((prev) => ({
                ...prev,
                settings: { ...prev.settings, backgroundBlur: val }
              }))
            }
            onChangeListTextTone={(val) =>
              setData((prev) => ({
                ...prev,
                settings: { ...prev.settings, listTextTone: val }
              }))
            }
            onChangeCloseBehavior={(val) =>
              setData((prev) => ({
                ...prev,
                settings: { ...prev.settings, closeBehavior: val }
              }))
            }
            onToggleMinimizedShowLyrics={() =>
              setData((prev) => ({
                ...prev,
                settings: {
                  ...prev.settings,
                  minimizedShowLyrics: prev.settings.minimizedShowLyrics === false
                }
              }))
            }
            onToggleLyricLocked={() =>
              setData((prev) => ({
                ...prev,
                settings: { ...prev.settings, lyricLocked: !prev.settings.lyricLocked }
              }))
            }
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!!playlistToDelete && (
          <DeletePlaylistModal
            dark={dark}
            playlist={playlistToDelete}
            onCancel={() => setPlaylistToDelete(null)}
            onConfirm={confirmRemovePlaylist}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
