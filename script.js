// p14 SiteForge - Construction app. p6 Voice + p10 Credits + FOMO + Cross.
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
  || { title: '', location: '', durationDays: 90, lineItems: [], settings: { ...ESTIMATE_DEFAULTS } };
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

  return { rows, materialCost:+materialCost.toFixed(2), laborCost:+laborCost.toFixed(2),
           laborHours, direct, overhead, contingency, margin, tax, total, settings: s };
}

function updateWallet() {
  const el = document.getElementById('wallet-info');
  if (!el) return;
  const addr = wallet || '0xDemo';
  el.innerHTML =
    `<span class="addr">${addr}</span>` +
    `<span class="bal">${credits.toLocaleString()}<span class="unit"> Credits</span></span>` +
    `<span class="addr">${balance.toLocaleString()} $EROS</span>`;
}

function connectWallet() {
  wallet = '0x' + Math.random().toString(16).slice(2, 10);
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
  preview.innerHTML = 'Recording p6 Voice Log (Lung Surprise Eye)...';

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const rec = new MediaRecorder(stream);
    let chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, {type:'audio/webm'});
      const url = URL.createObjectURL(blob);
      
      let surprise = 0.3;
      if (window.getP6LungSurprise) surprise = window.getP6LungSurprise();
      window.p14CurrentSurprise = surprise; // Birth 1: p6 feeds global for priority + pay
      
      preview.innerHTML = `<audio controls src="${url}"></audio><br>Surprise: ${surprise.toFixed(2)} — Log priority boosted!`;
      window._p14Voice = { url, surprise };
      
      // Auto add log + Birth 3: Codex mutates preview instantly
      addLog('Site Report', `Voice log: surprise ${surprise}`, surprise);
      addToCodex(`p6 Voice: surprise ${surprise.toFixed(2)}. Ache fuels preview growth.`);
      updatePreviewFromCodex(); // ALWAYS LEARNING mutation
      stream.getTracks().forEach(t => t.stop());
    };
    rec.start();
    setTimeout(() => rec.stop(), 4000);
  }).catch(() => {
    preview.innerHTML = 'Voice fallback. Surprise 0.65';
    window._p14Voice = { surprise: 0.65 };
    window.p14CurrentSurprise = 0.65;
    addLog('Site Report', 'Fallback voice log', 0.65);
    addToCodex('p6 Voice fallback. Codex mutates.');
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
  
  addToCodex(`${title}: ${desc}. Surprise ${surprise}. p6 voice.`);
  updateUI();
}

// === BIRTH 1: Surprise-Priority Pay (p6 voice logs + p10 stable) ===
// p6 surprise directly weaponizes priority + p10 Harvest Credit multiplier on completion
function harvestSurprisePay(proj) {
  const s = window.p14CurrentSurprise || proj.surprise || 0.4;
  const multiplier = 1 + (s * 0.8); // full-cheat: variable ratio near-miss boost
  const payout = Math.floor(proj.budget * 0.12 * multiplier); // p10 stable framing
  credits += payout;
  updateWallet();
  addToCodex(`p10 Harvest: +${payout} Credits (surprise x${multiplier.toFixed(2)}). ALWAYS LEARNING mutates success.`);
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
  alert(`Project completed (100%)! p10 payout ${payout} (p6 surprise boosted).`);
  if (openProjectId === projId && !document.getElementById('project-detail').classList.contains('hidden')) {
    renderProjectDetail();
  } else {
    showDashboard();
  }
}

// === BIRTH 3: Codex ALWAYS LEARNING mutates Virtual Preview (p11 + p9 live tours) ===
// Codex entries (esp p6 surprise) = Vitruvian growth. p9 live tour on the preview.
function updatePreviewFromCodex() {
  const viz = document.getElementById('build-preview');
  const meta = document.getElementById('preview-meta');
  if (!viz || !meta || !codex.length) return;

  const avgSurprise = codex.reduce((a,c) => a + (parseFloat(c.note.match(/surprise ([\d.]+)/)?.[1]) || 0.4), 0) / codex.length;
  const height = Math.max(30, Math.min(110, 30 + avgSurprise * 90)); // Vitruvian growth
  const aura = Math.floor(avgSurprise * 100);

  viz.style.height = height + 'px';
  viz.style.boxShadow = `0 0 ${8 + aura/5}px #c5a46e`;

  meta.innerHTML = `Codex avg surprise: ${avgSurprise.toFixed(2)} → Preview height +${Math.floor((height-30)/1.2)}% • FOMO aura ${aura}%. ALWAYS mutates success.`;
}

function showPreview() {
  hideAll('preview');
  document.getElementById('preview').classList.remove('hidden');
  updatePreviewFromCodex();
}

function liveTourPreview() {
  const s = window.p14CurrentSurprise || 0.5;
  const meta = document.getElementById('preview-meta');
  meta.innerHTML += `<br>p9 Live Tour active. Voice surprise ${s.toFixed(2)} — virtual build resonates. (Fictional)`;
  // p9 cross: simulate live stream with voice priority
  if (window.p14CurrentSurprise > 0.5) {
    addToCodex(`p9 Live Tour: high surprise mutated preview. FOMO on virtual site.`);
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
  if (!wallet) { alert('Connect wallet first.'); return; }
  const est = computeEstimate(draftEstimate);
  if (est.rows.length === 0) { alert('Add at least one estimate line item first (Estimate tab).'); return; }
  const title = (draftEstimate.title || '').trim() || prompt('Project title?') || 'New Build';

  const proj = {
    id: Date.now(),
    title,
    location: draftEstimate.location || '',
    budget: Math.round(est.total),        // budget now = a REAL computed estimate
    estimate: { lineItems: JSON.parse(JSON.stringify(draftEstimate.lineItems)),
                settings: { ...draftEstimate.settings }, total: est.total,
                materialCost: est.materialCost, laborCost: est.laborCost, laborHours: est.laborHours },
    durationDays: Number(draftEstimate.durationDays) || 90,
    phases: freshPhases(),
    bids: [],
    surprise: window._p14Voice ? window._p14Voice.surprise : 0.4,
    timestamp: new Date().toISOString(),
    status: 'bidding'
  };

  projects.unshift(proj);
  localStorage.setItem('p14_projects', JSON.stringify(projects));

  // reset draft for the next estimate
  draftEstimate = { title: '', location: '', durationDays: 90, lineItems: [], settings: { ...ESTIMATE_DEFAULTS } };
  saveDraft();

  addToCodex(`Project "${title}" created from estimate: ${proj.budget.toLocaleString()} Credits (mat ${Math.round(est.materialCost)}, labor ${Math.round(est.laborCost)}).`);
  alert(`Project created. Estimated total: ${proj.budget.toLocaleString()} Credits.\n${Math.floor(Math.random()*10)+5} contractors viewing.`);
  showProjects();
}

// legacy entry kept so old buttons still work → routes to estimate flow
function postBid() {
  if (draftEstimate.lineItems.length === 0) {
    alert('Build a real estimate first — opening the Estimate tab.');
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
    div.innerHTML = '<p>No active projects. Post bid or voice log.</p>';
    return;
  }
  
  // Portfolio roll-up: real totals across all projects
  let totalBudget = 0, totalEarned = 0;
  projects.forEach(p => { ensurePhases(p); totalBudget += (p.budget||0); totalEarned += earnedValue(p); });
  const portfolioPct = totalBudget ? +(totalEarned/totalBudget*100).toFixed(1) : 0;

  const summary = document.createElement('div');
  summary.className = 'card';
  summary.innerHTML =
    `<strong>Portfolio (${projects.length} project${projects.length===1?'':'s'})</strong>` +
    progressBarHTML(portfolioPct) +
    `<div class="meta">Earned <span class="hero-num">${totalEarned.toLocaleString()}</span> / ${totalBudget.toLocaleString()} Credits</div>`;
  div.appendChild(summary);

  projects.slice(0,3).forEach(p => {
    const prog = projectProgress(p);
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      `<strong>${p.title}</strong>` +
      `<div class="meta">${p.location ? p.location+' · ' : ''}<span class="hero-num">${p.budget.toLocaleString()}</span> Credits · ${p.status}</div>` +
      progressBarHTML(prog);
    el.innerHTML += `<button class="primary" onclick="openProject(${p.id})">Open · Update Progress</button>`;
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
  return `<optgroup label="Materials">${opt(COST_CATALOG.material,'material')}</optgroup>` +
         `<optgroup label="Labor">${opt(COST_CATALOG.labor,'labor')}</optgroup>`;
}

function estFieldInput(field, val) {
  draftEstimate[field] = field === 'durationDays' ? (parseInt(val)||0) : val;
  saveDraft();
  if (field === 'durationDays') renderEstimate(); // duration affects schedule readout
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
           <span class="est-name">${r.name}<small> · ${r.kind}</small></span>
           <span class="est-calc">${r.qty} ${r.unit} × ${r.unitCost}</span>
           <span class="est-amt hero-num">${r.line.toLocaleString()}</span>
           <button class="est-del" onclick="removeEstimateLine(${i})" title="Remove">✕</button>
         </div>`).join('')
    : '<p class="est-empty">No line items yet. Add materials and labor below to build a real estimate.</p>';

  const row = (label, val, cls='') =>
    `<div class="est-total-row ${cls}"><span>${label}</span><span class="hero-num">${Math.round(val).toLocaleString()}</span></div>`;

  wrap.innerHTML = `
    <div class="est-meta-fields">
      <input type="text" placeholder="Project title" value="${(draftEstimate.title||'').replace(/"/g,'&quot;')}"
             oninput="estFieldInput('title', this.value)">
      <input type="text" placeholder="Location (optional)" value="${(draftEstimate.location||'').replace(/"/g,'&quot;')}"
             oninput="estFieldInput('location', this.value)">
      <label class="est-dur">Duration
        <input type="number" min="1" value="${draftEstimate.durationDays||90}"
               oninput="estFieldInput('durationDays', this.value)"> days
      </label>
    </div>

    <div class="est-lines">${linesHTML}</div>

    <div class="est-add">
      <select id="est-item">${estOptionsHTML()}</select>
      <input type="number" id="est-qty" min="0" step="any" placeholder="Qty">
      <button class="primary" onclick="addEstimateLine()">+ Add</button>
    </div>

    <div class="est-settings">
      <label>Overhead % <input type="number" min="0" value="${s.overheadPct}" oninput="estSettingInput('overheadPct', this.value)"></label>
      <label>Contingency % <input type="number" min="0" value="${s.contingencyPct}" oninput="estSettingInput('contingencyPct', this.value)"></label>
      <label>Margin % <input type="number" min="0" value="${s.marginPct}" oninput="estSettingInput('marginPct', this.value)"></label>
      <label>Tax % <input type="number" min="0" value="${s.taxPct}" oninput="estSettingInput('taxPct', this.value)"></label>
    </div>

    <div class="est-totals">
      ${row('Materials', est.materialCost)}
      ${row('Labor ('+est.laborHours+' hr)', est.laborCost)}
      ${row('Direct cost', est.direct, 'sub')}
      ${row('Overhead ('+s.overheadPct+'%)', est.overhead)}
      ${row('Contingency ('+s.contingencyPct+'%)', est.contingency)}
      ${row('Margin ('+s.marginPct+'%)', est.margin)}
      ${row('Tax ('+s.taxPct+'%)', est.tax)}
      ${row('ESTIMATED TOTAL', est.total, 'grand')}
    </div>

    <button class="primary est-create" onclick="newProjectFromEstimate()"
            ${est.rows.length ? '' : 'disabled'}>Create Project from Estimate</button>
  `;
}

function showProjects() {
  hideAll('projects');
  document.getElementById('projects').classList.remove('hidden');
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  
  // Birth 1 + 3: Codex mutates shown success chance
  const codexBoost = codex.length ? (codex.reduce((a,c)=>a+(parseFloat(c.note.match(/surprise ([\d.]+)/)?.[1])||0.4),0)/codex.length * 0.2) : 0;
  
  projects.forEach(proj => {
    ensurePhases(proj);
    const el = document.createElement('div');
    el.className = 'card';
    const prog = projectProgress(proj);
    const earned = earnedValue(proj);
    el.innerHTML = `
      <strong>${proj.title}</strong>
      <div class="meta">${proj.location ? proj.location + ' · ' : ''}<span class="hero-num">${proj.budget.toLocaleString()}</span> Credits · ${proj.status}</div>
      ${progressBarHTML(prog)}
      <div class="meta">Earned value <span class="hero-num">${earned.toLocaleString()}</span> / ${proj.budget.toLocaleString()} Credits</div>
      <button class="primary" onclick="openProject(${proj.id})">Open · Update Progress</button>
      <button class="secondary" onclick="placeBid(${proj.id})">Place Bid</button>
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
      <div class="phase-head"><span>${ph.name}</span><span class="phase-w">weight ${ph.weight}%</span></div>
      ${progressBarHTML(ph.pct)}
      <input type="range" min="0" max="100" value="${ph.pct}"
             oninput="setPhasePct('${ph.key}', this.value)">
    </div>`).join('');

  // schedule vs progress = real "ahead/behind" signal
  const drift = prog - schedElapsed;
  const driftTxt = proj.status === 'completed' ? 'Completed'
    : drift >= 5 ? `Ahead of schedule (+${drift.toFixed(0)}%)`
    : drift <= -5 ? `Behind schedule (${drift.toFixed(0)}%)`
    : 'On schedule';

  wrap.innerHTML = `
    <div class="card">
      <strong>${proj.title}</strong>
      <div class="meta">${proj.location ? proj.location + ' · ' : ''}${proj.durationDays||90} day plan · ${proj.status}</div>
      ${progressBarHTML(prog)}
      <div class="meta">Overall ${prog}% · time elapsed ${schedElapsed}% · <b>${driftTxt}</b></div>
      <div class="meta">Budget <span class="hero-num">${proj.budget.toLocaleString()}</span> · earned <span class="hero-num">${earned.toLocaleString()}</span> Credits</div>
    </div>
    <h3 class="detail-h3">Phase progress</h3>
    ${phasesHTML}
    ${proj.status !== 'completed'
      ? `<button class="primary" onclick="completeProject(${proj.id})">Mark Complete + Harvest</button>` : ''}
    <button class="secondary" onclick="showProjects()">← Back to Projects</button>
  `;
}

function placeBid(projId) {
  const proj = projects.find(p => p.id === projId);
  if (!proj || !wallet) return;
  
  const bid = parseInt(prompt('Your bid in Credits?') || '5000');
  if (credits < bid * 0.1) { alert('Need credits for deposit.'); return; }
  
  credits -= Math.floor(bid * 0.1);
  proj.bids.push({ bidder: wallet, amount: bid });
  localStorage.setItem('p14_projects', JSON.stringify(projects));
  
  const surprise = window._p14Voice ? window._p14Voice.surprise : 0.4;
  addToCodex(`Bid ${bid} on ${proj.title}. Surprise boost ${surprise}.`);
  updateWallet();
  alert(`Bid placed! FOMO near-miss possible.`);
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
  
  // Birth 2: p13 Materials + p7 Logistics FOMO (dynamic from ache + time collapse)
  const mats = [
    {name: 'Steel Beams', base: 1200, surprise: 0.55 + (window.p14LogisticsAche||0)},
    {name: 'Concrete Mix', base: 800, surprise: 0.4 + (window.p14LogisticsAche||0)}
  ];
  
  mats.forEach(m => {
    const price = Math.floor(m.base * (0.8 + m.surprise * 0.6));
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML =
      `<strong>${m.name}</strong>` +
      `<div class="meta"><span class="hero-num">${price.toLocaleString()}</span> Credits · <span class="fomo">FOMO ${(m.surprise*100).toFixed(0)}%</span></div>` +
      `<button class="primary" onclick="buyMaterialWithLogistics('${m.name}', ${price})">Buy + Dispatch Logistics</button>`;
    list.appendChild(el);
  });
}

// Birth 2 emergent: buy starts p7-style delivery timer. Voice during = mutate FOMO
let logisticsTimer = null;
function buyMaterialWithLogistics(name, price) {
  if (credits < price) { alert('p10 Credits low.'); return; }
  credits -= price;
  updateWallet();
  
  window.p14LogisticsAche = (window.p14LogisticsAche || 0.1) + 0.15; // ache builds
  addToCodex(`p13+p7: Bought ${name} ${price}. Logistics dispatched. Timer FOMO.`);
  
  // p7 logistics timer collapse (near-miss pressure)
  if (logisticsTimer) clearTimeout(logisticsTimer);
  const eta = 8000;
  logisticsTimer = setTimeout(() => {
    window.p14LogisticsAche = Math.max(0.05, (window.p14LogisticsAche||0) * 0.6);
    alert(`${name} delivered! Ache collapsed. Next buy cheaper if voice logged.`);
    showTrade();
  }, eta);
  
  alert(`Material en route (p7 logistics ${eta/1000}s). Record voice NOW to mutate FOMO.`);
  showTrade();
}

function showCodex() {
  hideAll('codex');
  document.getElementById('codex').classList.remove('hidden');
  const list = document.getElementById('codex-list');
  list.innerHTML = '<h3>Construction Codex (ALWAYS LEARNING + p6 spores)</h3>';
  
  if (codex.length === 0) {
    list.innerHTML += '<p>Log with voice or bid to start.</p>';
    return;
  }
  
  codex.slice(0,8).forEach(c => {
    const div = document.createElement('div');
    div.className = 'notebook-entry';
    div.innerHTML = `<small>${new Date(c.time).toLocaleString()}</small><br>${c.note}`;
    list.appendChild(div);
  });
  updatePreviewFromCodex(); // Birth 3: codex view also mutates preview
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
  
  // p6 cross
  if (window.getP6LungSurprise) {
    console.log('[p14] p6 Lung Surprise Eye ready for voice logs.');
  }
  
  // Init map (Leaflet or graceful offline fallback)
  setTimeout(initMap, 500);
  
  // Show dashboard (routes through showDashboard so nav highlights on load)
  setTimeout(() => {
    showDashboard();
    // Birth 3 seed: ALWAYS LEARNING codex mutates preview on launch
    if (codex.length > 0) updatePreviewFromCodex();
  }, 300);
}

window.onload = initP14;