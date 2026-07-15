// p14 SiteForge - Construction app. p6 Voice + p10 Credits + FOMO + Cross.
let wallet = null;
let balance = 1420;
let credits = 680;
let projects = JSON.parse(localStorage.getItem('p14_projects') || '[]');
let logs = JSON.parse(localStorage.getItem('p14_logs') || '[]');
let codex = JSON.parse(localStorage.getItem('p14_codex') || '[]');
let map;

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
  localStorage.setItem('p14_projects', JSON.stringify(projects));
  alert(`Project completed! p10 payout ${payout} (p6 surprise boosted).`);
  showDashboard();
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

function postBid() {
  const title = prompt('Project title?') || 'New Build';
  const budget = parseInt(prompt('Budget in Credits?') || '10000');
  
  if (!wallet) {
    alert('Connect wallet.');
    return;
  }
  
  const proj = {
    id: Date.now(),
    title,
    budget,
    bids: [],
    surprise: window._p14Voice ? window._p14Voice.surprise : 0.4,
    timestamp: new Date().toISOString(),
    status: 'bidding'
  };
  
  projects.unshift(proj);
  localStorage.setItem('p14_projects', JSON.stringify(projects));
  
  addToCodex(`Bid submitted for ${title}. FOMO high.`);
  alert(`Bid posted! FOMO: ${Math.floor(Math.random()*10)+5} contractors viewing.`);
  showProjects();
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
  
  // Birth 3: Codex mutates dashboard success
  const codexAvg = codex.length ? codex.reduce((a,c)=>a+(parseFloat(c.note.match(/surprise ([\d.]+)/)?.[1])||0.4),0)/codex.length : 0.4;
  projects.slice(0,3).forEach(p => {
    const el = document.createElement('div');
    el.className = 'card';
    const mut = (p.surprise * (1 + codexAvg*0.5)).toFixed(2);
    el.innerHTML =
      `<strong>${p.title}</strong>` +
      `<div class="meta"><span class="hero-num">${p.budget.toLocaleString()}</span> Credits · ${p.status}</div>` +
      `<div class="meta">Surprise ${p.surprise.toFixed(2)} → Mutated ${mut} (Codex)</div>`;
    if (p.status !== 'completed') el.innerHTML += `<button class="primary" onclick="completeProject(${p.id})">Harvest</button>`;
    el.innerHTML += `<button class="secondary" onclick="showPreview()">Preview</button>`;
    div.appendChild(el);
  });
}

function showProjects() {
  hideAll('projects');
  document.getElementById('projects').classList.remove('hidden');
  const list = document.getElementById('project-list');
  list.innerHTML = '';
  
  // Birth 1 + 3: Codex mutates shown success chance
  const codexBoost = codex.length ? (codex.reduce((a,c)=>a+(parseFloat(c.note.match(/surprise ([\d.]+)/)?.[1])||0.4),0)/codex.length * 0.2) : 0;
  
  projects.forEach(proj => {
    const el = document.createElement('div');
    el.className = 'card';
    const health = (proj.surprise + codexBoost).toFixed(2);
    el.innerHTML = `
      <strong>${proj.title}</strong>
      <div class="meta"><span class="hero-num">${proj.budget.toLocaleString()}</span> Credits · ${proj.status}</div>
      <div class="meta">Surprise ${proj.surprise.toFixed(2)} · Codex Health ${health}</div>
      <button class="primary" onclick="placeBid(${proj.id})">Place Bid</button>
      ${proj.status !== 'completed' ? `<button class="secondary" onclick="completeProject(${proj.id})">Complete + Harvest</button>` : ''}
    `;
    list.appendChild(el);
  });
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
    projects = [
      { id: 1, title: 'Seoul Tower Phase 2', budget: 50000, bids: [], surprise: 0.72, timestamp: new Date().toISOString(), status: 'bidding' },
      { id: 2, title: 'Busan Port Expansion', budget: 32000, bids: [], surprise: 0.61, timestamp: new Date().toISOString(), status: 'bidding' }
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