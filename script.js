// Flappy Bird amélioré : responsive, difficulté progressive, UI/UX améliorée et sons procéduraux
(() => {
  // single-file game controller
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // DOM
  const startOverlay = document.getElementById('startOverlay');
  const startBtn = document.getElementById('startBtn');
  const audioToggle = document.getElementById('audioToggle');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const closeSettings = document.getElementById('closeSettings');
  const volumeRange = document.getElementById('volume');
  const diffRange = document.getElementById('difficultyRange');
  const loadingOverlay = document.getElementById('loading');
  const gameOverModal = document.getElementById('gameOver');
  const restartBtn = document.getElementById('restartBtn');
  const shareBtn = document.getElementById('shareBtn');
  const finalScore = document.getElementById('finalScore');
  const finalBest = document.getElementById('finalBest');
  const bestSpan = document.getElementById('bestScore');
  const floating = document.getElementById('floating');

  // hi-DPI fit
  function fitCanvas(){
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // Ensure bird isn't positioned too far left on wide/horizontal screens:
    // place it at least at 1/3 of the canvas width (keeps gameplay more centered)
    try{
      const minX = Math.floor(rect.width / 3);
      bird.x = Math.max(bird.x || 140, minX, 140);
    }catch(e){ /* ignore during early init */ }
  }
  // make canvas fill its container (we use CSS full-viewport)
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  fitCanvas(); window.addEventListener('resize', fitCanvas);

  // state
  let frames = 0, pipes = [], particles = [], clouds = [];
  let running = false, score = 0, best = Number(localStorage.getItem('flappy-best') || 0);
  bestSpan.textContent = best;

  // base config
  const base = { gap:150, width:72, speed:2.6, spawnInterval:92 };
  let difficulty = Number(localStorage.getItem('flappy-difficulty') || 1);
  // score-based gap progression settings
  // gap will linearly shrink from gapStart -> gapMin over scoreRange points
  const gapStart = Math.floor(base.gap * 1.6); // start larger (e.g. ~240)
  const gapMin = 100; // minimum gap
  const gapScoreRange = 10; // number of score points over which gap reaches gapMin
  let lastPipeTop = null; // remember last pipe top to limit vertical jumps between pipes

  const bird = { x: 140, y: 240, r: 20, dy:0, gravity:0.56, lift:-11, maxFall:14, rotation:0 };

  // images (SVGs provided in assets/) - preloaded
  const images = {};
  function loadImage(name, path){
    return new Promise(resolve => {
      const img = new Image(); img.src = path; img.onload = () => { images[name]=img; resolve(true); }; img.onerror = () => { resolve(false); };
    });
  }

  // load assets (SVGs added in repo)
  async function preload(){
    loadingOverlay.classList.remove('hidden');
    const list = [ ['bird','assets/bird.svg'], ['pipe','assets/pipe.svg'], ['cloud','assets/cloud.svg'], ['bg','assets/bg.svg'] ];
    const results = await Promise.all(list.map(([n,p]) => loadImage(n,p)));
    // create clouds for parallax even if asset missing
    for(let i=0;i<6;i++){ clouds.push({x: Math.random()*canvas.clientWidth, y: 40 + Math.random()*150, speed: 0.2 + Math.random()*0.6, scale: 0.6 + Math.random()*0.8}); }
    loadingOverlay.classList.add('hidden');
  }

  // audio (WebAudio) - persistent settings
  let audioEnabled = (localStorage.getItem('flappy-audio') !== 'off');
  let audioVolume = Number(localStorage.getItem('flappy-volume') || 0.9);
  let audioCtx=null, masterGain=null, musicNode=null;
  function ensureAudio(){ if(!audioEnabled) return null; if(!audioCtx){ try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); masterGain=audioCtx.createGain(); masterGain.gain.value=audioVolume; masterGain.connect(audioCtx.destination);}catch(e){audioEnabled=false; return null;} } return audioCtx; }
  function setVolume(v){ audioVolume=v; localStorage.setItem('flappy-volume', v); if(masterGain) masterGain.gain.setValueAtTime(v, audioCtx.currentTime); }

  function createNoiseBuffer(){ const actx=audioCtx; const len=actx.sampleRate*1.5; const buf=actx.createBuffer(1,len,actx.sampleRate); const d=buf.getChannelData(0); for(let i=0;i<len;i++) d[i]=Math.random()*2-1; return buf; }

  function playSfx(type){
    const actx = ensureAudio();
    if(!actx) return;
    const now = actx.currentTime;
    if(type === 'flap'){
      // Mario-like jump: short rising tone with lowpass for warmth
      const o = actx.createOscillator();
      const g = actx.createGain();
      const f = actx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, now);
      o.frequency.exponentialRampToValueAtTime(750, now + 0.09);
      f.type = 'lowpass'; f.frequency.setValueAtTime(1800, now);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      o.connect(f); f.connect(g); g.connect(masterGain);
      o.start(now); o.stop(now + 0.35);
    } else if(type === 'point'){
      // Coin/chime: two quick bell-like sines
      function bell(freq, t){
        const o = actx.createOscillator();
        const g = actx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
        o.connect(g); g.connect(masterGain);
        o.start(t); o.stop(t + 0.32);
      }
      bell(880, now);
      bell(1188, now + 0.06);
    } else if(type === 'crash'){
      // Impact: low thud + short noise
      const low = actx.createOscillator();
      const lg = actx.createGain();
      low.type = 'sine'; low.frequency.setValueAtTime(60, now);
      lg.gain.setValueAtTime(0.0001, now);
      lg.gain.linearRampToValueAtTime(0.7, now + 0.02);
      lg.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
      low.connect(lg); lg.connect(masterGain);
      low.start(now); low.stop(now + 0.72);

      const buf = actx.createBuffer(1, actx.sampleRate * 0.25, actx.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i] = (Math.random()*2-1) * Math.exp(-i/2400);
      const src = actx.createBufferSource(); src.buffer = buf;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(800, now);
      const ng = actx.createGain(); ng.gain.setValueAtTime(0.5, now); ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      src.connect(hp); hp.connect(ng); ng.connect(masterGain);
      src.start(now); src.stop(now + 0.28);
    }
  }

  // music: scheduler with melody/bass/kick/hat + delay
  function startMusic(){ const actx=ensureAudio(); if(!actx) return; stopMusic(); const tempo=110, beat=60/tempo; const melody=[440,392,330,392,440,494,440,392]; let idx=0; let nextTime=actx.currentTime+0.05; const lookahead=0.1; const delay=actx.createDelay(); delay.delayTime.value=0.18; const fb=actx.createGain(); fb.gain.value=0.22; delay.connect(fb); fb.connect(delay); delay.connect(masterGain); const noise=createNoiseBuffer(); function scheduleNote(t,f,d=0.36){ const o=actx.createOscillator(), g=actx.createGain(); o.type='sawtooth'; o.frequency.setValueAtTime(f,t); g.gain.setValueAtTime(0.0006,t); g.gain.linearRampToValueAtTime(0.05,t+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+d); o.connect(g); g.connect(delay); o.start(t); o.stop(t+d+0.02);} function scheduleBass(t,f){ const o=actx.createOscillator(), g=actx.createGain(); o.type='sine'; o.frequency.setValueAtTime(f,t); g.gain.setValueAtTime(0.0006,t); g.gain.linearRampToValueAtTime(0.03,t+0.03); g.gain.exponentialRampToValueAtTime(0.0001,t+0.5); o.connect(g); g.connect(delay); o.start(t); o.stop(t+0.6);} function scheduleKick(t){ const o=actx.createOscillator(), g=actx.createGain(); o.type='sine'; o.frequency.setValueAtTime(120,t); o.frequency.exponentialRampToValueAtTime(30,t+0.18); g.gain.setValueAtTime(0.001,t); g.gain.exponentialRampToValueAtTime(0.08,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.45); o.connect(g); g.connect(delay); o.start(t); o.stop(t+0.45);} function scheduleHat(t){ const s=actx.createBufferSource(); s.buffer=noise; const hp=actx.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=7000; const g=actx.createGain(); g.gain.setValueAtTime(0.001,t); g.gain.exponentialRampToValueAtTime(0.06,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.12); s.connect(hp); hp.connect(g); g.connect(delay); s.start(t); s.stop(t+0.12);} function scheduler(){ const now=actx.currentTime; while(nextTime < now + 0.6){ const note = melody[idx % melody.length]; scheduleNote(nextTime, note, beat*0.9); if(idx % 2 === 0) scheduleBass(nextTime, note/2); if(idx % 2 === 0) scheduleKick(nextTime); scheduleHat(nextTime + beat*0.25); nextTime += beat*0.5; idx++; } } const timer = setInterval(scheduler, Math.floor(lookahead*1000)); musicNode = {timer, delay}; scheduler(); }
  function stopMusic(){ if(musicNode){ try{ clearInterval(musicNode.timer); }catch(e){} musicNode=null; } }

  // difficulty and config
  function updateDifficulty(){ difficulty = Number(diffRange ? diffRange.value : difficulty) || 1; }
  function currentConfig(){
    updateDifficulty();
    // width & speed still affected by difficulty
    let width = Math.max(48, base.width + Math.floor((difficulty - 1) * 6));
    let speed = base.speed + (difficulty - 1) * 0.6;
    let spawnInterval = Math.max(48, Math.floor(base.spawnInterval - (difficulty -1) * 12));

    // score-based gap: start large and shrink toward gapMin as score increases
    const t = Math.min(1, score / gapScoreRange);
    const gap = Math.round(gapStart + (gapMin - gapStart) * t);

    return { gap, width, speed, spawnInterval };
  }

  // spawn pipe
  function spawnPipe(initial=false){
    const cfg = currentConfig();
    const rect = canvas.getBoundingClientRect();
    const playableH = Math.max(0, rect.height - 140);
    const minTop = 60;
    const maxTop = Math.max(minTop, 60 + playableH - cfg.gap);

    // pick a candidate top within allowed range
    let top = minTop + Math.random() * Math.max(0, maxTop - minTop);

    // limit vertical difference from previous pipe so consecutive pipes aren't extreme
    if(lastPipeTop !== null){
      const maxDelta = Math.max(80, Math.floor(cfg.gap * 0.9)); // limit how far next pipe can move
      const allowedMin = Math.max(minTop, lastPipeTop - maxDelta);
      const allowedMax = Math.min(maxTop, lastPipeTop + maxDelta);
      // clamp top into allowed range
      top = Math.min(allowedMax, Math.max(allowedMin, top));
    }

    // spawn closer to the right edge on wide screens to reduce empty travel distance
    const offset = initial ? Math.max(20, rect.width * 0.02) : 20;
    const x = Math.round(rect.width - offset);
    pipes.push({x: x, top, width: cfg.width, gap: cfg.gap, passed:false, rot:(Math.random()-0.5)*0.04, wobble:0});
    lastPipeTop = top;
  }

  // UI effects
  function emitScoreBubble(x,y,txt){ const el=document.createElement('div'); el.className='float-bubble'; el.textContent=txt; floating.appendChild(el); const rect=canvas.getBoundingClientRect(); const left=x/canvas.clientWidth*rect.width+rect.left; const top=y/canvas.clientHeight*rect.height+rect.top; el.style.left=`${left}px`; el.style.top=`${top}px`; el.style.fontSize='20px'; const anim=el.animate([{transform:'translate(-50%,-50%) translateY(0)', opacity:1},{transform:'translate(-50%,-80%)', opacity:0}],{duration:900,easing:'cubic-bezier(.2,.9,.3,1)'}); anim.onfinish=()=>el.remove(); }

  // particles on crash
  function explode(x,y){ for(let i=0;i<24;i++){ particles.push({x,y,vx:(Math.random()-0.5)*6,vy:(Math.random()-0.9)*6,life:60,color:`hsl(${40+Math.random()*40},80%,55%)`}); } }

  function reset(){
    frames = 0;
    pipes = [];
    particles = [];
    score = 0;
    running = true;
    const rect = canvas.getBoundingClientRect();
    bird.y = (rect.height/2) || (canvas.clientHeight/2);
    // ensure bird is not too far left; keep at least 1/3 from left
    bird.x = Math.max(Math.floor(rect.width / 3), 140);
    bird.dy = 0;
    startOverlay.classList.add('hidden');
    gameOverModal.classList.add('hidden');
    // spawn an initial pipe right away so there's not a long empty gap on widescreens
    spawnPipe(true);
    if(audioEnabled) startMusic();
  }
  function endGame(){ running=false; gameOverModal.classList.remove('hidden'); finalScore.textContent = score; if(score>best){ best=score; localStorage.setItem('flappy-best', best); } finalBest.textContent=best; bestSpan.textContent=best; explode(bird.x,bird.y); if(audioEnabled) playSfx('crash'); stopMusic(); }

  function update(){ frames++; const cfg=currentConfig(); bird.dy += bird.gravity; if(bird.dy > bird.maxFall) bird.dy = bird.maxFall; bird.y += bird.dy; bird.rotation = Math.max(-0.6, Math.min(1.2, bird.dy/12)); if(frames % cfg.spawnInterval === 0) spawnPipe(); for(let i=pipes.length-1;i>=0;i--){ const p=pipes[i]; p.x -= cfg.speed; p.wobble += 0.02; if(!p.passed && p.x + p.width < bird.x - bird.r){ p.passed=true; score++; emitScoreBubble(bird.x, bird.y - 30, '+1'); if(audioEnabled) playSfx('point'); } if(p.x + p.width < -100) pipes.splice(i,1); } if(bird.y - bird.r <= 0){ bird.y = bird.r; bird.dy = 0; } if(bird.y + bird.r >= canvas.clientHeight - 40){ bird.y = canvas.clientHeight - 40 - bird.r; endGame(); } for(const p of pipes){ if(bird.x + bird.r > p.x && bird.x - bird.r < p.x + p.width){ if(bird.y - bird.r < p.top || bird.y + bird.r > p.top + p.gap){ endGame(); } } } // particles
    for(let i=particles.length-1;i>=0;i--){ const q=particles[i]; q.x += q.vx; q.y += q.vy; q.vy += 0.18; q.life--; if(q.life<=0) particles.splice(i,1); }
  }

  function draw(){ ctx.clearRect(0,0,canvas.width,canvas.height); const cw=canvas.clientWidth, ch=canvas.clientHeight; // bg
    if(images['bg']) ctx.drawImage(images['bg'], 0, 0, cw, ch); else { const g=ctx.createLinearGradient(0,0,0,ch); g.addColorStop(0,'#7ad0dd'); g.addColorStop(1,'#baf0ff'); ctx.fillStyle=g; ctx.fillRect(0,0,cw,ch); }
    // clouds parallax
    for(const c of clouds){ c.x -= c.speed; if(c.x < -200) c.x = cw + 60; if(images['cloud']) ctx.drawImage(images['cloud'], c.x, c.y, 220*c.scale, 120*c.scale); else { ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.ellipse(c.x+80, c.y+30, 60*c.scale,28*c.scale,0,0,Math.PI*2); ctx.fill(); } }
    // ground
    ctx.fillStyle='#6ec06e'; ctx.fillRect(0,ch-40,cw,40);
    // pipes
    for(const p of pipes){ const px=p.x, pw=p.width, topH=p.top, bottomY=p.top + p.gap; ctx.save(); ctx.translate(px+pw/2,0); ctx.rotate(Math.sin(p.wobble)*p.rot); ctx.translate(-(px+pw/2),0); if(images['pipe']){ const bottomH = ch - bottomY - 40; ctx.drawImage(images['pipe'], px, 0, pw, topH); ctx.drawImage(images['pipe'], px, bottomY, pw, bottomH); } else { ctx.fillStyle='#2ea44f'; ctx.fillRect(px,0,pw,topH); ctx.fillRect(px,bottomY,pw,ch-bottomY-40); ctx.fillStyle='rgba(0,0,0,0.08)'; ctx.fillRect(px, Math.max(0,topH-8), pw, 8); } ctx.restore(); }
    // bird
    const bf = images['bird']; if(bf){ const bw=48, bh=36; ctx.save(); ctx.translate(bird.x,bird.y); ctx.rotate(bird.rotation); ctx.drawImage(bf,-bw/2,-bh/2,bw,bh); ctx.restore(); } else { ctx.save(); ctx.translate(bird.x,bird.y); ctx.rotate(bird.rotation); ctx.beginPath(); ctx.fillStyle='#ffdd57'; ctx.ellipse(0,0,bird.r,bird.r*0.85,0,0,Math.PI*2); ctx.fill(); ctx.closePath(); const wf=Math.sin(frames/6)*6; ctx.fillStyle='#f3c14a'; ctx.beginPath(); ctx.ellipse(-4,4+wf/6,bird.r*0.6,bird.r*0.25,-0.4,0,Math.PI*2); ctx.fill(); ctx.closePath(); ctx.beginPath(); ctx.fillStyle='#222'; ctx.arc(6,-4,3,0,Math.PI*2); ctx.fill(); ctx.closePath(); ctx.restore(); }
    // particles
    for(const q of particles){ ctx.fillStyle=q.color; ctx.beginPath(); ctx.globalAlpha = Math.max(0, q.life/60); ctx.arc(q.x, q.y, Math.max(1, q.life/6), 0, Math.PI*2); ctx.fill(); ctx.globalAlpha = 1; }
    // HUD
    ctx.fillStyle='rgba(0,0,0,0.35)'; ctx.font='20px system-ui,Arial'; ctx.fillText(`Score: ${score}`, 12, 28);
  }

  function loop(){ if(running) update(); draw(); requestAnimationFrame(loop); }

  // controls
  function flap(){ if(!running) return; bird.dy = bird.lift; if(audioEnabled) playSfx('flap'); }
  window.addEventListener('keydown', e => { if(e.code === 'Space'){ e.preventDefault(); if(!running) reset(); flap(); } });
  window.addEventListener('mousedown', e => { if(!running) reset(); flap(); });
  window.addEventListener('touchstart', e => { e.preventDefault(); if(!running) reset(); flap(); }, {passive:false});

  // UI bindings
  startBtn.addEventListener('click', ()=> reset());
  restartBtn.addEventListener('click', ()=> reset());
  if (shareBtn) {
    shareBtn.addEventListener('click', ()=>{ try{ navigator.share && navigator.share({title:'Flappy', text:`Mon score ${score}`}); }catch(e){ alert('Partage non supporté'); } });
  }
  if (audioToggle) {
    audioToggle.addEventListener('click', ()=>{ audioEnabled = !audioEnabled; localStorage.setItem('flappy-audio', audioEnabled ? 'on' : 'off'); audioToggle.textContent = audioEnabled ? '🔊' : '🔇'; if(audioEnabled) startMusic(); else stopMusic(); });
  }
  if (settingsBtn) {
    settingsBtn.addEventListener('click', ()=> settingsPanel.classList.remove('hidden'));
  }
  if (closeSettings) {
    closeSettings.addEventListener('click', ()=> settingsPanel.classList.add('hidden'));
  }
  if (volumeRange) {
    volumeRange.addEventListener('input', e => setVolume(Number(e.target.value)));
  }
  if (diffRange) {
    diffRange.addEventListener('input', e => { localStorage.setItem('flappy-difficulty', e.target.value); });
  }

  // init
  (async ()=>{ await preload(); // set initial UI
    if (audioToggle) audioToggle.textContent = audioEnabled ? '🔊' : '🔇';
    if (volumeRange) volumeRange.value = audioVolume;
    if (diffRange) diffRange.value = difficulty;
    draw(); requestAnimationFrame(loop); })();

  // expose for dev
  window.__flappy = { reset, endGame, images, startMusic, stopMusic };
})();
