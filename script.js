// Rubik Timer script

const display = document.getElementById('display');
const startStopBtn = document.getElementById('startStop');
const lapBtn = document.getElementById('lap');
const resetBtn = document.getElementById('reset');
const lapsList = document.getElementById('lapsList');
const timesTableBody = document.querySelector('#timesTable tbody');
const bestSingleEl = document.getElementById('bestSingle');
const bestAo5El = document.getElementById('bestAo5');
const bestAo12El = document.getElementById('bestAo12');
const sizeSelect = document.getElementById('sizeSelect');
const openScramblerBtn = document.getElementById('openScrambler');
const okStartBtn = document.getElementById('okStart');

// modal elements will be created dynamically
let modalBackdrop = null;
let scramblerState = null; // holds cube state

let running = false;
// ----------------- YouTube player support -----------------
    cancelHoldVisual();
  }, 1500);
  startHoldVisual(1500);
});

window.addEventListener('keyup', e => {
  if (e.code !== 'Space') return;
  // if hold timer still pending -> short press (do nothing when stopped)
  if (keyboardHoldTimer) {
    clearTimeout(keyboardHoldTimer);
    keyboardHoldTimer = null;
    cancelHoldVisual();
    return;
  }
  // if started by hold, ignore the keyup (don't stop)
  if (keyboardStartedByHold) {
    keyboardStartedByHold = false;
    return;
  }
});

// Pointer/touch: tap to stop when running; hold 2000ms on screen to start when stopped.
document.body.addEventListener('pointerdown', e => {
  // ignore interactions on buttons
  if (e.target.closest && e.target.closest('button')) return;
  // if running, mark as potential stop (tap)
  if (running) {
    pointerIsStopCandidate = true;
    return;
  }
  // if not running, start only after 2000ms hold
  if (pointerHoldTimer) return;
  pointerHoldTimer = setTimeout(() => {
    start();
    pointerStartedByHold = true;
    pointerHoldTimer = null;
    cancelHoldVisual();
  }, 2000);
  startHoldVisual(2000);
});

document.body.addEventListener('pointerup', e => {
  if (e.target.closest && e.target.closest('button')) return;
  // if a start-timer was pending but not reached -> cancel
  if (pointerHoldTimer) {
    clearTimeout(pointerHoldTimer);
    pointerHoldTimer = null;
    cancelHoldVisual();
  }
  // if started by hold -> ignore this up
  if (pointerStartedByHold) {
    pointerStartedByHold = false;
    return;
  }
  // if running and this was a tap (stop candidate), stop
  if (running && pointerIsStopCandidate) {
    stop();
  }
  pointerIsStopCandidate = false;
});

document.body.addEventListener('pointercancel', () => {
  if (keyboardHoldTimer) { clearTimeout(keyboardHoldTimer); keyboardHoldTimer = null; }
  if (pointerHoldTimer) { clearTimeout(pointerHoldTimer); pointerHoldTimer = null; }
  keyboardStartedByHold = false; pointerStartedByHold = false; pointerIsStopCandidate = false;
  cancelHoldVisual();
});

function startHoldVisual(duration){
  if(!holdIndicator) return;
  cancelHoldVisual();
  holdDuration = duration;
  holdStartTS = performance.now();
  function tick(){
    const now = performance.now();
    const pct = Math.max(0, Math.min(1, (now - holdStartTS) / holdDuration));
    holdIndicator.style.setProperty('--p', `${pct*100}%`);
    if(pct >= 1) return; // will be cleared in timeout callback
    holdRaf = requestAnimationFrame(tick);
  }
  holdRaf = requestAnimationFrame(tick);
}

