import { trendScores } from './metrics.js';
import { $, esc, fmt, css, COLORS, loadAll, renderShell, sparkline, sortableTable, csvButton, radio, tagHref, tiktokVideo, isSampleId } from './common.js';

const data = await loadAll({ need: 'trend' });
renderShell('industry.html', data);
const state = data.state;

const DAY = 86400000;
const day = k => new Date(Date.parse(data.today) - k * DAY).toISOString().slice(0, 10);
const sum = (e, from, to, m) => { let s = 0, us = 0, posts = 0; for (let k = from; k <= to; k++) { const d = e.days[day(k)]; if (d) { s += d[m]; us += d.us; posts += d.posts; } } return { v: s, us, posts }; };

function catRows(metric) {
  const cats = Object.entries(state?.categories || {});
  const rows = cats.map(([c, e]) => {
    const now = sum(e, 0, 6, metric), prev = sum(e, 7, 13, metric);
    return { cat: c, now: now.v, prev: prev.v, change: prev.v ? now.v / prev.v - 1 : null, us: now.posts ? Math.min(1, now.us / now.posts) : null, spark: Array.from({ length: 14 }, (_, i) => e.days[day(13 - i)]?.[metric] || 0) };
  });
  const tNow = rows.reduce((a, r) => a + r.now, 0), tPrev = rows.reduce((a, r) => a + r.prev, 0);
  return rows.map(r => ({ ...r, share: tNow ? r.now / tNow : 0, sharePrev: tPrev ? r.prev / tPrev : 0 }));
}

let chart;
function draw() {
  const metric = radio('metric');
  const rows = catRows(metric).sort((a, b) => b.now - a.now);
  const label = metric === 'posts' ? '영상' : '조회';

  $('#kpis').innerHTML = rows.slice(0, 8).map((r, i) => `<div class="kpi">
      <div class="label" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(r.cat)}</span><span class="${r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'muted'}">${fmt.signed(r.change)}</span></div>
      <div class="value">${fmt.n(r.now)}</div>
      <div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>7일 ${label} · 점유 ${fmt.pct(r.share)}</span>${sparkline(r.spark, { w: 64, h: 18, hot: r.change > 0.15 })}</div>
    </div>`).join('') || '<p class="empty">카테고리 데이터가 아직 없어요.</p>';

  sortableTable($('#catTable'), [
    { key: 'cat', label: '카테고리' },
    { key: 'now', label: `7일 ${label}`, num: true, render: r => fmt.n(r.now) },
    { key: 'change', label: '지난주 대비', num: true, render: r => `<span class="${r.change > 0 ? 'up' : r.change < 0 ? 'down' : 'muted'}">${fmt.signed(r.change)}</span>` },
    { key: 'share', label: '점유율', num: true, render: r => fmt.pct(r.share) },
    { key: 'us', label: '미국', num: true, render: r => fmt.pct(r.us) },
  ], rows, { sortKey: 'now' });

  const ink = css('--muted'), grid = css('--line');
  const cfg = {
    type: 'bar',
    data: {
      labels: rows.map(r => r.cat),
      datasets: [
        { label: '이번 주', data: rows.map(r => +(r.share * 100).toFixed(1)), backgroundColor: css('--c1') },
        { label: '지난주', data: rows.map(r => +(r.sharePrev * 100).toFixed(1)), backgroundColor: 'transparent', borderColor: css('--c1'), borderWidth: 1.5, borderDash: [4, 3] },
      ],
    },
    options: {
      indexAxis: 'y', maintainAspectRatio: false,
      plugins: { legend: { labels: { color: ink, boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x}%` } } },
      scales: { x: { ticks: { color: ink, callback: v => `${v}%` }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { display: false } } },
    },
  };
  if (chart) { chart.data = cfg.data; chart.update(); } else if (window.Chart) chart = new Chart($('#share'), cfg);

  csvButton($('#csv'), () => [['category', `${metric}_7d`, `${metric}_prev7d`, 'change', 'share', 'us_share', 'sample'],
    rows.map(r => [r.cat, r.now, r.prev, r.change ?? '', r.share.toFixed(4), r.us ?? '', data.sample])], `industry_${data.today}.csv`);
}

function drawStatic() {
  // 카테고리별 급상승 태그
  const scored = trendScores(state.tags, data.today).filter(s => s.eligible && s.score > 0);
  const cats = Object.keys(state.categories || {});
  $('#catTags').innerHTML = cats.map((c, i) => {
    const top = scored.filter(s => s.category === c).slice(0, 4);
    return `<div class="card" style="padding:12px">
      <h3 style="display:flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${css(COLORS[i % COLORS.length])}" aria-hidden="true"></span>${esc(c)}</h3>
      <ol style="margin:8px 0 0;padding-left:18px;font-size:13px;display:grid;gap:4px">${top.length ? top.map(s => `<li><a class="tag" href="${tagHref(s.key)}">#${esc(s.key)}</a> <span class="up">${fmt.x(s.momentum)}</span>${s.isNew ? ' <span class="chip new">NEW</span>' : ''}</li>`).join('') : '<li class="muted" style="list-style:none;margin-left:-18px">급상승 태그 없음</li>'}</ol>
    </div>`;
  }).join('');

  // 크리에이터: 오늘 해시태그별 인기 영상에 든 횟수
  const m = new Map();
  for (const [tag, posts] of Object.entries(state.top_posts || {})) for (const p of posts) {
    if (p.date !== data.today) continue;
    const c = m.get(p.author) || { author: p.author, region: p.region, hits: 0, plays: 0, tags: new Set(), top: p };
    c.hits++; c.plays = Math.max(c.plays, p.plays); c.tags.add(tag); if (p.plays > c.top.plays) c.top = p;
    m.set(p.author, c);
  }
  const creators = [...m.values()].filter(c => c.author).map(c => ({ ...c, tagList: [...c.tags].slice(0, 4) }));
  sortableTable($('#creators'), [
    { key: 'author', label: '크리에이터', render: r => (isSampleId(r.top) ? `@${esc(r.author)}` : `<a href="https://www.tiktok.com/@${encodeURIComponent(r.author)}" target="_blank" rel="noopener">@${esc(r.author)}</a>`) },
    { key: 'region', label: '지역', render: r => esc(r.region || '?') },
    { key: 'hits', label: '등장 횟수', num: true },
    { key: 'plays', label: '최고 조회', num: true, render: r => (isSampleId(r.top) ? fmt.n(r.plays) : `<a href="${tiktokVideo(r.top)}" target="_blank" rel="noopener">${fmt.n(r.plays)}</a>`) },
    { key: 'tags', label: '해시태그', nosort: true, render: r => `<div class="chips">${r.tagList.map(t => `<a class="chip" href="${tagHref(t)}">#${esc(t)}</a>`).join('')}</div>` },
  ], creators.sort((a, b) => b.hits - a.hits).slice(0, 50), { sortKey: 'hits', page: 10, empty: '오늘 표본의 크리에이터 데이터가 없어요.' });
}

if (!state) {
  $('#kpis').innerHTML = '<p class="empty">아직 수집된 표본이 없어요.</p>';
} else {
  document.querySelectorAll('input[name="metric"]').forEach(i => i.addEventListener('change', draw));
  const start = () => { draw(); drawStatic(); };
  if (window.Chart) start(); else window.addEventListener('load', start);
}
