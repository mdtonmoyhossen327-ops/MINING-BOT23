const $ = s => document.querySelector(s);
const tg = window.Telegram?.WebApp;
const initData = tg?.initData || new URLSearchParams(location.search).get('initdata') || '';
const DEMO = !initData;
if (tg) { tg.ready(); tg.expand(); }
if (DEMO) $('#demoBanner').hidden = false;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

async function api(path, method = 'GET', payload) {
  const res = await fetch('/functions/v1/app' + path, {
    method,
    headers: { 'x-telegram-init-data': initData, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || data.code || 'request_failed'), { status: res.status });
  return data;
}

let cfg = null, players = [], withdrawals = [];

const DEMO_CFG = {
  coinName: 'Lunar Crystal', coinSymbol: 'LC', mapName: 'Lunar surface pit',
  baseHashrate: 2.64, coinPerThPerHour: 0.01, collectHours: 24, startBalance: 0, minWithdraw: 0.5,
  levels: [{ title: 'Novice', requirement: 0 }, { title: 'Apprentice', requirement: 1 }, { title: 'Moon Lord', requirement: 45 }],
  miners: [{ id: 'drill', name: 'Auto Drill', emoji: '🛠️', cost: 0.5, hashrate: 1 }],
  tasks: [{ id: 'checkin', title: 'Daily check-in bonus', reward: 0.02, type: 'instant', url: '' }],
};

async function load() {
  if (DEMO) {
    cfg = JSON.parse(JSON.stringify(DEMO_CFG));
    players = [{ tg_id: 0, name: 'Demo Miner', balance: 1.25, total_mined: 3.4, banned: false }];
    withdrawals = [{ id: 1, tg_id: 0, amount: 0.5, status: 'pending', created_at: new Date().toISOString() }];
  } else {
    try {
      const r = await api('/api/admin/state');
      cfg = r.config; players = r.players; withdrawals = r.withdrawals;
    } catch (e) {
      $('#lock').hidden = false;
      return;
    }
  }
  $('#panel').hidden = false;
  renderAll();
}

/* ---- general ---- */
const GENERAL_FIELDS = [
  ['coinName', 'Coin name', 'text'], ['coinSymbol', 'Coin symbol', 'text'], ['mapName', 'Map name', 'text'],
  ['baseHashrate', 'Base hashrate (TH/s)', 'number'], ['coinPerThPerHour', 'Coins per TH/s per hour', 'number'],
  ['collectHours', 'Collect cap (hours)', 'number'], ['startBalance', 'New player balance', 'number'], ['minWithdraw', 'Min withdraw', 'number'],
];
function renderGeneral() {
  $('#generalForm').innerHTML = GENERAL_FIELDS.map(([k, label, type]) =>
    `<label>${label}<input data-g="${k}" type="${type}" step="any" value="${esc(cfg[k])}"></label>`).join('');
}
function readGeneral() {
  document.querySelectorAll('[data-g]').forEach(inp => {
    const k = inp.dataset.g;
    cfg[k] = inp.type === 'number' ? Number(inp.value) : inp.value;
  });
}

/* ---- list editors ---- */
function renderLevels() {
  $('#levelsList').innerHTML = cfg.levels.map((lv, i) =>
    `<div class="row"><input data-lv="title" data-i="${i}" value="${esc(lv.title)}" placeholder="Title"><input data-lv="requirement" data-i="${i}" type="number" step="any" value="${lv.requirement}" placeholder="Total mined needed"><button class="btn ghost" data-del-lv="${i}">✕</button></div>`).join('');
}
function renderMiners() {
  $('#minersList').innerHTML = cfg.miners.map((m, i) =>
    `<div class="row"><input data-m="id" data-i="${i}" value="${esc(m.id)}" placeholder="id"><input data-m="name" data-i="${i}" value="${esc(m.name)}" placeholder="Name"><input data-m="emoji" data-i="${i}" value="${esc(m.emoji || '')}" placeholder="Emoji"><input data-m="cost" data-i="${i}" type="number" step="any" value="${m.cost}" placeholder="Cost"><input data-m="hashrate" data-i="${i}" type="number" step="any" value="${m.hashrate}" placeholder="TH/s"><button class="btn ghost" data-del-m="${i}">✕</button></div>`).join('');
}
function renderTasks() {
  $('#tasksList').innerHTML = cfg.tasks.map((t, i) =>
    `<div class="row"><input data-t="id" data-i="${i}" value="${esc(t.id)}" placeholder="id"><input data-t="title" data-i="${i}" value="${esc(t.title)}" placeholder="Title"><input data-t="reward" data-i="${i}" type="number" step="any" value="${t.reward}" placeholder="Reward"><select data-t="type" data-i="${i}"><option value="instant" ${t.type === 'instant' ? 'selected' : ''}>instant</option><option value="link" ${t.type === 'link' ? 'selected' : ''}>link</option></select><input data-t="url" data-i="${i}" value="${esc(t.url || '')}" placeholder="https://..."><button class="btn ghost" data-del-t="${i}">✕</button></div>`).join('');
}
function readList(sel, key, numeric = []) {
  const out = [];
  document.querySelectorAll(sel).forEach(inp => {
    const i = Number(inp.dataset.i);
    out[i] = out[i] || {};
    out[i][key] = numeric.includes(key) ? Number(inp.value) : inp.value;
  });
  return out.filter(Boolean);
}

/* ---- players & withdrawals ---- */
function renderPlayers() {
  $('#playersTable').innerHTML = '<tr><th>Player</th><th>ID</th><th>Balance</th><th>Banned</th><th></th></tr>' +
    players.map(p => `<tr><td>${esc(p.name)}</td><td>${p.tg_id}</td><td><input type="number" step="any" value="${p.balance}" data-pb="${p.tg_id}"></td><td><input type="checkbox" data-pban="${p.tg_id}" ${p.banned ? 'checked' : ''}></td><td><button class="btn" data-psave="${p.tg_id}">Save</button></td></tr>`).join('');
}
function renderWithdrawals() {
  $('#withdrawList').innerHTML = withdrawals.map(w =>
    `<div class="row"><span>#${w.id} · tg ${w.tg_id}</span><span><b>${Number(w.amount).toFixed(4)}</b> ${esc(cfg.coinSymbol)}</span><span class="chip ${esc(w.status)}">${esc(w.status)}</span>${w.status === 'pending' ? `<span><button class="btn green" data-w="paid" data-wid="${w.id}">Approve</button> <button class="btn ghost" data-w="rejected" data-wid="${w.id}">Reject</button></span>` : '<span></span>'}</div>`).join('') || '<p class="muted" style="padding:16px">No withdrawals yet.</p>';
}

function renderAll() { renderGeneral(); renderLevels(); renderMiners(); renderTasks(); renderPlayers(); renderWithdrawals(); }

async function saveConfig() {
  if (DEMO) return toast('DEMO mode — save disabled');
  try {
    const r = await api('/api/admin/config', 'POST', cfg);
    cfg = r.config;
    toast('Saved ✅');
    renderAll();
  } catch (e) { toast('Save failed: ' + e.message); }
}

/* ---- events ---- */
$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-sec]');
  if (!btn) return;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b === btn));
  document.querySelectorAll('.admin-section').forEach(s => s.classList.toggle('active', s.id === 'sec-' + btn.dataset.sec));
});

