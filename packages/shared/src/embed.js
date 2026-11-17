/**
 * 向量接口：EMBEDDING_MODE=hash|openai|local
 * - hash：离线默认，jieba/领域词 + 哈希向量
 * - openai：需 OPENAI_API_KEY（可选 OPENAI_BASE_URL / OPENAI_EMBEDDING_MODEL）
 * - local：调本地 HTTP，默认 POST EMBEDDING_URL，body {text}，返回 {embedding:[...]} 或数组
 */
const path = require('path');
const { DOMAIN_WORDS, ensureJieba } = require('./lexicon');

let jiebaMod = null;
function getJieba() {
  if (jiebaMod === false) return null;
  if (jiebaMod) return jiebaMod;
  try {
    jiebaMod = ensureJieba(require('jieba-wasm'));
    return jiebaMod;
  } catch (e) {
    console.warn('[embed] jieba-wasm 不可用，回退字二元组：', e?.message || e);
    jiebaMod = false;
    return null;
  }
}

function tokenizeFallback(text) {
  const raw = (text || '').toLowerCase();
  const out = [];
  for (const m of raw.matchAll(/[a-z0-9_+#.-]{2,}/g)) out.push(m[0]);
  // 领域词先扫一遍（最长优先）
  const sorted = [...DOMAIN_WORDS].sort((a, b) => b.length - a.length);
  let zh = '';
  for (const m of raw.matchAll(/[\u4e00-\u9fff]+/g)) zh += m[0];
  let i = 0;
  const zhOut = [];
  while (i < zh.length) {
    let hit = null;
    for (const w of sorted) {
      if (zh.startsWith(w, i)) {
        hit = w;
        break;
      }
    }
    if (hit) {
      zhOut.push(hit);
      i += hit.length;
    } else {
      zhOut.push(zh[i]);
      if (i + 1 < zh.length) zhOut.push(zh.slice(i, i + 2));
      i += 1;
    }
  }
  out.push(...zhOut);
  return out.filter((t) => t && t.length >= 1);
}

function tokenize(text) {
  const raw = (text || '').toLowerCase();
  const out = [];
  for (const m of raw.matchAll(/[a-z0-9_+#.-]{2,}/g)) out.push(m[0]);
  const jieba = getJieba();
  const zhChunks = [...raw.matchAll(/[\u4e00-\u9fff]+/g)].map((m) => m[0]);
  if (jieba && zhChunks.length) {
    for (const chunk of zhChunks) {
      try {
        const parts = jieba.cut_for_search
          ? jieba.cut_for_search(chunk, true)
          : jieba.cut(chunk, true);
        for (const p of parts) {
          if (p && p.trim() && !/^[\s\u3000]+$/.test(p)) out.push(p);
        }
      } catch (_) {
        out.push(...tokenizeFallback(chunk));
      }
    }
    return out;
  }
  return tokenizeFallback(text);
}

function l2normalize(v) {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

function hashEmbed(text, dim = 256) {
  const v = new Array(dim).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    v[idx] += sign;
    // 领域词加权
    if (t.length >= 3 && /[\u4e00-\u9fff]/.test(t)) v[idx] += sign * 0.5;
  }
  return l2normalize(v);
}

function resolveMode(explicit) {
  const m = (explicit || process.env.EMBEDDING_MODE || 'hash').toLowerCase();
  if (m === 'openai' && !process.env.OPENAI_API_KEY) {
    console.warn('[embed] EMBEDDING_MODE=openai 但未设 OPENAI_API_KEY，回退 hash');
    return 'hash';
  }
  if (m === 'local' && !process.env.EMBEDDING_URL) {
    console.warn('[embed] EMBEDDING_MODE=local 但未设 EMBEDDING_URL，回退 hash');
    return 'hash';
  }
  if (m === 'openai' || m === 'local' || m === 'hash') return m;
  return 'hash';
}

async function openaiEmbed(text) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input: String(text || '').slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const emb = json?.data?.[0]?.embedding;
  if (!Array.isArray(emb)) throw new Error('OpenAI 返回无 embedding');
  return l2normalize(emb.map(Number));
}

async function localEmbed(text) {
  const url = process.env.EMBEDDING_URL;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.EMBEDDING_TOKEN ? { Authorization: `Bearer ${process.env.EMBEDDING_TOKEN}` } : {}) },
    body: JSON.stringify({ text: String(text || '').slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`local embedding HTTP ${res.status}`);
  const json = await res.json();
  const emb = Array.isArray(json) ? json : json.embedding || json.data;
  if (!Array.isArray(emb)) throw new Error('local embedding 格式不对');
  return l2normalize(emb.map(Number));
}

/** 统一入口：按模式产出向量 */
async function embedText(text, opts = {}) {
  const mode = resolveMode(opts.mode);
  if (mode === 'openai') {
    try {
      return await openaiEmbed(text);
    } catch (e) {
      console.warn('[embed] openai 失败，回退 hash：', e?.message || e);
      return hashEmbed(text, opts.dim);
    }
  }
  if (mode === 'local') {
    try {
      return await localEmbed(text);
    } catch (e) {
      console.warn('[embed] local 失败，回退 hash：', e?.message || e);
      return hashEmbed(text, opts.dim);
    }
  }
  return hashEmbed(text, opts.dim);
}

function embeddingMeta() {
  return {
    mode: resolveMode(),
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasLocalUrl: Boolean(process.env.EMBEDDING_URL),
    jieba: Boolean(getJieba()),
  };
}

module.exports = {
  tokenize,
  hashEmbed,
  embedText,
  resolveMode,
  embeddingMeta,
  l2normalize,
};
