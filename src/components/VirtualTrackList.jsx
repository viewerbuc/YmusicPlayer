import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FolderPlus, Heart, LocateFixed } from 'lucide-react';
import { SPRING } from '../constants/player';
import { formatDuration } from '../utils/tracks';

const HEADER_ROW_HEIGHT = 34;
const TRACK_ROW_HEIGHT = 36;
const OVERSCAN_PX = 360;
const PLAYER_BAR_CLEARANCE_PX = 136;

const TrackRow = memo(function TrackRow({
  track,
  even,
  isActive,
  isFlashing,
  style,
  listTextClass,
  listMutedTextClass,
  onPlayTrack,
  onToggleLike,
  onOpenContextMenu
}) {
  return (
    <div
      style={style}
      className={`grid grid-cols-[48px_2fr_1.2fr_1.2fr_90px] items-center px-2 text-sm border-b border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 apple-pointer select-none transition-colors duration-300 ${listTextClass} ${
        isFlashing
          ? 'bg-[#007aff]/28 dark:bg-[#007aff]/38 ring-1 ring-inset ring-[#007aff]/60'
          : isActive
            ? 'bg-[#007aff]/12 dark:bg-[#007aff]/22'
            : even
              ? 'bg-black/[0.02] dark:bg-white/[0.03]'
              : ''
      }`}
      onClick={() => onPlayTrack(track.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContextMenu(e.clientX, e.clientY, track.id);
      }}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r bg-[#007aff]" />}
      <button
        className="mx-auto p-1"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLike(track.id);
        }}
        title={track.liked ? '取消喜欢' : '喜欢'}
      >
        <Heart size={16} className={track.liked ? 'fill-red-500 text-red-500' : 'text-black/40 dark:text-white/40'} />
      </button>
      <div className={`truncate apple-pointer ${isActive ? 'text-[#0066d6] dark:text-[#86bcff] font-medium' : ''}`} title={track.title}>
        {track.title}
      </div>
      <div className={`truncate apple-pointer ${listMutedTextClass}`} title={track.artist}>
        {track.artist}
      </div>
      <div className={`truncate apple-pointer ${listMutedTextClass}`} title={track.album}>
        {track.album}
      </div>
      <div className={`text-right pr-2 apple-pointer ${listMutedTextClass}`}>
        {formatDuration(track.duration)}
      </div>
    </div>
  );
});

function findFirstVisibleIndex(items, minOffset) {
  let lo = 0;
  let hi = items.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].offset + items[mid].height < minOffset) {
      lo = mid + 1;
    } else {
      ans = mid;
      hi = mid - 1;
    }
  }
  return ans;
}