$('#saveGeneral').addEventListener('click', () => { readGeneral(); saveConfig(); });
$('#connectBot').addEventListener('click', async () => {
  if (DEMO) return toast('DEMO mode — disabled');
  try {
    const r = await api('/api/admin/setup-webhook', 'POST', {});
    toast(r.ok ? `Bot connected: @${r.bot} ✅` : 'Webhook setup failed — Secrets check করো');
  } catch (e) { toast(e.message === 'service_not_configured' ? 'আগে Settings-এ BOT_TOKEN/WEBHOOK_SECRET দাও' : 'Connect failed'); }
});
$('#saveLevels').addEventListener('click', () => { cfg.levels = readList('[data-lv]', 'title').map((r, i) => ({ title: r.title, requirement: Number(document.querySelector(`[data-lv="requirement"][data-i="${i}"]`)?.value || 0) })); saveConfig(); });
$('#saveMiners').addEventListener('click', () => {
  const rows = readList('[data-m]', 'id');
  cfg.miners = rows.map((r, i) => ({ id: r.id, name: document.querySelector(`[data-m="name"][data-i="${i}"]`).value, emoji: document.querySelector(`[data-m="emoji"][data-i="${i}"]`).value, cost: Number(document.querySelector(`[data-m="cost"][data-i="${i}"]`).value), hashrate: Number(document.querySelector(`[data-m="hashrate"][data-i="${i}"]`).value) }));
  saveConfig();
});
$('#saveTasks').addEventListener('click', () => {
  const rows = readList('[data-t]', 'id');
  cfg.tasks = rows.map((r, i) => ({ id: r.id, title: document.querySelector(`[data-t="title"][data-i="${i}"]`).value, reward: Number(document.querySelector(`[data-t="reward"][data-i="${i}"]`).value), type: document.querySelector(`[data-t="type"][data-i="${i}"]`).value, url: document.querySelector(`[data-t="url"][data-i="${i}"]`).value }));
  saveConfig();
});

$('#addLevel').addEventListener('click', () => { cfg.levels.push({ title: 'New level', requirement: 0 }); renderLevels(); });
$('#addMiner').addEventListener('click', () => { cfg.miners.push({ id: 'miner' + (cfg.miners.length + 1), name: 'New miner', emoji: '⚙️', cost: 1, hashrate: 1 }); renderMiners(); });
$('#addTask').addEventListener('click', () => { cfg.tasks.push({ id: 'task' + (cfg.tasks.length + 1), title: 'New task', reward: 0.01, type: 'instant', url: '' }); renderTasks(); });

document.addEventListener('click', async e => {
  const delLv = e.target.closest('[data-del-lv]');
  const delM = e.target.closest('[data-del-m]');
  const delT = e.target.closest('[data-del-t]');
  if (delLv) { cfg.levels.splice(Number(delLv.dataset.delLv), 1); renderLevels(); }
  if (delM) { cfg.miners.splice(Number(delM.dataset.delM), 1); renderMiners(); }
  if (delT) { cfg.tasks.splice(Number(delT.dataset.delT), 1); renderTasks(); }

  const ps = e.target.closest('[data-psave]');
  if (ps) {
    const id = Number(ps.dataset.psave);
    if (DEMO) return toast('DEMO mode — save disabled');
    try {
      await api('/api/admin/player', 'POST', {
        tgId: id,
        balance: Number(document.querySelector(`[data-pb="${id}"]`).value),
        banned: document.querySelector(`[data-pban="${id}"]`).checked,
      });
      toast('Player updated ✅');
      const r = await api('/api/admin/state');
      players = r.players; renderPlayers();
    } catch (err) { toast('Update failed'); }
  }

  const w = e.target.closest('[data-w]');
  if (w) {
    if (DEMO) return toast('DEMO mode — save disabled');
    try {
      await api('/api/admin/withdrawal', 'POST', { id: Number(w.dataset.wid), action: w.dataset.w });
      toast('Withdrawal ' + w.dataset.w);
      const r = await api('/api/admin/state');
      withdrawals = r.withdrawals; players = r.players;
      renderWithdrawals(); renderPlayers();
    } catch { toast('Action failed'); }
  }
});

load();