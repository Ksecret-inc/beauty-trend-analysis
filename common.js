// 모든 화면 공통: 상단 내비, 데이터 로드(실제/샘플), 숫자 표기, 스파크라인, 정렬 표, CSV.
import { trendScores, growthRate, sizeClass, toCSV } from './metrics.js';

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nfC = new Intl.NumberFormat('ko-KR', { notation: 'compact', maximumFractionDigits: 1 });
const nfP = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 });
export const fmt = {
  n: v => (v == null || !Number.isFinite(v) ? '–' : nfC.format(v)),
  pct: v => (v == null || !Number.isFinite(v) ? '–' : nfP.format(v)),
  signed: v => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : '') + nfP.format(v)),
  x: v => (v == null || !Number.isFinite(v) ? '–' : `×${v >= 10 ? Math.round(v) : v.toFixed(1)}`),
};
export const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const COLORS = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'];
export const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();
export const tagHref = t => `hashtags.html#${encodeURIComponent(t)}`;

const PAGES = [
  ['index.html', '트렌드'],
  ['hashtags.html', '해시태그 탐색'],
  ['industry.html', '업계 인사이트'],
  ['listening.html', '리스닝 보드'],
];
const LOGO = '<img src="assets/ksecret-logo.png" alt="케이시크릿" width="134" height="32">';

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
};

