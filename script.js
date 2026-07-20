// SiteForge - 건설 견적·관리 시뮬레이터. 음성 로그 + 가상 크레딧 견적/진행 관리.
let wallet = null;
let balance = 1420;
let credits = 680;
let projects = JSON.parse(localStorage.getItem('p14_projects') || '[]');
let logs = JSON.parse(localStorage.getItem('p14_logs') || '[]');
let codex = JSON.parse(localStorage.getItem('p14_codex') || '[]');
let map;

// === CONSTRUCTION CORE: cost catalog (Credits, fictional pricing) ===
// Real estimating needs a real unit-cost book. Each item = {unit cost, kind, unit}.
const COST_CATALOG = {
  material: [
    { id: 'concrete',  name: 'Concrete (ready-mix)', unit: 'm³',  cost: 130 },
    { id: 'rebar',     name: 'Rebar (steel)',        unit: 'ton', cost: 900 },
    { id: 'steelbeam', name: 'Steel Beam',           unit: 'ton', cost: 1200 },
    { id: 'brick',     name: 'Brick / Block',        unit: 'm²',  cost: 45 },
    { id: 'lumber',    name: 'Lumber / Formwork',    unit: 'm²',  cost: 38 },
    { id: 'glass',     name: 'Glazing / Curtain',    unit: 'm²',  cost: 210 },
    { id: 'insulation',name: 'Insulation',           unit: 'm²',  cost: 22 },
    { id: 'finishing', name: 'Interior Finishing',   unit: 'm²',  cost: 95 }
  ],
  labor: [
    { id: 'general',   name: 'General Laborer',      unit: 'hr', cost: 28 },
    { id: 'carpenter', name: 'Carpenter',            unit: 'hr', cost: 45 },
    { id: 'ironworker',name: 'Ironworker',           unit: 'hr', cost: 58 },
    { id: 'electrician',name:'Electrician',          unit: 'hr', cost: 62 },
    { id: 'plumber',   name: 'Plumber',              unit: 'hr', cost: 55 },
    { id: 'operator',  name: 'Equipment Operator',   unit: 'hr', cost: 68 },
    { id: 'foreman',   name: 'Site Foreman',         unit: 'hr', cost: 75 }
  ]
};
function catalogItem(kind, id) {
  return (COST_CATALOG[kind] || []).find(i => i.id === id);
}

// Estimate settings (real construction markups; adjustable per project)
const ESTIMATE_DEFAULTS = { overheadPct: 10, marginPct: 12, taxPct: 10, contingencyPct: 5 };

// Draft estimate the user is currently building (line items) — persisted so it survives reload
let draftEstimate = JSON.parse(localStorage.getItem('p14_draft_estimate') || 'null')
  || { title: '', location: '', durationDays: 90, floorArea: 0, lineItems: [], settings: { ...ESTIMATE_DEFAULTS } };
function saveDraft() { localStorage.setItem('p14_draft_estimate', JSON.stringify(draftEstimate)); }

// Pure function: compute a full itemized estimate from line items + settings.
// Returns every intermediate so the UI can show a real, auditable breakdown.
function computeEstimate(est) {
  const s = { ...ESTIMATE_DEFAULTS, ...(est.settings || {}) };
  let materialCost = 0, laborCost = 0, laborHours = 0;
  const rows = (est.lineItems || []).map(li => {
    const cat = catalogItem(li.kind, li.itemId);
    if (!cat) return null;
    const qty = Number(li.qty) || 0;
    const line = +(qty * cat.cost).toFixed(2);
    if (li.kind === 'material') materialCost += line;
    else { laborCost += line; laborHours += qty; }
    return { kind: li.kind, name: cat.name, unit: cat.unit, qty, unitCost: cat.cost, line };
  }).filter(Boolean);

  const direct = +(materialCost + laborCost).toFixed(2);
  const overhead   = +(direct * s.overheadPct   / 100).toFixed(2);
  const contingency= +(direct * s.contingencyPct/ 100).toFixed(2);
  const preMargin  = +(direct + overhead + contingency).toFixed(2);
  const margin     = +(preMargin * s.marginPct / 100).toFixed(2);
  const preTax     = +(preMargin + margin).toFixed(2);
  const tax        = +(preTax * s.taxPct / 100).toFixed(2);
  const total      = +(preTax + tax).toFixed(2);

  // Derived estimating metrics an estimator actually reads:
  //  - labor share of direct cost (a real bid-health signal; >55% often flags labor-heavy scope)
  //  - burdened markup the total carries over raw direct cost
  //  - cost per calendar day and per m² of built area (floorArea, if the user provides one)
  const laborShare = direct ? +(laborCost / direct * 100).toFixed(1) : 0;
  const markupPct  = direct ? +((total - direct) / direct * 100).toFixed(1) : 0;
  const days       = Number(est.durationDays) || 0;
  const area       = Number(est.floorArea) || 0;
  const costPerDay = days  ? Math.round(total / days) : 0;
  const costPerM2  = area  ? Math.round(total / area) : 0;

  return { rows, materialCost:+materialCost.toFixed(2), laborCost:+laborCost.toFixed(2),
           laborHours, direct, overhead, contingency, margin, tax, total, settings: s,
           laborShare, markupPct, costPerDay, costPerM2, days, area };
}

