export function parseLyrics(raw) {
  if (!raw) return [];
  const text = `${raw}`.replace(/^\uFEFF/, '');
  return text
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!matches.length) return [];
      const content = line.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
      return matches.map((m) => {
        const time = Number(m[1]) * 60 + Number(m[2]);
        return { time, text: content };
      });
    })
    .sort((a, b) => a.time - b.time);
}

export function findActiveLyricIndex(lyricLines, time) {
  if (!lyricLines?.length) return -1;
  if (time < lyricLines[0].time) return -1;

  let lo = 0;
  let hi = lyricLines.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lyricLines[mid].time <= time) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
