const path = require('path');
const { normalizeId } = require('./constants.cjs');

function decodeUtf16be(buf) {
  if (buf.length < 2) return '';
  const evenLen = buf.length - (buf.length % 2);
  const swapped = Buffer.allocUnsafe(evenLen);
  for (let i = 0; i < evenLen; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return new TextDecoder('utf-16le').decode(swapped);
}

function scoreDecodedText(txt) {
  if (!txt) return -1e9;
  const bad = (txt.match(/\uFFFD/g) || []).length;
  const nul = (txt.match(/\u0000/g) || []).length;
  const hasLrcTag = /\[\d{1,2}:\d{1,2}(?:\.\d+)?\]/.test(txt);
  const cjk = (txt.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  return (hasLrcTag ? 1000 : 0) + cjk * 0.1 - bad * 40 - nul * 3;
}

function decodeTextSmart(buf) {
  if (!buf || !buf.length) return '';

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return decodeUtf16be(buf.subarray(2));
  }

  const encodings = ['utf-8', 'gb18030', 'gbk', 'big5', 'shift_jis', 'euc-kr', 'utf-16le'];
  let best = '';
  let bestScore = -1e9;
  let bestTagged = '';
  let bestTaggedScore = -1e9;
  for (const enc of encodings) {
    try {
      const txt = new TextDecoder(enc).decode(buf);
      const score = scoreDecodedText(txt);
      const tagged = /\[\d{1,2}:\d{1,2}(?:\.\d+)?\]/.test(txt);
      if (tagged && score > bestTaggedScore) {
        bestTaggedScore = score;
        bestTagged = txt;
      }
      if (score > bestScore) {
        bestScore = score;
        best = txt;
      }
    } catch (_) {
      // ignore unsupported encoding in runtime
    }
  }
  return bestTagged || best || new TextDecoder('utf-8').decode(buf);
}

function decodeTextWithEncoding(buf, encoding) {
  if (!buf || !buf.length) return '';
  const enc = `${encoding || ''}`.toLowerCase();
  if (!enc || enc === 'auto') return decodeTextSmart(buf);
  if (enc === 'utf-16be') {
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return decodeUtf16be(buf.subarray(2));
    return decodeUtf16be(buf);
  }
  if (enc === 'utf-16le') {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
    return new TextDecoder('utf-16le').decode(buf);
  }
  return new TextDecoder(enc).decode(buf);
}

function shiftLrcTimestamps(raw, shiftSec) {
  const text = `${raw || ''}`;
  return text.replace(/\[(\d+):(\d+(?:\.(\d+))?)\]/g, (_, mmStr, secStr, fracStr) => {
    const total = Number(mmStr) * 60 + Number(secStr);
    const shifted = Math.max(0, total - shiftSec);
    const precision = fracStr ? fracStr.length : 0;
    if (precision > 0) {
      const scale = 10 ** precision;
      const ticks = Math.round(shifted * scale);
      const mm = Math.floor(ticks / (60 * scale));
      const rest = ticks - mm * 60 * scale;
      const sec = rest / scale;
      const secFixed = sec.toFixed(precision).padStart(precision + 3, '0');
      return `[${String(mm).padStart(2, '0')}:${secFixed}]`;
    }
    const mm = Math.floor(shifted / 60);
    const sec = Math.floor(shifted % 60);
    return `[${String(mm).padStart(2, '0')}:${String(sec).padStart(2, '0')}]`;
  });
}

function extractLrcMetadataHeaders(rawOriginal) {
  if (!rawOriginal) return [];
  const lines = `${rawOriginal}`.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headers = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[[a-zA-Z]+:[^\]]*\]$/.test(trimmed) && !/^\[offset:/i.test(trimmed)) {
      headers.push(trimmed);
    }
  }
  return headers;
}

function buildLrcPreservingHeaders(rawOriginal, lyricLines) {
  const headers = extractLrcMetadataHeaders(rawOriginal);
  const body = (lyricLines || []).map((line) => {
    const safeTime = Math.max(0, Number(line?.time) || 0);
    const ms = Math.round(safeTime * 1000);
    const mm = Math.floor(ms / 60000);
    const sec = (ms - mm * 60000) / 1000;
    return `[${String(mm).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}]${line?.text || ''}`;
  });
  return [...headers, ...body].join('\n');
}

function findLyricsForAudio(audioFile, lyricSource) {
  const parsed = path.parse(audioFile);
  const audioDir = normalizeId(parsed.dir);
  const audioStem = `${parsed.name || ''}`.normalize('NFKC').trim().toLowerCase();
  const audioStemLoose = audioStem.replace(/\s+/g, '');

  const candidates = lyricSource instanceof Map
    ? (lyricSource.get(audioDir) || [])
    : Array.isArray(lyricSource)
      ? lyricSource.filter((f) => normalizeId(path.dirname(f)) === audioDir)
      : [];

  if (!candidates.length) return null;

  let exact = null;
  for (const file of candidates) {
    const lp = path.parse(file);
    const stem = `${lp.name || ''}`.normalize('NFKC').trim().toLowerCase();
    if (stem === audioStem) {
      exact = file;
      if (lp.ext.toLowerCase() === '.lrc') return file;
    }
  }
  if (exact) return exact;

  let loose = null;
  for (const file of candidates) {
    const lp = path.parse(file);
    const stemLoose = `${lp.name || ''}`.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
    if (stemLoose === audioStemLoose) {
      loose = file;
      if (lp.ext.toLowerCase() === '.lrc') return file;
    }
  }
  if (loose) return loose;

  // Fallback: require non-empty stem and reasonably close length to avoid false-positive short filenames like "1.txt".
  if (!audioStemLoose) return null;
  const byContain = candidates.find((f) => {
    const stem = `${path.parse(f).name || ''}`.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '');
    if (stem.length < 2) return false;
    return stem.includes(audioStemLoose) || (stem.length >= Math.min(4, audioStemLoose.length) && audioStemLoose.includes(stem));
  });
  return byContain || null;
}

module.exports = {
  decodeUtf16be,
  scoreDecodedText,
  decodeTextSmart,
  decodeTextWithEncoding,
  shiftLrcTimestamps,
  buildLrcPreservingHeaders,
  findLyricsForAudio
};