// User-facing Korean labels for internal status codes
function statusLabel(s) {
  return { bidding: '입찰 중', 'in-progress': '진행 중', completed: '완료' }[s] || s;
}

function updateWallet() {
  const el = document.getElementById('wallet-info');
  if (!el) return;
  const addr = wallet || '게스트';
  el.innerHTML =
    `<span class="addr">${addr}</span>` +
    `<span class="bal">${credits.toLocaleString()}<span class="unit"> 크레딧</span></span>`;
}

function connectWallet() {
  wallet = '계정-' + Math.random().toString(16).slice(2, 8);
  updateWallet();
}

function initMap() {
  // Sites map: Leaflet if the CDN loaded, otherwise a graceful text fallback
  const mapEl = document.getElementById('map');
  if (!mapEl || map) return; // guard double-init
  if (typeof L !== 'undefined') {
    map = L.map('map').setView([37.5, 127], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
  } else {
    mapEl.innerHTML = '<p style="text-align:center;color:#8b6f47;padding-top:70px;">Seoul-area build sites (map offline)</p>';
  }
}

function recordVoiceLog() {
  const preview = document.getElementById('voice-preview');
  preview.innerHTML = '음성 로그 녹음 중...';

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const rec = new MediaRecorder(stream);
    let chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, {type:'audio/webm'});
      const url = URL.createObjectURL(blob);
      
      let surprise = 0.3;
      if (window.getP6LungSurprise) surprise = window.getP6LungSurprise();
      window.p14CurrentSurprise = surprise; // feeds priority + payout weighting

      preview.innerHTML = `<audio controls src="${url}"></audio><br>긴급도: ${surprise.toFixed(2)} — 로그 우선순위가 반영됩니다.`;
      window._p14Voice = { url, surprise };

      // Auto add log + refresh preview
      addLog('현장 보고', `음성 로그 · 긴급도 ${surprise.toFixed(2)}`, surprise);
      addToCodex(`음성 로그 기록 · 긴급도 ${surprise.toFixed(2)}.`);
      updatePreviewFromCodex();
      stream.getTracks().forEach(t => t.stop());
    };
    rec.start();
    setTimeout(() => rec.stop(), 4000);
  }).catch(() => {
    preview.innerHTML = '마이크를 사용할 수 없어 기본 로그로 기록합니다. 긴급도 0.65';
    window._p14Voice = { surprise: 0.65 };
    window.p14CurrentSurprise = 0.65;
    addLog('현장 보고', '기본 음성 로그', 0.65);
    addToCodex('음성 로그 기록(기본).');
    updatePreviewFromCodex();
  });
}

function addLog(title, desc, surprise = 0.3) {
  const log = {
    id: Date.now(),
    title,
    desc,
    surprise,
    voiceUrl: window._p14Voice ? window._p14Voice.url : null,
    timestamp: new Date().toISOString()
  };
  logs.unshift(log);
  localStorage.setItem('p14_logs', JSON.stringify(logs));

  addToCodex(`${title}: ${desc}. 긴급도 ${surprise}.`);
  updateUI();
}

// === Completion payout (priority score adjusts the credited amount) ===
function harvestSurprisePay(proj) {
  const s = window.p14CurrentSurprise || proj.surprise || 0.4;
  const multiplier = 1 + (s * 0.8);
  const payout = Math.floor(proj.budget * 0.12 * multiplier); // fictional credits
  credits += payout;
  updateWallet();
  addToCodex(`완료 정산: +${payout} 크레딧 (긴급도 반영 x${multiplier.toFixed(2)}).`);
  return payout;
}

