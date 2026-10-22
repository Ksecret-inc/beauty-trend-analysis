import { trendScores, dailyDeltas } from './metrics.js';
import { $, esc, fmt, css, loadAll, renderShell, tagFacts, baselineGrowth, tagHref, tiktokVideo, isSampleId, radio } from './common.js';

const data = await loadAll({ need: 'trend' });
renderShell('hashtags.html', data);

const state = data.state || { tags: {}, top_posts: {}, related: {} };
const base = baselineGrowth(data);
const scores = new Map(trendScores(state.tags, data.today || '1970-01-01').map(s => [s.key, s]));
const trackedMap = new Map(data.tracked.map(t => [t.tag, t]));
const allTags = [...new Set([...Object.keys(state.tags), ...data.tracked.map(t => t.tag), ...Object.keys(data.daily)])];
const info = tag => ({ tag, ...tagFacts(tag, data, base), s: scores.get(tag), t: trackedMap.get(tag) });
const infos = new Map(allTags.map(t => [t, info(t)]));

function drawList() {
  const q = $('#q').value.trim().replace(/^#/, '').toLowerCase();
  const mode = radio('list'), sort = $('#sort').value;
  let list = [...infos.values()].filter(i => (mode === 'all' || i.t || data.daily[i.tag]) && (!q || i.tag.includes(q)));
  const by = {
    growth: (a, b) => (b.growth ?? -1) - (a.growth ?? -1),
    recent: (a, b) => (b.s?.recentPosts ?? 0) - (a.s?.recentPosts ?? 0),
    size: (a, b) => (b.videoCount ?? 0) - (a.videoCount ?? 0),
    name: (a, b) => a.tag.localeCompare(b.tag),
  }[sort];
  list = list.sort(by).slice(0, 300);
  const current = decodeURIComponent(location.hash.slice(1));
  $('#count').textContent = `${list.length.toLocaleString('ko-KR')}개${list.length === 300 ? ' (상위 300개만 표시)' : ''}`;
  $('#list').innerHTML = list.length ? list.map(i => `<li><a href="${tagHref(i.tag)}"${i.tag === current ? ' aria-current="true"' : ''}>
      <span>#${esc(i.tag)} ${i.s?.isNew ? '<span class="chip new">NEW</span>' : ''}${i.t?.source === 'baseline' ? ' <span class="chip base">기준선</span>' : ''}</span>
      <span class="num ${i.growth > 0 ? 'up' : 'muted'}">${sort === 'recent' ? (i.s?.recentPosts ?? 0) : sort === 'size' ? fmt.n(i.videoCount) : fmt.signed(i.growth)}</span></a></li>`).join('')
    : '<li class="empty">찾는 해시태그가 없어요. 추적 중이 아니면 "표본 전체"에서 찾아보세요.</li>';
}

let chart;
function drawDetail() {
  const tag = decodeURIComponent(location.hash.slice(1));
  const i = infos.get(tag);
  if (!tag || !i) {
    $('#detail').innerHTML = `<div class="empty">왼쪽 목록에서 해시태그를 고르세요.${tag ? `<br>#${esc(tag)}은(는) 아직 데이터가 없어요.` : ''}</div>`;
    return;
  }
  const s = i.s, posts = state.top_posts?.[tag] || [], rel = state.related?.[tag] || [];
  const chips = [
    s?.isNew && '<span class="chip new">NEW</span>',
    i.t?.source === 'baseline' && '<span class="chip base">기준선</span>',
    i.t?.source === 'discovered' && `<span class="chip">자동 추적 · ${esc(i.t.added)}부터</span>`,
    i.size && `<span class="chip size-${i.size}">${i.size}</span>`,
    s?.category && `<span class="chip">${esc(s.category)}</span>`,
    s && `<span class="chip">처음 발견 ${esc(s.first_seen)}</span>`,
  ].filter(Boolean).join('');
  $('#detail').innerHTML = `
    <div class="card-head"><h2>#${esc(tag)}</h2><a class="btn" href="https://www.tiktok.com/tag/${encodeURIComponent(tag)}" target="_blank" rel="noopener">TikTok에서 보기</a></div>
    <div class="chips" style="margin-bottom:12px">${chips}</div>
    <div class="kpis six" style="margin-bottom:16px">
      ${[['누적 영상', fmt.n(i.videoCount)], ['누적 조회', fmt.n(i.viewCount)], ['7일 영상 성장', fmt.signed(i.growth)], ['기준선 대비', fmt.x(i.vsBase)], ['최근 3일 표본 등장', s ? `${s.recentPosts}회 · ${s.authors}명` : '–'], ['미국 비중', fmt.pct(s?.usShare)]]
        .map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}
    </div>
    <h3>일간 증가 (TikTok 전체)</h3>
    ${data.daily[tag]?.length >= 2 ? '<div class="chart-wrap" style="height:220px"><canvas id="c" role="img" aria-label="일간 신규 영상과 조회수 증가 그래프"></canvas></div>' : '<p class="empty">누적 합계가 2일 이상 쌓이면 그래프가 나와요. 추적 대상이 아니면 수집되지 않아요.</p>'}
    <div class="grid-2" style="margin-top:16px">
      <div>
        <h3>오늘 표본의 인기 영상</h3>
        <div class="videos">${posts.length ? posts.map(p => `<div class="video">
            <div style="min-width:0"><div>${isSampleId(p) ? `@${esc(p.author)}` : `<a href="${tiktokVideo(p)}" target="_blank" rel="noopener">@${esc(p.author)}</a>`} <span class="chip">${esc(p.region || '?')}</span></div><div class="desc">${esc(p.desc)}</div></div>
            <div class="num">${fmt.n(p.plays)}회</div></div>`).join('') : '<p class="empty">오늘 표본에 이 태그 영상이 없어요.</p>'}</div>
      </div>
      <div>
        <h3>함께 쓰인 해시태그</h3>
        <div class="chips" style="margin-top:8px">${rel.length ? rel.map(([t, n]) => `<a class="chip" href="${tagHref(t)}">#${esc(t)} · ${n}</a>`).join('') : '<span class="muted">–</span>'}</div>
      </div>
    </div>`;
  if (chart) { chart.destroy(); chart = null; }
  if (data.daily[tag]?.length >= 2 && window.Chart) {
    const d = dailyDeltas(data.daily[tag]).slice(-60);
    const ink = css('--muted'), grid = css('--line');
    chart = new Chart($('#c'), {
      data: {
        labels: d.map(x => x.date.slice(5)),
        datasets: [
          { type: 'bar', label: '신규 영상', data: d.map(x => Math.round(x.videos)), backgroundColor: css('--c1'), yAxisID: 'y' },
          { type: 'line', label: '조회수 증가', data: d.map(x => Math.round(x.views)), borderColor: css('--c2'), borderDash: [5, 4], pointRadius: 0, tension: 0.25, yAxisID: 'y2' },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: ink, usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt.n(c.parsed.y)}` } } },
        scales: {
          x: { ticks: { color: ink, maxTicksLimit: 8 }, grid: { display: false } },
          y: { ticks: { color: ink, callback: v => fmt.n(v) }, grid: { color: grid }, beginAtZero: true, title: { display: true, text: '신규 영상', color: ink } },
          y2: { position: 'right', ticks: { color: ink, callback: v => fmt.n(v) }, grid: { display: false }, beginAtZero: true, title: { display: true, text: '조회수 증가', color: ink } },
        },
      },
    });
  }
}

$('#q').addEventListener('input', drawList);
document.querySelectorAll('input[name="list"], #sort').forEach(e => e.addEventListener('change', drawList));
window.addEventListener('hashchange', () => { drawList(); drawDetail(); });
if (!location.hash) {
  const first = [...infos.values()].filter(i => i.t?.source === 'discovered').sort((a, b) => (b.growth ?? -1) - (a.growth ?? -1))[0];
  if (first) history.replaceState(null, '', tagHref(first.tag));
}
drawList();
const start = () => drawDetail();
if (window.Chart) start(); else window.addEventListener('load', start);
