import { memo, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Disc3, FileText, LocateFixed } from 'lucide-react';
import { ENCODING_LABEL_MAP, ENCODING_OPTIONS, SPRING } from '../constants/player';

const NowPlayingPanel = memo(function NowPlayingPanel({
  currentTrack,
  currentCoverDataUrl,
  isPlaying,
  lyricLines,
  lyricsRaw,
  lyricDebugPath,
  lyricEncoding,
  activeLyricIdx,
  lyricOffsetSec,
  lyricsDirty,
  lyricAdjustMode,
  holdLyricIdx,
  lyricAlignNotice,
  onClose,
  onLocateCurrentTrack,
  onOpenLyricFinder,
  onImportLocalLyric,
  onChangeEncoding,
  onToggleAdjustMode,
  onAdjustOffset,
  onSaveLyricsToFile,
  onLineClickInAdjustMode,
  onSeekToLyricLine
}) {
  const [encodingMenuOpen, setEncodingMenuOpen] = useState(false);
  const panelLyricsScrollRef = useRef(null);

  useEffect(() => {
    if (!encodingMenuOpen) return undefined;
    const close = () => setEncodingMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [encodingMenuOpen]);

  const activePanelLyricId = activeLyricIdx >= 0 ? `panel-lyric-${activeLyricIdx}` : '';
  const heldLyricLineText = holdLyricIdx != null ? (lyricLines[holdLyricIdx]?.text || '') : '';
  const canSaveLyrics = Boolean(lyricDebugPath && lyricLines.length && (Math.abs(lyricOffsetSec) > 0.001 || lyricsDirty));

  useEffect(() => {
    if (!activePanelLyricId || holdLyricIdx != null) return;
    const scroller = panelLyricsScrollRef.current;
    const el = document.getElementById(activePanelLyricId);
    if (!scroller || !el) return;
    const nextTop = Math.max(0, el.offsetTop - scroller.clientHeight * 0.45);
    scroller.scrollTo({ top: nextTop, behavior: 'smooth' });
  }, [activePanelLyricId, currentTrack?.id, lyricOffsetSec, holdLyricIdx]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={SPRING}
      className="absolute inset-x-4 top-4 bottom-[124px] z-[95] rounded-2xl border border-black/8 dark:border-white/12 bg-white/78 dark:bg-[#1f1f1f]/86 backdrop-blur-3xl shadow-2xl shadow-black/20 overflow-hidden"
    >
      <div className="flex h-full flex-col p-5">
        <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="relative z-20 flex flex-wrap items-center gap-2">
            <button
              className="no-drag rounded-lg p-2.5 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              onClick={onClose}
              onMouseDown={(e) => e.stopPropagation()}
              title="收起 (Esc)"
            >
              <ChevronDown size={20} />
            </button>

            <button
              className="no-drag inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              onClick={onLocateCurrentTrack}
              onMouseDown={(e) => e.stopPropagation()}
              title="收起面板并在列表中定位该歌曲 (Ctrl+L)"
            >
              <LocateFixed size={15} />
              定位列表
            </button>

            <button
              className="no-drag rounded-lg px-3.5 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              onClick={onOpenLyricFinder}
              onMouseDown={(e) => e.stopPropagation()}
              title="在线搜索并自动导入歌词"
            >
              查找歌词
            </button>

            <button
              className="no-drag inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              onClick={onImportLocalLyric}
              onMouseDown={(e) => e.stopPropagation()}
              title="选择本地 .lrc / .txt 文件导入到当前歌曲目录"
            >
              <FileText size={15} />
              导入歌词
            </button>

            <div className="relative no-drag" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="no-drag rounded-lg px-3 py-2 text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
                onClick={(e) => {
                  e.stopPropagation();
                  setEncodingMenuOpen((v) => !v);
                }}
                title="歌词编码"
              >
                {ENCODING_LABEL_MAP[lyricEncoding] || '编码: 自动'}
              </button>
              {encodingMenuOpen && (
                <div
                  className="absolute left-0 top-[calc(100%+6px)] z-30 w-44 rounded-lg border border-black/10 dark:border-white/15 bg-white/95 dark:bg-[#2a2a2a]/95 backdrop-blur-xl shadow-xl overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  {ENCODING_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      className={`w-full text-left px-3 py-2 text-sm ${
                        lyricEncoding === value
                          ? 'bg-[#007aff] text-white'
                          : 'text-black/85 dark:text-white/90 hover:bg-black/5 dark:hover:bg-white/10'
                      }`}
                      onClick={() => {
                        onChangeEncoding(value);
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
                onClick={onToggleAdjustMode}
                title="调整歌词：点一下按住某句，到目标播放位置再点一下生效"
              >
                调整歌词 {lyricAdjustMode ? '开' : '关'}
              </button>
              <button
                className="rounded-md px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/15"
                onClick={() => onAdjustOffset(-0.5)}
                title="歌词延后 0.5 秒"
              >
                延后
              </button>
              <div className="w-16 text-center text-xs tabular-nums text-black/70 dark:text-white/75">
                {lyricOffsetSec > 0 ? `+${lyricOffsetSec.toFixed(1)}` : lyricOffsetSec.toFixed(1)}s
              </div>
              <button
                className="rounded-md px-2 py-1 text-xs hover:bg-black/10 dark:hover:bg-white/15"
                onClick={() => onAdjustOffset(0.5)}
                title="歌词提前 0.5 秒"
              >
                提前
              </button>
              <button
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  canSaveLyrics
                    ? 'bg-[#007aff] text-white'
                    : 'bg-black/5 dark:bg-white/10 text-black/45 dark:text-white/45'
                }`}
                disabled={!canSaveLyrics}
                onClick={onSaveLyricsToFile}
                title="保存当前时间轴修改到 LRC 文件（保留原标签头）"
              >
                保存到LRC
              </button>
            </div>
          </div>

          {(lyricAdjustMode || lyricAlignNotice) && (
            <div className="px-2 text-xs">
              {lyricAlignNotice ? (
                <div className="text-[#007aff] dark:text-[#8ec1ff]">{lyricAlignNotice}</div>
              ) : holdLyricIdx != null ? (
                <div className="text-black/65 dark:text-white/72">
                  已按住第 {holdLyricIdx + 1} 句：{heldLyricLineText || '...'}。再次点击同一句即可放开并在当前位置生效
                </div>
              ) : (
                <div className="text-black/55 dark:text-white/62">
                  调整歌词已开启：点一下某句按住，到目标播放时间再点一次放开并生效
                </div>
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
            <div className="mt-3 px-2 text-center text-sm text-black/60 dark:text-white/65 truncate" title={currentTrack.album}>
              {currentTrack.album}
            </div>
          </div>

          <div className="min-h-0 pr-1 flex flex-col">
            <div className="shrink-0 px-2 pb-2">
              <div className="text-[28px] leading-tight tracking-tight font-semibold truncate" title={currentTrack.title}>
                {currentTrack.title}
              </div>
              <div className="mt-1 text-[18px] leading-snug text-black/60 dark:text-white/68 truncate">
                {currentTrack.artist} · {currentTrack.album}
              </div>
              {!!lyricDebugPath && (
                <div className="mt-1 text-[11px] text-black/45 dark:text-white/45 truncate" title={lyricDebugPath}>
                  歌词文件: {lyricDebugPath}
                </div>
              )}
            </div>

            <div ref={panelLyricsScrollRef} className="apple-scroll min-h-0 flex-1 overflow-auto">
              {!lyricLines.length && (
                <div className="h-full flex flex-col items-center justify-center gap-4 text-sm text-black/45 dark:text-white/45">
                  <div>未找到可用歌词（可直接拖入 .lrc 文件到窗口）</div>
                  {!!lyricsRaw && (
                    <pre className="max-w-[90%] max-h-28 overflow-auto text-[11px] text-left whitespace-pre-wrap bg-black/5 dark:bg-white/10 rounded-md p-2">
                      {lyricsRaw.split(/\r?\n/).slice(0, 4).join('\n')}
                    </pre>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      className="no-drag rounded-lg px-5 py-2.5 text-base font-medium bg-black/6 dark:bg-white/12 hover:bg-black/10 dark:hover:bg-white/18 text-black/80 dark:text-white/90"
                      onClick={onOpenLyricFinder}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      在线查找歌词
                    </button>
                    <button
                      className="no-drag rounded-lg px-5 py-2.5 text-base font-medium bg-black/6 dark:bg-white/12 hover:bg-black/10 dark:hover:bg-white/18 text-black/80 dark:text-white/90"
                      onClick={onImportLocalLyric}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      导入本地歌词
                    </button>
                  </div>
                </div>
              )}

              {!!lyricLines.length && (
                <div className="space-y-1.5 pt-2 pb-12">
                  {lyricLines.map((line, idx) => (
                    <div
                      key={`${idx}-${line.time}`}
                      id={`panel-lyric-${idx}`}
                      title={lyricAdjustMode ? '点击按住 / 再次点击对齐时间' : '双击跳转到该句播放'}
                      className={`px-2 py-1.5 rounded-md text-[15px] transition-colors cursor-pointer select-none ${
                        holdLyricIdx === idx ? 'bg-[#007aff]/20 ring-1 ring-[#007aff]/40' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      } ${
                        idx === activeLyricIdx
                          ? 'text-[#0069e5] dark:text-[#9accff] font-semibold'
                          : 'text-black/62 dark:text-white/62'
                      }`}
                      onClick={(e) => {
                        if (!lyricAdjustMode) return;
                        e.preventDefault();
                        e.stopPropagation();
                        onLineClickInAdjustMode(idx);
                      }}
                      onDoubleClick={(e) => {
                        if (lyricAdjustMode) return;
                        e.preventDefault();
                        onSeekToLyricLine(line.time);
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
  );
});

export default NowPlayingPanel;