function completeProject(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj) return;
  const payout = harvestSurprisePay(proj);
  proj.status = 'completed';
  ensurePhases(proj);
  proj.phases.forEach(p => p.pct = 100); // real 100% roll-up on completion
  localStorage.setItem('p14_projects', JSON.stringify(projects));
  alert(`프로젝트 완료(100%)! 정산 크레딧 ${payout.toLocaleString()} (긴급도 반영).`);
  if (openProjectId === projId && !document.getElementById('project-detail').classList.contains('hidden')) {
    renderProjectDetail();
  } else {
    showDashboard();
  }
}

// === Notes feed the virtual build preview (avg priority → build height/glow) ===
function updatePreviewFromCodex() {
  const viz = document.getElementById('build-preview');
  const meta = document.getElementById('preview-meta');
  if (!viz || !meta || !codex.length) return;

  const avgSurprise = codex.reduce((a,c) => a + (parseFloat(c.note.match(/긴급도 ([\d.]+)/)?.[1] ?? c.note.match(/surprise ([\d.]+)/)?.[1]) || 0.4), 0) / codex.length;
  const height = Math.max(30, Math.min(110, 30 + avgSurprise * 90));
  const aura = Math.floor(avgSurprise * 100);

  viz.style.height = height + 'px';
  viz.style.boxShadow = `0 0 ${8 + aura/5}px #c5a46e`;

  meta.innerHTML = `노트 평균 긴급도: ${avgSurprise.toFixed(2)} → 미리보기 높이 +${Math.floor((height-30)/1.2)}% · 강조 ${aura}%.`;
}

function showPreview() {
  hideAll('preview');
  document.getElementById('preview').classList.remove('hidden');
  updatePreviewFromCodex();
}

function liveTourPreview() {
  const s = window.p14CurrentSurprise || 0.5;
  const meta = document.getElementById('preview-meta');
  meta.innerHTML += `<br>라이브 투어 진행 중 · 음성 긴급도 ${s.toFixed(2)} 반영. (시뮬레이션)`;
  if (window.p14CurrentSurprise > 0.5) {
    addToCodex(`라이브 투어: 높은 긴급도로 미리보기가 갱신됨.`);
    updatePreviewFromCodex();
  }
}

// === CONSTRUCTION CORE: real progress model ===
// Every project carries construction phases with a weight (share of total scope)
// and a 0..100 percent-complete. Overall progress = weighted roll-up. Real, deterministic.
const DEFAULT_PHASES = [
  { key: 'sitework',   name: 'Site Prep & Excavation', weight: 10, pct: 0 },
  { key: 'foundation', name: 'Foundation',             weight: 20, pct: 0 },
  { key: 'structure',  name: 'Structure & Framing',    weight: 30, pct: 0 },
  { key: 'envelope',   name: 'Envelope & Roofing',     weight: 15, pct: 0 },
  { key: 'mep',        name: 'MEP (Elec/Plumb/HVAC)',  weight: 15, pct: 0 },
  { key: 'finishing',  name: 'Interior Finishing',     weight: 10, pct: 0 }
];
function freshPhases() { return DEFAULT_PHASES.map(p => ({ ...p })); }

// Weighted overall completion (0..100). Guards against missing/empty phases.
function projectProgress(proj) {
  const ph = proj.phases;
  if (!Array.isArray(ph) || ph.length === 0) return proj.status === 'completed' ? 100 : 0;
  const totW = ph.reduce((a, p) => a + (Number(p.weight) || 0), 0) || 1;
  const done = ph.reduce((a, p) => a + (Number(p.weight) || 0) * (Number(p.pct) || 0), 0);
  return +(done / totW).toFixed(1);
}
// Cost earned-to-date = budget × overall progress (earned value, real PM metric)
function earnedValue(proj) {
  return Math.round((proj.budget || 0) * projectProgress(proj) / 100);
}

// Backfill phases onto any legacy/seeded project so progress always works
function ensurePhases(proj) {
  if (!Array.isArray(proj.phases)) {
    proj.phases = freshPhases();
    if (proj.status === 'completed') proj.phases.forEach(p => p.pct = 100);
  }
  return proj;
}

