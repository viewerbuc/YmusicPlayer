import { memo, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { SPRING } from '../constants/player';

const MENU_WIDTH = 212;

const TrackContextMenu = memo(function TrackContextMenu({
  contextMenu,
  track,
  playlists,
  activePlaylist,
  onPlayNextInQueue,
  onAddTrackToPlaylist,
  onRemoveFromCurrentPlaylist,
  onShowInFolder,
  onRescanSingle,
  onRemoveTrack,
  onClose
}) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x: contextMenu?.x || 0, y: contextMenu?.y || 0 });

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const node = menuRef.current;
    const menuHeight = node?.offsetHeight || 280;
    const maxX = Math.max(8, window.innerWidth - MENU_WIDTH - 12);
    const maxY = Math.max(8, window.innerHeight - menuHeight - 12);
    setPos({
      x: Math.min(Math.max(8, contextMenu.x), maxX),
      y: Math.min(Math.max(8, contextMenu.y), maxY)
    });
  }, [contextMenu]);

  if (!contextMenu || !track) return null;

  const canRemoveFromPlaylist = Boolean(activePlaylist && !activePlaylist.fixed);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING}
      style={{ left: pos.x, top: pos.y, width: MENU_WIDTH }}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-[130] max-h-[75vh] overflow-y-auto apple-scroll rounded-lg border border-black/10 dark:border-white/15 bg-white/88 dark:bg-[#323232]/92 backdrop-blur-xl shadow-2xl py-1"
    >
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => {
          onPlayNextInQueue(track.id);
          onClose();
        }}
      >
        下一首播放
      </button>

      <div className="h-px bg-black/5 dark:bg-white/10 my-1" />

      {playlists.map((p) => (
        <button
          key={p.id}
          className="w-full truncate text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => {
            onAddTrackToPlaylist(track.id, p.id);
            onClose();
          }}
        >
          添加到 {p.name}
        </button>
      ))}

      {canRemoveFromPlaylist && (
        <>
          <div className="h-px bg-black/5 dark:bg-white/10 my-1" />
          <button
            className="w-full truncate text-left px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            onClick={() => {
              onRemoveFromCurrentPlaylist(track.id, activePlaylist.id);
              onClose();
            }}
          >
            从「{activePlaylist.name}」移除
          </button>
        </>
      )}

      <div className="h-px bg-black/5 dark:bg-white/10 my-1" />

      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => {
          onShowInFolder(track.path);
          onClose();
        }}
      >
        打开文件所在位置
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => {
          onRescanSingle(track);
          onClose();
        }}
      >
        重新扫描这首歌曲
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"
        onClick={() => {
          onRemoveTrack(track.id);
          onClose();
        }}
      >
        从播放器移除
      </button>
    </motion.div>
  );
});

export default TrackContextMenu;
