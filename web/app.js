const $ = s => document.querySelector(s);
const tg = window.Telegram?.WebApp;
const initData = tg?.initData || new URLSearchParams(location.search).get('initdata') || '';
const DEMO = !initData;

const COIN = '<svg class="coin" viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#ffc93c" stroke="#b98a1e" stroke-width="2"/><circle cx="20" cy="20" r="13" fill="#0e2440"/><path d="M20 9l6 8-6 14-6-14z" fill="#35c4ff"/><path d="M20 9l6 8h-12z" fill="#7fdcff"/></svg>';

const DEFAULT_CONFIG = {
  coinName: 'Lunar Crystal', coinSymbol: 'LC', mapName: 'Lunar surface pit',
  baseHashrate: 2.64, coinPerThPerHour: 0.01, collectHours: 24, startBalance: 0, minWithdraw: 0.5,
  levels: [
    { title: 'Novice', requirement: 0 }, { title: 'Apprentice', requirement: 1 }, { title: 'Digger', requirement: 3 },
    { title: 'Miner', requirement: 6 }, { title: 'Foreman', requirement: 10 }, { title: 'Engineer', requirement: 15 },
    { title: 'Expert', requirement: 21 }, { title: 'Master', requirement: 28 }, { title: 'Legend', requirement: 36 },
    { title: 'Moon Lord', requirement: 45 },
  ],
  miners: [
    { id: 'drill', name: 'Auto Drill', emoji: '🛠️', cost: 0.5, hashrate: 1 },
    { id: 'rig', name: 'Crystal Rig', emoji: '⚙️', cost: 2, hashrate: 5 },
    { id: 'laser', name: 'Laser Miner', emoji: '🔦', cost: 8, hashrate: 20 },
    { id: 'quantum', name: 'Quantum Excavator', emoji: '🛰️', cost: 25, hashrate: 75 },
  ],
  tasks: [
    { id: 'channel', title: 'Join our Telegram channel', reward: 0.1, type: 'link', url: 'https://t.me/telegram' },
    { id: 'checkin', title: 'Daily check-in bonus', reward: 0.02, type: 'instant', url: '' },
    { id: 'share', title: 'Share the bot with a friend', reward: 0.05, type: 'instant', url: '' },
  ],
};

let state = null;
let minerUrl = '';
const openedLinks = new Set();

if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor?.('#0a1626'); tg.setBackgroundColor?.('#0a1626'); }
if (DEMO) $('#demoBanner').hidden = false;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toFixed(4);
const haptic = kind => { try { tg?.HapticFeedback?.impactOccurred(kind || 'light'); } catch {} };