function newProjectFromEstimate() {
  if (!wallet) { alert('먼저 지갑을 연결하세요.'); return; }
  const est = computeEstimate(draftEstimate);
  if (est.rows.length === 0) { alert('견적 탭에서 항목을 하나 이상 추가하세요.'); return; }
  const title = (draftEstimate.title || '').trim() || prompt('프로젝트 이름?') || '새 현장';

  const proj = {
    id: Date.now(),
    title,
    location: draftEstimate.location || '',
    budget: Math.round(est.total),        // budget now = a REAL computed estimate
    estimate: { lineItems: JSON.parse(JSON.stringify(draftEstimate.lineItems)),
                settings: { ...draftEstimate.settings }, total: est.total,
                materialCost: est.materialCost, laborCost: est.laborCost, laborHours: est.laborHours },
    durationDays: Number(draftEstimate.durationDays) || 90,
    floorArea: Number(draftEstimate.floorArea) || 0,
    phases: freshPhases(),
    bids: [],
    surprise: window._p14Voice ? window._p14Voice.surprise : 0.4,
    timestamp: new Date().toISOString(),
    status: 'bidding'
  };

  projects.unshift(proj);
  localStorage.setItem('p14_projects', JSON.stringify(projects));

  // reset draft for the next estimate
  draftEstimate = { title: '', location: '', durationDays: 90, floorArea: 0, lineItems: [], settings: { ...ESTIMATE_DEFAULTS } };
  saveDraft();

  addToCodex(`견적으로 "${title}" 프로젝트 생성: ${proj.budget.toLocaleString()} 크레딧 (자재 ${Math.round(est.materialCost).toLocaleString()}, 인건비 ${Math.round(est.laborCost).toLocaleString()}).`);
  alert(`프로젝트가 생성되었습니다. 견적 총액: ${proj.budget.toLocaleString()} 크레딧.`);
  showProjects();
}

// legacy entry kept so old buttons still work → routes to estimate flow
function postBid() {
  if (draftEstimate.lineItems.length === 0) {
    alert('먼저 견적을 작성하세요 — 견적 탭을 엽니다.');
    showEstimate();
    return;
  }
  newProjectFromEstimate();
}

function showDashboard() {
  hideAll('dashboard');
  document.getElementById('dashboard').classList.remove('hidden');
  const div = document.getElementById('active-builds');
  div.innerHTML = '';
  
  if (projects.length === 0) {
    div.innerHTML = '<p>진행 중인 프로젝트가 없습니다. 견적을 작성하거나 현장 로그를 남겨보세요.</p>';
    return;
  }
  
  // Portfolio roll-up: real totals across all projects
  let totalBudget = 0, totalEarned = 0;
  projects.forEach(p => { ensurePhases(p); totalBudget += (p.budget||0); totalEarned += earnedValue(p); });
  const portfolioPct = totalBudget ? +(totalEarned/totalBudget*100).toFixed(1) : 0;

  const summary = document.createElement('div');
  summary.className = 'card';
  summary.innerHTML =
    `<strong>포트폴리오 (프로젝트 ${projects.length}건)</strong>` +
    progressBarHTML(portfolioPct) +
    `<div class="meta">완료 가치 <span class="hero-num">${totalEarned.toLocaleString()}</span> / ${totalBudget.toLocaleString()} 크레딧</div>`;
  div.appendChild(summary);

  projects.slice(0,3).forEach(p => {
    const prog = projectProgress(p);
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      `<strong>${p.title}</strong>` +
      `<div class="meta">${p.location ? p.location+' · ' : ''}<span class="hero-num">${p.budget.toLocaleString()}</span> 크레딧 · ${statusLabel(p.status)}</div>` +
      progressBarHTML(prog);
    el.innerHTML += `<button class="primary" onclick="openProject(${p.id})">열기 · 진행률 갱신</button>`;
    div.appendChild(el);
  });
  localStorage.setItem('p14_projects', JSON.stringify(projects));
}

// === ESTIMATE BUILDER UI ===
function showEstimate() {
  hideAll('estimate');
  document.getElementById('estimate').classList.remove('hidden');
  renderEstimate();
}

