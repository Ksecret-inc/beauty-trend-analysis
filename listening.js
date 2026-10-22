import { topicSeries, lastDays, byWeek, summarize, latestDate, dailyDeltas } from './metrics.js';
import { $, esc, fmt, css, COLORS, loadAll, renderShell, sparkline, tagFacts, baselineGrowth, sortableTable, csvButton, radio, tagHref } from './common.js';

const data = await loadAll({ need: 'daily' });
renderShell('listening.html', data);
const hidden = new Set();
let chart;

// ---- 자동 감지 급상승 추적 ----
const base = baselineGrowth(data);
const auto = data.tracked.filter(t => t.source === 'discovered').map(t => {
  const f = tagFacts(t.tag, data, base);
  const d = dailyDeltas(data.daily[t.tag] || []).slice(-14).map(x => x.videos);
  return { tag: t.tag, category: t.category, added: t.added, spark: d, ...f };
});
sortableTable($('#auto'), [
  { key: 'tag', label: '해시태그', render: r => `<div class="chips"><a class="tag" href="${tagHref(r.tag)}">#${esc(r.tag)}</a>${r.size ? `<span class="chip size-${r.size}">${r.size}</span>` : ''}</div>` },
  { key: 'category', label: '카테고리', render: r => esc(r.category || '–') },
  { key: 'added', label: '추적 시작' },
  { key: 'videoCount', label: '누적 영상', num: true, render: r => fmt.n(r.videoCount) },
  { key: 'spark', label: '최근 14일 신규 영상', nosort: true, render: r => sparkline(r.spark, { hot: r.vsBase > 1 }) },
  { key: 'growth', label: '7일 성장', num: true, render: r => `<span class="${r.growth > 0 ? 'up' : 'muted'}">${fmt.signed(r.growth)}</span>` },
  { key: 'vsBase', label: '기준선 대비', num: true, render: r => (r.vsBase == null ? '–' : `<strong class="${r.vsBase > 1 ? 'up' : 'muted'}">${fmt.x(r.vsBase)}</strong>`) },
], auto, { sortKey: 'vsBase', empty: '아직 자동 추적 중인 태그가 없어요. 발견 엔진이 매일 최대 30개씩 추가해요.' });

// ---- 내 주제 ----
function compute() {
  const end = latestDate(data.daily);
  const days = Number(radio('range')), unit = radio('unit'), metric = radio('metric');
  const series = data.topics.map((t, i) => {
    const s = lastDays(topicSeries(t, data.daily), days, end);
    return { ...t, color: css(COLORS[i % COLORS.length]), points: unit === 'week' ? byWeek(s).filter(w => w.days === 7) : s,
      views: s.reduce((a, d) => a + d.views, 0), videos: s.reduce((a, d) => a + d.videos, 0) };
  });
  return { end, days, unit, metric, series, ranked: summarize(series) };
}

function draw() {
  const v = compute();
  const views = v.ranked.reduce((a, r) => a + r.views, 0), videos = v.ranked.reduce((a, r) => a + r.videos, 0);
  $('#kpis').innerHTML = [
    ['조회수 증가', fmt.n(views), `최근 ${v.days}일 합계`], ['신규 영상', fmt.n(videos), `최근 ${v.days}일 합계`],
    ['1위 주제', v.ranked[0]?.name || '–', v.ranked[0] ? `점유율 ${fmt.pct(v.ranked[0].share)}` : ''], ['최근 수집일', v.end || '–', '매일 06:00 KST'],
  ].map(([l, val, n]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${esc(val)}</div><div class="note">${n}</div></div>`).join('');

  sortableTable($('#rows'), [
    { key: 'show', label: '<span class="sr">그래프 표시</span>', nosort: true, render: r => `<input type="checkbox" data-id="${esc(r.id)}" ${hidden.has(r.id) ? '' : 'checked'} aria-label="${esc(r.name)} 그래프에 표시">` },
    { key: 'name', label: '주제', render: r => `<div class="chips"><span style="width:8px;height:8px;border-radius:50%;background:${r.color};align-self:center" aria-hidden="true"></span><span>${esc(r.name)}</span><span class="muted">${r.hashtags.map(h => `<a class="tag" style="font-weight:400" href="${tagHref(h)}">#${esc(h)}</a>`).join(' ')}</span></div>` },
    { key: 'views', label: '조회수 증가', num: true, render: r => fmt.n(r.views) },
    { key: 'videos', label: '신규 영상', num: true, render: r => fmt.n(r.videos) },
    { key: 'share', label: '점유율', num: true, render: r => fmt.pct(r.share) },
  ], v.ranked, { sortKey: 'views' });

  $('#chartTitle').textContent = `내 주제 ${v.metric === 'views' ? '조회수 증가' : '신규 영상'} (${v.unit === 'week' ? '주' : '일'} 단위)`;
  const labels = [...new Set(v.series.flatMap(s => s.points.map(p => p.date)))].sort();
  const dashes = [[], [6, 4], [2, 3], [8, 3, 2, 3]]; // 색만으로 구분하지 않도록 선 모양도 다르게
  const datasets = v.series.filter(s => !hidden.has(s.id)).map((s, i) => {
    const m = new Map(s.points.map(p => [p.date, p[v.metric]]));
    return { label: s.name, data: labels.map(d => m.get(d) ?? null), borderColor: s.color, backgroundColor: s.color, borderDash: dashes[i % dashes.length], tension: 0.25, pointRadius: v.unit === 'week' ? 3 : 0, borderWidth: 2 };
  });
  const ink = css('--muted'), grid = css('--line');
  if (chart) { chart.data = { labels, datasets }; chart.update(); return; }
  chart = new Chart($('#chart'), {
    type: 'line', data: { labels, datasets },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { color: ink, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt.n(c.parsed.y)}` } } },
      scales: { x: { ticks: { color: ink, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: ink, callback: x => fmt.n(x) }, grid: { color: grid }, beginAtZero: true } },
    },
  });
}

csvButton($('#csv'), () => {
  const v = compute();
  return [['rank', 'topic', 'hashtags', 'views_gain', 'new_videos', 'share', 'period_days', 'end_date', 'sample'],
    v.ranked.map(r => [r.rank, r.name, r.hashtags.join(' '), Math.round(r.views), Math.round(r.videos), r.share.toFixed(4), v.days, v.end, data.sample])];
}, `topics_${data.today}.csv`);

$('#rows').addEventListener('change', e => {
  const id = e.target.dataset?.id;
  if (!id) return;
  e.target.checked ? hidden.delete(id) : hidden.add(id);
  draw();
});
document.querySelectorAll('.filters input').forEach(i => i.addEventListener('change', draw));
if (window.Chart) draw(); else window.addEventListener('load', draw);
