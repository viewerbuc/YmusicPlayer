import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { SPRING } from '../constants/player';

const SettingsModal = memo(function SettingsModal({
  dark,
  scanFolders,
  scanBusy,
  bgBlur,
  listTextTone,
  closeBehavior,
  minimizedShowLyrics,
  lyricLocked,
  onClose,
  onPickAndScanFolders,
  onRescanManagedFolders,
  onRemoveManagedFolder,
  onPickBackgroundImage,
  onClearBackgroundImage,
  onChangeBgBlur,
  onChangeListTextTone,
  onChangeCloseBehavior,
  onToggleMinimizedShowLyrics,
  onToggleLyricLocked
}) {
  const [closeBehaviorMenuOpen, setCloseBehaviorMenuOpen] = useState(false);

  useEffect(() => {
    if (!closeBehaviorMenuOpen) return undefined;
    const close = () => setCloseBehaviorMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [closeBehaviorMenuOpen]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING}
      className={`absolute inset-0 z-[110] flex items-center justify-center ${dark ? 'bg-black/32' : 'bg-black/10'}`}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.98, y: 6 }}
        transition={SPRING}
        onClick={(e) => e.stopPropagation()}
        className={`w-[580px] max-h-[85vh] overflow-y-auto apple-scroll rounded-2xl border shadow-2xl shadow-black/20 p-5 ${
          dark ? 'border-[#3a3a3a] bg-[#242424] text-white' : 'border-black/10 bg-[#f7f8fa] text-black'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="text-base tracking-tight font-medium">设置</div>
          <button className="rounded-md p-1.5 bg-black/5 dark:bg-white/10" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
            <div className="mb-1 text-xs text-black/60 dark:text-white/70">文件夹管理</div>
            <div className="flex items-center gap-2 mb-2">
              <button
                className="rounded px-2.5 py-1 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50"
                onClick={onPickAndScanFolders}
                disabled={scanBusy}
              >
                {scanBusy ? '扫描中...' : '添加文件夹'}
              </button>
              <button
                className="rounded px-2.5 py-1 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50"
                onClick={onRescanManagedFolders}
                disabled={scanBusy || !scanFolders.length}
              >
                重扫全部
              </button>
            </div>
            <div className="apple-scroll max-h-32 overflow-auto space-y-1 pr-1">
              {scanFolders.map((folder) => (
                <div key={folder} className="flex items-center gap-2 rounded-md px-2 py-1 bg-black/[0.04] dark:bg-white/[0.08]">
                  <div className="flex-1 truncate text-xs text-black/70 dark:text-white/75" title={folder}>
                    {folder}
                  </div>
                  <button
                    className="rounded px-1.5 py-0.5 text-xs bg-black/5 dark:bg-white/10 hover:bg-red-500/20"
                    onClick={() => onRemoveManagedFolder(folder)}
                    disabled={scanBusy}
                  >
                    移除
                  </button>
                </div>
              ))}
              {!scanFolders.length && <div className="text-xs text-black/50 dark:text-white/55">未添加目录</div>}
            </div>
          </section>

          <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
            <div className="mb-1 text-xs text-black/60 dark:text-white/70">背景图</div>
            <div className="flex items-center gap-2 mb-2">
              <button
                className="rounded px-2.5 py-1 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                onClick={onPickBackgroundImage}
              >
                更换背景图
              </button>
              <button
                className="rounded px-2.5 py-1 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                onClick={onClearBackgroundImage}
              >
                清除
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-black/60 dark:text-white/70 w-20">模糊度</span>
              <input
                type="range"
                min={0}
                max={24}
                step={1}
                value={bgBlur}
                onChange={(e) => onChangeBgBlur(Number(e.target.value))}
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
                    onClick={() => onChangeListTextTone(value)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 text-[11px] text-black/50 dark:text-white/55">
              “跟随主题”保持默认对比度；自定义背景过亮可选深色文字，过暗可选浅色文字。
            </div>
          </section>

          <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
            <div className="mb-2 text-xs text-black/60 dark:text-white/70">桌面悬浮歌词</div>
            <div className="flex flex-wrap gap-2">
              <button
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  minimizedShowLyrics
                    ? 'bg-[#007aff] text-white'
                    : 'bg-black/5 dark:bg-white/10 text-black/75 dark:text-white/80 hover:bg-black/10 dark:hover:bg-white/15'
                }`}
                onClick={onToggleMinimizedShowLyrics}
              >
                最小化到托盘时保留桌面歌词：{minimizedShowLyrics ? '开' : '关'}
              </button>
              <button
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  lyricLocked
                    ? 'bg-[#007aff] text-white'
                    : 'bg-black/5 dark:bg-white/10 text-black/75 dark:text-white/80 hover:bg-black/10 dark:hover:bg-white/15'
                }`}
                onClick={onToggleLyricLocked}
              >
                锁定桌面歌词窗口位置：{lyricLocked ? '开' : '关'}
              </button>
            </div>
          </section>

          <section className="rounded-xl p-3 bg-black/[0.03] dark:bg-white/[0.06]">
            <div className="mb-1 text-xs text-black/60 dark:text-white/70">关闭按钮行为</div>
            <div className="relative no-drag" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="w-full rounded-[5px] px-2.5 py-1.5 text-xs text-left bg-white dark:bg-white/10 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] hover:bg-black/5 dark:hover:bg-white/15"
                onClick={(e) => {
                  e.stopPropagation();
                  setCloseBehaviorMenuOpen((v) => !v);
                }}
              >
                {closeBehavior === 'tray'
                  ? '最小化到托盘'
                  : closeBehavior === 'exit'
                    ? '直接关闭'
                    : '每次询问'}
              </button>
              {closeBehaviorMenuOpen && (
                <div
                  className="absolute left-0 bottom-[calc(100%+6px)] z-30 w-full rounded-lg border border-black/10 dark:border-white/15 bg-white/95 dark:bg-[#2a2a2a]/95 backdrop-blur-xl shadow-xl overflow-hidden"
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
                        (closeBehavior || 'ask') === value
                          ? 'bg-[#007aff] text-white'
                          : 'text-black/85 dark:text-white/90 hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                      onClick={() => {
                        onChangeCloseBehavior(value);
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
  );
});

export default SettingsModal;
