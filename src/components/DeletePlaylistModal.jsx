import { memo } from 'react';
import { motion } from 'framer-motion';
import { SPRING } from '../constants/player';

const DeletePlaylistModal = memo(function DeletePlaylistModal({
  dark,
  playlist,
  onCancel,
  onConfirm
}) {
  if (!playlist) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING}
      className={`absolute inset-0 z-[120] flex items-center justify-center ${
        dark ? 'bg-black/32' : 'bg-black/10'
      }`}
      onClick={onCancel}
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
          确定删除歌单「{playlist.name}」吗？该操作不会删除本地歌曲文件。
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            className={`rounded-md px-3 py-1.5 text-sm ${dark ? 'bg-white/10 text-white' : 'bg-black/5 text-black'}`}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="rounded-md px-3 py-1.5 text-sm text-white bg-gradient-to-b from-red-500 to-red-600 border border-white/20"
            onClick={onConfirm}
          >
            删除
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
});

export default DeletePlaylistModal;
