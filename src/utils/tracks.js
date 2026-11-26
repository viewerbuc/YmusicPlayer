import { pinyin } from 'pinyin-pro';

export const MIXED_COLLATOR = new Intl.Collator(['zh-Hans', 'en'], {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true
});

const CJK_REGEX = /[\u3400-\u9fff]/;
const stringPinyinCache = new Map();
const trackMetaCache = new WeakMap();

export function formatDuration(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(s / 60);
  const sec = `${Math.floor(s % 60)}`.padStart(2, '0');
  return `${m}:${sec}`;
}

export function nextSort(prev, key) {
  if (prev.key !== key) return { key, dir: 'asc' };
  return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
}

export function normalizeSearchText(value) {
  return `${value || ''}`
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getCachedPinyinInfo(rawValue) {
  const text = normalizeSearchText(rawValue);
  if (!text) return { sortKey: '', compact: '', initials: '' };

  const hit = stringPinyinCache.get(text);
  if (hit) return hit;

  let result;
  if (!CJK_REGEX.test(text)) {
    result = {
      sortKey: text,
      compact: text.replace(/\s+/g, ''),
      initials: ''
    };
  } else {
    const fullArr = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
    const initArr = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' });
    const fullSpaced = normalizeSearchText(fullArr.join(' '));
    const fullCompact = fullArr.join('').replace(/\s+/g, '').toLowerCase();
    const initials = initArr.join('').replace(/\s+/g, '').toLowerCase();
    result = {
      sortKey: fullSpaced || text,
      compact: fullCompact,
      initials
    };
  }

  if (stringPinyinCache.size > 12000) {
    stringPinyinCache.clear();
  }
  stringPinyinCache.set(text, result);
  return result;
}

export function toMixedSortKey(value) {
  return getCachedPinyinInfo(value).sortKey;
}

export function getTrackMeta(track) {
  if (!track || typeof track !== 'object') {
    return {
      titleSortKey: '',
      artistSortKey: '',
      albumSortKey: '',
      searchable: ''
    };
  }
  const cached = trackMetaCache.get(track);
  if (cached) return cached;

  const titleNorm = normalizeSearchText(track.title);
  const artistNorm = normalizeSearchText(track.artist);
  const albumNorm = normalizeSearchText(track.album);

  const titlePy = getCachedPinyinInfo(titleNorm);
  const artistPy = getCachedPinyinInfo(artistNorm);
  const albumPy = getCachedPinyinInfo(albumNorm);

  const searchable = [
    titleNorm,
    artistNorm,
    albumNorm,
    titlePy.sortKey,
    titlePy.compact,
    titlePy.initials,
    artistPy.sortKey,
    artistPy.compact,
    artistPy.initials
  ]
    .filter(Boolean)
    .join(' ');

  const meta = {
    titleSortKey: titlePy.sortKey,
    artistSortKey: artistPy.sortKey,
    albumSortKey: albumPy.sortKey,
    searchable
  };
  trackMetaCache.set(track, meta);
  return meta;
}

export function splitSearchTokens(query) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  return normalized.split(' ').map((x) => x.trim()).filter(Boolean);
}

export function trackMatchesTokens(track, tokens) {
  if (!tokens.length) return true;
  const { searchable } = getTrackMeta(track);
  if (!searchable) return false;
  return tokens.every((token) => searchable.includes(token));
}

export function sortTracks(tracks, sort) {
  const arr = [...(tracks || [])];
  const dir = sort.dir === 'asc' ? 1 : -1;
  const key = sort.key || 'title';

  arr.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return (av - bv) * dir;
    }
    const metaA = getTrackMeta(a);
    const metaB = getTrackMeta(b);
    const sortProp = key === 'artist' ? 'artistSortKey' : key === 'album' ? 'albumSortKey' : 'titleSortKey';
    const ak = key === 'title' || key === 'artist' || key === 'album' ? metaA[sortProp] : toMixedSortKey(av);
    const bk = key === 'title' || key === 'artist' || key === 'album' ? metaB[sortProp] : toMixedSortKey(bv);
    const primary = MIXED_COLLATOR.compare(ak, bk) * dir;
    if (primary !== 0) return primary;
    return MIXED_COLLATOR.compare(`${av ?? ''}`, `${bv ?? ''}`) * dir;
  });
  return arr;
}

export function dedupeTracksById(tracks) {
  const map = new Map();
  for (const t of tracks || []) {
    if (!t?.id) continue;
    if (!map.has(t.id)) map.set(t.id, t);
  }
  return [...map.values()];
}

export function cyclePlayMode(mode) {
  if (mode === 'sequence') return 'list-loop';
  if (mode === 'list-loop') return 'loop';
  if (mode === 'loop') return 'random';
  return 'sequence';
}

export function getTextToneClasses(rawTone) {
  const listTextTone = ['auto', 'dark', 'light'].includes(rawTone) ? rawTone : 'auto';
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

  return {
    listTextTone,
    listTextClass,
    listMutedTextClass,
    listFaintTextClass,
    listAccentTextClass,
    listHeaderClass
  };
}
