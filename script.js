// SiteForge — 인테리어·건설 견적 / 공정 / 현장 관리 (가상 시뮬레이션)
// 도메인 기준: 국내 인테리어 견적서 관행(품명·규격·수량·단위·단가·금액·비고 + 공정별 소계),
// 원가계산서 구조(직접공사비→현장관리비→일반관리비→이윤→예비비→공급가액→부가세),
// 공정 선후관계 기반 공정표, 계약금/중도금/잔금 결제 스케줄, 펀치리스트, 하자보수 보증.
// ⚠️ 모든 금액은 공개 시세 범위를 참고한 "예시 단가"이며 실제 견적·계약을 대체하지 않는다.

'use strict';

/* ══════════════════════════════════════════════════════════
   0. 유틸
   ══════════════════════════════════════════════════════════ */
const PY_M2 = 3.305785;                                  // 1평 = 3.305785 m²
const won  = n => '₩' + Math.round(Number(n) || 0).toLocaleString('ko-KR');
const num  = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
// 큰 금액은 '만원' 단위로 축약해서 읽기 부담을 줄인다(국내 관행 표기).
function man(n) {
  const v = Math.round((Number(n) || 0) / 10000);
  return v >= 10000 ? (v / 10000).toFixed(2).replace(/\.?0+$/, '') + '억' : num(v) + '만';
}
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