function estOptionsHTML() {
  const opt = (arr, kind) => arr.map(i =>
    `<option value="${kind}:${i.id}">${i.name} — ${i.cost}/${i.unit}</option>`).join('');
  return `<optgroup label="자재">${opt(COST_CATALOG.material,'material')}</optgroup>` +
         `<optgroup label="인건비">${opt(COST_CATALOG.labor,'labor')}</optgroup>`;
}

function estFieldInput(field, val) {
  const numeric = (field === 'durationDays' || field === 'floorArea');
  draftEstimate[field] = numeric ? Math.max(0, parseInt(val) || 0) : val;
  saveDraft();
  if (numeric) renderEstimate(); // duration/area feed the derived cost KPIs
}
function estSettingInput(key, val) {
  draftEstimate.settings[key] = Math.max(0, parseFloat(val) || 0);
  saveDraft();
  renderEstimate();
}

function addEstimateLine() {
  const sel = document.getElementById('est-item');
  const qtyEl = document.getElementById('est-qty');
  if (!sel || !qtyEl) return;
  const [kind, itemId] = sel.value.split(':');
  const qty = parseFloat(qtyEl.value);
  if (!kind || !itemId) { alert('Pick an item.'); return; }
  if (!(qty > 0)) { alert('Enter a quantity greater than 0.'); return; }
  draftEstimate.lineItems.push({ kind, itemId, qty });
  saveDraft();
  qtyEl.value = '';
  renderEstimate();
}
function removeEstimateLine(idx) {
  draftEstimate.lineItems.splice(idx, 1);
  saveDraft();
  renderEstimate();
}

function renderEstimate() {
  const wrap = document.getElementById('estimate-body');
  if (!wrap) return;
  const est = computeEstimate(draftEstimate);
  const s = est.settings;

  const linesHTML = est.rows.length
    ? est.rows.map((r, i) =>
        `<div class="est-line">
           <span class="est-name">${r.name}<small> · ${r.kind === 'material' ? '자재' : '인건비'}</small></span>
           <span class="est-calc">${r.qty} ${r.unit} × ${r.unitCost}</span>
           <span class="est-amt hero-num">${r.line.toLocaleString()}</span>
           <button class="est-del" onclick="removeEstimateLine(${i})" title="삭제">✕</button>
         </div>`).join('')
    : '<p class="est-empty">아직 항목이 없습니다. 아래에서 자재·인건비를 추가해 견적을 작성하세요.</p>';

  const row = (label, val, cls='') =>
    `<div class="est-total-row ${cls}"><span>${label}</span><span class="hero-num">${Math.round(val).toLocaleString()}</span></div>`;

  // Cost-composition read: material vs labor split + the KPIs an estimator scans first.
  // Only shown once there are line items — an empty bar teaches nothing.
  const matShare = est.direct ? Math.round(est.materialCost / est.direct * 100) : 0;
  const kpi = (label, val, hint='') =>
    val ? `<div class="est-kpi"><span class="est-kpi-v hero-num">${val}</span><span class="est-kpi-l">${label}</span>${hint?`<span class="est-kpi-h">${hint}</span>`:''}</div>` : '';
  const insightHTML = est.rows.length ? `
    <div class="est-insight">
      <div class="est-split" title="자재 ${matShare}% · 인건비 ${est.laborShare}%">
        <div class="est-split-mat" style="width:${matShare}%"></div>
        <div class="est-split-lab" style="width:${est.laborShare}%"></div>
      </div>
      <div class="est-split-legend">
        <span><i class="dot mat"></i>자재 ${matShare}%</span>
        <span><i class="dot lab"></i>인건비 ${est.laborShare}%</span>
      </div>
      <div class="est-kpis">
        ${kpi('총 마크업', est.markupPct + '%', '직접비 대비')}
        ${kpi('일 평균', est.costPerDay ? est.costPerDay.toLocaleString() : '', est.days + '일 공기')}
        ${kpi('m²당', est.costPerM2 ? est.costPerM2.toLocaleString() : '', est.area ? est.area.toLocaleString()+'m²' : '')}
      </div>
    </div>` : '';

  wrap.innerHTML = `
    <div class="est-meta-fields">
      <input type="text" placeholder="프로젝트 이름" value="${(draftEstimate.title||'').replace(/"/g,'&quot;')}"
             oninput="estFieldInput('title', this.value)">
      <input type="text" placeholder="위치 (선택)" value="${(draftEstimate.location||'').replace(/"/g,'&quot;')}"
             oninput="estFieldInput('location', this.value)">
      <label class="est-dur">공기
        <input type="number" min="1" value="${draftEstimate.durationDays||90}"
               oninput="estFieldInput('durationDays', this.value)"> 일
      </label>
      <label class="est-dur">연면적
        <input type="number" min="0" value="${draftEstimate.floorArea||''}" placeholder="0"
               oninput="estFieldInput('floorArea', this.value)"> m²
      </label>
    </div>

    <div class="est-lines">${linesHTML}</div>

    <div class="est-add">
      <select id="est-item">${estOptionsHTML()}</select>
      <input type="number" id="est-qty" min="0" step="any" placeholder="수량">
      <button class="primary" onclick="addEstimateLine()">+ 추가</button>
    </div>

    <div class="est-settings">
      <label>간접비 % <input type="number" min="0" value="${s.overheadPct}" oninput="estSettingInput('overheadPct', this.value)"></label>
      <label>예비비 % <input type="number" min="0" value="${s.contingencyPct}" oninput="estSettingInput('contingencyPct', this.value)"></label>
      <label>마진 % <input type="number" min="0" value="${s.marginPct}" oninput="estSettingInput('marginPct', this.value)"></label>
      <label>세금 % <input type="number" min="0" value="${s.taxPct}" oninput="estSettingInput('taxPct', this.value)"></label>
    </div>

    ${insightHTML}

    <div class="est-totals">
      ${row('자재비', est.materialCost)}
      ${row('인건비 ('+est.laborHours+' 시간)', est.laborCost)}
      ${row('직접비', est.direct, 'sub')}
      ${row('간접비 ('+s.overheadPct+'%)', est.overhead)}
      ${row('예비비 ('+s.contingencyPct+'%)', est.contingency)}
      ${row('마진 ('+s.marginPct+'%)', est.margin)}
      ${row('세금 ('+s.taxPct+'%)', est.tax)}
      ${row('견적 총액', est.total, 'grand')}
    </div>

    <button class="primary est-create" onclick="newProjectFromEstimate()"
            ${est.rows.length ? '' : 'disabled'}>이 견적으로 프로젝트 생성</button>
  `;
}

