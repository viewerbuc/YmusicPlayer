import { memo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Disc3,
  ListOrdered,
  LocateFixed,
  Lock,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Unlock,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react';
import { PLAY_MODE_LABELS, SPRING } from '../constants/player';
import { formatDuration } from '../utils/tracks';

const PlayerBar = memo(function PlayerBar({
  currentTrack,
  currentCoverDataUrl,
  isPlaying,
  time,
  duration,
  volume,
  playMode,
  showLyrics,
  lyricLocked,
  lyricClickThrough,
  playError,
  onTogglePanel,
  onPlayPrev,
  onTogglePlay,
  onPlayNext,
  onCyclePlayMode,
  onToggleShowLyrics,
  onToggleLyricLocked,
  onToggleLyricClickThrough,
  onLocateCurrentTrack,
  onSeek,
  onChangeVolume
}) {
  const [scrubTime, setScrubTime] = useState(null);
  const preMuteVolumeRef = useRef(0.8);

  const effectiveDuration = Math.max(duration || currentTrack?.duration || 0, 0);
  const sliderMax = Math.max(effectiveDuration, 1);
  const displayedTime = scrubTime !== null ? scrubTime : Math.min(time, sliderMax);

  const PlayModeIcon =
    playMode === 'sequence'
      ? ListOrdered
      : playMode === 'list-loop'
        ? Repeat
        : playMode === 'loop'
          ? Repeat1
          : Shuffle;

  const VolumeIcon = volume <= 0.001 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const handleToggleMute = () => {
    if (volume > 0.001) {
      preMuteVolumeRef.current = volume;
      onChangeVolume(0);
    } else {
      onChangeVolume(preMuteVolumeRef.current > 0.02 ? preMuteVolumeRef.current : 0.8);
    }
  };

  const commitSeek = (val) => {
    setScrubTime(null);
    onSeek(val);
  };

  return (
    <div className="absolute bottom-0 inset-x-0 z-[80] px-4 pb-4 pointer-events-none">
      <div className="pointer-events-auto rounded-xl bg-white/90 dark:bg-[#323232]/90 backdrop-blur-xl shadow-2xl shadow-black/20 px-3 py-2.5 border border-black/5 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-[1.25] flex items-center gap-1">
            <button
              className="min-w-0 flex-1 flex items-center gap-2.5 text-left rounded-lg px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              onClick={() => {
                if (currentTrack) onTogglePanel();
              }}
              title={currentTrack ? '打开正在播放详情' : '尚未选择歌曲'}
            >
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-black/8 dark:border-white/12 bg-black/5 dark:bg-white/10 flex items-center justify-center">
                {currentCoverDataUrl ? (
                  <img src={currentCoverDataUrl} alt="cover" className="h-full w-full object-cover" />
                ) : (
                  <Disc3 size={20} className="text-black/55 dark:text-white/65" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] leading-tight tracking-tight font-medium">
                  {currentTrack?.title || '未选择歌曲'}
                </div>
                <div className="mt-0.5 truncate text-[11px] leading-tight text-black/52 dark:text-white/52">
                  {currentTrack ? `${currentTrack.artist} · ${currentTrack.album}` : '扫描本地文件夹开始播放'}
                </div>
              </div>
            </button>
            {currentTrack && (
              <button
                className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-black/60 dark:text-white/65 hover:text-[#0066d6] dark:hover:text-[#8ec5ff] hover:bg-black/6 dark:hover:bg-white/12 transition-colors"
                title="在列表中定位这首歌 (Ctrl+L)"
                onClick={onLocateCurrentTrack}
              >
                <LocateFixed size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center justify-center gap-2.5 flex-[0.95] min-w-0">
            <button
              className="rounded-xl p-3 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
              onClick={onPlayPrev}
              title="上一首 (←)"
            >
              <SkipBack size={24} />
            </button>
            <motion.button
              whileTap={{ scale: 0.96 }}
              transition={SPRING}
              className="rounded-xl px-5 py-3 bg-gradient-to-b from-blue-500 to-blue-600 text-white shadow-sm border border-white/20"
              onClick={onTogglePlay}
              title="播放 / 暂停 (Space)"
            >
              {isPlaying ? <Pause size={26} /> : <Play size={26} />}
            </motion.button>
            <button
              className="rounded-xl p-3 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
              onClick={onPlayNext}
              title="下一首 (→)"
            >
              <SkipForward size={24} />
            </button>
          </div>

          <div className="flex items-center justify-end gap-1.5 flex-1 min-w-0">
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15"
              title={PLAY_MODE_LABELS[playMode] || '切换播放模式'}
              onClick={onCyclePlayMode}
            >
              <PlayModeIcon size={16} />
            </button>
            <button
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm leading-none transition-colors ${
                showLyrics ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
              }`}
              title="桌面悬浮歌词"
              onClick={onToggleShowLyrics}
            >
              词
            </button>
            <button
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                lyricLocked ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
              }`}
              title={lyricLocked ? '解锁桌面歌词位置' : '锁定桌面歌词位置'}
              onClick={onToggleLyricLocked}
            >
              {lyricLocked ? <Lock size={14} /> : <Unlock size={14} />}
            </button>
            <button
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-sm leading-none transition-colors ${
                lyricClickThrough ? 'bg-[#007aff] text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'
              }`}
              title="桌面歌词鼠标穿透"
              onClick={onToggleLyricClickThrough}
            >
              穿
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="w-10 text-right text-xs tabular-nums text-black/50 dark:text-white/50">
            {formatDuration(displayedTime)}
          </span>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={0.2}
            value={displayedTime}
            disabled={!currentTrack}
            onChange={(e) => setScrubTime(Number(e.target.value))}
            onPointerUp={(e) => commitSeek(Number(e.currentTarget.value))}
            onPointerCancel={() => setScrubTime(null)}
            onBlur={() => {
              if (scrubTime !== null) commitSeek(scrubTime);
            }}
            onKeyUp={(e) => commitSeek(Number(e.currentTarget.value))}
            className="h-1.5 flex-1 appearance-none rounded-full bg-black/10 dark:bg-white/15 accent-[#007aff] cursor-pointer disabled:cursor-default"
          />
          <span className="w-10 text-xs tabular-nums text-black/50 dark:text-white/50">
            {formatDuration(effectiveDuration)}
          </span>

          <div className="ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 bg-black/5 dark:bg-white/10">
            <button
              onClick={handleToggleMute}
              className="text-black/60 dark:text-white/65 hover:text-black dark:hover:text-white"
              title={volume <= 0.001 ? '取消静音' : '静音'}
            >
              <VolumeIcon size={14} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(volume * 100)}
              onChange={(e) => {
                const next = Math.max(0, Math.min(100, Number(e.target.value))) / 100;
                if (next > 0.02) preMuteVolumeRef.current = next;
                onChangeVolume(next);
              }}
              className="h-1.5 w-24 appearance-none rounded-full bg-black/10 dark:bg-white/15 accent-[#007aff] cursor-pointer"
              title="音量"
            />
            <span className="w-9 text-right text-[11px] tabular-nums text-black/55 dark:text-white/60">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>

        {playError && <div className="mt-1 text-xs text-red-500">{playError}</div>}
      </div>
    </div>
  );
});

export default PlayerBar;