function bqDayKey(off){const d=new Date();d.setDate(d.getDate()+(off||0));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function bumpBqStreak(kind){
  try{
    let st=JSON.parse(localStorage.getItem('bq_streak')||'{}');
    const t0=bqDayKey(0);
    if(st.last!==t0){
      const y=bqDayKey(-1),y2=bqDayKey(-2);
      if(st.last&&st.last!==y&&st.last===y2&&(st.count||0)>=3){
        const ready=!st.shieldLast||((new Date(t0)-new Date(st.shieldLast))/86400000)>=7;
        if(ready){st.shieldLast=t0;st.last=y;}
      }
      st.count=(st.last===y)?(st.count||0)+1:1; st.last=t0;
      localStorage.setItem('bq_streak',JSON.stringify(st));
      try{legionTrack('streak',{count:st.count,kind:kind||'act'})}catch(e){}
    }
    const k='bq_day_'+t0; let day=JSON.parse(localStorage.getItem(k)||'{"lines":0,"projects":0}');
    if(kind==='line') day.lines=(day.lines||0)+1;
    if(kind==='project') day.projects=(day.projects||0)+1;
    localStorage.setItem(k,JSON.stringify(day));
    renderBqLoop();
  }catch(e){}
}
function renderBqLoop(){
  try{
    let el=document.getElementById('bqLoop');
    if(!el){
      el=document.createElement('div'); el.id='bqLoop';
      el.style.cssText='margin:8px 0;padding:10px;border:1px solid #2a2438;border-radius:12px;font-size:12px;display:flex;flex-wrap:wrap;gap:8px';
      const host=document.querySelector('header')||document.querySelector('h1')||document.body;
      host.insertAdjacentElement('afterend', el);
    }
    const st=JSON.parse(localStorage.getItem('bq_streak')||'{}');
    const day=JSON.parse(localStorage.getItem('bq_day_'+bqDayKey(0))||'{}');
    const end=new Date(); end.setHours(24,0,0,0);
    const ms=Math.max(0,end-Date.now());
    const clock=Math.floor(ms/3600000)+'h '+Math.floor((ms%3600000)/60000)+'m';
    const n=(typeof projects!=='undefined'&&projects)?projects.length:0;
    el.innerHTML='🔥 '+(st.count||0)+'일 · 오늘 항목 '+(day.lines||0)+' · 프로젝트 '+(day.projects||0)+' · 총현장 '+n+' · 리셋 '+clock+' · <span style="opacity:.7">견적 시뮬 · 투자/시공 권유 아님</span>';
  }catch(e){}
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const dateKR = d => { const x = new Date(d); return isNaN(x) ? '-' : `${x.getFullYear()}.${String(x.getMonth()+1).padStart(2,'0')}.${String(x.getDate()).padStart(2,'0')}`; };
const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);

function toast(msg, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/* ══════════════════════════════════════════════════════════
   1. 도메인 데이터 — 공정 분류 + 단가표(Cost Catalog)
   국내 인테리어에서 통용되는 공정 세트와 공개 시세 범위를 앵커로 삼은 예시 단가.
   low/high = 공개적으로 유통되는 시세 밴드 → 과견적/저가견적 판정 기준.
   auto(py) = 해당 공정이 포함될 때 평수로부터 유도되는 표준 수량(수기 takeoff 대체 레이어).
   ══════════════════════════════════════════════════════════ */
const TRADES = [
  { key: 'demo',   name: '철거',      seq: 1,  color: '#c2705a', dur: py => 2 + py * 0.05 },
  { key: 'plumb',  name: '설비·배관',  seq: 2,  color: '#5a90c2', dur: py => 3 + py * 0.03 },
  { key: 'elec',   name: '전기',      seq: 2,  color: '#c2a35a', dur: py => 3 + py * 0.03 },
  { key: 'carp',   name: '목공',      seq: 3,  color: '#a3835e', dur: py => 5 + py * 0.10 },
  { key: 'window', name: '창호',      seq: 4,  color: '#5aa38f', dur: py => 2 + py * 0.02 },
  { key: 'tile',   name: '타일',      seq: 5,  color: '#8b7bb0', dur: py => 4 },
  { key: 'bath',   name: '욕실',      seq: 5,  color: '#5ab0a3', dur: py => 4 },
  { key: 'film',   name: '도장·필름',  seq: 6,  color: '#b08b7b', dur: py => 3 },
  { key: 'paper',  name: '도배',      seq: 7,  color: '#c2a58b', dur: py => 2 + py * 0.02 },
  { key: 'floor',  name: '바닥재',    seq: 8,  color: '#7ba0c2', dur: py => 2 + py * 0.02 },
  { key: 'furn',   name: '가구',      seq: 9,  color: '#c27ba0', dur: py => 3 },
  { key: 'light',  name: '조명',      seq: 10, color: '#d8a24a', dur: py => 1 },
  { key: 'etc',    name: '부대비용',   seq: 11, color: '#8a8a8a', dur: py => 2 }
];
const tradeOf = k => TRADES.find(t => t.key === k) || TRADES[TRADES.length - 1];

const CATALOG = [
  // 철거
  { id:'demo_full',  trade:'demo',  name:'내부 전체 철거',     spec:'마감재 일괄 철거',        unit:'평',  cost:35000,   low:15000,  high:50000,   auto:py=>py },
  { id:'demo_part',  trade:'demo',  name:'부분 철거',         spec:'주방·욕실 국부',          unit:'식',  cost:900000,  low:400000, high:1500000, auto:()=>1 },
  { id:'demo_waste', trade:'demo',  name:'폐기물 처리·운반',   spec:'5톤 트럭 기준',           unit:'톤',  cost:150000,  low:100000, high:220000,  auto:py=>Math.max(1,Math.round(py*0.35)) },
  // 설비·배관
  { id:'plumb_pipe', trade:'plumb', name:'급배수 배관 교체',   spec:'PB 20A 신설',            unit:'개소', cost:280000,  low:180000, high:400000,  auto:py=>py>=30?5:4 },
  { id:'plumb_wp',   trade:'plumb', name:'욕실 방수',         spec:'액체방수 3회 + 보양',      unit:'개소', cost:450000,  low:300000, high:700000,  auto:py=>py>=30?2:1 },
  { id:'plumb_heat', trade:'plumb', name:'난방 배관 교체',     spec:'XL 엑셀 파이프 + 몰탈',    unit:'평',  cost:85000,   low:60000,  high:130000,  auto:py=>py },
  // 전기
  { id:'elec_wire',  trade:'elec',  name:'전기 배선 공사',     spec:'2.5SQ 신설 배선',         unit:'평',  cost:70000,   low:45000,  high:100000,  auto:py=>py },
  { id:'elec_panel', trade:'elec',  name:'분전반 교체',       spec:'차단기 12회로',           unit:'식',  cost:450000,  low:300000, high:700000,  auto:()=>1 },
  { id:'elec_out',   trade:'elec',  name:'콘센트·스위치 교체', spec:'국산 표준형',             unit:'개소', cost:25000,   low:15000,  high:40000,   auto:py=>Math.round(py*1.2) },
  { id:'elec_ac',    trade:'elec',  name:'시스템 에어컨',      spec:'4way 천장형 (배관 포함)',  unit:'대',  cost:1500000, low:1000000,high:2000000, auto:py=>py>=30?3:2 },
  // 목공
  { id:'carp_ceil',  trade:'carp',  name:'천장 목공',         spec:'다루끼 + 석고 2겹',        unit:'평',  cost:120000,  low:80000,  high:180000,  auto:py=>py },
  { id:'carp_wall',  trade:'carp',  name:'벽체 목공·단열',     spec:'아이소핑크 30T + 석고',    unit:'평',  cost:95000,   low:60000,  high:150000,  auto:py=>Math.round(py*0.5) },
  { id:'carp_mold',  trade:'carp',  name:'몰딩·걸레받이',      spec:'무몰딩 마감',             unit:'m',   cost:12000,   low:8000,   high:20000,   auto:py=>Math.round(py*3.2) },
  { id:'carp_door',  trade:'carp',  name:'도어 교체(문+문틀)',  spec:'ABS 도어 + 하드웨어',      unit:'개소', cost:380000,  low:250000, high:600000,  auto:py=>py>=30?4:3 },
  // 창호
  { id:'win_double', trade:'window',name:'이중창 교체',       spec:'24mm 복층유리 하이샷시',    unit:'평',  cost:300000,  low:200000, high:400000,  auto:py=>py },
  { id:'win_mid',    trade:'window',name:'중문 설치',         spec:'3연동 슬라이딩',           unit:'개소', cost:1200000, low:700000, high:2000000, auto:()=>1 },
  // 타일
  { id:'tile_bath',  trade:'tile',  name:'욕실 타일',         spec:'300×600 도기질 (덧방)',    unit:'㎡',  cost:90000,   low:60000,  high:130000,  auto:py=>(py>=30?2:1)*18 },
  { id:'tile_kit',   trade:'tile',  name:'주방 벽 타일',       spec:'200×400 유광',            unit:'㎡',  cost:85000,   low:55000,  high:120000,  auto:()=>8 },
  { id:'tile_ent',   trade:'tile',  name:'현관 타일',         spec:'600×600 폴리싱',          unit:'㎡',  cost:95000,   low:65000,  high:140000,  auto:()=>3 },
  // 욕실
  { id:'bath_set',   trade:'bath',  name:'욕실 도기 세트',     spec:'양변기+세면대+수전',       unit:'개소', cost:900000,  low:600000, high:1400000, auto:py=>py>=30?2:1 },
  { id:'bath_booth', trade:'bath',  name:'샤워 부스',         spec:'강화유리 스윙도어',        unit:'개소', cost:550000,  low:350000, high:900000,  auto:()=>1 },
  // 도장·필름
  { id:'film_wrap',  trade:'film',  name:'인테리어 필름 시공', spec:'국산 정품 필름',           unit:'㎡',  cost:25000,   low:15000,  high:40000,   auto:py=>Math.round(py*3) },
  { id:'film_paint', trade:'film',  name:'수성 페인트 도장',   spec:'친환경 2회 도장',          unit:'㎡',  cost:15000,   low:9000,   high:25000,   auto:py=>Math.round(py*1.5) },
  // 도배
  { id:'paper_silk', trade:'paper', name:'실크 벽지 도배',     spec:'합지 초배 + 실크',         unit:'평',  cost:45000,   low:30000,  high:60000,   auto:py=>py },
  { id:'paper_hab',  trade:'paper', name:'합지 벽지 도배',     spec:'소폭 합지',               unit:'평',  cost:28000,   low:18000,  high:40000,   auto:py=>py },
  // 바닥재
  { id:'floor_gang', trade:'floor', name:'강마루 시공',       spec:'7.5T 강마루 + 부자재',     unit:'평',  cost:120000,  low:90000,  high:160000,  auto:py=>py },
  { id:'floor_jang', trade:'floor', name:'장판 시공',         spec:'모노륨 2.2T',             unit:'평',  cost:45000,   low:30000,  high:65000,   auto:py=>py },
  // 가구
  { id:'furn_sink',  trade:'furn',  name:'싱크대(주방가구)',   spec:'PET 도어 + 인조대리석',    unit:'자',  cost:450000,  low:300000, high:700000,  auto:py=>py>=30?10:8 },
  { id:'furn_close', trade:'furn',  name:'붙박이장',          spec:'슬라이딩 도어',            unit:'자',  cost:350000,  low:250000, high:500000,  auto:py=>py>=30?8:6 },
  { id:'furn_shoe',  trade:'furn',  name:'신발장',            spec:'키큰장 포함',             unit:'식',  cost:800000,  low:500000, high:1300000, auto:()=>1 },
  // 조명
  { id:'light_fix',  trade:'light', name:'조명 기구 설치',     spec:'LED 매입·직부등',          unit:'개소', cost:80000,   low:50000,  high:130000,  auto:py=>Math.round(py*0.4) },
  { id:'light_line', trade:'light', name:'간접조명(우물천장)',  spec:'T5 라인등',               unit:'m',   cost:45000,   low:30000,  high:70000,   auto:py=>Math.round(py*0.5) },
  // 부대비용
  { id:'etc_clean',  trade:'etc',   name:'준공(입주) 청소',    spec:'전문 입주청소',            unit:'평',  cost:12000,   low:8000,   high:20000,   auto:py=>py },
  { id:'etc_move',   trade:'etc',   name:'이사·짐 보관',       spec:'컨테이너 1개월',           unit:'식',  cost:800000,  low:500000, high:1200000, auto:()=>1 },
  { id:'etc_live',   trade:'etc',   name:'임시 거주비',        spec:'월 단위',                 unit:'개월', cost:1200000, low:700000, high:2000000, auto:()=>2 },
  { id:'etc_permit', trade:'etc',   name:'관리실 신고·동의',   spec:'행위허가 대행',            unit:'식',  cost:300000,  low:150000, high:500000,  auto:()=>1 }
];
// ── 마이 단가표 레이어 ──────────────────────────────────────
// 기본 CATALOG는 고정 시세 앵커. 사용자는 자기 단가로 덮어쓰거나(priceBook)
// 자기 품목을 추가(customItems)한다. 견적 피커·계산은 모두 이 병합 결과를 읽는다.
function normalizeCustom(arr) {
  // localStorage는 함수를 저장하지 못하므로 auto()를 autoQty에서 복원한다.
  return (Array.isArray(arr) ? arr : []).map(c => ({
    ...c, custom: true,
    low:  c.low  != null ? c.low  : c.cost,
    high: c.high != null ? c.high : c.cost,
    auto: (py => Math.max(1, Math.round(Number(c.autoQty) || 1)))
  }));
}
function effectiveItem(base) {
  const o = priceBook[base.id];
  if (!o) return base;
  return { ...base,
    cost: o.cost != null ? o.cost : base.cost,
    low:  o.low  != null ? o.low  : base.low,
    high: o.high != null ? o.high : base.high,
    edited: true };
}
function effectiveCatalog() { return CATALOG.map(effectiveItem).concat(customItems); }
const itemOf = id => effectiveCatalog().find(i => i.id === id) || null;
function saveBook()   { save('p14_pricebook', priceBook); }
function saveCustom() { save('p14_custom', customItems.map(c => ({
  id:c.id, trade:c.trade, name:c.name, spec:c.spec, unit:c.unit,
  cost:c.cost, low:c.low, high:c.high, autoQty:c.autoQty }))); }

// 프로젝트 유형 템플릿 — 빈 화면에서 시작하지 않게 한다.
// 금액대별 커버 범위는 국내에서 통용되는 32평 기준 관행을 따랐다.
const TEMPLATES = [
  { key:'partial', name:'부분 시공',   hint:'도배 + 바닥만',
    ids:['paper_silk','floor_gang','etc_clean'] },
  { key:'basic',   name:'기본 리모델링', hint:'도배·마루·필름·조명',
    ids:['demo_part','paper_silk','floor_gang','film_wrap','light_fix','elec_out','etc_clean','demo_waste'] },
  { key:'standard',name:'중급 (주방·욕실 포함)', hint:'+ 싱크대·욕실·타일',
    ids:['demo_part','demo_waste','plumb_wp','elec_out','tile_bath','tile_kit','bath_set','bath_booth',
         'furn_sink','furn_shoe','paper_silk','floor_gang','film_wrap','light_fix','etc_clean'] },
  { key:'premium', name:'고급 (목공 포함)', hint:'+ 몰딩·간접조명·붙박이장',
    ids:['demo_full','demo_waste','plumb_pipe','plumb_wp','elec_wire','elec_out','elec_panel',
         'carp_ceil','carp_mold','carp_door','tile_bath','tile_kit','tile_ent','bath_set','bath_booth',
         'furn_sink','furn_close','furn_shoe','paper_silk','floor_gang','film_wrap',
         'light_fix','light_line','etc_clean'] },
  { key:'full',    name:'올수리 (창호 포함)', hint:'전 공정 + 창호·난방',
    ids:['demo_full','demo_waste','plumb_pipe','plumb_wp','plumb_heat','elec_wire','elec_panel','elec_out','elec_ac',
         'carp_ceil','carp_wall','carp_mold','carp_door','win_double','win_mid',
         'tile_bath','tile_kit','tile_ent','bath_set','bath_booth','film_wrap',
         'paper_silk','floor_gang','furn_sink','furn_close','furn_shoe','light_fix','light_line',
         'etc_clean','etc_move'] }
];

// 원가계산서 기본 요율 (국내 관행: 예비비 10~20%, 부가세 10% 별도)
const RATE_DEFAULTS = { sitePct: 6, genPct: 5, profitPct: 10, contPct: 10, vatPct: 10 };

/* ══════════════════════════════════════════════════════════
   2. 상태
   ══════════════════════════════════════════════════════════ */
let projects = load('p14_projects', []);
let logs     = load('p14_logs', []);
let codex    = load('p14_codex', []);
let photos   = load('p14_photos', []);
let punch    = load('p14_punch', []);
// 마이 단가표: 기본 CATALOG 위에 얹는 사용자 단가 오버라이드 + 사용자 추가 품목.
let priceBook   = load('p14_pricebook', {});       // { [id]: { cost, low, high } }
let customItems = normalizeCustom(load('p14_custom', []));  // 사용자 추가 품목(함수 복원)
let company  = load('p14_company', { name:'', biz:'', ceo:'', tel:'', addr:'', validDays:15 });
let credits  = load('p14_credits', 680);          // 자재 발주 시뮬용 부가 레이어(견적과 무관)
let wallet   = null;
let map = null;

let draft = load('p14_draft', null) || newDraft();
function newDraft() {
  return { title:'', addr:'', pyeong:32, startDate: todayISO(), lines:[], rates:{ ...RATE_DEFAULTS } };
}
function saveDraft() { save('p14_draft', draft); }

let openProjectId = null;   // 프로젝트 상세
let siteProjectId = null;   // 현장 탭 대상
let docSource = 'draft';    // 문서 탭 대상: 'draft' | projectId
let docTab = 'quote';       // 'quote' | 'gantt' | 'pay'
let clientView = false;     // 건축주(고객) 공유 뷰 — 원가·이윤 숨김

/* ══════════════════════════════════════════════════════════
   3. 견적 계산 — 순수 함수. 국내 원가계산서 구조를 그대로 따른다.
   ══════════════════════════════════════════════════════════ */
function computeEstimate(est) {
  const r = { ...RATE_DEFAULTS, ...(est.rates || {}) };
  const py = Math.max(0, Number(est.pyeong) || 0);

  const rows = (est.lines || []).map((l, idx) => {
    const cat = itemOf(l.itemId);
    const name = l.name || (cat ? cat.name : '직접 입력 항목');
    const spec = l.spec != null ? l.spec : (cat ? cat.spec : '');
    const unit = l.unit || (cat ? cat.unit : '식');
    const qty = Math.max(0, Number(l.qty) || 0);
    const unitCost = Math.max(0, Number(l.unitCost != null ? l.unitCost : (cat ? cat.cost : 0)) || 0);
    const amount = Math.round(qty * unitCost);
    // 시세 밴드 대비 판정 — 국내 유저 1순위 불안("이 견적 바가지인가")에 직접 답한다.
    let flag = null;
    if (cat && unitCost > 0) {
      if (unitCost > cat.high) flag = { kind:'over',  pct: Math.round((unitCost / cat.high - 1) * 100) };
      else if (unitCost < cat.low) flag = { kind:'under', pct: Math.round((1 - unitCost / cat.low) * 100) };
    }
    return { idx, tradeKey: l.trade || (cat ? cat.trade : 'etc'), itemId: l.itemId || null,
             name, spec, unit, qty, unitCost, amount, flag,
             band: cat ? { low: cat.low, high: cat.high } : null, note: l.note || '' };
  });

  // 공정별 그룹 + 소계 (견적서의 최소 단위는 '행', 읽는 단위는 '공정')
  const groups = [];
  TRADES.forEach(t => {
    const g = rows.filter(x => x.tradeKey === t.key);
    if (g.length) groups.push({ trade: t, rows: g, subtotal: g.reduce((a, x) => a + x.amount, 0) });
  });

  const direct  = rows.reduce((a, x) => a + x.amount, 0);
  const site    = Math.round(direct * r.sitePct / 100);
  const general = Math.round(direct * r.genPct / 100);
  const profit  = Math.round((direct + site + general) * r.profitPct / 100);
  const cont    = Math.round(direct * r.contPct / 100);
  const supply  = direct + site + general + profit + cont;
  const vat     = Math.round(supply * r.vatPct / 100);
  const total   = supply + vat;

  const perPy   = py ? Math.round(total / py) : 0;
  const flagged = rows.filter(x => x.flag && x.flag.kind === 'over');
  // 시세 상한으로 전부 계산했을 때의 총액 대비 위치 → 저/적정/고 판정
  const bandHigh = rows.reduce((a, x) => a + (x.band ? x.band.high * x.qty : x.amount), 0);
  const bandLow  = rows.reduce((a, x) => a + (x.band ? x.band.low  * x.qty : x.amount), 0);

  return { rows, groups, direct, site, general, profit, cont, supply, vat, total,
           rates: r, py, perPy, flagged, bandLow, bandHigh };
}

// 공정표: 공정 seq로 선후관계를 만들고 같은 seq는 병렬로 처리한다.
function computeSchedule(est) {
  const py = Math.max(1, Number(est.pyeong) || 32);
  const used = TRADES.filter(t => (est.lines || []).some(l => (l.trade || (itemOf(l.itemId) || {}).trade) === t.key));
  const bySeq = {};
  used.forEach(t => { (bySeq[t.seq] = bySeq[t.seq] || []).push(t); });
  const seqs = Object.keys(bySeq).map(Number).sort((a, b) => a - b);

  const bars = [];
  let cursor = 0;
  seqs.forEach(s => {
    let groupMax = 0;
    bySeq[s].forEach(t => {
      const d = Math.max(1, Math.round(t.dur(py)));
      bars.push({ trade: t, start: cursor, days: d, parallel: bySeq[s].length > 1 });
      groupMax = Math.max(groupMax, d);
    });
    cursor += groupMax;
  });
  return { bars, totalDays: cursor || 1, start: est.startDate || todayISO() };
}

// 결제 스케줄: 국내 관행. 1개월 미만 3단계(30/40/30), 이상 4단계(10/30/40/20).
// 잔금은 완공 후 하자 점검(14일) 이후 지급이 표준.
function defaultPayment(days) {
  return days < 30
    ? [ { label:'계약금', pct:30, when:'계약 시' }, { label:'중도금', pct:40, when:'공정 50%' }, { label:'잔금', pct:30, when:'완공 + 하자점검 14일' } ]
    : [ { label:'계약금', pct:10, when:'계약 시' }, { label:'1차 중도금', pct:30, when:'철거·설비 완료' },
        { label:'2차 중도금', pct:40, when:'목공·타일 완료' }, { label:'잔금', pct:20, when:'완공 + 하자점검 14일' } ];
}
function paymentOf(src) {
  const sch = computeSchedule(src);
  return src.payment && src.payment.length ? src.payment : defaultPayment(sch.totalDays);
}

/* ══════════════════════════════════════════════════════════
   4. 견적 탭
   ══════════════════════════════════════════════════════════ */
function showEstimate() { section('estimate'); renderEstimate(); }

function applyTemplate(key) {
  const tpl = TEMPLATES.find(t => t.key === key);
  if (!tpl) return;
  const py = Math.max(1, Number(draft.pyeong) || 32);
  draft.lines = tpl.ids.map(id => {
    const c = itemOf(id);
    return { itemId: id, trade: c.trade, qty: Math.max(1, Math.round(c.auto(py))), unitCost: c.cost, note: '' };
  });
  saveDraft();
  renderEstimate();
  const est = computeEstimate(draft);
  toast(`${tpl.name} 적용 — ${est.rows.length}개 항목 · 평당 ${man(est.perPy)}원`);
  note(`템플릿 "${tpl.name}" 적용: ${py}평 · ${est.rows.length}개 항목 · 총 ${man(est.total)}원.`);
}

function draftField(f, v) {
  if (f === 'pyeong') draft.pyeong = clamp(parseFloat(v) || 0, 0, 500);
  else draft[f] = v;
  saveDraft();
  if (f === 'pyeong') refreshTotals();
}
function rateField(k, v) { draft.rates[k] = clamp(parseFloat(v) || 0, 0, 100); saveDraft(); refreshTotals(); }

function lineQty(i, v)  { if (!draft.lines[i]) return; draft.lines[i].qty = Math.max(0, parseFloat(v) || 0); saveDraft(); refreshTotals(); }
function lineCost(i, v) { if (!draft.lines[i]) return; draft.lines[i].unitCost = Math.max(0, parseFloat(v) || 0); saveDraft(); refreshTotals(); }
function lineNote(i, v) { if (!draft.lines[i]) return; draft.lines[i].note = v; saveDraft(); }
function lineDel(i)     { draft.lines.splice(i, 1); saveDraft(); renderEstimate(); }

function addLineFromPicker() {
  const sel = document.getElementById('pick-item');
  const qEl = document.getElementById('pick-qty');
  if (!sel) return;
  const c = itemOf(sel.value);
  if (!c) { toast('항목을 선택하세요.', 'warn'); return; }
  const py = Math.max(1, Number(draft.pyeong) || 32);
  const qty = (qEl && parseFloat(qEl.value) > 0) ? parseFloat(qEl.value) : Math.max(1, Math.round(c.auto(py)));
  draft.lines.push({ itemId: c.id, trade: c.trade, qty, unitCost: c.cost, note: '' });
  saveDraft();
  renderEstimate();
  try{bumpBqStreak('line');}catch(e){}
  toast(`${c.name} ${qty}${c.unit} 추가`);
}
function addCustomLine() {
  const name = prompt('항목명 (직접 입력)');
  if (!name) return;
  draft.lines.push({ itemId: null, trade: 'etc', name, spec: '직접 입력', unit: '식', qty: 1, unitCost: 0, note: '' });
  saveDraft();
  renderEstimate();
}
function onPickChange() {
  const sel = document.getElementById('pick-item');
  const hint = document.getElementById('pick-hint');
  const qEl = document.getElementById('pick-qty');
  const c = itemOf(sel && sel.value);
  if (!c || !hint) return;
  const py = Math.max(1, Number(draft.pyeong) || 32);
  if (qEl) qEl.placeholder = Math.max(1, Math.round(c.auto(py)));
  hint.innerHTML = `${esc(c.spec)} · 시세 <b>${num(c.low)}~${num(c.high)}</b>/${c.unit}`;
}

function flagHTML(r) {
  if (!r.flag) return '';
  return r.flag.kind === 'over'
    ? `<span class="badge over" title="공개 시세 상한 ${num(r.band.high)}원 대비">시세 +${r.flag.pct}%</span>`
    : `<span class="badge under" title="공개 시세 하한 ${num(r.band.low)}원 대비">시세 -${r.flag.pct}%</span>`;
}

function renderEstimate() {
  const wrap = document.getElementById('estimate-body');
  if (!wrap) return;
  const est = computeEstimate(draft);
  const py = Math.max(1, Number(draft.pyeong) || 32);
  const empty = est.rows.length === 0;

  // ── 시작하기(템플릿) — 비어 있을 때만 펼쳐서 보여준다
  const tplHTML = `
    <details class="starter" ${empty ? 'open' : ''}>
      <summary><span>빠른 시작 — 평수 + 시공 범위 선택</span><i>▾</i></summary>
      <div class="starter-body">
        <label class="fld fld-py">평형
          <input type="number" min="1" max="200" value="${py}" oninput="draftField('pyeong', this.value)">
          <span class="sfx">평 · ${Math.round(py * PY_M2)}㎡</span>
        </label>
        <div class="tpl-grid">
          ${TEMPLATES.map(t => `
            <button class="tpl" onclick="applyTemplate('${t.key}')">
              <b>${t.name}</b><small>${t.hint}</small>
            </button>`).join('')}
        </div>
        <p class="fine">템플릿은 평형에 맞춘 표준 수량으로 라인아이템을 생성합니다. 수량·단가는 행에서 직접 수정하세요.</p>
      </div>
    </details>`;

  // ── 라인아이템 표: 품명·규격·수량·단위·단가·금액·비고 (국내 견적서 표준 7열)
  const tableHTML = empty ? `
    <div class="empty">
      <b>아직 견적 항목이 없습니다.</b>
      <span>위에서 평형과 시공 범위를 고르면 라인아이템이 자동으로 만들어집니다.</span>
    </div>` : `
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th class="c-name">품명 / 규격</th><th class="c-qty">수량</th><th class="c-unit">단위</th>
          <th class="c-cost">단가</th><th class="c-amt">금액</th><th class="c-note">비고</th><th></th>
        </tr></thead>
        ${est.groups.map(g => `
          <tbody class="grp">
            <tr class="grp-head">
              <td colspan="4"><i class="swatch" style="background:${g.trade.color}"></i>${g.trade.name}
                <small>${g.rows.length}개 항목</small></td>
              <td class="c-amt num"><span id="sub-${g.trade.key}">${num(g.subtotal)}</span></td>
              <td colspan="2"></td>
            </tr>
            ${g.rows.map(r => `
              <tr>
                <td class="c-name">
                  <b>${esc(r.name)}</b><span id="flag-${r.idx}">${flagHTML(r)}</span>
                  <small>${esc(r.spec)}</small>
                </td>
                <td class="c-qty"><input type="number" min="0" step="any" value="${r.qty}"
                     oninput="lineQty(${r.idx}, this.value)" aria-label="${esc(r.name)} 수량"></td>
                <td class="c-unit">${esc(r.unit)}</td>
                <td class="c-cost"><input type="number" min="0" step="1000" value="${r.unitCost}"
                     oninput="lineCost(${r.idx}, this.value)" aria-label="${esc(r.name)} 단가"></td>
                <td class="c-amt num" id="amt-${r.idx}">${num(r.amount)}</td>
                <td class="c-note"><input type="text" value="${esc(r.note)}" placeholder="—"
                     oninput="lineNote(${r.idx}, this.value)" aria-label="${esc(r.name)} 비고"></td>
                <td class="c-del"><button class="icon" onclick="lineDel(${r.idx})" title="행 삭제">✕</button></td>
              </tr>`).join('')}
          </tbody>`).join('')}
      </table>
    </div>`;

  // ── 항목 추가 (공정 → 항목 → 수량)
  const pickHTML = `
    <div class="picker">
      <select id="pick-item" onchange="onPickChange()">
        ${(eff => TRADES.map(t => {
          const items = eff.filter(c => c.trade === t.key);
          return items.length ? `<optgroup label="${t.name}">${items.map(c =>
            `<option value="${c.id}">${c.name} — ${num(c.cost)}/${c.unit}${c.custom ? ' ·직접' : ''}</option>`).join('')}</optgroup>` : '';
        }).join(''))(effectiveCatalog())}
      </select>
      <input type="number" id="pick-qty" min="0" step="any" placeholder="수량">
      <button class="primary" onclick="addLineFromPicker()">+ 추가</button>
      <div class="pick-hint" id="pick-hint"></div>
      <button class="ghost wide" onclick="addCustomLine()">직접 입력 항목 추가</button>
    </div>`;

  wrap.innerHTML = `
    ${tplHTML}
    <div class="fields">
      <label class="fld"><span>현장명</span>
        <input type="text" value="${esc(draft.title)}" placeholder="예: 반포 래미안 32평"
               oninput="draftField('title', this.value)"></label>
      <label class="fld"><span>주소</span>
        <input type="text" value="${esc(draft.addr)}" placeholder="서울시 …"
               oninput="draftField('addr', this.value)"></label>
      <label class="fld sm"><span>착공 예정일</span>
        <input type="date" value="${esc(draft.startDate)}" oninput="draftField('startDate', this.value)"></label>
      <label class="fld sm"><span>평형</span>
        <input type="number" min="1" max="200" value="${py}" oninput="draftField('pyeong', this.value)"></label>
    </div>

    <div id="est-kpibar">${kpiHTML(est)}</div>
    ${tableHTML}
    ${pickHTML}

    <details class="rates">
      <summary><span>요율 설정 — 현장관리비 · 일반관리비 · 이윤 · 예비비</span><i>▾</i></summary>
      <div class="rates-body">
        <label>현장관리비 <input type="number" min="0" max="100" value="${est.rates.sitePct}" oninput="rateField('sitePct', this.value)">%</label>
        <label>일반관리비 <input type="number" min="0" max="100" value="${est.rates.genPct}" oninput="rateField('genPct', this.value)">%</label>
        <label>이윤 <input type="number" min="0" max="100" value="${est.rates.profitPct}" oninput="rateField('profitPct', this.value)">%</label>
        <label>예비비 <input type="number" min="0" max="100" value="${est.rates.contPct}" oninput="rateField('contPct', this.value)">%</label>
        <p class="fine">예비비는 폐기물·이사·추가공사 등 부대 리스크 대비분입니다. 국내 실무 권장 범위는 시공비의 10~20%.</p>
      </div>
    </details>

    <div id="est-summary">${summaryHTML(est)}</div>

    <div class="actions">
      <button class="primary" onclick="createProjectFromDraft()" ${empty ? 'disabled' : ''}>이 견적으로 프로젝트 시작</button>
      <button onclick="goDoc('draft','quote')" ${empty ? 'disabled' : ''}>견적서 보기</button>
      <button class="ghost" onclick="exportCSV()" ${empty ? 'disabled' : ''}>CSV 내보내기</button>
      <button class="ghost" onclick="clearDraft()" ${empty ? 'disabled' : ''}>견적 비우기</button>
    </div>`;
  onPickChange();
}

function kpiHTML(est) {
  if (!est.rows.length) return '';
  // 평당가 = 국내 유저가 가장 먼저 읽는 숫자 → 화면의 주인공.
  const band = est.total > est.bandHigh ? { c:'over',  t:'시세 상단 초과' }
             : est.total < est.bandLow  ? { c:'under', t:'시세 하단 미만' }
             : { c:'ok', t:'시세 범위 내' };
  return `
    <div class="kpi">
      <div class="kpi-hero">
        <span class="kpi-label">평당 공사비</span>
        <span class="kpi-big">${num(est.perPy)}<em>원</em></span>
        <span class="kpi-sub">${est.py}평 · 총 ${man(est.total)}원 (부가세 포함)</span>
      </div>
      <div class="kpi-side">
        <div class="chip ${band.c}">${band.t}</div>
        <div class="kpi-mini"><b>${est.groups.length}</b><span>공정</span></div>
        <div class="kpi-mini"><b>${est.rows.length}</b><span>항목</span></div>
      </div>
    </div>
    ${est.flagged.length ? `<div class="alert warn">
      <b>단가 점검 ${est.flagged.length}건</b> — ${est.flagged.slice(0,3).map(f => esc(f.name)+' +'+f.flag.pct+'%').join(', ')}${est.flagged.length>3?' 외':''}
      <small>공개 시세 상한을 넘는 단가입니다. 자재 등급·시공 범위가 반영된 값인지 확인하세요.</small>
    </div>` : ''}`;
}

function summaryHTML(est) {
  if (!est.rows.length) return '';
  const r = est.rates;
  const row = (l, v, cls) => `<div class="sum-row ${cls || ''}"><span>${l}</span><b>${num(v)}</b></div>`;
  // 건축주 뷰에서는 일반관리비·이윤을 '제경비'로 묶어 노출한다(원가 비공개는 업계 관행).
  const mid = clientView
    ? row('제경비 (관리·이윤)', est.site + est.general + est.profit)
    : row(`현장관리비 (${r.sitePct}%)`, est.site) +
      row(`일반관리비 (${r.genPct}%)`, est.general) +
      row(`이윤 (${r.profitPct}%)`, est.profit);
  return `
    <div class="summary">
      <div class="sum-title">원가 계산</div>
      ${est.groups.map(g => `<div class="sum-row light"><span><i class="swatch" style="background:${g.trade.color}"></i>${g.trade.name}</span><b>${num(g.subtotal)}</b></div>`).join('')}
      ${row('직접공사비', est.direct, 'sub')}
      ${mid}
      ${row(`예비비 (${r.contPct}%)`, est.cont)}
      ${row('공급가액', est.supply, 'sub')}
      ${row(`부가세 (${r.vatPct}%)`, est.vat)}
      ${row('견적 총액', est.total, 'grand')}
      <p class="fine">부가세 별도 표기 · 예비비 포함. 실제 시공 시 현장 여건에 따라 변동될 수 있습니다.</p>
    </div>`;
}

// 입력 중 포커스를 잃지 않도록 합계 영역만 부분 갱신한다.
function refreshTotals() {
  const est = computeEstimate(draft);
  est.rows.forEach(r => {
    const a = document.getElementById('amt-' + r.idx);
    if (a) a.textContent = num(r.amount);
    // 단가를 고치면 시세 판정도 같이 움직여야 한다 — 금액만 갱신하면 배지가 거짓말을 한다.
    const f = document.getElementById('flag-' + r.idx);
    if (f) f.innerHTML = flagHTML(r);
  });
  est.groups.forEach(g => {
    const s = document.getElementById('sub-' + g.trade.key);
    if (s) s.textContent = num(g.subtotal);
  });
  const sum = document.getElementById('est-summary'); if (sum) sum.innerHTML = summaryHTML(est);
  const kpi = document.getElementById('est-kpibar');  if (kpi) kpi.innerHTML = kpiHTML(est);
}

function clearDraft() {
  if (!confirm('작성 중인 견적을 비울까요?')) return;
  draft = newDraft(); saveDraft(); renderEstimate(); toast('견적을 비웠습니다.');
}

function exportCSV() {
  const est = computeEstimate(draft);
  if (!est.rows.length) return;
  const head = ['공정','품명','규격','수량','단위','단가','금액','비고'];
  const body = est.rows.map(r => [tradeOf(r.tradeKey).name, r.name, r.spec, r.qty, r.unit, r.unitCost, r.amount, r.note]);
  body.push([], ['','','','','','직접공사비', est.direct, '']);
  body.push(['','','','','','공급가액', est.supply, '']);
  body.push(['','','','','','부가세', est.vat, '']);
  body.push(['','','','','','총액', est.total, '']);
  const csv = '﻿' + [head, ...body].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    a.download = `견적_${(draft.title || '현장').replace(/\s/g,'')}_${todayISO()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('CSV로 내보냈습니다.');
  } catch (e) { toast('내보내기를 지원하지 않는 환경입니다.', 'warn'); }
}

/* ══════════════════════════════════════════════════════════
   5. 프로젝트 — 견적이 실행예산으로 내려간다
   ══════════════════════════════════════════════════════════ */
function createProjectFromDraft() {
  const est = computeEstimate(draft);
  if (!est.rows.length) { toast('견적 항목을 먼저 추가하세요.', 'warn'); return; }
  const title = (draft.title || '').trim() || prompt('현장 이름을 입력하세요') || '새 현장';
  const sch = computeSchedule(draft);

  const proj = {
    id: uid(),
    title, addr: draft.addr, pyeong: draft.pyeong,
    startDate: draft.startDate || todayISO(),
    days: sch.totalDays,
    // 견적 스냅샷 = 실행예산의 기준선. 이후 변경(추가공사)과 대조된다.
    baseline: JSON.parse(JSON.stringify({ lines: draft.lines, rates: draft.rates, pyeong: draft.pyeong, startDate: draft.startDate })),
    budget: est.total,
    payment: defaultPayment(sch.totalDays),
    phases: est.groups.map(g => ({ key: g.trade.key, name: g.trade.name, budget: g.subtotal, pct: 0 })),
    changes: [],   // 추가공사 (Change Order)
    actuals: [],   // 실집행
    status: 'planned',
    completedAt: null,
    createdAt: new Date().toISOString()
  };
  projects.unshift(proj);
  save('p14_projects', projects);
  try{bumpBqStreak('project');}catch(e){}

  // 핵심 루프: 라인아이템 견적 완성 → 프로젝트 착수
  if (window.legionTrack) window.legionTrack('activate');

  note(`"${title}" 프로젝트 생성 — ${est.rows.length}개 항목 · ${man(est.total)}원 · 공기 ${sch.totalDays}일.`);
  draft = newDraft(); saveDraft();
  toast(`프로젝트 생성 — 예산 ${man(proj.budget)}원 · 공기 ${proj.days}일`);
  openProject(proj.id);
}

function projectProgress(p) {
  if (!p.phases || !p.phases.length) return p.status === 'done' ? 100 : 0;
  const tw = p.phases.reduce((a, x) => a + (x.budget || 0), 0) || 1;
  return +(p.phases.reduce((a, x) => a + (x.budget || 0) * (x.pct || 0), 0) / tw).toFixed(1);
}
function contractSum(p) { return (p.budget || 0) + (p.changes || []).filter(c => c.approved).reduce((a, c) => a + c.amount, 0); }
function actualSum(p)   { return (p.actuals || []).reduce((a, x) => a + x.amount, 0); }
function earnedValue(p) { return Math.round(contractSum(p) * projectProgress(p) / 100); }

function showProjects() {
  section('projects');
  const list = document.getElementById('project-list');
  if (!list) return;
  if (!projects.length) {
    list.innerHTML = `<div class="empty"><b>진행 중인 현장이 없습니다.</b>
      <span>견적 탭에서 라인아이템을 만들면 그대로 실행예산이 됩니다.</span>
      <button class="primary" onclick="showEstimate()">견적 작성하기</button></div>`;
    return;
  }
  list.innerHTML = projects.map(p => {
    const pct = projectProgress(p);
    const con = contractSum(p);
    const act = actualSum(p);
    const over = con ? Math.round((act - earnedValue(p)) / con * 100) : 0;
    return `<article class="card">
      <div class="card-head">
        <div><b>${esc(p.title)}</b><small>${esc(p.addr || '주소 미입력')} · ${p.pyeong}평</small></div>
        <span class="chip ${p.status === 'done' ? 'ok' : 'live'}">${statusLabel(p.status)}</span>
      </div>
      ${bar(pct)}
      <div class="rowline">
        <span>계약금액</span><b>${num(con)}</b>
      </div>
      <div class="rowline">
        <span>기성고 / 실집행</span><b>${num(earnedValue(p))} / ${num(act)}</b>
      </div>
      ${act > 0 && over > 3 ? `<div class="alert warn slim">실집행이 기성고보다 ${over}% 앞섭니다 — 원가 초과 위험</div>` : ''}
      <div class="card-actions">
        <button class="primary" onclick="openProject('${p.id}')">현장 열기</button>
        <button class="ghost" onclick="goDoc('${p.id}','quote')">문서</button>
      </div>
    </article>`;
  }).join('');
}
function statusLabel(s) { return { planned:'착공 대기', live:'진행 중', done:'준공' }[s] || s; }
function bar(pct, cls) {
  const p = clamp(pct, 0, 100);
  return `<div class="bar ${cls || ''}"><div class="bar-fill" style="width:${p}%"></div><span>${p}%</span></div>`;
}

function openProject(id) { openProjectId = id; section('detail'); renderDetail(); }

function setPhase(key, v) {
  const p = projects.find(x => x.id === openProjectId); if (!p) return;
  const ph = (p.phases || []).find(x => x.key === key); if (!ph) return;
  ph.pct = clamp(Math.round(Number(v) || 0), 0, 100);
  const prog = projectProgress(p);
  p.status = prog >= 100 ? 'done' : (prog > 0 ? 'live' : 'planned');
  if (p.status === 'done' && !p.completedAt) p.completedAt = todayISO();
  if (p.status !== 'done') p.completedAt = null;
  save('p14_projects', projects);
  renderDetail();
}

function addChange() {
  const p = projects.find(x => x.id === openProjectId); if (!p) return;
  const desc = prompt('추가공사 내용 (예: 안방 붙박이장 추가)'); if (!desc) return;
  const amt = parseInt(prompt('금액 (원, 부가세 포함)') || '0', 10);
  if (!(amt > 0)) { toast('금액을 올바르게 입력하세요.', 'warn'); return; }
  p.changes = p.changes || [];
  p.changes.push({ id: uid(), desc, amount: amt, date: todayISO(), approved: false });
  save('p14_projects', projects);
  note(`${p.title} 추가공사 요청: ${desc} ${man(amt)}원 (서면 합의 대기).`);
  renderDetail();
  toast('추가공사를 등록했습니다. 승인 전까지 계약금액에 반영되지 않습니다.');
}
function approveChange(cid) {
  const p = projects.find(x => x.id === openProjectId); if (!p) return;
  const c = (p.changes || []).find(x => x.id === cid); if (!c) return;
  c.approved = !c.approved;
  save('p14_projects', projects);
  renderDetail();
  toast(c.approved ? '추가공사 승인 — 계약금액에 반영됩니다.' : '승인을 취소했습니다.');
}
function addActual() {
  const p = projects.find(x => x.id === openProjectId); if (!p) return;
  const keys = (p.phases || []).map(x => x.key);
  const name = prompt(`집행 공정 (${(p.phases || []).map(x => x.name).join(' / ')})`);
  if (!name) return;
  const ph = (p.phases || []).find(x => x.name === name.trim()) || (p.phases || [])[0];
  const amt = parseInt(prompt('집행 금액 (원)') || '0', 10);
  if (!(amt > 0)) { toast('금액을 올바르게 입력하세요.', 'warn'); return; }
  p.actuals = p.actuals || [];
  p.actuals.push({ id: uid(), key: ph ? ph.key : keys[0], amount: amt, date: todayISO() });
  save('p14_projects', projects);
  renderDetail();
}

function renderDetail() {
  const wrap = document.getElementById('detail-body');
  const p = projects.find(x => x.id === openProjectId);
  if (!wrap) return;
  if (!p) { wrap.innerHTML = '<div class="empty"><b>현장을 찾을 수 없습니다.</b></div>'; return; }

  const prog = projectProgress(p);
  const con = contractSum(p);
  const act = actualSum(p);
  const earned = earnedValue(p);
  const elapsed = clamp(Math.round((Date.now() - new Date(p.startDate)) / (p.days * 86400000) * 100), 0, 100);
  const drift = prog - elapsed;
  const driftTxt = p.status === 'done' ? '준공 완료'
    : drift >= 5 ? `일정보다 빠름 +${drift.toFixed(0)}%`
    : drift <= -5 ? `일정 지연 ${drift.toFixed(0)}%` : '일정대로 진행';

  // 공정별 예산 대비 실집행
  const actByKey = {};
  (p.actuals || []).forEach(a => { actByKey[a.key] = (actByKey[a.key] || 0) + a.amount; });

  const phasesHTML = (p.phases || []).map(ph => {
    const spent = actByKey[ph.key] || 0;
    const evPh = Math.round(ph.budget * ph.pct / 100);
    const risk = evPh > 0 && spent > evPh * 1.1;
    return `<div class="phase">
      <div class="phase-head">
        <span><i class="swatch" style="background:${tradeOf(ph.key).color}"></i>${ph.name}</span>
        <span class="phase-b">${man(ph.budget)}원</span>
      </div>
      ${bar(ph.pct)}
      <input type="range" min="0" max="100" step="5" value="${ph.pct}" oninput="setPhase('${ph.key}', this.value)" aria-label="${ph.name} 진행률">
      ${clientView ? '' : `<div class="phase-cost ${risk ? 'risk' : ''}">기성 ${num(evPh)} · 집행 ${num(spent)}${risk ? ' · 초과' : ''}</div>`}
    </div>`;
  }).join('');

  const changesHTML = (p.changes || []).length ? `
    <div class="stack">
      ${p.changes.map(c => `<div class="co ${c.approved ? 'on' : ''}">
        <div><b>${esc(c.desc)}</b><small>${dateKR(c.date)} · ${c.approved ? '서면 합의 완료' : '승인 대기'}</small></div>
        <div class="co-right"><b>${num(c.amount)}</b>
          <button class="ghost sm" onclick="approveChange('${c.id}')">${c.approved ? '승인 취소' : '승인'}</button></div>
      </div>`).join('')}
    </div>` : `<p class="fine">등록된 추가공사가 없습니다. 추가공사는 반드시 서면 합의 후 진행하세요.</p>`;

  // 하자보수 보증 — 준공 후에도 앱을 다시 열 이유
  let warrantyHTML = '';
  if (p.completedAt) {
    const d1 = addDays(p.completedAt, 365), d5 = addDays(p.completedAt, 365 * 5);
    const left = Math.ceil((d1 - Date.now()) / 86400000);
    warrantyHTML = `<section class="block">
      <h3>하자보수 보증</h3>
      <div class="warr">
        <div><span>시공 하자</span><b>${left > 0 ? `D-${left}` : '만료'}</b><small>~ ${dateKR(d1)} (1년)</small></div>
        <div><span>자재 하자</span><b>${dateKR(d5)}</b><small>제조사 기준 5년</small></div>
      </div>
      <p class="fine">준공일 ${dateKR(p.completedAt)} 기준. 하자 발견 시 현장 탭의 하자 목록에 등록하세요.</p>
    </section>`;
  }

  wrap.innerHTML = `
    <button class="back" onclick="showProjects()">← 프로젝트 목록</button>
    <section class="block hero-block">
      <div class="card-head">
        <div><b class="big">${esc(p.title)}</b><small>${esc(p.addr || '주소 미입력')} · ${p.pyeong}평 · 공기 ${p.days}일</small></div>
        <span class="chip ${p.status === 'done' ? 'ok' : 'live'}">${statusLabel(p.status)}</span>
      </div>
      ${bar(prog)}
      <div class="rowline"><span>일정 경과 ${elapsed}%</span><b class="${drift < -5 ? 'neg' : drift > 5 ? 'pos' : ''}">${driftTxt}</b></div>
      <div class="numgrid">
        <div><span>계약금액</span><b>${man(con)}원</b></div>
        <div><span>기성고</span><b>${man(earned)}원</b></div>
        ${clientView ? '' : `<div><span>실집행</span><b class="${act > earned ? 'neg' : ''}">${man(act)}원</b></div>`}
      </div>
      ${!clientView && act > 0 ? (() => {
        const margin = con ? Math.round((con - act / Math.max(prog, 1) * 100) / con * 100) : 0;
        return `<div class="rowline"><span>예상 마진 (현 소진율 기준)</span><b class="${margin < 5 ? 'neg' : 'pos'}">${margin}%</b></div>`;
      })() : ''}
    </section>

    <section class="block">
      <h3>공정별 진행률 <small>${clientView ? '' : '예산 대비 집행'}</small></h3>
      ${phasesHTML || '<p class="fine">공정이 없습니다.</p>'}
      ${clientView ? '' : `<button class="ghost wide" onclick="addActual()">+ 집행 비용 기록</button>`}
    </section>

    <section class="block">
      <h3>추가공사 <small>원 견적 대비 ${con - p.budget > 0 ? '+' + man(con - p.budget) + '원' : '변동 없음'}</small></h3>
      ${changesHTML}
      <button class="ghost wide" onclick="addChange()">+ 추가공사 등록</button>
    </section>

    ${warrantyHTML}

    <div class="actions">
      <button class="primary" onclick="goDoc('${p.id}','quote')">문서 (견적서·공정표·결제)</button>
      <button onclick="openSite('${p.id}')">현장 기록</button>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   6. 문서 탭 — 견적서 / 공정표 / 계약·결제
   ══════════════════════════════════════════════════════════ */
function goDoc(src, tab) { docSource = src; docTab = tab || 'quote'; section('docs'); renderDocs(); }
function setDocTab(t) { docTab = t; renderDocs(); }
function docSrcObj() {
  if (docSource === 'draft') return { ...draft, _name: '작성 중 견적', _proj: null };
  const p = projects.find(x => x.id === docSource);
  if (!p) { docSource = 'draft'; return { ...draft, _name: '작성 중 견적', _proj: null }; }
  // baseline은 견적 스냅샷이라 결제·일정 같은 '이후에 바뀌는 값'을 갖고 있지 않다.
  // 프로젝트의 현재 값으로 덮어써야 사용자가 고친 결제 비율이 화면에 되돌아온다.
  return { ...p.baseline, title: p.title, addr: p.addr, pyeong: p.pyeong,
           startDate: p.startDate, payment: p.payment, _name: p.title, _proj: p };
}

function companyField(k, v) { company[k] = v; save('p14_company', company); }

function renderDocs() {
  const wrap = document.getElementById('docs-body');
  if (!wrap) return;
  const src = docSrcObj();
  const est = computeEstimate(src);

  const selector = `
    <div class="docbar">
      <select onchange="goDoc(this.value, docTab)">
        <option value="draft" ${docSource === 'draft' ? 'selected' : ''}>작성 중 견적${draft.title ? ' — ' + esc(draft.title) : ''}</option>
        ${projects.map(p => `<option value="${p.id}" ${docSource === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
      </select>
      <div class="tabs">
        ${[['quote','견적서'],['gantt','공정표'],['contract','계약서'],['pay','결제']].map(([k, l]) =>
          `<button class="${docTab === k ? 'on' : ''}" onclick="setDocTab('${k}')">${l}</button>`).join('')}
      </div>
    </div>`;

  if (!est.rows.length) {
    wrap.innerHTML = selector + `<div class="empty"><b>견적 항목이 없습니다.</b>
      <span>견적 탭에서 항목을 추가하면 견적서·공정표·결제 스케줄이 자동으로 만들어집니다.</span>
      <button class="primary" onclick="showEstimate()">견적 작성하기</button></div>`;
    return;
  }
  wrap.innerHTML = selector +
    (docTab === 'quote' ? quoteHTML(src, est)
      : docTab === 'gantt' ? ganttHTML(src)
      : docTab === 'contract' ? contractHTML(src, est)
      : payHTML(src, est));
}

function quoteHTML(src, est) {
  const valid = addDays(todayISO(), Number(company.validDays) || 15);
  return `
    <details class="rates">
      <summary><span>발행 정보 — 상호 · 사업자번호 · 연락처</span><i>▾</i></summary>
      <div class="rates-body co-fields">
        <label>상호 <input type="text" value="${esc(company.name)}" placeholder="○○인테리어" oninput="companyField('name', this.value)"></label>
        <label>대표 <input type="text" value="${esc(company.ceo)}" placeholder="홍길동" oninput="companyField('ceo', this.value)"></label>
        <label>사업자번호 <input type="text" value="${esc(company.biz)}" placeholder="000-00-00000" oninput="companyField('biz', this.value)"></label>
        <label>연락처 <input type="text" value="${esc(company.tel)}" placeholder="02-000-0000" oninput="companyField('tel', this.value)"></label>
        <label class="wide">주소 <input type="text" value="${esc(company.addr)}" placeholder="서울시 …" oninput="companyField('addr', this.value)"></label>
        <label>유효기간 <input type="number" min="1" max="180" value="${company.validDays}" oninput="companyField('validDays', this.value); renderDocs()">일</label>
      </div>
    </details>

    <div class="paper" id="quote-paper">
      <div class="paper-head">
        <h4>견 적 서</h4>
        <div class="paper-meta">
          <div><span>견적일</span><b>${dateKR(todayISO())}</b></div>
          <div><span>유효기간</span><b>${dateKR(valid)}까지</b></div>
        </div>
      </div>
      <div class="paper-parties">
        <div><span>현장</span><b>${esc(src.title || '(현장명 미입력)')}</b><small>${esc(src.addr || '')} · ${src.pyeong}평 (${Math.round((src.pyeong||0)*PY_M2)}㎡)</small></div>
        <div><span>공급자</span><b>${esc(company.name || '(상호 미입력)')}</b>
          <small>${company.ceo ? '대표 ' + esc(company.ceo) + ' · ' : ''}${esc(company.biz || '사업자번호 미입력')}</small>
          <small>${esc(company.tel || '')}${company.addr ? ' · ' + esc(company.addr) : ''}</small></div>
      </div>

      <div class="tbl-wrap">
        <table class="tbl paper-tbl">
          <thead><tr><th>공정</th><th>품명</th><th>규격</th><th class="num">수량</th><th>단위</th><th class="num">단가</th><th class="num">공급금액</th><th>비고</th></tr></thead>
          <tbody>
            ${est.groups.map(g => g.rows.map((r, i) => `
              <tr>
                <td>${i === 0 ? g.trade.name : ''}</td>
                <td><b>${esc(r.name)}</b></td>
                <td class="dim">${esc(r.spec)}</td>
                <td class="num">${r.qty}</td>
                <td>${esc(r.unit)}</td>
                <td class="num">${num(r.unitCost)}</td>
                <td class="num">${num(r.amount)}</td>
                <td class="dim">${esc(r.note)}</td>
              </tr>`).join('') + `
              <tr class="sub-row"><td colspan="6">${g.trade.name} 소계</td><td class="num">${num(g.subtotal)}</td><td></td></tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="paper-sum">
        <div><span>직접공사비</span><b>${num(est.direct)}</b></div>
        <div><span>제경비 (현장관리·일반관리·이윤)</span><b>${num(est.site + est.general + est.profit)}</b></div>
        <div><span>예비비 (${est.rates.contPct}%)</span><b>${num(est.cont)}</b></div>
        <div class="line"><span>공급가액</span><b>${num(est.supply)}</b></div>
        <div><span>부가세 (${est.rates.vatPct}%)</span><b>${num(est.vat)}</b></div>
        <div class="grand"><span>합계 금액</span><b>${won(est.total)}</b></div>
        <div class="perpy"><span>평당 공사비</span><b>${num(est.perPy)}원 / 평</b></div>
      </div>

      <ul class="paper-notes">
        <li>본 견적은 현장 실측 전 산출된 예상 견적이며, 현장 여건에 따라 변동될 수 있습니다.</li>
        <li>추가공사는 별도 서면 합의 후 진행하며, 합의 없는 추가 청구는 인정되지 않습니다.</li>
        <li>자재는 규격란에 기재된 등급을 기준으로 하며, 변경 시 단가가 조정됩니다.</li>
        <li>하자보수: 시공 1년 / 자재 제조사 기준. 잔금은 완공 후 하자 점검(14일) 이후 지급합니다.</li>
      </ul>

      <div class="paper-sign">
        <div><span>공급자</span><i></i><small>(인)</small></div>
        <div><span>건축주</span><i></i><small>(인)</small></div>
      </div>
      <p class="paper-fine">본 문서는 가상 시뮬레이션 산출물이며 실제 계약·청구 효력이 없습니다.</p>
    </div>

    <div class="actions">
      <button class="primary" onclick="printQuote()">견적서 인쇄 / PDF 저장</button>
      <button onclick="shareQuote()">요약 공유</button>
      <button class="ghost" onclick="toggleClientView()">${clientView ? '시공사 뷰로' : '건축주 뷰로'} 전환</button>
    </div>`;
}

function printQuote() {
  if (window.legionTrack) window.legionTrack('share', { kind:'quote_print' });
  note('견적서를 출력했습니다.');
  try { window.print(); } catch (e) { toast('인쇄를 지원하지 않는 환경입니다.', 'warn'); }
}
function shareQuote() {
  const src = docSrcObj(), est = computeEstimate(src);
  const txt = `[${src.title || '견적'}] ${src.pyeong}평 · 총 ${man(est.total)}원 (평당 ${num(est.perPy)}원)\n`
            + est.groups.map(g => `· ${g.trade.name} ${man(g.subtotal)}원`).join('\n')
            + `\n※ 가상 시뮬레이션 견적입니다.`;
  if (window.legionTrack) window.legionTrack('share', { kind:'quote_summary' });
  if (navigator.share) { navigator.share({ title: 'SiteForge 견적', text: txt }).catch(() => {}); return; }
  if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(() => toast('견적 요약을 복사했습니다.')).catch(() => toast('복사에 실패했습니다.', 'warn')); return; }
  toast('공유를 지원하지 않는 환경입니다.', 'warn');
}
function toggleClientView() {
  clientView = !clientView;
  const b = document.getElementById('cv-toggle');
  if (b) { b.classList.toggle('on', clientView); b.textContent = clientView ? '건축주 뷰' : '시공사 뷰'; }
  renderDocs();
  toast(clientView ? '건축주 뷰 — 원가·이윤을 숨깁니다.' : '시공사 뷰 — 원가·마진을 표시합니다.');
}

function ganttHTML(src) {
  const sch = computeSchedule(src);
  const start = new Date(src.startDate || todayISO());
  const W = 100 / sch.totalDays;
  return `
    <div class="gantt-head">
      <div><span>착공</span><b>${dateKR(start)}</b></div>
      <div><span>준공(예정)</span><b>${dateKR(addDays(start, sch.totalDays))}</b></div>
      <div><span>총 공기</span><b>${sch.totalDays}일</b></div>
    </div>
    <div class="gantt">
      ${sch.bars.map(b => `
        <div class="gantt-row">
          <div class="gantt-label"><i class="swatch" style="background:${b.trade.color}"></i>${b.trade.name}
            ${b.parallel ? '<em>병행</em>' : ''}</div>
          <div class="gantt-track">
            <div class="gantt-bar" style="left:${(b.start * W).toFixed(2)}%;width:${(b.days * W).toFixed(2)}%;background:${b.trade.color}">
              <span>${b.days}일</span>
            </div>
          </div>
          <div class="gantt-date">${dateKR(addDays(start, b.start))}</div>
        </div>`).join('')}
    </div>
    <p class="fine">공정 순서는 철거 → 설비·전기 → 목공 → 창호 → 타일·욕실 → 도장 → 도배 → 바닥 → 가구 → 조명 → 준공청소를 따릅니다.
    같은 단계로 묶인 공정(설비·전기, 타일·욕실)은 병행 시공됩니다. 계약 전 공정표를 반드시 확인하세요.</p>`;
}

function payHTML(src, est) {
  const sch = computeSchedule(src);
  const pay = paymentOf(src);
  const start = new Date(src.startDate || todayISO());
  const total = est.total;
  const sum = pay.reduce((a, x) => a + x.pct, 0);
  const down = pay[0] ? pay[0].pct : 0;
  // 국내 규칙: 공정위 표준약관은 계약금 10% 이하 권장, 30% 이상 선지급 요구는 위험 신호.
  const warn = down >= 30 ? { c:'bad',  t:`계약금 ${down}% — 30% 이상 선지급 요구는 사기 위험 신호로 분류됩니다.` }
             : down > 10  ? { c:'warn', t:`계약금 ${down}% — 공정위 표준약관 권장(10% 이하)을 초과합니다.` }
             : { c:'ok', t:`계약금 ${down}% — 공정위 표준약관 권장 범위입니다.` };
  return `
    <div class="alert ${warn.c}"><b>${warn.t}</b></div>
    <div class="pay-list">
      ${pay.map((x, i) => {
        const amt = Math.round(total * x.pct / 100);
        const when = i === 0 ? start
          : i === pay.length - 1 ? addDays(start, sch.totalDays + 14)
          : addDays(start, Math.round(sch.totalDays * (i / (pay.length - 1)) * 0.8));
        return `<div class="pay-row">
          <div class="pay-n">${i + 1}</div>
          <div class="pay-main">
            <b>${x.label}</b><small>${x.when} · ${dateKR(when)}</small>
            <div class="pay-track"><div style="width:${x.pct}%"></div></div>
          </div>
          <div class="pay-amt"><b>${num(amt)}</b><small>${x.pct}%</small>
            <input type="number" min="0" max="100" value="${x.pct}" oninput="setPayPct(${i}, this.value)" aria-label="${x.label} 비율">
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="rowline strong"><span>합계</span><b class="${sum !== 100 ? 'neg' : ''}">${sum}% · ${num(Math.round(total * sum / 100))}</b></div>
    ${sum !== 100 ? '<div class="alert warn slim">지급 비율 합계가 100%가 아닙니다.</div>' : ''}
    <section class="block">
      <h3>계약서 필수 항목 체크</h3>
      <ul class="check">
        ${['당사자 (상호·사업자번호·연락처)','공사 범위 (견적서 별첨)','자재 명세 (브랜드·모델·등급·규격)',
           '공사 기간 (착공·준공일)','계약 금액 (부가세 포함 여부)','대금 지급 시기·방법',
           'A/S·하자보수 기간 (시공 1년 / 자재 5년)','추가공사 서면 합의 조항',
           '지연 시 지체상금','분쟁 해결 방법'].map((t, i) =>
          `<li><input type="checkbox" id="ck${i}"><label for="ck${i}">${t}</label></li>`).join('')}
      </ul>
      <p class="fine">표준계약서는 공정거래위원회·한국실내건축가협회에서 무료로 배포합니다. 하자이행보증보험 조항 추가를 권장합니다.</p>
    </section>`;
}
function setPayPct(i, v) {
  const src = docSrcObj();
  const pay = paymentOf(src).map(x => ({ ...x }));
  pay[i].pct = clamp(parseInt(v, 10) || 0, 0, 100);
  if (src._proj) { src._proj.payment = pay; save('p14_projects', projects); }
  else { draft.payment = pay; saveDraft(); }
  renderDocs();
}

/* ── 공사도급계약서 생성 ──────────────────────────────────
   견적·공정표·결제 스케줄이 하나의 계약 문서로 조립된다.
   금액·기간·지체상금·하자보증금은 모두 데이터에서 결정적으로 계산된다. ── */
const CONTRACT_DEFAULTS = { client:'', clientAddr:'', delayRate:3, court:'서울중앙지방법원', warrantyBondPct:3 };
function contractMeta(src) {
  const base = src._proj ? (src._proj.contract || {}) : (draft.contract || {});
  return { ...CONTRACT_DEFAULTS, ...base };
}
function setContractField(k, v) {
  const src = docSrcObj();
  const m = contractMeta(src);
  m[k] = (k === 'delayRate' || k === 'warrantyBondPct') ? clamp(parseFloat(v) || 0, 0, 100) : v;
  if (src._proj) { src._proj.contract = m; save('p14_projects', projects); }
  else { draft.contract = m; saveDraft(); }
  // 비율 변경은 문서 전체 금액에 영향 → 전체 재렌더. 텍스트 필드는 저장만.
  if (k === 'delayRate' || k === 'warrantyBondPct') renderDocs();
}
function contractHTML(src, est) {
  const m = contractMeta(src);
  const sch = computeSchedule(src);
  const start = new Date(src.startDate || todayISO());
  const end = addDays(start, sch.totalDays);
  const total = est.total;
  const pay = paymentOf(src);
  const daily = Math.round(total * (Number(m.delayRate) || 0) / 1000);
  const bond  = Math.round(total * (Number(m.warrantyBondPct) || 0) / 100);
  const clause = (n, t, body) => `<div class="cl"><div class="cl-h">제${n}조 <b>(${t})</b></div><div class="cl-b">${body}</div></div>`;
  const payDate = i => i === 0 ? start
    : i === pay.length - 1 ? addDays(start, sch.totalDays + 14)
    : addDays(start, Math.round(sch.totalDays * (i / (pay.length - 1)) * 0.8));

  return `
    <details class="rates">
      <summary><span>계약 정보 — 도급인(건축주) · 지체상금 · 관할</span><i class="chev">▾</i></summary>
      <div class="rates-body co-fields">
        <label>도급인(건축주) <input type="text" value="${esc(m.client)}" placeholder="홍길동" oninput="setContractField('client', this.value)"></label>
        <label class="wide">도급인 주소 <input type="text" value="${esc(m.clientAddr)}" placeholder="서울시 …" oninput="setContractField('clientAddr', this.value)"></label>
        <label>지체상금율 <input type="number" min="0" max="100" step="0.5" value="${m.delayRate}" oninput="setContractField('delayRate', this.value)">‰(1000분율)</label>
        <label>하자보증금 <input type="number" min="0" max="100" step="1" value="${m.warrantyBondPct}" oninput="setContractField('warrantyBondPct', this.value)">%</label>
        <label class="wide">관할 법원 <input type="text" value="${esc(m.court)}" placeholder="서울중앙지방법원" oninput="setContractField('court', this.value)"></label>
      </div>
    </details>

    <div class="paper" id="contract-paper">
      <div class="paper-head">
        <h4>공 사 도 급 계 약 서</h4>
        <div class="paper-meta"><div><span>계약일</span><b>${dateKR(todayISO())}</b></div></div>
      </div>

      <p class="ct-intro">도급인 <b>${esc(m.client || '(건축주)')}</b>(이하 "갑")과 수급인 <b>${esc(company.name || '(시공사)')}</b>(이하 "을")은
      아래 현장의 인테리어 공사에 관하여 다음과 같이 도급계약을 체결한다.</p>

      <div class="paper-parties">
        <div><span>갑 (도급인·건축주)</span><b>${esc(m.client || '(성명 미입력)')}</b><small>${esc(m.clientAddr || '주소 미입력')}</small></div>
        <div><span>을 (수급인·시공사)</span><b>${esc(company.name || '(상호 미입력)')}</b>
          <small>${company.ceo ? '대표 ' + esc(company.ceo) + ' · ' : ''}${esc(company.biz || '사업자번호 미입력')}</small>
          <small>${esc(company.tel || '')}${company.addr ? ' · ' + esc(company.addr) : ''}</small></div>
      </div>

      <div class="clauses">
        ${clause(1, '공사 개요', `
          <table class="cl-tbl">
            <tr><th>공사명</th><td>${esc(src.title || '(현장명 미입력)')} 인테리어 공사</td></tr>
            <tr><th>공사 장소</th><td>${esc(src.addr || '(주소 미입력)')}</td></tr>
            <tr><th>공사 규모</th><td>${src.pyeong || 0}평 (${Math.round((src.pyeong || 0) * PY_M2)}㎡)</td></tr>
            <tr><th>공사 범위</th><td>${est.groups.map(g => g.trade.name).join(' · ')} — 총 ${est.groups.length}개 공정 (세부 내역 별첨 견적서)</td></tr>
          </table>`)}
        ${clause(2, '도급 금액', `
          <div class="ct-amount">금 <b>${num(total)}</b> 원정 <small>(부가가치세 포함 / 평당 ${num(est.perPy)}원)</small></div>
          <p>공급가액 ${num(est.supply)}원 + 부가세 ${num(est.vat)}원. 세부 산출 근거는 별첨 견적서에 따른다.</p>`)}
        ${clause(3, '공사 기간', `
          착공 <b>${dateKR(start)}</b> · 준공 <b>${dateKR(end)}</b> (총 ${sch.totalDays}일).
          공정표(별첨)에 따르며, 천재지변·갑의 사유로 인한 지연은 공기에서 제외한다.`)}
        ${clause(4, '대금 지급', `
          <table class="cl-tbl pay">
            <thead><tr><th>구분</th><th>시기</th><th class="num">비율</th><th class="num">금액</th></tr></thead>
            <tbody>${pay.map((x, i) => `<tr><td>${esc(x.label)}</td><td class="dim">${esc(x.when)} (${dateKR(payDate(i))})</td><td class="num">${x.pct}%</td><td class="num">${num(Math.round(total * x.pct / 100))}</td></tr>`).join('')}</tbody>
          </table>
          <p>잔금은 준공 및 하자 점검(14일) 완료 후 지급한다.</p>`)}
        ${clause(5, '지체상금', `
          을의 귀책으로 준공이 지연될 경우, 지연 1일당 도급금액의 <b>${m.delayRate}/1000</b>
          (1일 <b>${num(daily)}원</b>)을 지체상금으로 갑에게 지급한다.`)}
        ${clause(6, '하자담보책임', `
          시공 하자 <b>1년</b> · 자재 하자 <b>제조사 기준(통상 5년)</b>. 을은 하자보수를 보증하기 위하여
          도급금액의 <b>${m.warrantyBondPct}%</b> (<b>${num(bond)}원</b>)를 하자보수보증금으로 갈음하며, 하자담보 기간 만료 시 반환한다.`)}
        ${clause(7, '추가·변경 공사', `
          공사 범위 외 추가·변경 공사는 반드시 <b>서면 합의</b> 후 시행하며, 합의 없는 추가 청구는 인정하지 않는다.`)}
        ${clause(8, '분쟁 해결', `
          본 계약과 관련한 분쟁은 갑·을 상호 협의로 해결하되, 협의가 이루어지지 않을 경우
          <b>${esc(m.court || '관할 법원')}</b>을 제1심 관할 법원으로 한다.`)}
      </div>

      <p class="ct-close">본 계약의 성립을 증명하기 위하여 계약서 2부를 작성하고 갑·을이 서명·날인 후 각 1부씩 보관한다.</p>
      <div class="paper-meta ct-date"><b>${dateKR(todayISO())}</b></div>

      <div class="paper-sign ct-sign">
        <div><span>도급인 (갑)</span><b>${esc(m.client || '')}</b><i></i><small>(서명·인)</small></div>
        <div><span>수급인 (을)</span><b>${esc(company.name || '')}</b><i></i><small>(서명·인)</small></div>
      </div>
      <p class="paper-fine">본 문서는 가상 시뮬레이션 산출물이며 실제 계약·법률 효력이 없습니다. 실제 계약 시 공정거래위원회 표준하도급계약서 등 정식 양식을 사용하세요.</p>
    </div>

    <div class="actions">
      <button class="primary" onclick="printContract()">계약서 인쇄 / PDF 저장</button>
      <button onclick="goDoc(docSource,'quote')">별첨 견적서 보기</button>
      <button class="ghost" onclick="goDoc(docSource,'pay')">결제 스케줄</button>
    </div>`;
}
function printContract() {
  if (window.legionTrack) window.legionTrack('share', { kind:'contract_print' });
  note('공사도급계약서를 출력했습니다.');
  try { window.print(); } catch (e) { toast('인쇄를 지원하지 않는 환경입니다.', 'warn'); }
}

/* ══════════════════════════════════════════════════════════
   7. 현장 탭 — 작업일지(음성) · 사진 · 하자(펀치리스트)
   ══════════════════════════════════════════════════════════ */
function openSite(id) { if (id) siteProjectId = id; section('site'); renderSite(); }
function showSite() { openSite(null); }
function setSiteProject(id) { siteProjectId = id; renderSite(); }

function renderSite() {
  const wrap = document.getElementById('site-body');
  if (!wrap) return;
  if (!siteProjectId && projects.length) siteProjectId = projects[0].id;
  const p = projects.find(x => x.id === siteProjectId);
  const ph = photos.filter(x => x.proj === siteProjectId);
  const pu = punch.filter(x => x.proj === siteProjectId);
  const open = pu.filter(x => x.status !== 'fixed').length;

  const sel = projects.length ? `
    <select class="site-pick" onchange="setSiteProject(this.value)">
      ${projects.map(x => `<option value="${x.id}" ${x.id === siteProjectId ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}
    </select>` : '';

  if (!p) {
    wrap.innerHTML = `<div class="empty"><b>현장이 없습니다.</b>
      <span>프로젝트를 먼저 만들면 작업일지·사진·하자 목록을 기록할 수 있습니다.</span>
      <button class="primary" onclick="showEstimate()">견적 작성하기</button></div>`;
    return;
  }

  wrap.innerHTML = `
    ${sel}
    <section class="block">
      <h3>작업일지 <small>오늘 ${dateKR(todayISO())}</small></h3>
      <div class="log-actions">
        <button class="primary" onclick="recordVoiceLog()">🎙 음성으로 기록</button>
        <button onclick="addTextLog()">✍️ 텍스트로 기록</button>
      </div>
      <div id="voice-preview"></div>
      <div class="stack">
        ${logs.slice(0, 6).map(l => `<div class="log">
          <div><b>${esc(l.title)}</b><small>${new Date(l.ts).toLocaleString('ko-KR')}</small></div>
          <p>${esc(l.desc)}</p>
          ${l.urgency >= 0.6 ? '<span class="badge over">긴급</span>' : ''}
        </div>`).join('') || '<p class="fine">아직 작업일지가 없습니다. 인력·자재·날씨·특이사항을 남기세요.</p>'}
      </div>
    </section>

    <section class="block">
      <h3>현장 사진 <small>${ph.length}장</small></h3>
      <label class="photo-add">
        <input type="file" accept="image/*" onchange="addPhoto(this)" hidden>
        <span>＋ 사진 추가 (공정·전후 기록)</span>
      </label>
      ${ph.length ? `<div class="photo-grid">
        ${ph.slice(0, 12).map(x => `<figure class="photo">
          <img src="${x.data}" alt="${esc(x.label)}" loading="lazy">
          <figcaption>${esc(x.label)}<small>${dateKR(x.date)}</small></figcaption>
          <button class="icon del" onclick="delPhoto('${x.id}')" title="삭제">✕</button>
        </figure>`).join('')}
      </div>` : '<p class="fine">공정별·일자별로 사진을 남기면 준공 후 분쟁에서 가장 강한 증적이 됩니다.</p>'}
    </section>

    <section class="block">
      <h3>하자 목록 (펀치리스트) <small>${open}건 미완료</small></h3>
      ${pu.length ? `<div class="stack">
        ${pu.map(x => `<div class="punch ${x.status}">
          <div><b>${esc(x.title)}</b><small>${esc(x.loc)} · ${dateKR(x.date)}</small></div>
          <div class="punch-act">
            <span class="chip ${x.status === 'fixed' ? 'ok' : x.status === 'recheck' ? 'warn' : 'live'}">${{open:'미조치',recheck:'재검사',fixed:'완료'}[x.status]}</span>
            <button class="ghost sm" onclick="cyclePunch('${x.id}')">상태 변경</button>
          </div>
        </div>`).join('')}
      </div>` : '<p class="fine">잔금은 완공 후 하자 점검(1~2주) 뒤 지급이 표준입니다. 점검 항목을 여기에 등록하세요.</p>'}
      <button class="ghost wide" onclick="addPunch()">+ 하자 등록</button>
    </section>

    <section class="block">
      <h3>활동 기록 <small>전체 현장 공통</small></h3>
      <div class="stack">
        ${codex.slice(0, 8).map(c => `<div class="note"><small>${new Date(c.time).toLocaleString('ko-KR')}</small>${esc(c.note)}</div>`).join('')
          || '<p class="fine">견적·계약·추가공사 기록이 자동으로 쌓입니다.</p>'}
      </div>
    </section>`;
}

function addTextLog() {
  const t = prompt('작업일지 (인력·자재·날씨·특이사항)');
  if (!t) return;
  addLog('현장 보고', t, 0.3);
  renderSite();
}
function addLog(title, desc, urgency) {
  logs.unshift({ id: uid(), title, desc, urgency: urgency || 0.3, ts: Date.now() });
  if (logs.length > 60) logs.pop();
  save('p14_logs', logs);
  // 하위호환: 기존 긴급도 엔진이 p14_logs.surprise를 읽는다
  logs.forEach(l => { if (l.surprise == null) l.surprise = l.urgency; });
  save('p14_logs', logs);
}
function recordVoiceLog() {
  const pv = document.getElementById('voice-preview');
  if (pv) pv.innerHTML = '<div class="rec">● 녹음 중… (4초)</div>';
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { voiceFallback(pv); return; }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const rec = new MediaRecorder(stream); const chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type:'audio/webm' }));
      const u = window.getP6LungSurprise ? window.getP6LungSurprise() : 0.4;
      if (pv) pv.innerHTML = `<audio controls src="${url}"></audio><div class="fine">긴급도 ${u.toFixed(2)} — 높을수록 일지 상단에 노출됩니다.</div>`;
      addLog('음성 작업일지', `음성 기록 · 긴급도 ${u.toFixed(2)}`, u);
      stream.getTracks().forEach(t => t.stop());
      renderSite();
    };
    rec.start(); setTimeout(() => { try { rec.stop(); } catch (e) {} }, 4000);
  }).catch(() => voiceFallback(pv));
}
function voiceFallback(pv) {
  if (pv) pv.innerHTML = '<div class="fine">마이크를 사용할 수 없어 텍스트 일지로 대체합니다.</div>';
  addTextLog();
}

// 사진: 캔버스로 축소 저장(로컬 용량 보호). 원본 업로드/전송 없음.
function addPhoto(input) {
  const f = input && input.files && input.files[0];
  if (!f) return;
  if (photos.filter(x => x.proj === siteProjectId).length >= 12) { toast('현장당 사진은 12장까지 저장됩니다.', 'warn'); return; }
  const label = prompt('사진 설명 (예: 철거 후 / 주방 타일 시공)') || '현장 사진';
  const rd = new FileReader();
  rd.onload = e => {
    const img = new Image();
    img.onload = () => {
      const max = 640, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      try {
        photos.unshift({ id: uid(), proj: siteProjectId, label, date: todayISO(), data: cv.toDataURL('image/jpeg', 0.6) });
        save('p14_photos', photos);
        renderSite(); toast('사진을 기록했습니다.');
      } catch (err) { toast('저장 공간이 부족합니다. 오래된 사진을 지워주세요.', 'warn'); }
    };
    img.src = e.target.result;
  };
  rd.readAsDataURL(f);
}
function delPhoto(id) { photos = photos.filter(x => x.id !== id); save('p14_photos', photos); renderSite(); }

function addPunch() {
  const title = prompt('하자 내용 (예: 거실 걸레받이 들뜸)'); if (!title) return;
  const loc = prompt('위치 (예: 거실 남측)') || '위치 미기재';
  punch.unshift({ id: uid(), proj: siteProjectId, title, loc, status:'open', date: todayISO() });
  save('p14_punch', punch);
  note(`하자 등록: ${title} (${loc}).`);
  renderSite();
}
function cyclePunch(id) {
  const x = punch.find(y => y.id === id); if (!x) return;
  x.status = x.status === 'open' ? 'recheck' : x.status === 'recheck' ? 'fixed' : 'open';
  save('p14_punch', punch); renderSite();
}

/* ══════════════════════════════════════════════════════════
   8. 자재 탭 — 스펙 명세 + 발주 (분쟁 1순위 원인이 자재 스펙)
   ══════════════════════════════════════════════════════════ */
const MATERIAL_SPECS = [
  { id:'m1', trade:'floor', name:'강마루', brand:'국산 A사', model:'GM-750', grade:'친환경 E0', size:'1200×150×7.5T', unit:'평', price:120000 },
  { id:'m2', trade:'paper', name:'실크 벽지', brand:'국산 B사', model:'SW-2400', grade:'방염 1급', size:'106cm 광폭', unit:'평', price:45000 },
  { id:'m3', trade:'tile',  name:'욕실 벽타일', brand:'국산 C사', model:'BT-3060', grade:'도기질 1등급', size:'300×600', unit:'㎡', price:90000 },
  { id:'m4', trade:'furn',  name:'주방 상판', brand:'국산 D사', model:'HN-900', grade:'인조대리석', size:'2400×600×12T', unit:'자', price:180000 },
  { id:'m5', trade:'window',name:'이중창 샷시', brand:'국산 E사', model:'WS-240', grade:'단열 2등급', size:'24mm 복층유리', unit:'평', price:300000 },
  { id:'m6', trade:'bath',  name:'양변기', brand:'국산 F사', model:'CT-1030', grade:'절수 1등급', size:'투피스 305mm', unit:'개', price:280000 }
];
function showTrade() { section('materials'); renderMaterials(); }
function renderMaterials() {
  const wrap = document.getElementById('materials-body');
  if (!wrap) return;
  wrap.innerHTML = `
    <p class="lead">계약서 별첨 자재 명세는 <b>브랜드 · 모델명 · 등급 · 규격 · 수량</b>이 모두 기재되어야 합니다.
    이 항목이 빠진 견적이 시공 분쟁의 1순위 원인입니다.</p>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr><th>품명</th><th>브랜드 / 모델</th><th>등급</th><th>규격</th><th class="num">단가</th><th></th></tr></thead>
        <tbody>
          ${MATERIAL_SPECS.map(m => `<tr>
            <td><b>${m.name}</b><small>${tradeOf(m.trade).name}</small></td>
            <td>${m.brand}<small>${m.model}</small></td>
            <td><span class="chip sm">${m.grade}</span></td>
            <td class="dim">${m.size}</td>
            <td class="num">${num(m.price)}<small>/${m.unit}</small></td>
            <td><button class="ghost sm" onclick="orderMaterial('${m.id}')">발주</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="credit-chip">발주 시뮬레이션 잔액 <b>${num(credits)}</b> 크레딧 <small>— 가상 단위이며 견적 금액(원)과 무관합니다.</small></div>`;
}
function orderMaterial(id) {
  const m = MATERIAL_SPECS.find(x => x.id === id); if (!m) return;
  const qty = parseFloat(prompt(`${m.name} 발주 수량 (${m.unit})`) || '0');
  if (!(qty > 0)) { toast('수량을 올바르게 입력하세요.', 'warn'); return; }
  const cost = Math.max(1, Math.round(m.price * qty / 100000));
  if (credits < cost) { toast('발주 시뮬레이션 잔액이 부족합니다.', 'warn'); return; }
  credits -= cost; save('p14_credits', credits);
  note(`자재 발주: ${m.name} ${qty}${m.unit} (${m.brand} ${m.model} · ${m.grade}).`);
  renderMaterials();
  toast(`${m.name} ${qty}${m.unit} 발주 — 납기 3~5일 (시뮬레이션)`);
}

/* ══════════════════════════════════════════════════════════
   8.5 단가표 탭 — 마이 단가표(Price Book)
   프로 시공사의 핵심 자산은 "자기 단가표". 기본 시세 위에 자기 단가를 얹고
   자기 품목을 추가하면, 견적 피커·계산·시세 판정이 전부 이 값을 읽는다.
   ══════════════════════════════════════════════════════════ */
let pbQuery = '';
function showPricebook() { section('pricebook'); renderPricebook(); }

function pbEdit(id, field, v) {
  const val = Math.max(0, Math.round(parseFloat(v) || 0));
  const cx = customItems.find(c => c.id === id);
  if (cx) {
    cx[field] = val;
    if (field === 'cost') { if (cx.low > val) cx.low = val; if (cx.high < val) cx.high = val; }
    saveCustom();
  } else {
    priceBook[id] = priceBook[id] || {};
    priceBook[id][field] = val;
    saveBook();
  }
  renderPricebook();
  refreshTotals();  // 견적 화면이 열려 있으면 즉시 반영
}
function pbAuto(id, v) {
  const cx = customItems.find(c => c.id === id); if (!cx) return;
  cx.autoQty = Math.max(1, Math.round(parseFloat(v) || 1)); saveCustom();
}
function pbReset(id) {
  delete priceBook[id]; saveBook(); renderPricebook(); refreshTotals();
  toast('기본 시세 단가로 복원했습니다.');
}
function pbResetAll() {
  if (!Object.keys(priceBook).length) { toast('수정한 단가가 없습니다.'); return; }
  if (!confirm('수정한 단가를 모두 기본값으로 되돌릴까요? (직접 추가한 품목은 유지)')) return;
  priceBook = {}; saveBook(); renderPricebook(); refreshTotals();
  toast('모든 단가를 기본 시세로 복원했습니다.');
}
function pbAddCustom() {
  const name = (document.getElementById('pb-new-name') || {}).value;
  const trade = (document.getElementById('pb-new-trade') || {}).value || 'etc';
  const unit = ((document.getElementById('pb-new-unit') || {}).value || '식').trim() || '식';
  const cost = Math.max(0, Math.round(parseFloat((document.getElementById('pb-new-cost') || {}).value) || 0));
  const spec = ((document.getElementById('pb-new-spec') || {}).value || '').trim();
  if (!name || !name.trim()) { toast('품명을 입력하세요.', 'warn'); return; }
  if (!(cost > 0)) { toast('단가를 입력하세요.', 'warn'); return; }
  const item = { id: 'cx_' + uid(), trade, name: name.trim(), spec: spec || '직접 등록 품목',
                 unit, cost, low: cost, high: cost, autoQty: 1 };
  customItems.push(normalizeCustom([item])[0]);
  saveCustom();
  note(`단가표에 품목 추가: ${item.name} — ${num(cost)}/${unit} (${tradeOf(trade).name}).`);
  renderPricebook();
  toast(`"${item.name}" 품목을 단가표에 추가했습니다.`);
}
function pbDelCustom(id) {
  const cx = customItems.find(c => c.id === id); if (!cx) return;
  if (!confirm(`"${cx.name}" 품목을 단가표에서 삭제할까요?`)) return;
  customItems = customItems.filter(c => c.id !== id); saveCustom();
  renderPricebook(); toast('품목을 삭제했습니다.');
}
function pbSearch(v) {
  pbQuery = String(v || '').trim().toLowerCase();
  const list = document.getElementById('pb-list');
  if (list) list.innerHTML = pbListHTML();
}

function pbListHTML() {
  const eff = effectiveCatalog();
  const q = pbQuery;
  const match = c => !q || (c.name + ' ' + (c.spec || '') + ' ' + tradeOf(c.trade).name).toLowerCase().includes(q);
  let out = '';
  TRADES.forEach(t => {
    const items = eff.filter(c => c.trade === t.key && match(c));
    if (!items.length) return;
    out += `<details class="pb-grp" ${q ? 'open' : ''}>
      <summary><span><i class="swatch" style="background:${t.color}"></i>${t.name}</span>
        <small>${items.length}품목</small><i class="chev">▾</i></summary>
      <div class="pb-rows">
        ${items.map(c => {
          const edited = c.edited || c.custom;
          return `<div class="pb-item ${edited ? 'on' : ''}">
            <div class="pb-item-head">
              <div class="pb-name"><b>${esc(c.name)}</b>
                ${c.custom ? '<span class="badge cx">직접</span>' : c.edited ? '<span class="badge ed">수정</span>' : ''}
                <small>${esc(c.spec || '')}</small></div>
              ${c.custom
                ? `<button class="icon" onclick="pbDelCustom('${c.id}')" title="품목 삭제">✕</button>`
                : c.edited ? `<button class="ghost sm" onclick="pbReset('${c.id}')">기본값</button>` : ''}
            </div>
            <div class="pb-grid">
              <label>단가 <span class="u">원/${esc(c.unit)}</span>
                <input type="number" min="0" step="1000" value="${c.cost}" onchange="pbEdit('${c.id}','cost',this.value)" aria-label="${esc(c.name)} 단가"></label>
              <label>시세 하한
                <input type="number" min="0" step="1000" value="${c.low}" onchange="pbEdit('${c.id}','low',this.value)" aria-label="${esc(c.name)} 시세 하한"></label>
              <label>시세 상한
                <input type="number" min="0" step="1000" value="${c.high}" onchange="pbEdit('${c.id}','high',this.value)" aria-label="${esc(c.name)} 시세 상한"></label>
              ${c.custom
                ? `<label>표준수량 <span class="u">${esc(c.unit)}</span><input type="number" min="1" step="1" value="${c.autoQty || 1}" onchange="pbAuto('${c.id}',this.value)" aria-label="${esc(c.name)} 표준수량"></label>`
                : `<div class="pb-band">기본 시세 ${num(itemOfBase(c.id).low)}~${num(itemOfBase(c.id).high)}</div>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </details>`;
  });
  return out || `<div class="empty"><b>검색 결과가 없습니다.</b><span>다른 품명·공정으로 다시 찾아보세요.</span></div>`;
}
function itemOfBase(id) { return CATALOG.find(i => i.id === id) || { low: 0, high: 0 }; }

function renderPricebook() {
  const wrap = document.getElementById('pricebook-body');
  if (!wrap) return;
  const editedCount = Object.keys(priceBook).length;
  const customCount = customItems.length;
  wrap.innerHTML = `
    <p class="lead">기본 시세 단가 위에 <b>내 단가</b>를 얹거나 <b>내 품목</b>을 추가하세요.
    여기서 고친 단가는 견적 작성의 기본값과 시세 점검 기준에 바로 반영됩니다.</p>

    <div class="pb-kpi">
      <div><b>${CATALOG.length}</b><span>기본 품목</span></div>
      <div class="${editedCount ? 'on' : ''}"><b>${editedCount}</b><span>내가 수정</span></div>
      <div class="${customCount ? 'on' : ''}"><b>${customCount}</b><span>직접 추가</span></div>
      <button class="ghost sm" onclick="pbResetAll()" ${editedCount ? '' : 'disabled'}>전체 복원</button>
    </div>

    <details class="pb-add">
      <summary><span>＋ 내 품목 추가 — 카탈로그에 없는 시공 항목</span><i class="chev">▾</i></summary>
      <div class="pb-add-body">
        <label class="wide">품명 <input type="text" id="pb-new-name" placeholder="예: 아트월 대리석 시공"></label>
        <label>공정
          <select id="pb-new-trade">${TRADES.map(t => `<option value="${t.key}">${t.name}</option>`).join('')}</select>
        </label>
        <label>단위 <input type="text" id="pb-new-unit" placeholder="㎡ / 식 / 개소" value="식"></label>
        <label>단가 <input type="number" id="pb-new-cost" min="0" step="1000" placeholder="원"></label>
        <label class="wide">규격/사양 <input type="text" id="pb-new-spec" placeholder="예: 이태리산 대리석 20T"></label>
        <button class="primary" onclick="pbAddCustom()">단가표에 추가</button>
      </div>
    </details>

    <div class="pb-searchbar">
      <input type="search" id="pb-search" placeholder="품명·공정 검색" value="${esc(pbQuery)}" oninput="pbSearch(this.value)" aria-label="단가 검색">
    </div>

    <div id="pb-list">${pbListHTML()}</div>
    <p class="fine">단가는 공개 시세 범위를 참고한 예시값입니다. 실제 자재 등급·현장 여건에 따라 조정하세요. 가상 시뮬레이션.</p>`;
}

/* ══════════════════════════════════════════════════════════
   9. 대시보드
   ══════════════════════════════════════════════════════════ */
function showDashboard() {
  section('dashboard');
  const wrap = document.getElementById('dash-body');
  if (!wrap) return;

  if (!projects.length) {
    wrap.innerHTML = `<div class="empty hero-empty">
      <b>견적 한 장으로 시작하세요.</b>
      <span>평형과 시공 범위를 고르면 공정별 라인아이템 견적 · 공정표 · 결제 스케줄이 한 번에 만들어집니다.</span>
      <button class="primary" onclick="showEstimate()">견적 작성하기</button>
    </div>
    <div class="anchor-card">
      <h3>2026 국내 인테리어 시세 기준</h3>
      <div class="anchors">
        <div><b>200~250만원</b><span>아파트 평당 공사비</span></div>
        <div><b>10~20%</b><span>권장 예비비</span></div>
        <div><b>10% 이하</b><span>표준약관 권장 계약금</span></div>
        <div><b>1년 / 5년</b><span>시공 / 자재 하자보수</span></div>
      </div>
      <p class="fine">공개 유통되는 시세 범위를 참고한 기준값입니다. 견적 작성 시 단가 점검에 사용됩니다.</p>
    </div>`;
    return;
  }

  let con = 0, earned = 0, act = 0, openPunch = 0;
  projects.forEach(p => { con += contractSum(p); earned += earnedValue(p); act += actualSum(p); });
  punch.forEach(x => { if (x.status !== 'fixed') openPunch++; });
  const pct = con ? +(earned / con * 100).toFixed(1) : 0;

  wrap.innerHTML = `
    <section class="block hero-block">
      <div class="kpi">
        <div class="kpi-hero">
          <span class="kpi-label">수주 잔고 (계약금액)</span>
          <span class="kpi-big">${man(con)}<em>원</em></span>
          <span class="kpi-sub">현장 ${projects.length}곳 · 기성 ${man(earned)}원</span>
        </div>
        <div class="kpi-side">
          ${clientView ? '' : `<div class="kpi-mini"><b>${con ? Math.round((con - act) / con * 100) : 0}%</b><span>잔여 마진</span></div>`}
          <div class="kpi-mini ${openPunch ? 'warn' : ''}"><b>${openPunch}</b><span>미조치 하자</span></div>
        </div>
      </div>
      ${bar(pct)}
    </section>

    <section class="block">
      <h3>진행 중 현장</h3>
      <div id="map"></div>
      <div class="stack">
        ${projects.slice(0, 4).map(p => `<div class="mini" onclick="openProject('${p.id}')">
          <div><b>${esc(p.title)}</b><small>${esc(p.addr || '주소 미입력')} · ${p.pyeong}평</small></div>
          <div class="mini-right"><b>${man(contractSum(p))}원</b>${bar(projectProgress(p), 'thin')}</div>
        </div>`).join('')}
      </div>
    </section>

    <div class="actions">
      <button class="primary" onclick="showEstimate()">+ 새 견적</button>
      <button onclick="goDoc('draft','quote')">문서</button>
    </div>`;
  setTimeout(initMap, 200);
}

function initMap() {
  const el = document.getElementById('map');
  if (!el || map) return;
  if (typeof L === 'undefined') { el.innerHTML = '<p class="map-off">현장 지도 (오프라인)</p>'; return; }
  try {
    map = L.map('map').setView([37.5, 127], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  } catch (e) { el.innerHTML = '<p class="map-off">현장 지도 (오프라인)</p>'; }
}

/* ══════════════════════════════════════════════════════════
   10. 공통 — 섹션 전환 · 노트 · 하위호환
   ══════════════════════════════════════════════════════════ */
function section(id) {
  const all = document.querySelectorAll('.section');
  if (all && all.forEach) all.forEach(s => s.classList.add('hidden'));
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
  const nav = document.querySelectorAll('.nav button');
  if (nav && nav.forEach) nav.forEach(b => b.classList.toggle('active', b.dataset.section === id));
  try { window.scrollTo(0, 0); } catch (e) {}
}
function note(text) {
  codex.unshift({ time: Date.now(), note: text });
  if (codex.length > 40) codex.pop();
  save('p14_codex', codex);
}

// 하위호환 별칭 (이전 버전 진입점 유지)
function showVoice() { showSite(); }
function showCodex() { showSite(); }
function showPreview() { goDoc('draft', 'quote'); }
function connectWallet() { wallet = '계정-' + Math.random().toString(16).slice(2, 8); toast('발주 시뮬레이션 계정이 연결되었습니다.'); }
function updatePreviewFromCodex() { /* 게임형 미리보기 제거 — 문서 탭이 대체 */ }
function updateUI() { /* no-op */ }

/* ══════════════════════════════════════════════════════════
   11. 부팅
   ══════════════════════════════════════════════════════════ */
function initP14() {
  // 데모 시드 — 빈 화면 대신 실제 구조를 보여준다
  if (!projects.length && !load('p14_seeded', false)) {
    save('p14_seeded', true);
    const py = 32;
    const lines = TEMPLATES.find(t => t.key === 'standard').ids.map(id => {
      const c = itemOf(id);
      return { itemId: id, trade: c.trade, qty: Math.max(1, Math.round(c.auto(py))), unitCost: c.cost, note: '' };
    });
    const base = { lines, rates: { ...RATE_DEFAULTS }, pyeong: py, startDate: todayISO() };
    const est = computeEstimate(base);
    const sch = computeSchedule(base);
    projects = [{
      id: uid(), title: '반포 래미안 32평 리모델링', addr: '서울 서초구', pyeong: py,
      startDate: addDays(todayISO(), -12).toISOString().slice(0, 10), days: sch.totalDays,
      baseline: base, budget: est.total, payment: defaultPayment(sch.totalDays),
      phases: est.groups.map((g, i) => ({ key: g.trade.key, name: g.trade.name, budget: g.subtotal, pct: i < 3 ? 100 : (i === 3 ? 40 : 0) })),
      changes: [], actuals: [], status: 'live', completedAt: null, createdAt: new Date().toISOString()
    }];
    save('p14_projects', projects);
  }
  siteProjectId = projects.length ? projects[0].id : null;
  showDashboard();
}
window.onload = initP14;

try{ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', renderBqLoop); else setTimeout(renderBqLoop,80); }catch(e){}

/* LEGION_WAVE_6_pipe_ensure */

(function(){try{
  if(document.getElementById('moneyPipe'))return;
  var d=document.createElement('div');
  d.innerHTML='<div id="moneyPipe" style="margin-top:12px;padding:10px;border:1px solid #c5a46e44;border-radius:12px;background:#16121c;text-align:center;font-size:12px"><div style="color:#e0b552;font-weight:700;margin-bottom:4px">pipe</div><a style="color:#ece8f1;margin:0 6px" href="mailto:hoyashi95@gmail.com?subject=%5BLegion%5D">mail</a><a style="color:#e0b552;margin:0 6px" href="https://hosuman08-netizen.github.io/legion-hub/">Hub</a></div>';
  var app=document.getElementById('app')||document.body;
  app.appendChild(d.firstElementChild||d);
}catch(e){}
/* LEGION_WAVE_51_share_counter */
document.addEventListener('click',function(ev){try{var el=ev.target;if(!el)return;var tx=(el.textContent||'')+(el.id||'');if(/share|copy/i.test(tx)||/\uacf5\uc720|\ubcf5\uc0ac/.test(tx)){localStorage.setItem('lw_p14_construc_share_counter',String((+(localStorage.getItem('lw_p14_construc_share_counter')||0))+1));}}catch(e){}},true);
})();
/* LEGION_WAVE_96_pipe_ensure */ /* pipe already present wave 96 */