function cancelHoldVisual(){
  if(!holdIndicator) return;
  if(holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = null;
  holdIndicator.style.setProperty('--p','0%');
}

// initialize
display.textContent = formatTime(0);
renderLaps();

// populate size select
for(let s=3;s<=12;s++){
  const opt = document.createElement('option'); opt.value = s; opt.textContent = s+"x"+s; if(s===3) opt.selected=true; sizeSelect.appendChild(opt);
}

openScramblerBtn.addEventListener('click', ()=>openScrambler(parseInt(sizeSelect.value,10)));

okStartBtn.addEventListener('click', ()=>{
  // when user confirms start after scramble: close modal if open and start timer (reset behavior handled by start())
  if(modalBackdrop && modalBackdrop.classList.contains('show')) modalBackdrop.classList.remove('show');
  // ensure display resets and start immediately
  start();
});

/* SCRAMBLER: render simple NxN cube (outer-layer rotations only) and apply scramble moves */
function openScrambler(size){
  // create modal if not exist
  if(!modalBackdrop){
    modalBackdrop = document.createElement('div'); modalBackdrop.className='modal-backdrop';
    const modal = document.createElement('div'); modal.className='modal';
    modal.innerHTML = `
      <div class="scramble-panel">
        <div class="scramble-list-wrap"><ol id="scrambleList"></ol></div>
        <div class="modal-controls">
          <button id="doScramble">Generate Scramble</button>
          <button id="closeModal">Close</button>
        </div>
        <div class="modal-confirm" style="text-align:center;margin-top:8px;"><button id="confirmScramble" style="display:none;">OK</button></div>
      </div>`;
    modalBackdrop.appendChild(modal);
    document.body.appendChild(modalBackdrop);
    modalBackdrop.addEventListener('click', (e)=>{ if(e.target===modalBackdrop) modalBackdrop.classList.remove('show'); });
    modal.querySelector('#closeModal').addEventListener('click', ()=>modalBackdrop.classList.remove('show'));
    modal.querySelector('#doScramble').addEventListener('click', ()=>{
      const sz = parseInt(sizeSelect.value,10);
      const seq = generateScramble(sz);
      showScrambleSequence(seq);
    });
    modal.querySelector('#confirmScramble').addEventListener('click', ()=>{
      modalBackdrop.classList.remove('show');
    });
  }
  // prepare (clear) scramble list for given size
  renderScramblerCube(size);
  modalBackdrop.classList.add('show');
}

function renderScramblerCube(size){
  // Instead of rendering a 3D cube, prepare the scramble list container.
  const list = document.getElementById('scrambleList');
  if(list) list.innerHTML = '';
  scramblerState = {size:size, seq:[]};
}

// scrambler view rotation state (degrees)
let scramblerRotX = -25, scramblerRotY = 25;
function setScramblerRotation(x,y){
  scramblerRotX = x; scramblerRotY = y;
  const cubeEl = document.getElementById('scramblerCube');
  if(cubeEl) cubeEl.style.transform = `rotateX(${scramblerRotX}deg) rotateY(${scramblerRotY}deg)`;
}
function rotateScrambler(deltaX, deltaY){
  setScramblerRotation(scramblerRotX + deltaX, scramblerRotY + deltaY);
}

function generateScramble(size){
  const faces = ['U','D','F','B','L','R'];
  const seq = [];
  const moves = Math.max(20, size*10);
  for(let i=0;i<moves;i++){
    const f = faces[Math.floor(Math.random()*faces.length)];
    const suffix = Math.random()<0.2 ? '2' : (Math.random()<0.5?"'":"");
    seq.push(f+suffix);
  }
  return seq;
}

function showScrambleSequence(seq){
  scramblerState = scramblerState || {};
  scramblerState.seq = seq;
  const list = document.getElementById('scrambleList');
  const confirm = document.getElementById('confirmScramble');
  if(!list) return;
  list.innerHTML = '';
  // reveal moves sequentially for clarity
  let i=0;
  function showNext(){
    if(i>=seq.length){ if(confirm) confirm.style.display='inline-block'; return; }
    const li = document.createElement('li'); li.textContent = seq[i++];
    list.appendChild(li);
    // scroll into view
    list.scrollTop = list.scrollHeight;
    setTimeout(showNext, 80);
  }
  showNext();
}

// Mark todo completed
try{ 
  // update todo status via manage_todo_list (best-effort; tool previously used from assistant) 
}catch(e){}

// ----------------- YouTube player support -----------------
// ----------------- Methods / Cases Viewer -----------------
const openMethodsBtn = document.getElementById('openMethods');
const methodsModal = document.getElementById('methodsModal');
const methodsListEl = document.getElementById('methodsList');
const methodNameEl = document.getElementById('methodName');
const methodDescEl = document.getElementById('methodDesc');
const casesWrap = document.getElementById('casesWrap');
const closeMethodsBtn = document.getElementById('closeMethods');

const methodsData = [
  {
    id: 'beginner', title: "Cơ bản (Beginner)",
    desc: "Dành cho người mới: Cross → F2L sơ bộ → OLL cơ bản → PLL.",
    cases: [
      {name:'Cross', notes:'Xây chữ thập trên mặt trắng; tập gọi tên cặp cạnh.', alg:"(no alg - practice lookahead)"},
      {name:'F2L (basic)', notes:'Ghép cặp góc-cạnh tầng giữa bằng tay trái/phải.', alg:"U R U' R'\nL' U' L U"},
      {name:'OLL (basic)', notes:"Một số OLL cơ bản: Sune, Antisune, H, T. Tập nhận dạng và alg.", alg:[
        {name:'Sune', alg:"R U R' U R U2 R'"},
        {name:'Anti-Sune', alg:"R U2 R' U' R U' R'"},
        {name:'H (edges)', alg:"M2 U M2 U2 M2 U M2"},
        {name:'T (corners)', alg:"R U R' U' R' F R2 U' R' U' R U R' F'"}
      ]},
      {name:'PLL (basic)', notes:'Một vài PLL: Ua, Ub, E, A-perm. Tập hoán vị tầng trên.', alg:[
        {name:'Ua perm', alg:"(R U' R U) R U R U' R' U' R2"},
        {name:'Ub perm', alg:"R2 U R U R' U' R' U' R' U R'"},
        {name:'E perm', alg:"x' R U' R D R' U R D' x"},
        {name:'A perm', alg:"x' R U' R D R' U R D' x"}
      ]}
    ]
  },
  {
    id:'cfop', title:'CFOP (Speedcubing)',
    desc: 'CFOP: Cross → F2L → OLL → PLL (đầy đủ bộ alg để nhanh).',
    cases:[
      {name:'Full OLL', notes:'57 cases — học từng nhóm (edge orientation, corner orientation).', alg:'See OLL tables — many algs.'},
      {name:'Full PLL', notes:'21 cases — học theo loại cycle: 3-cycle, 4-cycle.', alg:'Ua: R U' R U R U R U' R' U' R2'},
      {name:'F2L lookahead', notes:'Kỹ thuật quan sát để ghép cặp liên tục.'}
    ]
  },
  {
    id:'roux', title:'Roux',
    desc: 'Phương pháp Roux: block-building + CMLL + LSE. Tập block 1 và 2.',
    cases:[
      {name:'Blocks', notes:'Xây 1x2x3 block ở hai bên.'},
      {name:'CMLL', notes:'Orient và permute corners of last layer with few algs.', alg:'R U R' + "..."},
      {name:'LSE', notes:'Solve last six edges.'}
    ]
  },
  {
    id:'advanced', title:'Nâng cao (ZBLL / COLL)',
    desc: 'ZBLL/COLL dành cho người đã thành thạo OLL/PLL; học nhiều alg.',
    cases:[
      {name:'COLL', notes:'C-surface orientation + corner permutation — ~42 cases.'},
      {name:'ZBLL', notes:'23 edge orientations × many corner perms — rất nhiều alg.'}
    ]
  }
];

function renderMethodsList(){
  if(!methodsListEl) return;
  methodsListEl.innerHTML = '';
  methodsData.forEach(m=>{
    const li = document.createElement('li');
    li.style.padding = '8px 6px';
    li.style.cursor = 'pointer';
    li.style.borderRadius = '6px';
    li.textContent = m.title;
    li.addEventListener('click', ()=>selectMethod(m.id));
    methodsListEl.appendChild(li);
  });
}

function selectMethod(id){
  const m = methodsData.find(x=>x.id===id);
  if(!m) return;
  if(methodNameEl) methodNameEl.textContent = m.title;
  if(methodDescEl) methodDescEl.textContent = m.desc;
  if(casesWrap) {
    casesWrap.innerHTML = '';
    // controls: expand/collapse all
    const ctrl = document.createElement('div'); ctrl.style.display='flex'; ctrl.style.gap='8px'; ctrl.style.marginBottom='8px';
    const btnAll = document.createElement('button'); btnAll.textContent='Mở rộng tất cả'; btnAll.className='primary';
    const btnCollapse = document.createElement('button'); btnCollapse.textContent='Thu gọn tất cả';
    ctrl.appendChild(btnAll); ctrl.appendChild(btnCollapse);
    casesWrap.appendChild(ctrl);

    const caseEls = [];
    m.cases.forEach(c=>{
      const card = document.createElement('div');
      card.className = 'method-case';
      card.style.border = '1px solid rgba(0,0,0,0.06)';
      card.style.padding = '8px';
      card.style.borderRadius = '8px';
      card.style.marginBottom = '8px';
      card.style.cursor = 'pointer';

      const header = document.createElement('div'); header.style.display='flex'; header.style.justifyContent='space-between'; header.style.alignItems='center';
      const h = document.createElement('div'); h.style.fontWeight='700'; h.textContent = c.name;
      const toggleIcon = document.createElement('div'); toggleIcon.textContent = '▸'; toggleIcon.style.opacity = '0.7'; toggleIcon.style.marginLeft='8px';
      header.appendChild(h); header.appendChild(toggleIcon);

      const details = document.createElement('div'); details.style.display='none'; details.style.marginTop='8px';
      const p = document.createElement('div'); p.className='muted'; p.textContent = c.notes; details.appendChild(p);
      // alg(s)
      if(c.alg){
        if(Array.isArray(c.alg)){
          c.alg.forEach(a=>{
            const name = a.name ? a.name : '';
            if(name){ const an = document.createElement('div'); an.style.fontWeight='600'; an.style.marginTop='8px'; an.textContent = name; details.appendChild(an); }
            const pre = document.createElement('pre'); pre.style.marginTop='6px'; pre.style.background='rgba(0,0,0,0.02)'; pre.style.padding='8px'; pre.style.borderRadius='6px';
            pre.textContent = a.alg || a; details.appendChild(pre);
          });
        } else {
          const pre = document.createElement('pre'); pre.style.marginTop='8px'; pre.style.background='rgba(0,0,0,0.02)'; pre.style.padding='8px'; pre.style.borderRadius='6px';
          pre.textContent = c.alg; details.appendChild(pre);
        }
      }

      card.appendChild(header); card.appendChild(details);
      card.addEventListener('click', ()=>{
        const opened = details.style.display !== 'none';
        details.style.display = opened ? 'none' : 'block';
        toggleIcon.textContent = opened ? '▸' : '▾';
      });
      caseEls.push({card, details, toggleIcon});
      casesWrap.appendChild(card);
    });

    btnAll.addEventListener('click', ()=>{ caseEls.forEach(e=>{ e.details.style.display='block'; e.toggleIcon.textContent='▾'; }); });
    btnCollapse.addEventListener('click', ()=>{ caseEls.forEach(e=>{ e.details.style.display='none'; e.toggleIcon.textContent='▸'; }); });
  }
}

if(openMethodsBtn) openMethodsBtn.addEventListener('click', ()=>{
  console.log('openMethods clicked');
  try{ alert('Mở Methods modal (debug)'); }catch(e){}
  if(methodsModal) methodsModal.classList.add('show');
  renderMethodsList();
  selectMethod('beginner');
});
// fallback: event delegation in case direct listener didn't attach
document.body.addEventListener('click', (e)=>{
  const el = e.target.closest && e.target.closest('#openMethods');
  if(el){
    console.log('delegated openMethods click');
    try{ alert('Mở Methods modal (delegated debug)'); }catch(e){}
    if(methodsModal) methodsModal.classList.add('show'); renderMethodsList(); selectMethod('beginner');
  }
});
if(closeMethodsBtn) closeMethodsBtn.addEventListener('click', ()=>{ if(methodsModal) methodsModal.classList.remove('show'); });
if(methodsModal) methodsModal.addEventListener('click', (e)=>{ if(e.target===methodsModal) methodsModal.classList.remove('show'); });

// expose quick select of beginner by default when opened
function openAndSelectDefault(){ renderMethodsList(); selectMethod('beginner'); if(methodsModal) methodsModal.classList.add('show'); }

let ytAPILoaded = false;
let ytPlayer = null;
let ytReady = false;

function parseYouTubeId(url){
  if(!url) return null;
  // common patterns
  const m = url.match(/(?:v=|\/embed\/|\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function loadYouTubeAPI(cb){
  if(ytAPILoaded){ cb && cb(); return; }
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  window.onYouTubeIframeAPIReady = function(){ ytAPILoaded = true; cb && cb(); };
  document.head.appendChild(tag);
}

function createYTPlayer(videoId){
  if(!videoId) return;
  const wrap = document.getElementById('ytPlayer');
  wrap.innerHTML = '<div id="ytiframe"></div>';
  ytPlayer = new YT.Player('ytiframe', {
    height: '360', width: '640', videoId: videoId,
    playerVars: { rel:0, modestbranding:1, controls:1 },
    events: {
      onReady: function(){ ytReady = true; document.getElementById('ytPlayerWrap').style.display = 'block'; },
      onStateChange: function(e){ /* optional */ }
    }
  });
}

function ensurePlayerForUrl(url){
  const id = parseYouTubeId(url);
  if(!id) return false;
  loadYouTubeAPI(()=>{
    // if already player with same id, keep
    if(ytPlayer && ytPlayer.getVideoData && ytPlayer.getVideoData().video_id === id){ document.getElementById('ytPlayerWrap').style.display='block'; return; }
    createYTPlayer(id);
  });
  return true;
}

document.getElementById('ytLoad').addEventListener('click', ()=>{
  const url = document.getElementById('ytUrl').value.trim();
  if(!url){ alert('Please paste a YouTube link.'); return; }
  const ok = ensurePlayerForUrl(url);
  if(!ok) alert('Không nhận diện được link YouTube.');
});

document.getElementById('ytPlay').addEventListener('click', ()=>{
  // if no player but URL present, create player first
  const url = document.getElementById('ytUrl').value.trim();
  if(!ytPlayer){ if(!ensurePlayerForUrl(url)) { alert('No video loaded'); return; } }
  // play (user interaction)
  if(ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo();
});

document.getElementById('ytStop').addEventListener('click', ()=>{
  if(ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  document.getElementById('ytPlayerWrap').style.display = 'none';
});

// add .running class automatically when timer runs
const displayEl = document.getElementById('display');
const origStart = start;
start = function(){
  origStart();
  if(displayEl) displayEl.classList.add('running');
}
const origStop = stop;
stop = function(){
  origStop();
  if(displayEl) displayEl.classList.remove('running');
}
