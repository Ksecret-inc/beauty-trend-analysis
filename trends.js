import { trendScores } from './metrics.js';
import { $, esc, fmt, loadAll, renderShell, sparkline, tagFacts, baselineGrowth, sortableTable, csvButton, radio, tagHref } from './common.js';

const data = await loadAll({ need: 'trend' });
renderShell('index.html', data);

if (!data.state) {
  $('#rank').innerHTML = '<p class="empty">아직 수집된 표본이 없어요. 첫 수집이 끝나면 여기에 표시돼요.</p>';
} else {
  const base = baselineGrowth(data);
  const trackedMap = new Map(data.tracked.map(t => [t.tag, t]));
  const scoredTags = trendScores(data.state.tags, data.today);
  const scoredKw = trendScores(data.state.keywords || {}, data.today);

  const cats = [...new Set(Object.values(data.state.tags).flatMap(e => Object.keys(e.cats || {})))].sort((a, b) => a.localeCompare(b, 'ko'));
  $('#cat').insertAdjacentHTML('beforeend', cats.map(c => `<option>${esc(c)}</option>`).join(''));

  const rising = scoredTags.filter(s => s.score > 0);
  $('#kpis').innerHTML = [
    ['오늘 표본', fmt.n(data.state.sample?.posts), `영상 · 검색 ${data.state.sample?.searches ?? '–'}회`],
    ['급상승 해시태그', rising.length.toLocaleString('ko-KR'), '모멘텀 > 1, 크리에이터 3명 이상'],
    ['신규 해시태그', scoredTags.filter(s => s.isNew && s.eligible).length.toLocaleString('ko-KR'), '최근 7일 안에 처음 등장'],
    ['기준선 7일 성장', fmt.signed(base), '대형 태그 누적 영상 수 중앙값'],
  ].map(([l, v, n]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="note">${n}</div></div>`).join('');

  function rows() {
    const target = radio('target'), geo = radio('geo'), size = radio('size'), cat = $('#cat').value, onlyNew = $('#onlyNew').checked;
    const src = target === 'tags' ? scoredTags : scoredKw;
    return src
      .filter(s => s.eligible)
      .map(s => {
        const f = target === 'tags' ? tagFacts(s.key, data, base) : {};
        // 전 세계 보기: 미국 가중(0.6 + 0.4×미국 비중)을 걷어낸 점수
        const score = geo === 'all' ? s.score / (0.6 + 0.4 * s.usShare) : s.score;
        return { ...s, ...f, score, source: trackedMap.get(s.key)?.source };
      })
      .filter(r => (!cat || r.category === cat) && (!onlyNew || r.isNew) && (!size || r.size === size))
      .slice(0, 200);
  }

  function draw() {
    const target = radio('target');
    $('#rankTitle').textContent = target === 'tags' ? '급상승 해시태그' : '급상승 키워드';
    const list = rows();
    const cols = [
      { key: 'rank', label: '#', num: true, nosort: true, render: (r, i) => i + 1 },
      { key: 'key', label: target === 'tags' ? '해시태그' : '키워드', render: r => `<div class="chips">${target === 'tags' ? `<a class="tag" href="${tagHref(r.key)}">#${esc(r.key)}</a>` : `<span class="tag">${esc(r.key)}</span>`}${r.isNew ? '<span class="chip new">NEW</span>' : ''}${r.source === 'baseline' ? '<span class="chip base">기준선</span>' : ''}${r.size ? `<span class="chip size-${r.size}">${r.size}</span>` : ''}</div>` },
      { key: 'category', label: '카테고리', render: r => esc(r.category || '–') },
      { key: 'recentPosts', label: '최근 3일', num: true, render: r => `<div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">${sparkline(r.spark, { hot: r.score > 0 })}<span>${r.recentPosts}</span></div>` },
      { key: 'momentum', label: '모멘텀', num: true, render: r => `<span class="${r.momentum > 1 ? 'up' : 'muted'}">${fmt.x(r.momentum)}</span>` },
      { key: 'authors', label: '크리에이터', num: true },
      { key: 'usShare', label: '미국', num: true, render: r => `<span class="bar" title="미국 비중"><i style="width:${Math.round(r.usShare * 100)}%"></i></span> ${fmt.pct(r.usShare)}` },
    ];
    if (target === 'tags') {
      cols.push(
        { key: 'growth', label: '7일 성장', num: true, render: r => `<span class="${r.growth > 0 ? 'up' : 'muted'}">${fmt.signed(r.growth)}</span>` },
        { key: 'vsBase', label: '기준선 대비', num: true, render: r => (r.vsBase == null ? '–' : `<strong class="${r.vsBase > 1 ? 'up' : 'muted'}">${fmt.x(r.vsBase)}</strong>`) },
      );
    }
    cols.push({ key: 'score', label: '점수', num: true, render: r => r.score.toFixed(1) });
    sortableTable($('#rank'), cols, list, { sortKey: 'score', page: 30, empty: '조건에 맞는 항목이 없어요. 필터를 줄여 보세요.' });
  }

  // 기준선 표
  const baseRows = data.tracked.filter(t => t.source === 'baseline').map(t => ({ tag: t.tag, category: t.category, ...tagFacts(t.tag, data, base) }));
  sortableTable($('#baseline'), [
    { key: 'tag', label: '태그', render: r => `<a class="tag" href="${tagHref(r.tag)}">#${esc(r.tag)}</a>` },
    { key: 'videoCount', label: '누적 영상', num: true, render: r => fmt.n(r.videoCount) },
    { key: 'growth', label: '7일 성장', num: true, render: r => fmt.signed(r.growth) },
  ], baseRows, { sortKey: 'growth', empty: '기준선 합계가 2일 이상 쌓이면 표시돼요.' });

  csvButton($('#csv'), () => {
    const t = radio('target');
    return [['rank', t === 'tags' ? 'hashtag' : 'keyword', 'category', 'recent3d_posts', 'momentum', 'creators', 'us_share', 'growth_7d', 'vs_baseline', 'score', 'new', 'sample'],
      rows().sort((a, b) => b.score - a.score).map((r, i) => [i + 1, r.key, r.category || '', r.recentPosts, r.momentum.toFixed(2), r.authors, r.usShare.toFixed(3), r.growth ?? '', r.vsBase ?? '', r.score.toFixed(2), r.isNew, data.sample])];
  }, `trends_${data.today}.csv`);

  document.querySelectorAll('.filters input, .filters select').forEach(i => i.addEventListener('change', draw));
  draw();
}
