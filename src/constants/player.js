export const SPRING = { type: 'spring', stiffness: 300, damping: 30 };

export const DEFAULT_DATA = {
  scanFolders: [],
  tracks: [],
  playlists: [{ id: 'favorites', name: '我喜欢', fixed: true, trackIds: [] }],
  settings: {
    showLyrics: true,
    minimizedShowLyrics: true,
    playMode: 'sequence',
    lyricLocked: false,
    lyricClickThrough: false,
    closeBehavior: 'ask',
    theme: 'dark',
    backgroundImagePath: '',
    backgroundBlur: 8,
    listTextTone: 'auto',
    volume: 0.8,
    lyricEncodingMap: {},
    lastTrackId: null,
    lastPositionSec: 0,
    lastPlaylistId: 'all',
    lastView: 'songs',
    sort: { key: 'title', dir: 'asc' }
  }
};

export const MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
};

export const ONLINE_SOURCES = [
  { id: 'NeteaseMusicClient', label: '网易云音乐' },
  { id: 'SodaMusicClient', label: '汽水音乐' },
  { id: 'MiguMusicClient', label: '咪咕音乐' },
  { id: 'QQMusicClient', label: 'QQ音乐' },
  { id: 'KuwoMusicClient', label: '酷我音乐' }
];

export const ENCODING_LABEL_MAP = {
  auto: '编码: 自动',
  'utf-8': 'UTF-8',
  gb18030: 'GB18030',
  gbk: 'GBK',
  big5: 'Big5',
  shift_jis: 'Shift_JIS',
  'euc-kr': 'EUC-KR',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE'
};

export const ENCODING_OPTIONS = Object.entries(ENCODING_LABEL_MAP);

export const PLAY_MODE_LABELS = {
  sequence: '顺序播放',
  'list-loop': '列表循环',
  loop: '单曲循环',
  random: '随机播放'
};
