export const DEFAULT_CONFIG = {
  coinName: 'Lunar Crystal',
  coinSymbol: 'LC',
  mapName: 'Lunar surface pit',
  baseHashrate: 2.64,
  coinPerThPerHour: 0.01,
  collectHours: 24,
  startBalance: 0,
  minWithdraw: 0.5,
  levels: [
    { title: 'Novice', requirement: 0 },
    { title: 'Apprentice', requirement: 1 },
    { title: 'Digger', requirement: 3 },
    { title: 'Miner', requirement: 6 },
    { title: 'Foreman', requirement: 10 },
    { title: 'Engineer', requirement: 15 },
    { title: 'Expert', requirement: 21 },
    { title: 'Master', requirement: 28 },
    { title: 'Legend', requirement: 36 },
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

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, typeof data === 'string' ? enc.encode(data) : data));
}

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const checkString = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppInitData', botToken);
  const expected = hex(await hmac(secret, checkString));
  if (expected !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    if (!user || !Number.isSafeInteger(user.id)) return null;
    return user;
  } catch {
    return null;
  }
}

export function application({ db, env, BackendError }) {
  const fail = (code, status) => { throw new BackendError(code, status); };
  const rows = r => { if (r.error) fail('database_error', 503); return r.data; };
  const adminIds = () => String(env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Number.isSafeInteger);

  async function body(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) fail('invalid_input', 400);
    const text = await request.text();
    if (text.length > 16384) fail('payload_too_large', 413);
    try { return JSON.parse(text); } catch { fail('invalid_input', 400); }
  }

  async function getConfig() {
    const found = rows(await db.from('config').select('data').eq('id', 1).limit(1));
    if (found?.length) return { ...DEFAULT_CONFIG, ...found[0].data };
    rows(await db.from('config').insert({ id: 1, data: DEFAULT_CONFIG }));
    return { ...DEFAULT_CONFIG };
  }

  async function getPlayer(userId, name) {
    const found = rows(await db.from('players').select('*').eq('tg_id', userId).limit(1));
    if (found?.length) return found[0];
    const cfg = await getConfig();
    const created = rows(await db.from('players').insert({
      tg_id: userId, name: name || 'Miner', balance: cfg.startBalance, total_mined: 0,
      miners: {}, last_collect: new Date().toISOString(), banned: false, created_at: new Date().toISOString(),
    }).select('*'));
    return created[0];
  }

  const hashrateOf = (cfg, miners) => cfg.baseHashrate + cfg.miners.reduce((s, m) => s + m.hashrate * (miners?.[m.id] || 0), 0);
  const levelOf = (cfg, total) => { let l = 0; cfg.levels.forEach((lv, i) => { if (total >= lv.requirement) l = i; }); return l; };
  const pendingOf = (cfg, p, now) => {
    const hours = Math.min(Math.max((now - new Date(p.last_collect).getTime()) / 3600000, 0), cfg.collectHours);
    return hours * hashrateOf(cfg, p.miners) * cfg.coinPerThPerHour;
  };

  async function auth(request) {
    const user = await verifyInitData(request.headers.get('x-telegram-init-data') || '', env.BOT_TOKEN);
    if (!user) fail('unauthorized', 401);
    return user;
  }
  const requireAdmin = user => { if (!adminIds().includes(user.id)) fail('forbidden', 403); };

  async function tg(method, payload) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    } catch {
      return {};
    }
  }

  async function webhook(request) {
    if (request.headers.get('x-telegram-bot-api-secret-token') !== env.WEBHOOK_SECRET) fail('forbidden', 403);
    const update = await body(request);
    const msg = update.message;
    if (!msg?.text || !env.BOT_TOKEN) return Response.json({ ok: true });
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const isAdmin = adminIds().includes(userId);
    const origin = new URL(request.url).origin;
    const keyboard = [[{ text: '⛏ Open Mine', web_app: { url: origin + '/' } }]];
    if (isAdmin) keyboard.push([{ text: '🛠 Admin Panel', web_app: { url: origin + '/admin.html' } }]);
    const send = text => tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
    const cmd = msg.text.split(' ')[0].split('@')[0];
    if (cmd === '/start') {
      await getPlayer(userId, msg.from?.first_name);
      await send(`⛏ <b>Lunar Miner</b>\n\nMoon-এ crystal খুঁড়ে collect করো, miners কিনে hashrate বাড়াও!\n\nনিচের button দিয়ে game খোলো।${isAdmin ? '\n🛠 Admin Panel button শুধু তোমার জন্য।' : ''}`);
    } else if (cmd === '/admin') {
      if (isAdmin) await send('🛠 Admin Panel খোলো — সব settings, players আর withdrawals এখান থেকে change করা যাবে।');
      else await tg('sendMessage', { chat_id: chatId, text: '⛔ Admin Panel শুধু bot owner দেখতে পারে।' });
    } else if (cmd === '/balance') {
      const p = await getPlayer(userId, msg.from?.first_name);
      const cfg = await getConfig();
      await tg('sendMessage', { chat_id: chatId, text: `💎 Balance: <b>${p.balance.toFixed(4)} ${cfg.coinSymbol}</b>\n⚡ Hashrate: ${hashrateOf(cfg, p.miners).toFixed(2)} TH/s` });
    } else if (cmd === '/help') {
      await send('/start — game খোলো\n/balance — balance দেখো\n/admin — admin panel (শুধু owner)');
    }
    return Response.json({ ok: true });
  }

  function validateConfig(c) {
    const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    const num = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
    if (!str(c.coinName, 40) || !str(c.coinSymbol, 8) || !str(c.mapName, 40)) fail('invalid_config', 400);
    if (!num(c.baseHashrate, 1e6) || !num(c.coinPerThPerHour, 1e3) || !num(c.collectHours, 168) || c.collectHours < 1) fail('invalid_config', 400);
    if (!num(c.startBalance, 1e6) || !num(c.minWithdraw, 1e6)) fail('invalid_config', 400);
    if (!Array.isArray(c.levels) || c.levels.length < 1 || c.levels.length > 200) fail('invalid_config', 400);
    for (const lv of c.levels) if (!str(lv.title, 40) || !num(lv.requirement, 1e9)) fail('invalid_config', 400);
    if (!Array.isArray(c.miners) || c.miners.length > 50) fail('invalid_config', 400);
    for (const m of c.miners) if (!str(m.id, 30) || !str(m.name, 40) || !num(m.cost, 1e6) || !num(m.hashrate, 1e6)) fail('invalid_config', 400);
    if (!Array.isArray(c.tasks) || c.tasks.length > 50) fail('invalid_config', 400);
    for (const t of c.tasks) if (!str(t.id, 30) || !str(t.title, 80) || !num(t.reward, 1e6) || !['instant', 'link'].includes(t.type)) fail('invalid_config', 400);
    return c;
  }

  return async ctx => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail('not_found', 404);
    const path = match[1] || '/';

    if (path === '/api/health' && request.method === 'GET') return Response.json({ ok: true });
    if (path === '/webhook' && request.method === 'POST') return webhook(request);

    if (path === '/api/setup-webhook' && request.method === 'GET') {
      const key = new URL(request.url).searchParams.get('key');
      if (!env.WEBHOOK_SECRET || key !== env.WEBHOOK_SECRET) fail('forbidden', 403);
      if (!env.BOT_TOKEN) fail('service_not_configured', 503);
      const origin = new URL(request.url).origin;
      const url = origin + '/functions/v1/app/webhook';
      const me = await tg('getMe', {});
      const set = await tg('setWebhook', { url, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message'] });
      return Response.json({ ok: set.ok === true, bot: me.result?.username || null, url });
    }

    const user = await auth(request);
    const cfg = await getConfig();

    if (path === '/api/bootstrap' && request.method === 'GET') {
      const player = await getPlayer(user.id, user.first_name);
      if (player.banned) fail('banned', 403);
      const claims = rows(await db.from('task_claims').select('task_id').eq('tg_id', user.id).limit(200));
      const withdrawals = rows(await db.from('withdrawals').select('*').eq('tg_id', user.id).order('created_at', { ascending: false }).limit(50));
      return Response.json({
        player, config: cfg, isAdmin: adminIds().includes(user.id),
        claims: (claims || []).map(c => c.task_id), withdrawals: withdrawals || [], now: Date.now(),
      });
    }

    if (path === '/api/collect' && request.method === 'POST') {
      const player = await getPlayer(user.id, user.first_name);
      if (player.banned) fail('banned', 403);
      const now = Date.now();
      const gained = pendingOf(cfg, player, now);
      const updated = rows(await db.from('players').update({
        balance: player.balance + gained, total_mined: player.total_mined + gained, last_collect: new Date(now).toISOString(),
      }).eq('tg_id', user.id).select('*'));
      return Response.json({ player: updated[0], gained });
    }

    if (path === '/api/buy-miner' && request.method === 'POST') {
      const { id } = await body(request);
      const miner = cfg.miners.find(m => m.id === id);
      if (!miner) fail('not_found', 404);
      const player = await getPlayer(user.id, user.first_name);
      if (player.banned) fail('banned', 403);
      if (player.balance < miner.cost) fail('insufficient_balance', 400);
      const miners = { ...player.miners, [id]: (player.miners?.[id] || 0) + 1 };
      const updated = rows(await db.from('players').update({ balance: player.balance - miner.cost, miners }).eq('tg_id', user.id).select('*'));
      return Response.json({ player: updated[0] });
    }

    if (path === '/api/claim-task' && request.method === 'POST') {
      const { id } = await body(request);
      const task = cfg.tasks.find(t => t.id === id);
      if (!task) fail('not_found', 404);
      const player = await getPlayer(user.id, user.first_name);
      if (player.banned) fail('banned', 403);
      const claimed = rows(await db.from('task_claims').select('task_id').eq('tg_id', user.id).eq('task_id', id).limit(1));
      if (claimed?.length) fail('already_claimed', 400);
      rows(await db.from('task_claims').insert({ tg_id: user.id, task_id: id, claimed_at: new Date().toISOString() }));
      const updated = rows(await db.from('players').update({ balance: player.balance + task.reward }).eq('tg_id', user.id).select('*'));
      return Response.json({ player: updated[0] });
    }

    if (path === '/api/withdraw' && request.method === 'POST') {
      const { amount } = await body(request);
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < cfg.minWithdraw || amount > 1e6) fail('invalid_amount', 400);
      const player = await getPlayer(user.id, user.first_name);
      if (player.banned) fail('banned', 403);
      if (player.balance < amount) fail('insufficient_balance', 400);
      rows(await db.from('players').update({ balance: player.balance - amount }).eq('tg_id', user.id));
      const created = rows(await db.from('withdrawals').insert({ id: Date.now(), tg_id: user.id, amount, status: 'pending', created_at: new Date().toISOString() }).select('*'));
      return Response.json({ withdrawal: created[0] });
    }

    if (path === '/api/admin/setup-webhook' && request.method === 'POST') {
      requireAdmin(user);
      if (!env.BOT_TOKEN || !env.WEBHOOK_SECRET) fail('service_not_configured', 503);
      const origin = new URL(request.url).origin;
      const url = origin + '/functions/v1/app/webhook';
      const me = await tg('getMe', {});
      const set = await tg('setWebhook', { url, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message'] });
      return Response.json({ ok: set.ok === true, bot: me.result?.username || null, url });
    }

    if (path === '/api/admin/state' && request.method === 'GET') {
      requireAdmin(user);
      const players = rows(await db.from('players').select('*').order('created_at', { ascending: false }).limit(500));
      const withdrawals = rows(await db.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(200));
      return Response.json({ config: cfg, players: players || [], withdrawals: withdrawals || [] });
    }

    if (path === '/api/admin/config' && request.method === 'POST') {
      requireAdmin(user);
      const config = validateConfig(await body(request));
      const found = rows(await db.from('config').select('id').eq('id', 1).limit(1));
      if (found?.length) rows(await db.from('config').update({ data: config }).eq('id', 1));
      else rows(await db.from('config').insert({ id: 1, data: config }));
      return Response.json({ config });
    }

    if (path === '/api/admin/player' && request.method === 'POST') {
      requireAdmin(user);
      const b = await body(request);
      if (!Number.isSafeInteger(b.tgId)) fail('invalid_input', 400);
      const patch = {};
      if (b.balance !== undefined) { if (typeof b.balance !== 'number' || b.balance < 0 || b.balance > 1e9) fail('invalid_input', 400); patch.balance = b.balance; }
      if (b.banned !== undefined) { if (typeof b.banned !== 'boolean') fail('invalid_input', 400); patch.banned = b.banned; }
      if (!Object.keys(patch).length) fail('invalid_input', 400);
      const updated = rows(await db.from('players').update(patch).eq('tg_id', b.tgId).select('*'));
      if (!updated?.length) fail('not_found', 404);
      return Response.json({ player: updated[0] });
    }

    if (path === '/api/admin/withdrawal' && request.method === 'POST') {
      requireAdmin(user);
      const { id, action } = await body(request);
      if (!['paid', 'rejected'].includes(action)) fail('invalid_input', 400);
      const found = rows(await db.from('withdrawals').select('*').eq('id', id).limit(1));
      if (!found?.length) fail('not_found', 404);
      const w = found[0];
      if (w.status !== 'pending') fail('already_processed', 400);
      rows(await db.from('withdrawals').update({ status: action }).eq('id', id));
      if (action === 'rejected') {
        const p = rows(await db.from('players').select('balance').eq('tg_id', w.tg_id).limit(1));
        if (p?.length) rows(await db.from('players').update({ balance: p[0].balance + w.amount }).eq('tg_id', w.tg_id));
      }
      return Response.json({ ok: true });
    }

    fail('not_found', 404);
  };
}