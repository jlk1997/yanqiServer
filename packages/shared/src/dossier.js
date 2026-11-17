/**
 * 匹配卷宗、覆盖门闩、发布门闩。不改 scorePair 的总分定义。
 * 规则版本写入批次日志，便于对照分数变化。
 */
const RULE_VERSION = 'dossier-1';

const COLLAB_LABEL = {
  lateral: '横向开发或技术服务',
  license: '许可或转让',
  challenge: '揭榜联合攻关',
  observe: '只观察，先不联系',
};

const ACTION_ZH = {
  SHADOW: '影子匹配，先不找人',
  REVIEW: '可以复核',
  FIND_PEOPLE: '可以找人',
  HOLD: '先搁置',
};

const STAGE_ZH = {
  accumulating: '蓄水',
  shadow: '可复核',
  outreach: '可找人',
};

const BLOCKER_ZH = {
  junk: '像垃圾标题或空标题',
  demo_blocked: '演示数据，默认不发布',
  thin_summary: '正文太短，还不能展示',
  no_person: '还没挂到具体老师',
  no_school: '还没挂到学校',
  no_name: '缺少姓名',
  no_type: '缺少成果类型',
  no_year: '缺少年份或外部编号',
  no_owner: '没有负责老师或实验室',
  no_keywords: '关键词不够',
  no_evidence: '说不清这条能力从哪来',
  no_org: '需求还没挂到机构',
  unknown_demand_kind: '还看不出是技术问题、揭榜、采购还是联合研发',
  no_taxonomy: '还没归到行业',
  ambiguous_person: '同名老师还没确认是不是同一个人',
  conflict_field: '多个来源对不上，等人工选定',
  lab_unplaced: '实验室还没挂到学院或学校',
  stale: '超过半年没有来源再印证',
};

function thresholds(overrides) {
  const envNum = (name, fallback) => {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && process.env[name] !== undefined && process.env[name] !== '' ? n : fallback;
  };
  return Object.assign(
    {
      minTeachers: envNum('COVERAGE_MIN_TEACHERS', 20),
      minDemands: envNum('COVERAGE_MIN_DEMANDS', 8),
      maxAgeDays: envNum('COVERAGE_MAX_AGE_DAYS', 45),
      minContactRatio: envNum('COVERAGE_MIN_CONTACT_RATIO', 0.3),
      reviewMinScore: envNum('MATCH_REVIEW_MIN_SCORE', 0.45),
    },
    overrides || {},
  );
}

function normalizeName(input) {
  let s = String(input || '').trim();
  s = s.replace(/[\u3000]/g, ' ').replace(/\s+/g, '');
  s = s.replace(/[（(].*?[）)]/g, '');
  s = s.replace(/(教授|副教授|博士生导师|博士|老师|先生|女士)$/g, '');
  s = s.replace(/(有限责任公司|股份有限公司|有限公司|集团|公司)$/g, '');
  return s.toLowerCase();
}

function isJunkTitle(title) {
  const t = String(title || '').trim();
  if (t.length < 4) return true;
  if (/^(untitled|test|测试|首页|导航|更多|登录|注册)$/i.test(t)) return true;
  return false;
}