const VirtualTrackList = memo(function VirtualTrackList({
  view,
  displayTracks,
  groupedByArtist,
  groupedByFolder,
  totalTrackCount,
  currentTrackId,
  scrollToTrackRequest,
  sort,
  toneClasses,
  scanBusy,
  onToggleSort,
  onPlayTrack,
  onToggleLike,
  onOpenContextMenu,
  onPickAndScanFolders,
  onLocateCurrentTrack
}) {
  const scrollerRef = useRef(null);
  const handledScrollSeqRef = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [flashingTrackId, setFlashingTrackId] = useState(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return undefined;
    const updateSize = () => setViewportHeight(node.clientHeight || 640);
    updateSize();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { items, totalHeight } = useMemo(() => {
    const list = [];
    let offset = 0;
    let trackSeq = 0;

    if (view === 'songs') {
      for (let i = 0; i < displayTracks.length; i += 1) {
        const track = displayTracks[i];
        list.push({
          type: 'track',
          key: `songs-${track.id}`,
          track,
          even: trackSeq % 2 === 1,
          offset,
          height: TRACK_ROW_HEIGHT
        });
        offset += TRACK_ROW_HEIGHT;
        trackSeq += 1;
      }
    } else {
      const groups = view === 'artists' ? groupedByArtist : groupedByFolder;
      for (const [groupName, tracks] of groups) {
        list.push({
          type: 'header',
          key: `group-${view}-${groupName}`,
          label: `${groupName} (${tracks.length})`,
          offset,
          height: HEADER_ROW_HEIGHT
        });
        offset += HEADER_ROW_HEIGHT;
        for (let i = 0; i < tracks.length; i += 1) {
          const track = tracks[i];
          list.push({
            type: 'track',
            key: `${view}-${groupName}-${track.id}`,
            track,
            even: i % 2 === 1,
            offset,
            height: TRACK_ROW_HEIGHT
          });
          offset += TRACK_ROW_HEIGHT;
        }
      }
    }

    return { items: list, totalHeight: offset };
  }, [view, displayTracks, groupedByArtist, groupedByFolder]);

  const activeItem = useMemo(
    () => (currentTrackId ? items.find((item) => item.type === 'track' && item.track.id === currentTrackId) || null : null),
    [items, currentTrackId]
  );

  const isActiveTrackVisible = useMemo(() => {
    if (!activeItem) return false;
    const visibleTop = scrollTop + 34; // below sticky table header
    const visibleBottom = scrollTop + Math.max(120, viewportHeight - PLAYER_BAR_CLEARANCE_PX);
    return activeItem.offset >= visibleTop - 8 && activeItem.offset + activeItem.height <= visibleBottom + 8;
  }, [activeItem, scrollTop, viewportHeight]);

  useEffect(() => {
    if (!flashingTrackId) return undefined;
    const timer = setTimeout(() => setFlashingTrackId(null), 1500);
    return () => clearTimeout(timer);
  }, [flashingTrackId]);

  useEffect(() => {
    const req = scrollToTrackRequest;
    if (!req?.seq || !req.trackId || handledScrollSeqRef.current === req.seq) return undefined;
    const targetItem = items.find((item) => item.type === 'track' && item.track.id === req.trackId);
    if (!targetItem) return undefined;

    handledScrollSeqRef.current = req.seq;
    if (req.flash) {
      setFlashingTrackId(req.trackId);
    }

    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      const node = scrollerRef.current;
      if (!node) return;
      const usableHeight = Math.max(160, (node.clientHeight || viewportHeight || 640) - PLAYER_BAR_CLEARANCE_PX);
      const nextTop = Math.max(0, targetItem.offset - usableHeight * 0.45);
      const distance = Math.abs(node.scrollTop - nextTop);

      if (req.behavior === 'smooth' && distance > 2200) {
        const preJump = nextTop + (node.scrollTop > nextTop ? 420 : -420);
        node.scrollTop = Math.max(0, preJump);
        raf2 = requestAnimationFrame(() => {
          node.scrollTo({ top: nextTop, behavior: 'smooth' });
        });
      } else {
        node.scrollTo({ top: nextTop, behavior: req.behavior || 'smooth' });
      }
      setScrollTop(nextTop);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [scrollToTrackRequest, items, viewportHeight]);

  const visibleItems = useMemo(() => {
    if (!items.length) return [];
    const minOffset = Math.max(0, scrollTop - OVERSCAN_PX);
    const maxOffset = scrollTop + viewportHeight + OVERSCAN_PX;
    const startIdx = findFirstVisibleIndex(items, minOffset);
    const slice = [];
    for (let i = startIdx; i < items.length; i += 1) {
      const item = items[i];
      if (item.offset > maxOffset) break;
      slice.push(item);
    }
    return slice;
  }, [items, scrollTop, viewportHeight]);

  const renderSortArrow = (colKey) => {
    if (sort.key !== colKey) return '';
    return sort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const {
    listTextClass,
    listMutedTextClass,
    listFaintTextClass,
    listHeaderClass
  } = toneClasses;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={scrollerRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="apple-scroll flex-1 min-h-0 overflow-auto px-3 pb-40"
      >
        <div
          className={`sticky top-0 z-10 grid grid-cols-[48px_2fr_1.2fr_1.2fr_90px] px-2 py-2 text-xs tracking-wide uppercase bg-[rgba(226,232,238,0.88)] dark:bg-[rgba(48,56,64,0.94)] backdrop-blur-md border-b border-black/5 dark:border-white/10 ${listHeaderClass}`}
        >
          <span className="text-center">喜欢</span>
          <button className="text-left apple-pointer" onClick={() => onToggleSort('title')}>
            歌曲名{renderSortArrow('title')}
          </button>
          <button className="text-left apple-pointer" onClick={() => onToggleSort('artist')}>
            作者{renderSortArrow('artist')}
          </button>
          <button className="text-left apple-pointer" onClick={() => onToggleSort('album')}>
            专辑{renderSortArrow('album')}
          </button>
          <button className="text-right pr-2 apple-pointer" onClick={() => onToggleSort('duration')}>
            时长{renderSortArrow('duration')}
          </button>
        </div>

        {items.length > 0 ? (
          <div className="relative w-full" style={{ height: totalHeight }}>
            {visibleItems.map((item) => {
              const posStyle = {
                position: 'absolute',
                top: item.offset,
                left: 0,
                right: 0,
                height: item.height
              };
              if (item.type === 'header') {
                return (
                  <div
                    key={item.key}
                    style={posStyle}
                    className="flex items-center gap-2 px-2 text-xs font-semibold tracking-wide text-black/50 dark:text-white/50"
                  >
                    <span className="h-px w-3 bg-black/18 dark:bg-white/18" />
                    <span className="min-w-0 truncate" title={item.label}>{item.label}</span>
                    <span className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                  </div>
                );
              }
              return (
                <TrackRow
                  key={item.key}
                  track={item.track}
                  even={item.even}
                  isActive={currentTrackId === item.track.id}
                  isFlashing={flashingTrackId === item.track.id}
                  style={posStyle}
                  listTextClass={listTextClass}
                  listMutedTextClass={listMutedTextClass}
                  onPlayTrack={onPlayTrack}
                  onToggleLike={onToggleLike}
                  onOpenContextMenu={onOpenContextMenu}
                />
              );
            })}
          </div>
        ) : (
          <div className={`py-16 flex flex-col items-center justify-center gap-3 text-center text-sm ${listFaintTextClass}`}>
            {totalTrackCount === 0 ? (
              <>
                <div>曲库为空，添加本地音乐目录或直接拖入文件夹即可开始播放</div>
                <button
                  onClick={onPickAndScanFolders}
                  disabled={scanBusy}
                  className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-medium text-white bg-gradient-to-b from-blue-500 to-blue-600 shadow-sm disabled:opacity-55"
                >
                  <FolderPlus size={15} />
                  {scanBusy ? '正在扫描...' : '添加音乐文件夹'}
                </button>
              </>
            ) : (
              <div>没有匹配歌曲，支持按歌曲名、歌手、专辑或拼音/首字母搜索</div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {currentTrackId && !isActiveTrackVisible && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.94 }}
            transition={SPRING}
            onClick={onLocateCurrentTrack}
            title="快速滚动到当前播放歌曲 (Ctrl+L)"
            className="absolute right-6 bottom-[134px] z-[70] inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium bg-white/92 dark:bg-[#2b2b2b]/92 text-[#0066d6] dark:text-[#8ec5ff] border border-[#007aff]/25 shadow-lg shadow-black/15 backdrop-blur-xl hover:bg-[#007aff] hover:text-white dark:hover:bg-[#007aff] dark:hover:text-white transition-colors"
          >
            <LocateFixed size={14} />
            <span>定位当前播放</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});

export default VirtualTrackList;
