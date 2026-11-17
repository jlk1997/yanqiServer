const { tokenize, hashEmbed, embedText, embeddingMeta, l2normalize } = require('./embed');

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function jaccard(a, b) {
  const A = new Set((a || []).map((x) => String(x).toLowerCase()).filter(Boolean));
  const B = new Set((b || []).map((x) => String(x).toLowerCase()).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function round2(n) { return Math.round(n * 1000) / 1000; }
function unique(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr || []) {
    const k = String(x).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
function scorePair(input) {
  const weights = { semantic: 0.4, keyword: 0.25, discipline: 0.2, region: 0.05, trlFit: 0.1 };
  const demandTags = unique([...(input.demandKeywords||[]), ...(input.demandIndustry||[])]);
  const supplyTags = unique([...(input.supplyKeywords||[]), ...(input.supplyDisciplines||[])]);
  const kw = jaccard(demandTags, supplyTags);
  const disc = jaccard(input.demandIndustry||[], input.supplyDisciplines||[]);
  const demb = input.demandEmb?.length ? input.demandEmb : hashEmbed(input.demandText||'');
  const semb = input.supplyEmb?.length ? input.supplyEmb : hashEmbed(input.supplyText||'');
  // 维度不同时（openai vs hash）退回文本重算 hash，避免崩
  let semantic = 0;
  if (demb.length === semb.length) semantic = Math.max(0, cosine(demb, semb));
  else semantic = Math.max(0, cosine(hashEmbed(input.demandText||''), hashEmbed(input.supplyText||'')));
  let region = 0.5;
  if (input.demandRegion && input.supplyRegion) {
    region = (String(input.demandRegion).includes(String(input.supplyRegion)) || String(input.supplyRegion).includes(String(input.demandRegion))) ? 1 : 0.2;
  }
  let trlFit = 0.6;
  if (typeof input.trl === 'number') trlFit = input.trl >= 5 ? 1 : input.trl >= 3 ? 0.7 : 0.4;
  const hardPass = !(kw < 0.01 && disc < 0.01 && semantic < 0.08);
  const total = semantic*weights.semantic + kw*weights.keyword + disc*weights.discipline + region*weights.region + trlFit*weights.trlFit;
  const overlap = demandTags.filter((t) => supplyTags.some((s) => String(s).toLowerCase()===String(t).toLowerCase())).slice(0,6);
  const reasonParts = [];
  reasonParts.push(`语义相近度 ${(semantic*100).toFixed(0)}%，关键词重合 ${(kw*100).toFixed(0)}%。`);
  reasonParts.push(overlap.length ? `共同标签：${unique(overlap).join('、')}。` : '标签直接重合较少，主要靠摘要语义接近。');
  if (typeof input.trl === 'number') reasonParts.push(`供给侧成熟度约 TRL ${input.trl}。`);
  if (input.demandRegion && input.supplyRegion) {
    reasonParts.push(region > 0.5 ? `地域偏好较吻合（${input.supplyRegion} / ${input.demandRegion}）。` : `地域不完全一致（${input.supplyRegion} vs ${input.demandRegion}），可远程合作。`);
  }
  reasonParts.push('建议运营复核后生成邀约草稿。');
  return { total: Math.round(total*1000)/1000, breakdown: { hardPass, semantic: round2(semantic), keyword: round2(kw), discipline: round2(disc), region: round2(region), trlFit: round2(trlFit), weights, embeddingMode: embeddingMeta().mode }, reason: reasonParts.join('') };
}
function buildOutreachDraft(input) {
  const who = input.personName || '老师/负责人';
  return {
    subject: `【研企通】关于「${input.demandTitle}」的合作对接建议`,
    body: `${who}您好：\n\n我们在「研企通」平台上，把贵方「${input.demandOrg}」的需求「${input.demandTitle}」，与「${input.supplyOrg}」的能力/成果「${input.supplyTitle}」做了匹配。\n\n匹配说明：${input.reason}\n\n如方便，欢迎通过邀请链接完善档案：${input.inviteUrl || '（运营稍后补发）'}，或回复本邮件约定一次沟通。本邮件为系统草稿，需人工确认后才会正式发送。\n\n研企通运营团队`,
  };
}
module.exports = {
  hashEmbed,
  tokenize,
  cosine,
  l2normalize,
  jaccard,
  scorePair,
  buildOutreachDraft,
  unique,
  embedText,
  embeddingMeta,
};