function summaryPublic(text, max = 280) {
  let s = String(text || '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function inferDemandKind(explicit, text) {
  const given = String(explicit || '').trim();
  if (['tech_problem', 'challenge', 'procurement', 'joint_rd', 'unknown'].includes(given)) return given;
  const blob = String(text || '');
  if (/揭榜|挂帅|榜单|攻关/.test(blob)) return 'challenge';
  if (/采购|样机|引进|购买/.test(blob)) return 'procurement';
  if (/联合研发|概念验证|共建|中试/.test(blob)) return 'joint_rd';
  if (blob.trim().length >= 8) return 'tech_problem';
  return 'unknown';
}

function routeCollabMode(input) {
  const kind = input.demandKind || 'unknown';
  const trl = typeof input.trl === 'number' ? input.trl : null;
  const hardPass = input.hardPass !== false;
  const conflict = Number(input.conflictPenalty || 0) > 0 || (input.conflicts || []).length > 0;
  if (!hardPass || conflict || kind === 'unknown' || input.supplyPublished === false) {
    return 'observe';
  }
  const lic = String(input.licenseOpenness || '').toLowerCase();
  const licOk = !lic || lic === 'open' || lic === 'negotiable' || lic === 'unclear';
  if (kind === 'procurement' && (trl == null || trl >= 6) && licOk) return 'license';
  if (kind === 'challenge') return 'challenge';
  if (kind === 'joint_rd' || (trl != null && trl <= 4)) return 'lateral';
  if (kind === 'tech_problem') return 'lateral';
  return 'observe';
}

function confidenceScore(parts) {
  let n = 0;
  if (parts.hasPerson) n += 0.25;
  if ((parts.evidenceCount || 0) >= 2) n += 0.2;
  if (parts.realEmbedding && parts.modelMatch !== false) n += 0.2;
  if (!parts.demandThin) n += 0.15;
  if (parts.fresh) n += 0.1;
  if (parts.hasContact) n += 0.1;
  return Math.round(Math.min(1, n) * 1000) / 1000;
}

function ageDays(date, now) {
  if (!date) return 9999;
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return 9999;
  return Math.max(0, Math.round((now.getTime() - t) / 86400000));
}

function isDemoSource(source) {
  return source === 'demo' || source === 'demo_fixture';
}

function isPublished(status) {
  return !status || status === 'published';
}

function publishDecision(entity, row) {
  const blockers = [];
  const source = String(row.sourceCode || row.source || '');
  if (source === 'demo' || source === 'demo_fixture') blockers.push('demo_blocked');
  if (row.junk) blockers.push('junk');
  if (row.ambiguousPerson) blockers.push('ambiguous_person');
  if (row.conflictField) blockers.push('conflict_field');
  if (entity === 'person') {
    if (!row.schoolName && !row.orgId) blockers.push('no_school');
    if (!row.name) blockers.push('no_name');
    const summaryOk = String(row.researchSummary || '').trim().length >= 40;
    const hasWork = Number(row.outcomeCount || 0) > 0;
    if (!summaryOk && !hasWork) blockers.push('thin_summary');
  }
  const selfServe = source === 'portal_self';
  if (entity === 'outcome') {
    if (!row.title || isJunkTitle(row.title)) blockers.push('junk');
    if (!row.type) blockers.push('no_type');
    if (!row.year && !row.externalId && !row.doi && !row.patentNo && !selfServe) blockers.push('no_year');
    const abs = String(row.abstract || '');
    if (abs.length < 80 && !row.patentNo) blockers.push('thin_summary');
    if (!row.orgId && !row.schoolName) blockers.push('no_school');
    if (!row.personId && !selfServe) blockers.push('no_person');
  }
  if (entity === 'capability') {
    if (!row.personId && !row.labName && !row.orgId) blockers.push('no_owner');
    if (String(row.summary || '').trim().length < 40) blockers.push('thin_summary');
    const kws = row.keywords || [];
    if (kws.length < 2) blockers.push('no_keywords');
    const evidence = row.evidenceOutcomeIds || [];
    if (!evidence.length && !row.homepage && !selfServe) blockers.push('no_evidence');
  }
  if (entity === 'demand') {
    if (!row.orgId) blockers.push('no_org');
    if (!row.title || isJunkTitle(row.title)) blockers.push('junk');
    if (String(row.problem || '').trim().length < 40) blockers.push('thin_summary');
    if (!row.demandKind || row.demandKind === 'unknown') blockers.push('unknown_demand_kind');
    const tags = row.taxonomyCodes || row.industry || [];
    if (!tags.length) blockers.push('no_taxonomy');
  }
  if (entity === 'org' || entity === 'lab') {
    if (!row.name || isJunkTitle(row.name)) blockers.push('junk');
    if (row.unitKind === 'lab_unplaced') blockers.push('lab_unplaced');
  }
  const uniq = [...new Set(blockers)];
  let status = 'published';
  if (uniq.includes('junk') || uniq.includes('demo_blocked')) status = 'quarantine';
  else if (uniq.length) status = 'canonical';
  return { status, blockers: uniq, ruleVersion: RULE_VERSION };
}

function sliceStage(stats, th) {
  const rules = th || thresholds();
  const thick =
    stats.teacherCount >= rules.minTeachers &&
    stats.demandCount >= rules.minDemands &&
    (stats.medianAgeDays == null || stats.medianAgeDays <= rules.maxAgeDays);
  if (!thick) return 'accumulating';
  if ((stats.contactRatio || 0) < rules.minContactRatio) return 'shadow';
  return 'outreach';
}

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function summarizeSlices(input) {
  const now = input.now ? new Date(input.now) : new Date();
  const th = thresholds(input.thresholds);
  const people = input.people || [];
  const demands = input.demands || [];
  const outcomes = input.outcomes || [];
  const capabilities = input.capabilities || [];
  const contacts = input.contacts || [];
  const contactPeople = new Set(contacts.filter((c) => c.personId && c.confidence >= 0.6).map((c) => c.personId));
  for (const p of people) {
    if (p.email) contactPeople.add(p.id);
  }
  const keys = new Set();
  for (const d of demands) {
    if (!isPublished(d.publishStatus)) continue;
    const codes = d.taxonomyCodes?.length ? d.taxonomyCodes : d.industry || [];
    if (codes[0]) keys.add(codes[0]);
  }
  const slices = [];
  for (const key of keys) {
    const demRows = demands.filter((d) => {
      if (!isPublished(d.publishStatus)) return false;
      const codes = d.taxonomyCodes?.length ? d.taxonomyCodes : d.industry || [];
      return codes[0] === key && d.demandKind && d.demandKind !== 'unknown';
    });
    const teacherIds = new Set();
    for (const p of people) {
      if (!isPublished(p.publishStatus)) continue;
      if ((p.taxonomyCodes || []).includes(key)) teacherIds.add(p.id);
    }
    for (const o of outcomes) {
      if (!isPublished(o.publishStatus) || !o.personId) continue;
      if ((o.taxonomyCodes || []).includes(key)) teacherIds.add(o.personId);
    }
    for (const c of capabilities) {
      if (!isPublished(c.publishStatus) || !c.personId) continue;
      if ((c.taxonomyCodes || []).includes(key)) teacherIds.add(c.personId);
    }
    const ages = [];
    for (const row of [...demRows, ...outcomes.filter((o) => (o.taxonomyCodes || []).includes(key))]) {
      ages.push(ageDays(row.sourceUpdatedAt || row.updatedAt, now));
    }
    const withContact = [...teacherIds].filter((id) => contactPeople.has(id)).length;
    const stats = {
      taxonomyCode: key,
      teacherCount: teacherIds.size,
      demandCount: demRows.length,
      outcomeCount: outcomes.filter((o) => isPublished(o.publishStatus) && (o.taxonomyCodes || []).includes(key)).length,
      contactRatio: teacherIds.size ? Math.round((withContact / teacherIds.size) * 1000) / 1000 : 0,
      medianAgeDays: median(ages),
    };
    stats.stage = sliceStage(stats, th);
    slices.push(stats);
  }
  return { ruleVersion: RULE_VERSION, thresholds: th, slices };
}

function buildMatchDossier(input) {
  const bd = input.breakdown || {};
  const hardPass = bd.hardPass !== false;
  const demandKind = inferDemandKind(input.demandKind, [input.demandTitle, input.demandProblem].filter(Boolean).join(' '));
  const collabMode = routeCollabMode({
    demandKind,
    trl: input.trl,
    hardPass,
    conflictPenalty: bd.conflictPenalty,
    conflicts: bd.conflicts,
    licenseOpenness: input.licenseOpenness,
    supplyPublished: input.supplyPublished !== false,
  });
  const overlap = []
    .concat(bd.taxonomyOverlap || [])
    .concat(input.overlap || [])
    .filter(Boolean)
    .slice(0, 4);
  const evidence = [];
  if (input.supplyId && input.supplyTitle) {
    evidence.push({
      type: input.supplyKind || 'outcome',
      id: input.supplyId,
      title: input.supplyTitle,
      why: overlap.length ? `共同标签：${overlap.join('、')}` : '摘要或关键词接近',
    });
  }
  for (const extra of input.extraEvidence || []) {
    if (evidence.length >= 3) break;
    if (extra?.id) evidence.push(extra);
  }
  const stage = input.sliceStage || 'accumulating';
  const blockers = [];
  if (!input.primaryPersonId) blockers.push('no_person');
  if (input.demandThin) blockers.push('demand_thin');
  if (stage === 'accumulating') blockers.push('slice_not_ready');
  if (input.modelMismatch) blockers.push('embedding_model_mismatch');
  if ((bd.conflicts || []).length) blockers.push('rights_conflict');
  const confidence = confidenceScore({
    hasPerson: Boolean(input.primaryPersonId),
    evidenceCount: evidence.length + (overlap.length ? 1 : 0),
    realEmbedding: input.embeddingMode && input.embeddingMode !== 'hash',
    modelMatch: !input.modelMismatch,
    demandThin: Boolean(input.demandThin),
    fresh: input.fresh !== false,
    hasContact: Boolean(input.hasContact),
  });
  let action = 'HOLD';
  if (!hardPass || collabMode === 'observe') action = 'HOLD';
  else if (stage === 'accumulating') action = 'SHADOW';
  else if (Number(input.total) >= thresholds(input.thresholds).reviewMinScore) action = 'REVIEW';
  const sliceKey = input.sliceKey || 'unspecified';
  const reasonSuffix = evidence.length
    ? ` 证据：${evidence.map((e) => e.title).join('、')}。建议合作方式：${COLLAB_LABEL[collabMode] || collabMode}。`
    : '';
  return {
    ruleVersion: RULE_VERSION,
    action,
    collabMode,
    collabModeLabel: COLLAB_LABEL[collabMode] || collabMode,
    evidence: evidence.slice(0, 3),
    confidence,
    blockers,
    sliceKey,
    sliceStage: stage,
    demandKind,
    primaryPersonId: input.primaryPersonId || null,
    reasonSuffix,
  };
}

function mergeLocked(existing, incoming, lockedFields) {
  const locks = new Set(lockedFields || []);
  const out = { ...(incoming || {}) };
  for (const key of locks) {
    if (existing && Object.prototype.hasOwnProperty.call(existing, key)) out[key] = existing[key];
  }
  return out;
}

function stripLocked(patch, lockedFields) {
  const locks = new Set(lockedFields || []);
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (locks.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function visibleToOrg(action) {
  return action !== 'SHADOW' && action !== 'HOLD';
}

function externalShareBlock(input) {
  const row = input || {};
  if (row.action === 'SHADOW' || row.action === 'HOLD') {
    return { code: 'not_ready', message: '这条还在内部观察，不能对外展示' };
  }
  for (const card of row.cards || []) {
    if (!card) continue;
    if (card.quarantine) return { code: 'quarantine', message: '档案已隔离，不能对外展示' };
    if (isDemoSource(card.source)) return { code: 'demo', message: '演示数据不能对外展示' };
    if (card.publishStatus && card.publishStatus !== 'published') {
      return { code: 'unpublished', message: '档案还没发布，不能对外展示' };
    }
  }
  return null;
}

function publicCaseText(text, hiddenNames) {
  let s = String(text || '');
  const names = (hiddenNames || [])
    .map((name) => String(name || '').trim())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of names) s = s.split(name).join('某机构');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '');
  s = s.replace(/(?:\+?86[-\s]?)?1[3-9]\d{9}/g, '');
  s = s.replace(/建议对接[:：][^。\n；;]*/g, '');
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function outreachBlock(input) {
  const row = input || {};
  if (row.action === 'SHADOW' || row.action === 'HOLD') {
    return { code: 'not_ready', message: '这条还在内部观察，不能发出' };
  }
  for (const card of row.cards || []) {
    if (!card) continue;
    if (card.quarantine) return { code: 'quarantine', message: '档案已隔离，不能发出' };
    if (isDemoSource(card.source)) return { code: 'demo', message: '演示数据不能对外发出' };
    if (card.publishStatus && card.publishStatus !== 'published') {
      return { code: 'unpublished', message: '档案还没发布，不能发出' };
    }
  }
  if (row.personStatus && row.personStatus !== 'published') {
    return { code: 'person_unpublished', message: '联系人档案还没发布，不能发出' };
  }
  if (row.slicePaused) return { code: 'slice_paused', message: '这个产业方向的找人已暂停，不能发出' };
  if (row.recentContact) return { code: 'frequency_cap', message: '同一联系人 7 天内已经发过，先不要再发' };
  return null;
}

function labelOf(map, key) {
  if (!key) return '';
  return map[key] || key;
}

module.exports = {
  RULE_VERSION,
  COLLAB_LABEL,
  ACTION_ZH,
  STAGE_ZH,
  BLOCKER_ZH,
  mergeLocked,
  stripLocked,
  visibleToOrg,
  externalShareBlock,
  publicCaseText,
  outreachBlock,
  labelOf,
  thresholds,
  normalizeName,
  isJunkTitle,
  summaryPublic,
  inferDemandKind,
  routeCollabMode,
  confidenceScore,
  isDemoSource,
  isPublished,
  publishDecision,
  sliceStage,
  summarizeSlices,
  buildMatchDossier,
  ageDays,
};
