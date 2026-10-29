// Mvolt AI backend (Cloudflare Worker).
// Routes (POST unless noted): /ai  /status  /reward  /event   GET /stats?key=ADMIN_KEY
// Credits: free daily credits per device, bonus credits from rewarded ads, Pro plan (RevenueCat) with a high daily limit.
const ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const origin = req.headers.get('Origin') || '';
    const extra = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const allowed = [...ORIGINS, ...extra].includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'null',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Vary': 'Origin'
    };
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Admin stats (your eyes only): /stats?key=ADMIN_KEY
    if (req.method === 'GET' && path === '/stats') {
      if (!env.ADMIN_KEY || url.searchParams.get('key') !== env.ADMIN_KEY) return J({ error: 'Not found' }, 404);
      const days = [];
      for (let i = 0; i < 7; i++) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
      const out = {};
      for (const d of days) {
        const [dau, ai, rw] = await Promise.all([env.LIMITS.get('dau:' + d), env.LIMITS.get('g:' + d), env.LIMITS.get('rw:' + d)]);
        const l = await env.LIMITS.list({ prefix: 'tool:' + d + ':' });
        const tools = (await Promise.all(l.keys.map(async k => [k.name.split(':')[2], +(await env.LIMITS.get(k.name)) || 0]))).sort((a, b) => b[1] - a[1]).slice(0, 10);
        out[d] = { users: +dau || 0, ai_requests: +ai || 0, rewards: +rw || 0, top_tools: tools };
      }
      return J(out);
    }

    if (req.method !== 'POST') return J({ error: 'Not found' }, 404);
    if (!allowed) return J({ error: 'Origin not allowed' }, 403);
    if ((+req.headers.get('content-length') || 0) > 3000000) return J({ error: 'Request too large' }, 413);

    let b;
    try { b = await req.json(); } catch { return J({ error: 'Bad request' }, 400); }
    const device = String(b.device || '').replace(/[^\w-]/g, '').slice(0, 64);
    if (!device) return J({ error: 'Bad request' }, 400);
    const uid = String(b.uid || '').replace(/[^\w.:@-]/g, '').slice(0, 100);

    const day = new Date().toISOString().slice(0, 10);
    const ip = req.headers.get('CF-Connecting-IP') || '0';
    const FREE = num(env.DEVICE_LIMIT, 15);
    const PRO = num(env.PRO_LIMIT, 200);
    const REWARD_CREDITS = num(env.REWARD_CREDITS, 5);
    const REWARD_PER_DAY = num(env.REWARD_PER_DAY, 3);
    const getN = async k => +(await env.LIMITS.get(k)) || 0;
    const putN = (k, v, ttl) => env.LIMITS.put(k, String(v), { expirationTtl: ttl || 172800 });

    // Is this user a Pro subscriber? Asks RevenueCat, cached for 10 minutes.
    async function isPro() {
      if (!uid || !env.REVENUECAT_SECRET) return false;
      const ck = 'p:' + uid;
      if (b.refresh && env.LIMITS.delete) await env.LIMITS.delete(ck);
      const c = await env.LIMITS.get(ck);
      if (c !== null) return c === '1';
      let pro = false;
      try {
        const r = await fetch('https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(uid), { headers: { Authorization: 'Bearer ' + env.REVENUECAT_SECRET } });
        if (r.ok) {
          const d = await r.json();
          const e = d && d.subscriber && d.subscriber.entitlements && d.subscriber.entitlements[env.PRO_ENTITLEMENT || 'pro'];
          pro = !!(e && (!e.expires_date || Date.parse(e.expires_date) > Date.now()));
          await env.LIMITS.put(ck, pro ? '1' : '0', { expirationTtl: 600 });
        }
      } catch {}
      return pro;
    }

    async function state() {
      const pro = await isPro();
      const used = await getN('d:' + device + ':' + day);
      const bonus = await getN('b:' + device);
      const rewardsToday = await getN('r:' + device + ':' + day);
      return { pro, used, bonus, rewardsToday, free_left: Math.max(0, (pro ? PRO : FREE) - used), rewards_left: Math.max(0, REWARD_PER_DAY - rewardsToday), reward_credits: REWARD_CREDITS };
    }
    const pub = s => ({ pro: s.pro, credits: s.free_left + s.bonus, free_left: s.free_left, bonus: s.bonus, rewards_left: s.rewards_left, reward_credits: s.reward_credits });

    if (path === '/status') return J(pub(await state()));

    if (path === '/event') {
      const tool = String(b.tool || '').replace(/[^\w-]/g, '').slice(0, 24);
      const seen = 'seen:' + device + ':' + day;
      if (!(await env.LIMITS.get(seen))) {
        await env.LIMITS.put(seen, '1', { expirationTtl: 172800 });
        await putN('dau:' + day, (await getN('dau:' + day)) + 1);
      }
      if (tool) await putN('tool:' + day + ':' + tool, (await getN('tool:' + day + ':' + tool)) + 1, 864000);
      return J({ ok: true });
    }

    // A rewarded ad was watched: grant bonus credits. Capped per device, per network address and per day.
    if (path === '/reward') {
      const s = await state();
      if (s.rewardsToday >= REWARD_PER_DAY) return J({ error: 'No more rewards today. Come back tomorrow.' }, 429);
      const ipN = await getN('ri:' + ip + ':' + day);
      if (ipN >= REWARD_PER_DAY * 4) return J({ error: 'No more rewards today. Come back tomorrow.' }, 429);
      if (await getN('rw:' + day) >= num(env.REWARD_GLOBAL, 1500)) return J({ error: 'Rewards are busy today. Try again tomorrow.' }, 429);
      await Promise.all([
        putN('r:' + device + ':' + day, s.rewardsToday + 1),
        putN('ri:' + ip + ':' + day, ipN + 1),
        putN('rw:' + day, (await getN('rw:' + day)) + 1),
        env.LIMITS.put('b:' + device, String(Math.min(s.bonus + REWARD_CREDITS, 100)), { expirationTtl: 60 * 86400 })
      ]);
      return J(pub(await state()));
    }

    if (path !== '/ai' && path !== '/') return J({ error: 'Not found' }, 404);

    const system = typeof b.system === 'string' ? b.system : '';
    let user = b.user;
    if (system.length > 3000) return J({ error: 'Bad request' }, 400);
    if (typeof user === 'string') {
      if (!user.trim() || user.length > 6000) return J({ error: 'Bad request' }, 400);
    } else if (Array.isArray(user) && user.length > 0 && user.length <= 3) {
      for (const p of user) {
        if (p && p.type === 'text' && typeof p.text === 'string' && p.text.length <= 6000) continue;
        if (p && p.type === 'image' && p.source && p.source.type === 'base64' &&
            ['image/jpeg', 'image/png', 'image/webp'].includes(p.source.media_type) &&
            typeof p.source.data === 'string' && p.source.data.length <= 2000000) continue;
        return J({ error: 'Bad request' }, 400);
      }
    } else return J({ error: 'Bad request' }, 400);

    // Limits: per device (free or Pro), per network address, and a global safety cap.
    const s = await state();
    const ipN = await getN('i:' + ip + ':' + day);
    const gN = await getN('g:' + day);
    if (gN >= num(env.GLOBAL_LIMIT, 3000)) return J({ error: 'AI is very busy today. Please try again tomorrow.', code: 'BUSY' }, 429);
    if (ipN >= num(env.IP_LIMIT, 40) * (s.pro ? 5 : 1)) return J({ error: 'Daily AI limit reached. Try again tomorrow.', code: 'LIMIT' }, 429);
    let useBonus = false;
    if (s.free_left <= 0) {
      if (s.bonus > 0) useBonus = true;
      else return J({ error: s.pro ? 'Daily Pro limit reached. Try again tomorrow.' : 'Daily free AI credits finished.', code: s.pro ? 'PROLIMIT' : 'LIMIT', ...pub(s) }, 429);
    }
    await Promise.all([
      useBonus ? env.LIMITS.put('b:' + device, String(s.bonus - 1), { expirationTtl: 60 * 86400 }) : putN('d:' + device + ':' + day, s.used + 1),
      putN('i:' + ip + ':' + day, ipN + 1),
      putN('g:' + day, gN + 1)
    ]);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.MODEL || 'claude-haiku-5-5',
        max_tokens: Math.min(+b.max_tokens || 700, s.pro ? 2000 : 800),
        system,
        messages: [{ role: 'user', content: user }]
      })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return J({ error: 'AI is not available right now. Please try again later.' }, 502);
    const s2 = { ...s, used: useBonus ? s.used : s.used + 1, bonus: useBonus ? s.bonus - 1 : s.bonus };
    s2.free_left = Math.max(0, (s.pro ? PRO : FREE) - s2.used);
    return J({ text: (d.content || []).map(c => c.text || '').join('').trim(), ...pub(s2) });
  }
};
