const { tokenize, hashEmbed, embedText, embeddingMeta, l2normalize } = require('./embed');
const { detectRightsConflicts, conflictScorePenalty } = require('./rights-conflict');

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
  const base = { semantic: 0.32, keyword: 0.30, discipline: 0.22, region: 0.06, trlFit: 0.1 };
  const weights = Object.assign({}, base, input.weights || {});
  const demandTags = unique([...(input.demandKeywords||[]), ...(input.demandIndustry||[])]);
  const supplyTags = unique([...(input.supplyKeywords||[]), ...(input.supplyDisciplines||[])]);
  let kw = jaccard(demandTags, supplyTags);
  // 中文标签常有「工业视觉检测」vs「工业视觉」这类包含关系，补一点模糊重合
  if (kw < 0.35) {
    let hits = 0, total = Math.max(demandTags.length, 1);
    for (const d of demandTags) {
      const ds = String(d).toLowerCase();
      if (supplyTags.some((s) => {
        const ss = String(s).toLowerCase();
        return ss.includes(ds) || ds.includes(ss);
      })) hits++;
    }
    kw = Math.max(kw, Math.min(1, hits / total * 0.85));
  }
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
  if (typeof input.trl === 'number') {
    // 企业采购窗口更吃 TRL≥6；实验室早期仍可合作但分低一点
    if (input.trl >= 7) trlFit = 1;
    else if (input.trl >= 5) trlFit = 0.92;
    else if (input.trl >= 3) trlFit = 0.7;
    else trlFit = 0.4;
  }
  // 权利/开放许可：未知保持 0.5（对总分零加成），有信息时微调
  let rightsFit = 0.5;
  const lic = String(input.licenseOpenness || '').toLowerCase();
  const ip = String(input.ipOwnership || '').toLowerCase();
  const rightsTxt = String(input.rights || '');
  const hasRightsSignal = Boolean(lic || ip || rightsTxt);
  if (hasRightsSignal) {
    rightsFit = 0.55;
    if (lic === 'open' || /开放|可许可|非独占/.test(rightsTxt)) rightsFit = 0.95;
    else if (lic === 'negotiable' || /协商|可谈/.test(rightsTxt)) rightsFit = 0.8;
    else if (lic === 'exclusive' || /独占|不可转/.test(rightsTxt)) rightsFit = 0.45;
    if (ip === 'university' || ip === 'joint') rightsFit = Math.min(1, rightsFit + 0.05);
    if (ip === 'unclear') rightsFit = Math.max(0.35, rightsFit - 0.1);
  }
  const readiness = String(input.readinessBand || '').toLowerCase();
  if (readiness === 'production') trlFit = Math.max(trlFit, 0.95);
  else if (readiness === 'pilot') trlFit = Math.max(trlFit, 0.85);
  // 金标：小幅加成，最多约 +0.04，避免压过语义主轴
  const badges = Array.isArray(input.trustBadges) ? input.trustBadges : [];
  let trustBoost = 0;
  if (badges.includes('peer_reviewed')) trustBoost += 0.012;
  if (badges.includes('verified_import')) trustBoost += 0.01;
  if (badges.includes('complete_profile')) trustBoost += 0.008;
  if (badges.includes('duplicate_clean')) trustBoost += 0.005;
  if (badges.includes('ops_endorsed')) trustBoost += 0.015;
  if (typeof input.qualityScore === 'number' && input.qualityScore >= 0.8) trustBoost += 0.01;
  trustBoost = Math.min(0.04, trustBoost);

  // 行业 taxonomy：共享代码软加成（无标签时 0，不漂金标）
  const demTax = unique(input.demandTaxonomy || input.taxonomyDemand || []);
  const supTax = unique(input.supplyTaxonomy || input.taxonomySupply || []);
  let taxonomyFit = 0;
  let taxonomyOverlap = [];
  if (demTax.length && supTax.length) {
    taxonomyOverlap = demTax.filter((t) =>
      supTax.some((s) => String(s).toLowerCase() === String(t).toLowerCase()),
    );
    // 父子前缀弱匹配：mfg.vision vs mfg
    let soft = 0;
    for (const d of demTax) {
      const ds = String(d).toLowerCase();
      for (const s of supTax) {
        const ss = String(s).toLowerCase();
        if (ds === ss) continue;
        if (ds.startsWith(ss + '.') || ss.startsWith(ds + '.')) soft += 0.5;
      }
    }
    const raw = taxonomyOverlap.length / Math.max(Math.min(demTax.length, supTax.length), 1);
    taxonomyFit = Math.min(1, raw + soft * 0.15);
  }
  const taxonomyBoost = taxonomyFit > 0 ? Math.min(0.035, taxonomyFit * 0.035) : 0;

  const hardPass = !(kw < 0.008 && disc < 0.008 && semantic < 0.07);
  const core = semantic*weights.semantic + kw*weights.keyword + disc*weights.discipline + region*weights.region + trlFit*weights.trlFit;
  // 权利项：相对中性 0.5 的偏移 * 小系数，未知时加成=0 → 金标评测不漂
  const rightsBonus = hasRightsSignal ? (rightsFit - 0.5) * 0.05 : 0;
  const conflictPack = detectRightsConflicts(
    { licenseNeed: input.licenseNeed, minTrl: input.minTrl, expectedOut: input.demandExpectedOut, problem: input.demandProblem, title: input.demandTitle },
    { licenseOpenness: input.licenseOpenness, rights: input.rights, trl: input.trl, readinessBand: input.readinessBand, title: input.supplyTitle },
  );
  const conflictPenalty = conflictScorePenalty(conflictPack.conflicts);
  const hardNegPenalty = input.hardNegative ? 0.25 : 0;
  const total = Math.max(0, Math.min(1, core + rightsBonus + trustBoost + taxonomyBoost - conflictPenalty - hardNegPenalty));
  const overlap = demandTags.filter((t) => supplyTags.some((s) => String(s).toLowerCase()===String(t).toLowerCase())).slice(0,6);
  const reasonParts = [];
  reasonParts.push(`语义相近度 ${(semantic*100).toFixed(0)}%，关键词重合 ${(kw*100).toFixed(0)}%。`);
  reasonParts.push(overlap.length ? `共同标签：${unique(overlap).join('、')}。` : '标签直接重合较少，主要靠摘要语义接近。');
  if (typeof input.trl === 'number') reasonParts.push(`供给侧成熟度约 TRL ${input.trl}${readiness ? `（${readiness}）` : ''}。`);
  if (hasRightsSignal) {
    const bits = [];
    if (ip) bits.push(`权属 ${ip}`);
    if (lic) bits.push(`许可 ${lic}`);
    if (rightsTxt) bits.push(rightsTxt.slice(0, 24));
    reasonParts.push(`知识产权信号：${bits.join(' · ')}。`);
  }
  if (badges.length) {
    const zh = { peer_reviewed: '同行复核', verified_import: '授权导入核验', complete_profile: '档案较完整', duplicate_clean: '已去重', ops_endorsed: '运营背书' };
    reasonParts.push(`信任金标：${badges.map((b) => zh[b] || b).join('、')}。`);
  }
  if (input.demandRegion && input.supplyRegion) {
    reasonParts.push(region > 0.5 ? `地域偏好较吻合（${input.supplyRegion} / ${input.demandRegion}）。` : `地域不完全一致（${input.supplyRegion} vs ${input.demandRegion}），可远程合作。`);
  }
  if (taxonomyOverlap.length) {
    reasonParts.push(`行业标签重合：${taxonomyOverlap.slice(0, 4).join('、')}。`);
  }
  if (conflictPack.conflicts.length) {
    reasonParts.push('注意：' + conflictPack.conflicts.map((c) => c.labelZh).join('、') + '。');
  }
  reasonParts.push('建议运营复核后生成邀约草稿。');
  return {
    total: Math.round(total*1000)/1000,
    breakdown: {
      hardPass,
      semantic: round2(semantic),
      keyword: round2(kw),
      discipline: round2(disc),
      region: round2(region),
      trlFit: round2(trlFit),
      rightsFit: round2(rightsFit),
      trustBoost: round2(trustBoost),
      rightsBonus: round2(rightsBonus),
      conflictPenalty: round2(conflictPenalty),
      conflicts: conflictPack.conflicts,
      taxonomyFit: round2(taxonomyFit),
      taxonomyBoost: round2(taxonomyBoost),
      taxonomyOverlap,
      weights,
      embeddingMode: embeddingMeta().mode,
    },
    reason: reasonParts.join(''),
  };
}
function buildOutreachDraft(input) {
  const who = input.personName || '老师/负责人';
  const ops = process.env.OPS_DISPLAY_NAME || process.env.MAIL_FROM_NAME || process.env.CHANNEL_EMAIL_OPS_NAME || '小蚁';
  const product = '研企通';
  return {
    subject: `【${product}】关于「${input.demandTitle}」的合作对接建议`,
    body: `${who}您好：

我是${ops}，来自「${product}」。平台上把「${input.demandOrg}」的需求「${input.demandTitle}」，与「${input.supplyOrg}」的能力/成果「${input.supplyTitle}」对上了。

为什么推荐这条：${input.reason}${input.collabModeLabel ? `\n建议合作方式：${input.collabModeLabel}。` : ''}

如果方便，可以用邀请链接补一下档案：${input.inviteUrl || '（运营稍后补发）'}，或直接回复本邮件约个短沟通。

说明：这是系统草稿，必须人工点头后才会正式发出，不会自动群发。

— ${ops} · ${product}`,
  };
}
const dossier = require('./dossier');

module.exports = {
  detectRightsConflicts,
  conflictScorePenalty,
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
  ...dossier,
};
