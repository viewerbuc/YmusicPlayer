const AUDIO_EXT = new Set(['.mp3', '.flac', '.wma', '.wav', '.m4a', '.aac', '.ogg']);
const LYRIC_EXT = new Set(['.lrc', '.txt']);

const IMAGE_EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
};

const AUDIO_EXT_MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wma': 'audio/x-ms-wma',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg'
};

const ONLINE_MUSIC_SOURCES = [
  { id: 'NeteaseMusicClient', label: '网易云音乐' },
  { id: 'SodaMusicClient', label: '汽水音乐' },
  { id: 'MiguMusicClient', label: '咪咕音乐' },
  { id: 'QQMusicClient', label: 'QQ音乐' },
  { id: 'KuwoMusicClient', label: '酷我音乐' }
];

function normalizePath(fp) {
  return String(fp || '').replace(/\\/g, '/');
}

function normalizeId(fp) {
  return normalizePath(fp).toLowerCase();
}

module.exports = {
  AUDIO_EXT,
  LYRIC_EXT,
  IMAGE_EXT_MIME,
  AUDIO_EXT_MIME,
  ONLINE_MUSIC_SOURCES,
  normalizePath,
  normalizeId
};