function showProjects() {
  hideAll('projects');
  document.getElementById('projects').classList.remove('hidden');
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  
  // Notes nudge the shown success chance (avg priority score)
  const codexBoost = codex.length ? (codex.reduce((a,c)=>a+(parseFloat(c.note.match(/긴급도 ([\d.]+)/)?.[1] ?? c.note.match(/surprise ([\d.]+)/)?.[1])||0.4),0)/codex.length * 0.2) : 0;
  
  projects.forEach(proj => {
    ensurePhases(proj);
    const el = document.createElement('div');
    el.className = 'card';
    const prog = projectProgress(proj);
    const earned = earnedValue(proj);
    el.innerHTML = `
      <strong>${proj.title}</strong>
      <div class="meta">${proj.location ? proj.location + ' · ' : ''}<span class="hero-num">${proj.budget.toLocaleString()}</span> 크레딧 · ${statusLabel(proj.status)}</div>
      ${progressBarHTML(prog)}
      <div class="meta">완료 가치 <span class="hero-num">${earned.toLocaleString()}</span> / ${proj.budget.toLocaleString()} 크레딧</div>
      <button class="primary" onclick="openProject(${proj.id})">열기 · 진행률 갱신</button>
      <button class="secondary" onclick="placeBid(${proj.id})">입찰하기</button>
    `;
    list.appendChild(el);
  });
  localStorage.setItem('p14_projects', JSON.stringify(projects)); // persist any phase backfill
}

