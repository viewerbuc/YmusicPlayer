import { memo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DownloadCloud,
  FolderTree,
  ListMusic,
  Moon,
  Settings2,
  Sun,
  Users,
  X
} from 'lucide-react';
import { SPRING } from '../constants/player';

const VIEW_TABS = [
  ['songs', ListMusic, '歌曲'],
  ['artists', Users, '作者'],
  ['folders', FolderTree, '文件夹'],
  ['online', DownloadCloud, '下载']
];

const Sidebar = memo(function Sidebar({
  dark,
  view,
  playlistId,
  playlists,
  totalTrackCount,
  onOpenSettings,
  onToggleTheme,
  onSelectPlaylist,
  onRemovePlaylist,
  onAddPlaylist,
  onChangeView
}) {
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

  const handleCreate = () => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    onAddPlaylist(trimmed);
    setNewPlaylistName('');
    setCreatingPlaylist(false);
  };

  return (
    <aside className="relative flex min-h-0 flex-col p-4 bg-white/20 dark:bg-black/22 backdrop-blur-2xl border-r border-black/5 dark:border-white/10">
      <div className="mb-2 no-drag flex items-center gap-2 text-xs shrink-0">
        <button
          onClick={onOpenSettings}
          className="no-drag rounded-md p-1.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
          title="设置"
        >
          <Settings2 size={16} />
        </button>
        <button
          onClick={onToggleTheme}
          className="no-drag rounded-md p-1.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
          title="切换主题"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <div className="mb-3 shrink-0">
        <div className="text-xs tracking-wide uppercase text-black/50 dark:text-white/40">Library</div>
      </div>

      <div className="apple-scroll min-h-0 flex-1 overflow-y-auto pr-1">
        <nav className="space-y-1 text-sm">
          <button
            className={`w-full rounded-md px-2 py-1.5 text-left transition-colors ${
              playlistId === 'all' ? 'bg-[#007aff] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'
            }`}
            onClick={() => onSelectPlaylist('all')}
          >
            所有歌曲 ({totalTrackCount})
          </button>
          {playlists.map((p) => (
            <div key={p.id} className="flex items-center gap-1">
              <button
                className={`min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left transition-colors ${
                  playlistId === p.id ? 'bg-[#007aff] text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'
                }`}
                onClick={() => onSelectPlaylist(p.id)}
                title={p.name}
              >
                {p.name} ({p.trackIds.length})
              </button>
              {!p.fixed && (
                <button
                  onClick={() => onRemovePlaylist(p.id)}
                  className="p-1 text-black/40 dark:text-white/40 hover:text-red-400"
                  title="删除歌单"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="mt-3 shrink-0">
        {!creatingPlaylist && (
          <button
            className="w-full rounded-md px-2 py-1.5 text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 transition-colors"
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
                if (e.key === 'Enter') handleCreate();
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
                onClick={handleCreate}
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
        {VIEW_TABS.map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => onChangeView(id)}
            className="relative flex-1 rounded-[6px] py-1.5 text-xs tracking-wide"
          >
            {view === id && (
              <motion.div
                layoutId="view-tab"
                transition={SPRING}
                className="absolute inset-0 rounded-[6px] bg-white dark:bg-gray-600 shadow-sm"
              />
            )}
            <span className="relative z-10 flex items-center justify-center gap-1">
              <Icon size={15} />
              {label}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
});

export default Sidebar;
