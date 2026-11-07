/**
 * Cloudflare Pages Function: POST /api/ai
 *
 * 作用：把大模型请求放到服务端，浏览器不再持有 Key。
 * · 请求必须带 Supabase 登录令牌（Authorization: Bearer <access_token>）
 * · 服务端校验令牌 → 校验允许名单 → 用环境变量里的 Key 转发给模型服务
 * · 原样透传 SSE 流，前端仍按 OpenAI 格式解析
 *
 * 需要的环境变量（Cloudflare Pages → Settings → Environment variables）：
 *   AI_API_KEY        模型服务商的 Key（必填，加密保存）
 *   AI_BASE_URL       接口根地址，默认 https://api.deepseek.com
 *   AI_MODEL          模型名，默认 deepseek-chat
 *   SUPABASE_URL      你的 Supabase 项目地址（用于校验登录令牌）
 *   SUPABASE_PUBLISHABLE_KEY  Supabase 的 publishable/anon key
 *   AI_ALLOWED_EMAILS 允许使用的邮箱/用户 id，逗号分隔；留空表示任何登录用户都能用
 */

const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const MAX_MESSAGES = 24;
const MAX_CHARS = 8000;
const MAX_TOKENS = 1500;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequestPost({ request, env }) {
  // 1) 取登录令牌
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: '请先登录后再使用内置通道' }, 401);

  if (!env.AI_API_KEY) {
    return json({ error: '服务端还没有配置模型密钥（AI_API_KEY），请先在 Cloudflare 里补上' }, 503);
  }
  const supaUrl = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supaKey = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  if (!supaUrl || !supaKey) {
    return json({ error: '服务端未配置 SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY' }, 503);
  }

  // 2) 校验令牌（顺带拿到用户信息）
  let user = null;
  try {
    const res = await fetch(supaUrl + '/auth/v1/user', {
      headers: { apikey: supaKey, Authorization: 'Bearer ' + token }
    });
    if (res.ok) user = await res.json();
  } catch (e) {
    return json({ error: '校验登录状态时连不上 Supabase，稍后再试' }, 502);
  }
  if (!user || !user.id) return json({ error: '登录状态无效或已过期，请重新登录' }, 401);

  // 3) 允许名单（不填则任何登录用户可用；站点开放注册时建议填上）
  const allow = String(env.AI_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length) {
    const email = String(user.email || '').toLowerCase();
    const uid = String(user.id || '').toLowerCase();
    if (allow.indexOf(email) < 0 && allow.indexOf(uid) < 0) {
      return json({ error: '这个账号没有使用内置通道的权限' }, 403);
    }
  }

  // 4) 校验并裁剪请求体
  let body = null;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: '请求格式不对' }, 400);
  }
  const raw = body && Array.isArray(body.messages) ? body.messages : [];
  const messages = raw
    .filter((m) => m && typeof m.content === 'string' && ['system', 'user', 'assistant'].indexOf(m.role) >= 0)
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_CHARS) }));
  if (!messages.length) return json({ error: '没有可发送的内容' }, 400);

  // 5) 转发（模型名与温度由服务端决定，避免前端指定昂贵模型）
  const base = String(env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = String(env.AI_MODEL || DEFAULT_MODEL);

  let upstream;
  try {
    upstream = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + env.AI_API_KEY
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        stream: true,
        temperature: 0.7,
        max_tokens: MAX_TOKENS
      })
    });
  } catch (e) {
    return json({ error: '连接模型服务失败：' + ((e && e.message) || '网络错误') }, 502);
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 400);
    } catch (e) {
      /* ignore */
    }
    return json(
      { error: '模型服务返回 ' + upstream.status + (detail ? '：' + detail : '') },
      502
    );
  }

  // 6) 原样透传 SSE
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    }
  });
}