// Reusable progress bar (deterministic width from real %)
function progressBarHTML(pct) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="progress"><div class="progress-fill" style="width:${p}%"></div>
          <span class="progress-label">${p}%</span></div>`;
}

// === PROJECT DETAIL: real progress editing per phase ===
let openProjectId = null;
function openProject(projId) {
  openProjectId = projId;
  hideAll('project-detail');
  document.getElementById('project-detail').classList.remove('hidden');
  renderProjectDetail();
}

function setPhasePct(phaseKey, val) {
  const proj = projects.find(p => p.id === openProjectId);
  if (!proj) return;
  ensurePhases(proj);
  const ph = proj.phases.find(p => p.key === phaseKey);
  if (!ph) return;
  ph.pct = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
  // auto status roll-up from real progress
  const prog = projectProgress(proj);
  proj.status = prog >= 100 ? 'completed' : (prog > 0 ? 'in-progress' : 'bidding');
  localStorage.setItem('p14_projects', JSON.stringify(projects));
  renderProjectDetail();
}

function renderProjectDetail() {
  const wrap = document.getElementById('detail-body');
  const proj = projects.find(p => p.id === openProjectId);
  if (!wrap) return;
  if (!proj) { wrap.innerHTML = '<p>Project not found.</p>'; return; }
  ensurePhases(proj);
  const prog = projectProgress(proj);
  const earned = earnedValue(proj);

  const startDate = new Date(proj.timestamp);
  const endDate = new Date(startDate.getTime() + (proj.durationDays||90)*86400000);
  const now = Date.now();
  const schedElapsed = Math.max(0, Math.min(100,
    Math.round((now - startDate) / ((proj.durationDays||90)*86400000) * 100)));

  const phasesHTML = proj.phases.map(ph => `
    <div class="phase">
      <div class="phase-head"><span>${ph.name}</span><span class="phase-w">비중 ${ph.weight}%</span></div>
      ${progressBarHTML(ph.pct)}
      <input type="range" min="0" max="100" value="${ph.pct}"
             oninput="setPhasePct('${ph.key}', this.value)">
    </div>`).join('');

  // schedule vs progress = real "ahead/behind" signal
  const drift = prog - schedElapsed;
  const driftTxt = proj.status === 'completed' ? '완료'
    : drift >= 5 ? `일정보다 빠름 (+${drift.toFixed(0)}%)`
    : drift <= -5 ? `일정보다 지연 (${drift.toFixed(0)}%)`
    : '일정대로 진행';

  wrap.innerHTML = `
    <div class="card">
      <strong>${proj.title}</strong>
      <div class="meta">${proj.location ? proj.location + ' · ' : ''}${proj.durationDays||90}일 계획 · ${statusLabel(proj.status)}</div>
      ${progressBarHTML(prog)}
      <div class="meta">전체 ${prog}% · 경과 시간 ${schedElapsed}% · <b>${driftTxt}</b></div>
      <div class="meta">예산 <span class="hero-num">${proj.budget.toLocaleString()}</span> · 완료 가치 <span class="hero-num">${earned.toLocaleString()}</span> 크레딧</div>
    </div>
    <h3 class="detail-h3">공정별 진행률</h3>
    ${phasesHTML}
    ${proj.status !== 'completed'
      ? `<button class="primary" onclick="completeProject(${proj.id})">완료 처리 + 정산</button>` : ''}
    <button class="secondary" onclick="showProjects()">← 프로젝트 목록</button>
  `;
}

function placeBid(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj || !wallet) return;
  
  const bid = parseInt(prompt('입찰 금액(크레딧)?') || '5000');
  if (!(bid > 0)) { alert('올바른 입찰 금액을 입력하세요.'); return; }
  if (credits < bid * 0.1) { alert('보증금(입찰액의 10%)에 필요한 크레딧이 부족합니다.'); return; }

  credits -= Math.floor(bid * 0.1);
  proj.bids.push({ bidder: wallet, amount: bid });
  localStorage.setItem('p14_projects', JSON.stringify(projects));

  const surprise = window._p14Voice ? window._p14Voice.surprise : 0.4;
  addToCodex(`${proj.title}에 ${bid.toLocaleString()} 크레딧 입찰. 긴급도 ${surprise}.`);
  updateWallet();
  alert(`입찰이 접수되었습니다. (보증금 ${Math.floor(bid*0.1).toLocaleString()} 크레딧 차감)`);
  showProjects();
}

function showVoice() {
  hideAll('voice');
  document.getElementById('voice').classList.remove('hidden');
}

function showTrade() {
  hideAll('trade');
  document.getElementById('trade').classList.remove('hidden');
  const list = document.getElementById('materials-list');
  list.innerHTML = '';
  
  // Materials pricing scales with current demand (updated by recent orders)
  const mats = [
    {name: '철골 (Steel Beam)', base: 1200, surprise: Math.min(1, 0.55 + (window.p14LogisticsAche||0))},
    {name: '레미콘 (Concrete Mix)', base: 800, surprise: Math.min(1, 0.4 + (window.p14LogisticsAche||0))}
  ];

  mats.forEach(m => {
    const price = Math.floor(m.base * (0.8 + m.surprise * 0.6));
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      `<strong>${m.name}</strong>` +
      `<div class="meta"><span class="hero-num">${price.toLocaleString()}</span> 크레딧 · <span class="fomo">수요 ${(m.surprise*100).toFixed(0)}%</span></div>` +
      `<button class="primary" onclick="buyMaterialWithLogistics('${m.name.replace(/'/g,'')}', ${price})">주문 + 배송 요청</button>`;
    list.appendChild(el);
  });
}

// Purchase starts a delivery timer; demand relaxes on arrival
let logisticsTimer = null;
function buyMaterialWithLogistics(name, price) {
  if (credits < price) { alert('크레딧이 부족합니다.'); return; }
  credits -= price;
  updateWallet();

  window.p14LogisticsAche = Math.min(0.45, (window.p14LogisticsAche || 0.1) + 0.15); // demand builds
  addToCodex(`${name} ${price.toLocaleString()} 크레딧 주문. 배송 요청됨.`);

  // Delivery timer (demand relaxes on arrival)
  if (logisticsTimer) clearTimeout(logisticsTimer);
  const eta = 8000;
  logisticsTimer = setTimeout(() => {
    window.p14LogisticsAche = Math.max(0.05, (window.p14LogisticsAche||0) * 0.6);
    alert(`${name} 배송 완료! 수요가 완화되었습니다.`);
    showTrade();
  }, eta);

  alert(`자재 배송 중 (예상 ${eta/1000}초).`);
  showTrade();
}

function showCodex() {
  hideAll('codex');
  document.getElementById('codex').classList.remove('hidden');
  const list = document.getElementById('codex-list');
  list.innerHTML = '<h3>현장 노트</h3>';

  if (codex.length === 0) {
    list.innerHTML += '<p>음성 로그를 남기거나 입찰하면 노트가 쌓입니다.</p>';
    return;
  }
  
  codex.slice(0,8).forEach(c => {
    const div = document.createElement('div');
    div.className = 'notebook-entry';
    div.innerHTML = `<small>${new Date(c.time).toLocaleString()}</small><br>${c.note}`;
    list.appendChild(div);
  });
  updatePreviewFromCodex(); // notes view also refreshes preview
}

function updateUI() { /* stub for cross calls + mutation refresh */ if (typeof updatePreviewFromCodex === 'function') updatePreviewFromCodex(); }

function addToCodex(note) {
  codex.unshift({ time: Date.now(), note });
  if (codex.length > 20) codex.pop();
  localStorage.setItem('p14_codex', JSON.stringify(codex));
}

function hideAll(activeId) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  // Nav active-state: fluency — always show "where am I"
  document.querySelectorAll('.nav button').forEach(b =>
    b.classList.toggle('active', activeId && b.dataset.section === activeId));
}

function initP14() {
  updateWallet();
  
  // Seed demo
  if (projects.length === 0) {
    const seedTs = () => new Date(Date.now() - Math.floor(Math.random()*20+5)*86400000).toISOString();
    projects = [
      { id: 1, title: 'Seoul Tower Phase 2', location: 'Seoul', budget: 50000, durationDays: 120,
        phases: freshPhases().map((p,i)=>({ ...p, pct: i<3 ? 100 : (i===3?40:0) })),
        bids: [], surprise: 0.72, timestamp: seedTs(), status: 'in-progress' },
      { id: 2, title: 'Busan Port Expansion', location: 'Busan', budget: 32000, durationDays: 90,
        phases: freshPhases().map((p,i)=>({ ...p, pct: i<2 ? 100 : (i===2?25:0) })),
        bids: [], surprise: 0.61, timestamp: seedTs(), status: 'in-progress' }
    ];
    localStorage.setItem('p14_projects', JSON.stringify(projects));
  }
  
  // Init map (Leaflet or graceful offline fallback)
  setTimeout(initMap, 500);

  // Show dashboard (routes through showDashboard so nav highlights on load)
  setTimeout(() => {
    showDashboard();
    if (codex.length > 0) updatePreviewFromCodex();
  }, 300);
}

window.onload = initP14;