async function api(path, method = 'GET', payload) {
  const res = await fetch('/functions/v1/app' + path, {
    method,
    headers: { 'x-telegram-init-data': initData, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.code || 'request_failed');
  return data;
}

/* ---- demo engine (browser preview without Telegram) ---- */
const demoStore = {
  load() {
    try { return JSON.parse(localStorage.getItem('lunar-demo-v1')) || null; } catch { return null; }
  },
  save(s) { localStorage.setItem('lunar-demo-v1', JSON.stringify(s)); },
};
function demoState() {
  let s = demoStore.load();
  if (!s) {
    s = {
      player: { tg_id: 0, name: 'Demo Miner', balance: 0, total_mined: 0, miners: {}, last_collect: new Date().toISOString(), banned: false },
      claims: [], withdrawals: [],
    };
    demoStore.save(s);
  }
  return s;
}
const hashrateOf = (cfg, miners) => cfg.baseHashrate + cfg.miners.reduce((sum, m) => sum + m.hashrate * (miners?.[m.id] || 0), 0);
const levelOf = (cfg, total) => { let l = 0; cfg.levels.forEach((lv, i) => { if (total >= lv.requirement) l = i; }); return l; };
const pendingOf = (cfg, p) => Math.min(Math.max((Date.now() - new Date(p.last_collect).getTime()) / 3600000, 0), cfg.collectHours) * hashrateOf(cfg, p.miners) * cfg.coinPerThPerHour;

async function load() {
  if (DEMO) {
    const s = demoState();
    state = { player: s.player, config: DEFAULT_CONFIG, claims: s.claims, withdrawals: s.withdrawals, isAdmin: false };
  } else {
    state = await api('/api/bootstrap');
  }
  renderAll();
}

function demoMutate(fn) {
  const s = demoState();
  fn(s);
  demoStore.save(s);
  state.player = s.player; state.claims = s.claims; state.withdrawals = s.withdrawals;
}

/* ---- rendering ---- */
function renderTop() {
  const { player, config } = state;
  const pending = pendingOf(config, player);
  $('#pendingNum').textContent = fmt(pending);
  $('#hashrate').textContent = hashrateOf(config, player.miners).toFixed(2);
  const elapsed = (Date.now() - new Date(player.last_collect).getTime()) / 3600000;
  const remain = Math.max(config.collectHours - elapsed, 0);
  $('#timer').textContent = `${Math.floor(remain)}h ${Math.floor((remain % 1) * 60)}m`;
  const lvl = levelOf(config, player.total_mined);
  const cur = config.levels[lvl].requirement;
  const next = config.levels[lvl + 1]?.requirement;
  const pct = next === undefined ? 100 : Math.min(Math.max((player.total_mined - cur) / (next - cur), 0), 1) * 100;
  $('#levelProgress').style.width = pct + '%';
  $('#coinTop').innerHTML = COIN; $('#coinBig').innerHTML = COIN; $('#coinWallet').innerHTML = COIN;
}

function renderMap() {
  const { player, config } = state;
  $('#pitName').textContent = config.mapName;
  const lvl = levelOf(config, player.total_mined);
  const wrap = $('#nodes');
  wrap.innerHTML = '';
  const offsets = [0, -60, 40, -30, 60, 0, -50, 30];
  [...config.levels].map((lv, i) => ({ lv, i })).reverse().forEach(({ lv, i }, idx) => {
    const w = document.createElement('div');
    w.className = 'node-wrap';
    w.style.transform = `translateX(${offsets[i % offsets.length]}px)`;
    const st = i < lvl ? 'done' : i === lvl ? 'current' : 'locked';
    const badge = st === 'done' ? '<span class="badge">✅</span>' : st === 'locked' ? '<span class="badge">🔒</span>' : '<span class="badge">⛏</span>';
    w.innerHTML = `<div class="node ${st}" data-level="${i}">${i + 1}${badge}</div>` +
      (st === 'current' ? `<span class="level-tag">Current level · ${esc(lv.title)}</span>${minerUrl ? `<img class="miner-sprite" alt="miner" src="${minerUrl}">` : ''}` : '');
    wrap.appendChild(w);
  });
}

function renderTasks() {
  const { config, claims } = state;
  $('#tasksList').innerHTML = config.tasks.map(t => {
    const done = claims.includes(t.id);
    const btn = done ? '<button class="btn green" disabled>✓ Done</button>'
      : t.type === 'link' && !openedLinks.has(t.id) ? `<button class="btn ghost" data-open="${esc(t.id)}">Open</button>`
      : `<button class="btn" data-claim="${esc(t.id)}">Claim +${t.reward}</button>`;
    return `<div class="card item"><span class="emoji">📋</span><div class="grow"><h3>${esc(t.title)}</h3><p class="muted">Reward: +${t.reward} ${esc(config.coinSymbol)}</p></div>${btn}</div>`;
  }).join('') || '<p class="muted" style="padding:20px">No tasks yet.</p>';
}

function renderMiners() {
  const { config, player } = state;
  $('#minersList').innerHTML = config.miners.map(m => {
    const owned = player.miners?.[m.id] || 0;
    return `<div class="card item"><span class="emoji">${esc(m.emoji || '⚙️')}</span><div class="grow"><h3>${esc(m.name)}</h3><p class="muted">+${m.hashrate} TH/s · Owned: ${owned}</p></div><button class="btn" data-buy="${esc(m.id)}" ${player.balance < m.cost ? 'disabled' : ''}>${m.cost} ${esc(config.coinSymbol)}</button></div>`;
  }).join('');
}

function renderWallet() {
  const { player, config, withdrawals } = state;
  $('#walletBalance').textContent = fmt(player.balance);
  $('#walletMined').textContent = `Total mined: ${fmt(player.total_mined)} ${config.coinSymbol}`;
  $('#withdrawNote').textContent = `Minimum withdraw: ${config.minWithdraw} ${config.coinSymbol} · admin approves requests`;
  $('#withdrawHistory').innerHTML = withdrawals.map(w =>
    `<div class="card item"><div class="grow"><h3>${fmt(w.amount)} ${esc(config.coinSymbol)}</h3><p class="muted">${new Date(w.created_at).toLocaleString()}</p></div><span class="chip ${esc(w.status)}">${esc(w.status)}</span></div>`).join('');
}

function renderProfile() {
  const { player, config, claims, isAdmin } = state;
  const u = tg?.initDataUnsafe?.user;
  $('#profileName').textContent = u ? [u.first_name, u.last_name].filter(Boolean).join(' ') : player.name;
  $('#profileUser').textContent = u?.username ? '@' + u.username : (DEMO ? 'demo player' : 'ID ' + player.tg_id);
  if (u?.photo_url) $('#avatar').innerHTML = `<img src="${esc(u.photo_url)}" alt="">`;
  $('#profileLevel').textContent = config.levels[levelOf(config, player.total_mined)].title;
  $('#statMined').textContent = fmt(player.total_mined);
  $('#statHash').textContent = hashrateOf(config, player.miners).toFixed(2);
  $('#statMiners').textContent = Object.values(player.miners || {}).reduce((a, b) => a + b, 0);
  $('#statTasks').textContent = claims.length;
  $('#adminLink').hidden = !isAdmin;
}

function renderAll() { renderTop(); renderMap(); renderTasks(); renderMiners(); renderWallet(); renderProfile(); }

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---- actions ---- */
async function collect() {
  haptic('medium');
  try {
    if (DEMO) {
      let gained = 0;
      demoMutate(s => { gained = pendingOf(DEFAULT_CONFIG, s.player); s.player.balance += gained; s.player.total_mined += gained; s.player.last_collect = new Date().toISOString(); });
      toast(`+${fmt(gained)} ${state.config.coinSymbol} collected`);
    } else {
      const r = await api('/api/collect', 'POST', {});
      state.player = r.player;
      toast(`+${fmt(r.gained)} ${state.config.coinSymbol} collected`);
    }
    renderAll();
  } catch (e) { toast('Collect failed: ' + e.message); }
}

async function buy(id) {
  haptic();
  try {
    if (DEMO) {
      demoMutate(s => {
        const m = DEFAULT_CONFIG.miners.find(x => x.id === id);
        if (s.player.balance < m.cost) throw new Error('insufficient_balance');
        s.player.balance -= m.cost;
        s.player.miners[id] = (s.player.miners[id] || 0) + 1;
      });
    } else {
      const r = await api('/api/buy-miner', 'POST', { id });
      state.player = r.player;
    }
    toast('Miner purchased ⚡');
    renderAll();
  } catch (e) { toast(e.message === 'insufficient_balance' ? 'Balance যথেষ্ট নয়' : 'Buy failed'); }
}

async function claim(id) {
  haptic();
  try {
    if (DEMO) {
      demoMutate(s => {
        if (s.claims.includes(id)) throw new Error('already_claimed');
        const t = DEFAULT_CONFIG.tasks.find(x => x.id === id);
        s.claims.push(id);
        s.player.balance += t.reward;
      });
    } else {
      const r = await api('/api/claim-task', 'POST', { id });
      state.player = r.player;
      state.claims = [...state.claims, id];
    }
    toast('Task reward added 💎');
    renderAll();
  } catch { toast('Already claimed'); }
}

async function withdraw() {
  const amount = Number($('#withdrawAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) return toast('Amount লেখো');
  haptic();
  try {
    if (DEMO) {
      demoMutate(s => {
        if (amount < DEFAULT_CONFIG.minWithdraw || s.player.balance < amount) throw new Error('invalid');
        s.player.balance -= amount;
        s.withdrawals.unshift({ id: Date.now(), amount, status: 'pending', created_at: new Date().toISOString() });
      });
    } else {
      await api('/api/withdraw', 'POST', { amount });
      const r = await api('/api/bootstrap');
      state = r;
    }
    $('#withdrawAmount').value = '';
    toast('Withdraw request পাঠানো হয়েছে');
    renderAll();
  } catch (e) { toast(e.message === 'insufficient_balance' ? 'Balance যথেষ্ট নয়' : 'Withdraw failed'); }
}

/* ---- events ---- */
$('#collectBtn').addEventListener('click', collect);
$('#withdrawBtn').addEventListener('click', withdraw);
$('#adminLink').addEventListener('click', () => { location.href = 'admin.html' + (initData ? '?initdata=' + encodeURIComponent(initData) : ''); });
$('#locateBtn').addEventListener('click', () => { $('.node.current')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); haptic(); });
$('#pitUp').addEventListener('click', () => $('#view-mine').scrollBy({ top: -300, behavior: 'smooth' }));
$('#pitDown').addEventListener('click', () => $('#view-mine').scrollBy({ top: 300, behavior: 'smooth' }));

document.querySelectorAll('.nav button').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.tab));
  haptic('selection');
}));

document.addEventListener('click', e => {
  const buyId = e.target.closest('[data-buy]')?.dataset.buy;
  const claimId = e.target.closest('[data-claim]')?.dataset.claim;
  const openId = e.target.closest('[data-open]')?.dataset.open;
  if (buyId) buy(buyId);
  if (claimId) claim(claimId);
  if (openId) {
    const t = state.config.tasks.find(x => x.id === openId);
    openedLinks.add(openId);
    if (tg?.openLink) tg.openLink(t.url); else window.open(t.url, '_blank');
    renderTasks();
  }
});

/* ---- miner sprite: remove magenta background ---- */
async function makeMiner() {
  const img = new Image();
  img.src = 'assets/miner.png';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 256, 256);
  const d = ctx.getImageData(0, 0, 256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
    if (r > 170 && b > 170 && g < 150) d.data[i + 3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  minerUrl = c.toDataURL();
}

load();
makeMiner().then(() => { if (state) renderMap(); }).catch(() => {});
setInterval(() => { if (state) renderTop(); }, 1000);