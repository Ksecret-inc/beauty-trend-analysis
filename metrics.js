// 해시태그 일간 스냅샷(누적 video_count/view_count) → 주제별 증가량 계산.
// 브라우저와 node(테스트) 양쪽에서 쓰는 순수 함수만 둔다.

const DAY = 86400000;
const toDate = s => new Date(s + 'T00:00:00Z');
const fmt = d => d.toISOString().slice(0, 10);

// 누적 스냅샷 → 일간 증가량. 수집이 빠진 날은 증가분을 균등 분배(보간)하고,
// TikTok 집계 보정으로 누적값이 줄어든 날은 0으로 본다.
export function dailyDeltas(snapshots) {
  const s = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const gap = Math.round((toDate(s[i].date) - toDate(s[i - 1].date)) / DAY);
    if (gap < 1) continue;
    const views = Math.max(0, s[i].view_count - s[i - 1].view_count) / gap;
    const videos = Math.max(0, s[i].video_count - s[i - 1].video_count) / gap;
    for (let k = gap - 1; k >= 0; k--) {
      out.push({ date: fmt(new Date(toDate(s[i].date) - k * DAY)), views, videos, interpolated: k > 0 });
    }
  }
  return out;
}

// 주제 = 해시태그 묶음. 소속 해시태그의 일간 증가량을 날짜별로 합산.
export function topicSeries(topic, hashtagDaily) {
  const byDate = new Map();
  for (const tag of topic.hashtags) {
    for (const d of dailyDeltas(hashtagDaily[tag] || [])) {
      const cur = byDate.get(d.date) || { date: d.date, views: 0, videos: 0 };
      cur.views += d.views;
      cur.videos += d.videos;
      byDate.set(d.date, cur);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 기간 필터: 마지막 날짜(end) 포함 최근 days일.
export function lastDays(series, days, end) {
  const from = fmt(new Date(toDate(end) - (days - 1) * DAY));
  return series.filter(d => d.date >= from && d.date <= end);
}

// 주 단위(월요일 시작)로 묶기. days = 그 주에 들어간 날 수(7 미만이면 부분 주).
export function byWeek(series) {
  const m = new Map();
  for (const d of series) {
    const dt = toDate(d.date);
    const monday = fmt(new Date(dt - ((dt.getUTCDay() + 6) % 7) * DAY));
    const cur = m.get(monday) || { date: monday, views: 0, videos: 0, days: 0 };
    cur.views += d.views;
    cur.videos += d.videos;
    cur.days++;
    m.set(monday, cur);
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// 주제별 합계와 점유율(Share of Voice, 조회수 기준).
export function summarize(rows) {
  const total = rows.reduce((s, r) => s + r.views, 0);
  return rows
    .map(r => ({ ...r, share: total ? r.views / total : 0 }))
    .sort((a, b) => b.views - a.views)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

export function latestDate(hashtagDaily) {
  let max = '';
  for (const snaps of Object.values(hashtagDaily)) for (const s of snaps) if (s.date > max) max = s.date;
  return max || null;
}

// ---- 급상승·신규 판정 (표본 등장량 기반) ----
// store: { key: { first_seen, days: { 'YYYY-MM-DD': { posts, plays, authors, us } }, cats } }
// 최근 3일 평균 등장량을 그 전 14일 평균과 비교한다. 등장 크리에이터 수(폭)를 곱해
// 한 계정의 도배를 누르고, 미국 비중으로 가중한다(미국 우선).
export function trendScores(store, today, { recent = 3, base = 14 } = {}) {
  const t = toDate(today);
  const day = k => fmt(new Date(t - k * DAY));
  let earliest = today;
  for (const e of Object.values(store)) for (const d of Object.keys(e.days)) if (d < earliest) earliest = d;
  const historyDays = Math.round((t - toDate(earliest)) / DAY) + 1;

  const out = [];
  for (const [key, e] of Object.entries(store)) {
    let r = 0, b = 0, authors = 0, plays = 0, us = 0;
    const spark = [];
    for (let k = recent + base - 1; k >= 0; k--) {
      const d = e.days[day(k)];
      spark.push(d?.posts || 0);
      if (!d) continue;
      // 크리에이터 수는 날짜끼리 더하면 같은 계정이 중복되므로 하루 최대값(고유 계정 수의 하한)을 쓴다.
      if (k < recent) { r += d.posts; authors = Math.max(authors, d.authors); plays += d.plays; us += d.us; }
      else b += d.posts;
    }
    const recentAvg = r / recent, baseAvg = b / base;
    const momentum = (recentAvg + 0.5) / (baseAvg + 0.5);
    const usShare = r ? us / r : 0;
    const category = Object.entries(e.cats || {}).sort((x, y) => y[1] - x[1])[0]?.[0] || null;
    const isNew = historyDays >= 7 && e.first_seen > day(7);
    const eligible = authors >= 3 && r >= 2;
    const score = eligible ? Math.max(0, Math.log2(momentum)) * Math.sqrt(authors) * (0.6 + 0.4 * usShare) : 0;
    out.push({ key, score, momentum, recentPosts: r, authors, plays, usShare, isNew, eligible, category, first_seen: e.first_seen, spark });
  }
  out.sort((a, b) => b.score - a.score || b.recentPosts - a.recentPosts);
  return Object.assign(out, { historyDays });
}

// 해시태그 규모 등급 (TikTok 전체 영상 수 기준). 소형·중형이 "뻔하지 않은" 발견 대상.
export function sizeClass(videoCount) {
  if (videoCount == null) return null;
  if (videoCount < 50_000) return '소형';
  if (videoCount < 1_000_000) return '중형';
  return '대형';
}

// 누적 합계 기준 성장률: 최근 7일 영상 증가 / 7일 전 누적 (규모 대비 속도)
export function growthRate(snapshots, days = 7) {
  const s = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < 2) return null;
  const last = s.at(-1);
  const from = fmt(new Date(toDate(last.date) - days * DAY));
  const prev = [...s].reverse().find(x => x.date <= from) || s[0];
  if (prev === last || !prev.video_count) return null;
  const span = Math.round((toDate(last.date) - toDate(prev.date)) / DAY);
  return { videos: (last.video_count - prev.video_count) / prev.video_count, views: prev.view_count ? (last.view_count - prev.view_count) / prev.view_count : null, span };
}

export function toCSV(header, rows) {
  const esc = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header, ...rows].map(r => r.map(esc).join(',')).join('\n');
}