async function getJSON(path) {
  try {
    const res = await fetch(path, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// 실제 데이터가 충분하지 않으면(급상승 판정은 7일, 합계 추이는 2일) 샘플을 기본으로 보여준다.
export async function loadAll({ need = 'trend' } = {}) {
  const [state, tracked, daily, topics] = await Promise.all(['trend_state', 'tracked', 'hashtag_daily', 'topics'].map(f => getJSON(`data/${f}.json`)));
  const today = state?.updated || Object.values(daily || {}).flat().map(s => s.date).sort().at(-1) || null;
  const realDays = state && today ? trendScores(state.tags, today).historyDays : 0;
  const dailyDays = daily ? Math.max(0, ...Object.values(daily).map(s => s.length)) : 0;
  const enough = need === 'trend' ? realDays >= 7 : dailyDays >= 2;
  const pref = store.get('dataMode'); // 'real' | 'sample' | null
  const useSample = pref ? pref === 'sample' : !enough;
  let data = { state, tracked: tracked || [], daily: daily || {}, topics: topics || [] };
  if (useSample) {
    const [s, t, d] = await Promise.all(['sample_trend_state', 'sample_tracked', 'sample_hashtag_daily'].map(f => getJSON(`data/${f}.json`)));
    data = { state: s, tracked: t || [], daily: d || {}, topics: topics || [] };
  }
  const day = data.state?.updated || Object.values(data.daily).flat().map(s => s.date).sort().at(-1);
  return { ...data, today: day, sample: useSample, realDays, dailyDays, enough };
}

export function renderShell(active, info) {
  const nav = PAGES.map(([href, label]) => `<a href="${href}"${href === active ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const status = info.sample
    ? `<span class="dot-sample" aria-hidden="true"></span>샘플 데이터`
    : `<span class="dot-live" aria-hidden="true"></span>실제 데이터 · ${esc(info.today || '')} 기준`;
  document.querySelector('#shell').innerHTML = `
    <header class="topbar"><div class="wrap">
      <a class="brand" href="index.html">${LOGO}<span class="brand-name">숏폼 Beauty trend analysis</span></a>
      <nav class="nav" aria-label="화면">${nav}</nav>
      <div class="datastatus" role="status">${status}</div>
    </div></header>`;
  const banner = document.querySelector('#banner');
  if (!banner) return;
  const days = info.realDays;
  if (info.sample) {
    banner.innerHTML = `<span>지금 보이는 숫자는 <strong>화면 확인용 샘플</strong>이에요. 실제 데이터는 ${days ? `${days}일째` : '오늘부터'} 쌓이는 중이고, 급상승 판정은 약 14일 뒤부터 안정돼요.</span>
      <button class="btn" type="button" id="toReal">실제 데이터 보기</button>`;
    banner.hidden = false;
    banner.querySelector('#toReal').onclick = () => { store.set('dataMode', 'real'); location.reload(); };
  } else if (!info.enough) {
    banner.innerHTML = `<span>실제 데이터 ${days}일째예요. 비교할 과거가 짧아서 지금은 <strong>등장량이 많은 태그가 위로</strong> 와요.</span>
      <button class="btn" type="button" id="toSample">샘플로 화면 보기</button>`;
    banner.hidden = false;
    banner.querySelector('#toSample').onclick = () => { store.set('dataMode', 'sample'); location.reload(); };
  }
}

export function sparkline(values, { w = 88, h = 22, hot = false } = {}) {
  if (!values?.length) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  const last = pts.split(' ').at(-1).split(',');
  return `<svg class="spark${hot ? ' hot' : ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="currentColor"/></svg>`;
}

// 해시태그 1개에 대한 파생 지표 (규모, 7일 성장률, 기준선 대비)
export function tagFacts(tag, data, baselineGrowth) {
  const snaps = data.daily[tag] || [];
  const last = snaps.at(-1);
  const g = growthRate(snaps);
  return {
    videoCount: last?.video_count ?? null,
    viewCount: last?.view_count ?? null,
    size: sizeClass(last?.video_count),
    growth: g?.videos ?? null,
    vsBase: g?.videos != null && baselineGrowth > 0 ? g.videos / baselineGrowth : null,
  };
}

export function baselineGrowth(data) {
  const vals = data.tracked.filter(t => t.source === 'baseline').map(t => growthRate(data.daily[t.tag] || [])?.videos).filter(v => v != null).sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length / 2)] : null;
}

// 정렬 가능한 표. columns: [{key, label, num?, render(row), sort?(row)}]
export function sortableTable(el, columns, rows, { sortKey, desc = true, empty = '해당하는 항목이 없어요.', page = 0 } = {}) {
  let key = sortKey, d = desc, shown = page || Infinity;
  const draw = () => {
    const col = columns.find(c => c.key === key);
    const val = r => (col?.sort ? col.sort(r) : r[key]);
    const sorted = col ? [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * (d ? -1 : 1);
    }) : rows;
    const visible = sorted.slice(0, shown);
    el.innerHTML = `<table><thead><tr>${columns.map(c => `<th scope="col" class="${c.num ? 'num' : ''}"${c.key === key ? ` aria-sort="${d ? 'descending' : 'ascending'}"` : ''}>${c.nosort ? c.label : `<button type="button" data-k="${c.key}">${c.label}</button>`}</th>`).join('')}</tr></thead>
      <tbody>${visible.length ? visible.map((r, i) => `<tr>${columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r, i) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">${empty}</td></tr>`}</tbody></table>
      ${sorted.length > shown ? `<div class="more"><button type="button" class="btn" data-more>더 보기 (${shown}/${sorted.length})</button></div>` : ''}`;
    el.querySelectorAll('th button').forEach(b => (b.onclick = () => { d = b.dataset.k === key ? !d : true; key = b.dataset.k; draw(); el.querySelector(`th button[data-k="${key}"]`)?.focus(); }));
    const more = el.querySelector('[data-more]');
    if (more) more.onclick = () => { shown += page; draw(); };
  };
  draw();
}

// CSV: 일반 호스팅은 파일 다운로드, 아티팩트(iframe)는 다운로드가 막혀 클립보드 복사.
export function csvButton(btn, build, filename) {
  btn.textContent = inFrame ? 'CSV 복사' : 'CSV 내려받기';
  btn.onclick = () => {
    const [header, rows] = build();
    const csv = toCSV(header, rows);
    if (inFrame) {
      navigator.clipboard.writeText(csv).then(
        () => { btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = 'CSV 복사'), 1800); },
        () => { btn.textContent = '복사가 막혔어요'; }
      );
      return;
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: filename });
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

export const radio = name => document.querySelector(`input[name="${name}"]:checked`)?.value;
export const tiktokVideo = p => `https://www.tiktok.com/@${encodeURIComponent(p.author)}/video/${encodeURIComponent(p.id)}`;
export const isSampleId = p => String(p.id).startsWith('sample');
