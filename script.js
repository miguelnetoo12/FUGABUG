(function(){
"use strict";

// ===== Elementos =====
const $ = id => document.getElementById(id);
const stage = $("stage"), cv = $("cv"), ctx = cv.getContext("2d");

// ===== Câmera e mundo =====
const CAM_H = 3.2;        // altura da câmera
const D = 5.5;            // distância da câmera até o robô
const FAR = 62;           // até onde a pista aparece
const LANE_W = 1.05;      // largura de cada pista
const ROAD = 1.65;        // metade da largura da estrada
const G = 32;             // gravidade
const JUMP_V = 8.6;       // força do pulo
const SLIDE_T = 0.62;     // duração do deslize (s)

let W = 0, H = 0, k = 1, horizon = 0, cx = 0, city = [];

function resize(){
  const r = stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  k = Math.min(W * 1.6, H * 1.1);
  horizon = H * 0.9 - (CAM_H / D) * k;
  cx = W / 2;
  buildCity();
  if(state !== "play") draw();
}
function proj(x, y, z){
  const p = k / (z + D);
  return [cx + x * p, horizon + (CAM_H - y) * p, p];
}

function buildCity(){
  city = [];
  let x = -20;
  while(x < W + 20){
    const w = 18 + Math.random() * 46, h = 14 + Math.random() * Math.min(110, H * 0.16);
    const wins = [];
    for(let yy = 6; yy < h - 4; yy += 8) for(let xx = 4; xx < w - 4; xx += 8) if(Math.random() < 0.35) wins.push([xx, yy]);
    city.push({x, w, h, wins});
    x += w + 2 + Math.random() * 10;
  }
}

// ===== Estado =====
let state = "start";      // start | play | pause | over
let speed, dist, chips, time, objs, untilRow, shield, flash, shake;
const P = {lane:1, x:0, y:0, vy:0, slide:0, run:0};
let best = 0;
try{ best = +(localStorage.getItem("fuga-do-bug-best") || 0) || 0; }catch(e){}
let muted = false;
try{ muted = localStorage.getItem("fuga-do-bug-mute") === "1"; }catch(e){}

function reset(){
  speed = 12; dist = 0; chips = 0; time = 0; objs = []; untilRow = 18; shield = false; flash = 0; shake = 0;
  P.lane = 1; P.x = 0; P.y = 0; P.vy = 0; P.slide = 0; P.run = 0;
  // chips de boas-vindas na pista do meio
  for(let i = 0; i < 6; i++) objs.push({t:"chip", x:0, z:8 + i * 1.8, y:0.35, len:0.3});
}

// ===== Geração da pista =====
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a){ for(let i = a.length - 1; i > 0; i--){ const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function addObstacle(type, lane, z){
  const x = (lane - 1) * LANE_W;
  if(type === "low")  objs.push({t:"low",  x, z, len:0.35});
  if(type === "high") objs.push({t:"high", x, z, len:0.3});
  if(type === "wall") objs.push({t:"wall", x, z, len:4.2});
}

function spawnRow(z){
  const lanes = [null, null, null];
  const r = Math.random();
  const hard = time > 25;
  const n = r < 0.45 ? 1 : (r < 0.88 || !hard) ? 2 : 3;
  const order = shuffle([0, 1, 2]);
  for(let i = 0; i < n; i++) lanes[order[i]] = pick(["low", "high", "wall", "wall"]);
  if(lanes.every(t => t === "wall")) lanes[order[0]] = Math.random() < 0.5 ? "low" : "high";
  lanes.forEach((t, i) => { if(t) addObstacle(t, i, z); });

  const free = [0, 1, 2].filter(i => !lanes[i]);
  if(Math.random() < 0.75){
    const lowLane = lanes.indexOf("low");
    if(lowLane >= 0 && Math.random() < 0.45){
      // arco de chips por cima do bug
      for(let i = 0; i < 5; i++){
        const f = i / 4;
        objs.push({t:"chip", x:(lowLane - 1) * LANE_W, z:z - 2.6 + f * 5.2, y:0.4 + Math.sin(f * Math.PI) * 1.0, len:0.3});
      }
    } else if(free.length){
      const l = pick(free);
      for(let i = 0; i < 5; i++) objs.push({t:"chip", x:(l - 1) * LANE_W, z:z - 7 + i * 1.6, y:0.35, len:0.3});
    }
  }
  if(!shield && free.length && Math.random() < 0.05){
    objs.push({t:"shield", x:(pick(free) - 1) * LANE_W, z:z + 2, y:0.5, len:0.3});
  }
}

// ===== Controles =====
function move(dir){
  if(state !== "play") return;
  const nl = Math.max(0, Math.min(2, P.lane + dir));
  if(nl !== P.lane){ P.lane = nl; sfx("move"); }
}
function jump(){
  if(state !== "play") return;
  if(P.y <= 0.001){ P.vy = JUMP_V; P.slide = 0; sfx("jump"); }
}
function slide(){
  if(state !== "play") return;
  if(P.y > 0.001){ P.vy = -16; }        // desce rápido do pulo
  P.slide = SLIDE_T; sfx("slide");
}

document.addEventListener("keydown", e => {
  const key = e.key;
  if(state === "start" || state === "over"){
    if(key === "Enter" || key === " "){ e.preventDefault(); start(); }
    return;
  }
  if(key === "p" || key === "P" || key === "Escape"){ togglePause(); return; }
  if(state !== "play") return;
  if(key === "ArrowLeft" || key === "a" || key === "A"){ e.preventDefault(); move(-1); }
  else if(key === "ArrowRight" || key === "d" || key === "D"){ e.preventDefault(); move(1); }
  else if(key === "ArrowUp" || key === "w" || key === "W" || key === " "){ e.preventDefault(); jump(); }
  else if(key === "ArrowDown" || key === "s" || key === "S"){ e.preventDefault(); slide(); }
});

// deslizar o dedo
let sx = 0, sy = 0, swiping = false, used = false;
cv.addEventListener("pointerdown", e => { sx = e.clientX; sy = e.clientY; swiping = true; used = false; });
cv.addEventListener("pointermove", e => {
  if(!swiping || used) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if(Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
  used = true;
  if(Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
  else if(dy < 0) jump(); else slide();
});
cv.addEventListener("pointerup", () => {
  if(swiping && !used) jump();          // toque rápido também pula
  swiping = false;
});
cv.addEventListener("pointercancel", () => { swiping = false; });

// ===== Som (bipes simples) =====
let ac = null;
function sfx(kind){
  if(muted) return;
  try{
    if(!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
    const t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
    o.connect(g); g.connect(ac.destination);
    const S = {
      chip:[["square",880,1320,0.08],0.05], jump:[["triangle",300,620,0.16],0.12], slide:[["triangle",420,180,0.14],0.1],
      move:[["sine",520,600,0.05],0.05], hit:[["sawtooth",180,60,0.4],0.12], shield:[["square",500,1500,0.3],0.06]
    }[kind];
    if(!S) return;
    const [[type, f0, f1, dur], vol] = S;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  }catch(e){}
}
function setMuteUI(){ $("btnSound").textContent = muted ? "🔇" : "🔊"; $("btnSound").setAttribute("aria-label", muted ? "Som desligado" : "Som ligado"); }
$("btnSound").addEventListener("click", () => { muted = !muted; setMuteUI(); try{ localStorage.setItem("fuga-do-bug-mute", muted ? "1" : "0"); }catch(e){} });

// ===== Fluxo do jogo =====
function score(){ return Math.floor(dist) + chips * 10; }
function start(){
  reset(); state = "play";
  $("startScreen").hidden = true; $("overScreen").hidden = true; $("pauseScreen").hidden = true; $("hud").hidden = false;
  last = performance.now();
  if(ac && ac.state === "suspended") ac.resume();
}
function togglePause(){
  if(state === "play"){ state = "pause"; $("pauseScreen").hidden = false; }
  else if(state === "pause"){ state = "play"; $("pauseScreen").hidden = true; last = performance.now(); }
}
function gameOver(){
  state = "over"; sfx("hit"); shake = 0.35;
  const s = score(), rec = s > best;
  if(rec){ best = s; try{ localStorage.setItem("fuga-do-bug-best", String(best)); }catch(e){} }
  setTimeout(() => {
    $("overScore").textContent = s.toLocaleString("pt-BR");
    $("overDist").textContent = Math.floor(dist).toLocaleString("pt-BR") + " m";
    $("overChips").textContent = chips;
    $("overTitle").textContent = rec ? "Novo recorde!" : pick(["O bug te pegou!", "Erro 404: robô caiu!", "Travou o sistema!"]);
    $("overTag").textContent = rec ? "Parabéns" : "Fim de jogo";
    $("overBest").textContent = "Recorde: " + best.toLocaleString("pt-BR");
    $("overScreen").hidden = false;
    $("btnAgain").focus({preventScroll:true});
  }, 650);
}
$("btnPlay").addEventListener("click", start);
$("btnAgain").addEventListener("click", start);
$("btnPause").addEventListener("click", togglePause);
$("btnResume").addEventListener("click", togglePause);
document.addEventListener("visibilitychange", () => { if(document.hidden && state === "play") togglePause(); });

// ===== Atualização =====
function update(dt){
  time += dt;
  speed = Math.min(31, 12 + time * 0.32);
  const dz = speed * dt;
  dist += dz;

  for(const o of objs) o.z -= dz;
  objs = objs.filter(o => o.z + o.len > -2.4 && !o.gone);

  untilRow -= dz;
  if(untilRow <= 0){ spawnRow(FAR); untilRow = speed * rnd(0.72, 1.05) + 4; }

  // robô
  const tx = (P.lane - 1) * LANE_W;
  P.x += (tx - P.x) * Math.min(1, dt * 16);
  if(P.y > 0 || P.vy > 0){ P.vy -= G * dt; P.y += P.vy * dt; if(P.y <= 0){ P.y = 0; P.vy = 0; } }
  if(P.slide > 0) P.slide -= dt;
  P.run += dt * speed * 0.9;
  if(flash > 0) flash -= dt;

  // colisões
  for(const o of objs){
    if(o.z > 0.45 || o.z + o.len < -0.25) continue;
    const dx = Math.abs(o.x - P.x);
    if(o.t === "chip"){
      if(dx < 0.55 && Math.abs(o.y - (P.y + 0.45)) < 0.75){ o.gone = true; chips++; sfx("chip"); }
      continue;
    }
    if(o.t === "shield"){
      if(dx < 0.6){ o.gone = true; shield = true; sfx("shield"); }
      continue;
    }
    if(dx > 0.62) continue;
    let hit = false;
    if(o.t === "low")  hit = P.y < 0.5;
    if(o.t === "high") hit = !(P.slide > 0 && P.y < 0.3);
    if(o.t === "wall") hit = true;
    if(hit){
      if(shield){ shield = false; o.gone = true; flash = 0.5; shake = 0.2; sfx("hit"); }
      else { gameOver(); return; }
    }
  }

  $("hudScore").textContent = score().toLocaleString("pt-BR");
  $("hudChips").textContent = chips;
  $("hudShield").hidden = !shield;
}

// ===== Desenho =====
function poly(pts, fill){ ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for(let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); }

function drawSky(){
  const g = ctx.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, "#04102F"); g.addColorStop(1, "#1A3F96");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon + 1);
  // estrelas fixas
  ctx.fillStyle = "rgba(207,230,255,.55)";
  for(let i = 0; i < 40; i++){ const x = (i * 97.3) % W, y = (i * 53.7) % Math.max(10, horizon - 30); ctx.fillRect(x, y, 2, 2); }
  // cidade de servidores
  for(const b of city){
    const y = horizon - b.h;
    ctx.fillStyle = "#0B2260"; ctx.fillRect(b.x, y, b.w, b.h);
    ctx.fillStyle = "rgba(94,194,255,.55)";
    for(const [xx, yy] of b.wins) ctx.fillRect(b.x + xx, y + yy, 3, 3);
  }
  ctx.fillStyle = "#5EC2FF"; ctx.fillRect(0, horizon - 1, W, 2);
}

function drawGround(){
  // chão lateral
  ctx.fillStyle = "#071A4B"; ctx.fillRect(0, horizon, W, H - horizon);
  // grade do chão
  ctx.lineWidth = 1;
  const off = dist % 3;
  for(let z = 3 - off; z < FAR; z += 3){
    const a = proj(-30, 0, z), b = proj(30, 0, z);
    ctx.strokeStyle = "rgba(94,194,255," + (0.22 * (1 - z / FAR)).toFixed(3) + ")";
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  for(const x of [-9, -6, -4, 4, 6, 9]){
    const a = proj(x, 0, -2), b = proj(x, 0, FAR);
    ctx.strokeStyle = "rgba(94,194,255,.14)"; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  // estrada
  const nl = proj(-ROAD, 0, -2.2), nr = proj(ROAD, 0, -2.2), fl = proj(-ROAD, 0, FAR), fr = proj(ROAD, 0, FAR);
  poly([nl, nr, fr, fl], "#0E2C78");
  // faixas de pista (tracejadas, andando)
  for(const x of [-LANE_W / 2, LANE_W / 2]){
    for(let z = -(dist % 4); z < FAR; z += 4){
      if(z + 2 < -2) continue;
      const a = proj(x - 0.03, 0, Math.max(-2.2, z)), b = proj(x + 0.03, 0, Math.max(-2.2, z)), c = proj(x + 0.03, 0, z + 2), d = proj(x - 0.03, 0, z + 2);
      poly([a, b, c, d], "rgba(94,194,255,.55)");
    }
  }
  // bordas brilhantes
  for(const s of [-1, 1]){
    const a = proj(s * ROAD, 0, -2.2), b = proj(s * (ROAD + 0.08), 0, -2.2), c = proj(s * (ROAD + 0.08), 0, FAR), d = proj(s * ROAD, 0, FAR);
    poly([a, b, c, d], "#5EC2FF");
  }
  // névoa no horizonte
  const fog = ctx.createLinearGradient(0, horizon, 0, horizon + H * 0.12);
  fog.addColorStop(0, "rgba(26,63,150,.9)"); fog.addColorStop(1, "rgba(26,63,150,0)");
  ctx.fillStyle = fog; ctx.fillRect(0, horizon, W, H * 0.12);
}

function box(x, w, y0, h, z, len, cFront, cTop, cSide){
  const zn = Math.max(z, -2.4), zf = z + len;
  if(zf < -2.4) return null;
  const hw = w / 2;
  const fbl = proj(x - hw, y0, zn), fbr = proj(x + hw, y0, zn), ftl = proj(x - hw, y0 + h, zn), ftr = proj(x + hw, y0 + h, zn);
  const btl = proj(x - hw, y0 + h, zf), btr = proj(x + hw, y0 + h, zf), bbl = proj(x - hw, y0, zf), bbr = proj(x + hw, y0, zf);
  // lateral visível (a voltada para o centro da tela)
  if(fbl[0] > cx) poly([fbl, ftl, btl, bbl], cSide);
  if(fbr[0] < cx) poly([fbr, ftr, btr, bbr], cSide);
  // topo (visível se abaixo da câmera)
  if(y0 + h < CAM_H) poly([ftl, ftr, btr, btl], cTop);
  // frente
  poly([fbl, fbr, ftr, ftl], cFront);
  return {x:ftl[0], y:ftl[1], w:ftr[0] - ftl[0], h:fbl[1] - ftl[1]};
}

function shadow(x, z, w){
  if(z < -2.4) return;
  const p = proj(x, 0, z);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.ellipse(p[0], p[1], w * p[2] * 0.5, w * p[2] * 0.14, 0, 0, Math.PI * 2); ctx.fill();
}

function drawObj(o){
  if(o.t === "low"){
    shadow(o.x, o.z, 0.9);
    const f = box(o.x, 0.9, 0, 0.45, o.z, o.len, "#FF6B7D", "#FF9AA6", "#C93A4C");
    if(f && f.w > 8){
      // inseto (bug) desenhado na frente
      const bx = f.x + f.w / 2, by = f.y + f.h / 2, r = Math.min(f.w, f.h) * 0.32;
      ctx.strokeStyle = "#3A0710"; ctx.lineWidth = Math.max(1, r * 0.18); ctx.lineCap = "round";
      for(const s of [-1, 1]) for(const dy of [-0.5, 0, 0.5]){ ctx.beginPath(); ctx.moveTo(bx + s * r * 0.6, by + dy * r); ctx.lineTo(bx + s * r * 1.45, by + dy * r * 1.5); ctx.stroke(); }
      ctx.fillStyle = "#3A0710"; ctx.beginPath(); ctx.ellipse(bx, by, r * 0.7, r, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#FFE58A"; ctx.beginPath(); ctx.arc(bx - r * 0.25, by - r * 0.45, r * 0.16, 0, 7); ctx.arc(bx + r * 0.25, by - r * 0.45, r * 0.16, 0, 7); ctx.fill();
    }
  } else if(o.t === "high"){
    for(const s of [-1, 1]) box(o.x + s * 0.44, 0.1, 0, 1.25, o.z, o.len, "#C2410C", "#FFB25C", "#9A3412");
    const f = box(o.x, 0.98, 0.78, 0.42, o.z, o.len, "#FFB25C", "#FFD199", "#C2410C");
    if(f && f.w > 8){
      ctx.save(); ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
      ctx.fillStyle = "#C2410C";
      const st = f.h * 0.9;
      for(let x = f.x - f.h; x < f.x + f.w + f.h; x += st * 1.6){ poly([[x, f.y + f.h], [x + st * 0.8, f.y + f.h], [x + st * 0.8 + f.h, f.y], [x + f.h, f.y]], "#C2410C"); }
      ctx.restore();
      if(f.w > 60){
        ctx.fillStyle = "#3A1404"; ctx.font = "800 " + Math.round(f.h * 0.42) + "px Archivo, Arial Black, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillText("FIREWALL", f.x + f.w / 2, f.y + f.h / 2 + 1);
      }
    }
  } else if(o.t === "wall"){
    shadow(o.x, o.z, 0.95);
    const f = box(o.x, 0.95, 0, 1.75, o.z, o.len, "#1B3C8F", "#2A55B8", "#112B6B");
    if(f && f.w > 10){
      // luzes do servidor
      const rows = 6, pad = f.w * 0.12, rh = (f.h - pad * 2) / rows;
      for(let i = 0; i < rows; i++){
        const y = f.y + pad + i * rh;
        ctx.fillStyle = "#0A1F57"; ctx.fillRect(f.x + pad, y + rh * 0.15, f.w - pad * 2, rh * 0.7);
        ctx.fillStyle = ((i + Math.floor(time * 4)) % 3) ? "#5EC2FF" : "#4BE3A1";
        ctx.fillRect(f.x + pad * 1.5, y + rh * 0.38, Math.max(2, f.w * 0.06), Math.max(2, rh * 0.24));
        ctx.fillRect(f.x + pad * 1.5 + f.w * 0.1, y + rh * 0.38, Math.max(2, f.w * 0.06), Math.max(2, rh * 0.24));
      }
      ctx.strokeStyle = "#5EC2FF"; ctx.lineWidth = Math.max(1, f.w * 0.02); ctx.strokeRect(f.x, f.y, f.w, f.h);
    }
  } else if(o.t === "chip"){
    const p = proj(o.x, o.y, o.z), s = 0.34 * p[2];
    if(s < 1) return;
    const sq = Math.abs(Math.cos(time * 5 + o.z * 0.5));
    ctx.save(); ctx.translate(p[0], p[1]); ctx.scale(Math.max(0.15, sq), 1);
    ctx.fillStyle = "#FFC93C"; ctx.fillRect(-s / 2, -s / 2, s, s);
    ctx.fillStyle = "#B7791F"; ctx.fillRect(-s * 0.22, -s * 0.22, s * 0.44, s * 0.44);
    ctx.strokeStyle = "#FFC93C"; ctx.lineWidth = Math.max(1, s * 0.08);
    for(const d of [-0.25, 0, 0.25]){ ctx.beginPath(); ctx.moveTo(-s * 0.7, d * s); ctx.lineTo(s * 0.7, d * s); ctx.moveTo(d * s, -s * 0.7); ctx.lineTo(d * s, s * 0.7); ctx.stroke(); }
    ctx.restore();
  } else if(o.t === "shield"){
    const p = proj(o.x, o.y + Math.sin(time * 4) * 0.1, o.z), r = 0.32 * p[2];
    ctx.strokeStyle = "#5EC2FF"; ctx.lineWidth = Math.max(2, r * 0.22);
    ctx.fillStyle = "rgba(94,194,255,.25)";
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#FFFFFF"; ctx.font = "700 " + Math.round(r) + "px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+", p[0], p[1] + 1);
  }
}

function rr(x, y, w, h, r, fill){ ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); ctx.fillStyle = fill; ctx.fill(); }

function drawRobot(){
  shadow(P.x, 0, 0.8 - Math.min(0.4, P.y * 0.2));
  const sliding = P.slide > 0 && P.y < 0.3;
  const p = proj(P.x, P.y, 0), u = p[2];
  const bw = (sliding ? 0.82 : 0.66) * u, bh = (sliding ? 0.5 : 1.0) * u;
  const x = p[0] - bw / 2, base = p[1];
  const lean = (((P.lane - 1) * LANE_W) - P.x) * 0.25;
  ctx.save(); ctx.translate(p[0], base); ctx.rotate(lean); ctx.translate(-p[0], -base);
  // pernas
  if(!sliding){
    const ph = Math.sin(P.run * 1.4), lh = 0.26 * u;
    const air = P.y > 0.05;
    rr(p[0] - bw * 0.32, base - lh + (air ? -0.06 * u : Math.max(0, ph) * -0.08 * u), bw * 0.22, lh, 4, "#CFE6FF");
    rr(p[0] + bw * 0.1, base - lh + (air ? -0.06 * u : Math.max(0, -ph) * -0.08 * u), bw * 0.22, lh, 4, "#CFE6FF");
  }
  const by = base - (sliding ? 0.08 * u : 0.24 * u) - bh * (sliding ? 0.85 : 0.62);
  // corpo
  rr(x, by, bw, bh * (sliding ? 0.85 : 0.62), 10, "#FFFFFF");
  // mochila/propulsor nas costas
  rr(p[0] - bw * 0.28, by + bh * 0.08, bw * 0.56, bh * (sliding ? 0.5 : 0.36), 8, "#12347F");
  ctx.fillStyle = "#5EC2FF"; ctx.fillRect(p[0] - bw * 0.18, by + bh * (sliding ? 0.25 : 0.2), bw * 0.36, Math.max(2, bh * 0.05));
  // cabeça
  if(!sliding){
    const hw = bw * 0.82, hh = bh * 0.34, hy = by - hh * 0.92;
    rr(p[0] - hw / 2, hy, hw, hh, 10, "#FFFFFF");
    rr(p[0] - hw * 0.35, hy + hh * 0.25, hw * 0.7, hh * 0.45, 6, "#DCEBFF");
    ctx.strokeStyle = "#CFE6FF"; ctx.lineWidth = Math.max(2, u * 0.04);
    ctx.beginPath(); ctx.moveTo(p[0], hy); ctx.lineTo(p[0], hy - hh * 0.4); ctx.stroke();
    ctx.fillStyle = "#5EC2FF"; ctx.beginPath(); ctx.arc(p[0], hy - hh * 0.45, Math.max(3, u * 0.06), 0, 7); ctx.fill();
  }
  // fogo do propulsor no pulo
  if(P.y > 0.05){
    ctx.fillStyle = "rgba(255,201,60,.85)";
    ctx.beginPath(); ctx.moveTo(p[0] - bw * 0.15, by + bh * 0.62); ctx.lineTo(p[0] + bw * 0.15, by + bh * 0.62); ctx.lineTo(p[0], by + bh * 0.62 + 0.3 * u * (0.7 + Math.random() * 0.3)); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  if(shield){
    ctx.strokeStyle = "rgba(94,194,255," + (0.6 + Math.sin(time * 8) * 0.25).toFixed(2) + ")"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p[0], base - bh * 0.55, bw * 0.95, bh * 0.85, 0, 0, Math.PI * 2); ctx.stroke();
  }
}

function draw(){
  ctx.save();
  if(shake > 0){ ctx.translate((Math.random() - 0.5) * 12 * shake, (Math.random() - 0.5) * 12 * shake); }
  drawSky();
  drawGround();
  if(objs){
    const sorted = objs.slice().sort((a, b) => b.z - a.z);
    for(const o of sorted) if(o.z > 0.2) drawObj(o);
    drawRobot();
    for(const o of sorted) if(o.z <= 0.2) drawObj(o);
  }
  if(flash > 0){ ctx.fillStyle = "rgba(94,194,255," + (flash * 0.6).toFixed(2) + ")"; ctx.fillRect(-20, -20, W + 40, H + 40); }
  ctx.restore();
}

// ===== Laço principal =====
let last = performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if(state === "play") update(dt);
  if(shake > 0) shake = Math.max(0, shake - dt);
  if(state === "play" || state === "over" || shake > 0) draw();
}

// ===== Início =====
reset();
setMuteUI();
$("bestStart").textContent = "Recorde: " + best.toLocaleString("pt-BR");
new ResizeObserver(resize).observe(stage);
resize();
requestAnimationFrame(loop);
})();
