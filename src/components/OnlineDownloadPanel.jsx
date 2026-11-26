import { memo, useMemo } from 'react';
import { Check, Search } from 'lucide-react';
import { normalizeSearchText } from '../utils/tracks';

const OnlineDownloadPanel = memo(function OnlineDownloadPanel({
  onlineQuery,
  onlineSources,
  selectedOnlineSources,
  onlineResults,
  selectedOnlineKeys,
  onlineBusy,
  onlineDownloading,
  onlineNotice,
  onlineSearchStatus,
  onlineLimitPerSource,
  downloadFolder,
  localTracks,
  toneClasses,
  onChangeOnlineQuery,
  onSearchOnlineMusic,
  onPauseOnlineSearch,
  onDownloadSelected,
  onToggleOnlineSource,
  onChangeLimitPerSource,
  onPickDownloadFolder,
  onToggleSelection,
  onToggleSelectAll
}) {
  const {
    listTextClass,
    listMutedTextClass,
    listFaintTextClass,
    listAccentTextClass,
    listHeaderClass
  } = toneClasses;

  const localSignatureSet = useMemo(() => {
    const set = new Set();
    for (const t of localTracks || []) {
      const title = normalizeSearchText(t.title);
      const artist = normalizeSearchText(t.artist);
      if (title) set.add(`${artist}::${title}`);
    }
    return set;
  }, [localTracks]);

  const selectedKeySet = useMemo(() => new Set(selectedOnlineKeys), [selectedOnlineKeys]);
  const allSelected = onlineResults.length > 0 && selectedOnlineKeys.length === onlineResults.length;

  return (
    <div className="apple-scroll flex-1 min-h-0 overflow-auto p-4 pb-44 space-y-4">
      <section className="rounded-2xl bg-white/50 dark:bg-[#1e1e1e]/55 backdrop-blur-md border border-black/5 dark:border-white/10 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white/70 dark:bg-white/8 border border-black/5 dark:border-white/10 px-3 py-2 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]">
            <Search size={17} className="text-black/40 dark:text-white/45" />
            <input
              value={onlineQuery}
              onChange={(e) => onChangeOnlineQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchOnlineMusic();
              }}
              placeholder="输入歌曲名、歌手或歌词关键词"
              className="min-w-0 flex-1 bg-transparent outline-none text-sm"
            />
          </div>
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium text-white bg-gradient-to-b from-blue-500 to-blue-600 disabled:opacity-55"
            onClick={onSearchOnlineMusic}
            disabled={onlineBusy || !onlineQuery.trim() || !selectedOnlineSources.length}
          >
            {onlineBusy
              ? `搜索中 ${onlineSearchStatus?.completed || 0}/${onlineSearchStatus?.total || selectedOnlineSources.length}`
              : '搜索'}
          </button>
          {onlineBusy && (
            <button
              className="rounded-xl px-4 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10"
              onClick={onPauseOnlineSearch}
            >
              暂停搜索
            </button>
          )}
          <button
            className="rounded-xl px-4 py-2 text-sm font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10 disabled:opacity-55"
            onClick={onDownloadSelected}
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
                onClick={() => onToggleOnlineSource(source.id)}
              >
                {source.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1.5 rounded-full border border-black/8 dark:border-white/10 bg-black/4 dark:bg-white/6 px-3 py-1.5 text-black/52 dark:text-white/52 transition-colors hover:bg-black/8 hover:dark:bg-white/10">
            <span className="text-black/52 dark:text-white/52">每个音乐源</span>
            <select
              value={onlineLimitPerSource}
              onChange={(e) => onChangeLimitPerSource(Number(e.target.value) || 15)}
              className="appearance-none bg-transparent pr-4 outline-none font-medium text-[#0066d6] dark:text-[#9accff]"
              disabled={onlineBusy}
              style={{
                backgroundImage:
                  'linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)',
                backgroundPosition: 'calc(100% - 7px) 52%, calc(100% - 3px) 52%',
                backgroundSize: '4px 4px, 4px 4px',
                backgroundRepeat: 'no-repeat'
              }}
            >
              {[10, 15, 20].map((value) => (
                <option key={value} value={value} className="bg-white text-black dark:bg-[#111722] dark:text-white">
                  {value} 首
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2 text-xs text-black/55 dark:text-white/55 lg:flex-row lg:items-center">
          <div className="truncate" title={downloadFolder || '默认音乐目录'}>
            保存到：{downloadFolder || '默认音乐目录'}
          </div>
          <button
            className="w-fit rounded-lg px-2.5 py-1 bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-black/5 dark:border-white/10"
            onClick={onPickDownloadFolder}
          >
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
                  style={{
                    width: `${Math.max(
                      6,
                      Math.round(
                        ((onlineSearchStatus.completed || 0) /
                          Math.max(1, onlineSearchStatus.total || selectedOnlineSources.length)) *
                          100
                      )
                    )}%`
                  }}
                />
              </div>
            )}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl bg-white/70 dark:bg-[#1e1e1e]/80 backdrop-blur-md border border-black/5 dark:border-white/10">
        <div
          className={`grid grid-cols-[44px_2fr_1.2fr_1.1fr_88px_96px] items-center px-3 py-2 text-xs tracking-wide uppercase bg-[rgba(226,232,238,0.88)] dark:bg-[rgba(48,56,64,0.94)] border-b border-black/5 dark:border-white/10 ${listHeaderClass}`}
        >
          <input
            type="checkbox"
            checked={allSelected}
            disabled={!onlineResults.length}
            onChange={onToggleSelectAll}
            title="全选 / 取消全选"
            className="mx-auto accent-[#007aff] cursor-pointer disabled:opacity-40"
          />
          <span>歌曲名</span>
          <span>作者</span>
          <span>专辑</span>
          <span className="text-right">大小</span>
          <span className="text-right pr-2">来源</span>
        </div>
        {onlineResults.map((item) => {
          const checked = selectedKeySet.has(item.key);
          const firstSinger = `${item.singers || ''}`.split(/[,，/、&；;]/)[0];
          const inLibrary = localSignatureSet.has(
            `${normalizeSearchText(firstSinger)}::${normalizeSearchText(item.song_name)}`
          );
          return (
            <div
              key={item.key}
              className={`grid grid-cols-[44px_2fr_1.2fr_1.1fr_88px_96px] items-center px-3 py-2 text-sm border-b border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/8 apple-pointer ${listTextClass} ${
                checked ? 'bg-[#007aff]/10 dark:bg-[#007aff]/18' : ''
              }`}
              onClick={() => onToggleSelection(item.key)}
            >
              <input type="checkbox" checked={checked} readOnly className="mx-auto accent-[#007aff]" />
              <div className="min-w-0">
                <div className={`flex items-center gap-1.5 truncate font-medium ${listTextClass}`}>
                  <span className="truncate">{item.song_name}</span>
                  {inLibrary && (
                    <span className="inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-normal bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      <Check size={10} />
                      已在本地
                    </span>
                  )}
                </div>
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
            输入关键词后可从网易云、汽水、咪咕、QQ、酷我并发搜索并下载到本地曲库
          </div>
        )}
      </section>
    </div>
  );
});

export default OnlineDownloadPanel;
