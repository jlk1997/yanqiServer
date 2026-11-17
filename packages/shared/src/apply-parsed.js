/**
 * 把解析草稿对齐进规范档案。采集脚本和 API 共用。
 * 默认只补空；lockedFields 中的字段不改。
 */
const {
  RULE_VERSION,
  normalizeName,
  isJunkTitle,
  summaryPublic,
  inferDemandKind,
  publishDecision,
} = require('./dossier');

const TAX_HINTS = [
  { re: /视觉|检测|缺陷|质检/, code: 'mfg.vision' },
  { re: /工业软件|MES|制造执行/, code: 'mfg.mes' },
  { re: /碳|能耗|节能/, code: 'env.carbon' },
  { re: /水务|污水|漏损/, code: 'env.water' },
  { re: /电池|储能|热失控/, code: 'energy.battery' },
  { re: /材料|合金|复合/, code: 'mat.general' },
  { re: /医疗|诊断|影像/, code: 'health.dx' },
  { re: /机器人|自动化/, code: 'mfg.robot' },
];

function guessTaxonomy(text, given) {
  const codes = [...(given || [])];
  const blob = String(text || '');
  for (const h of TAX_HINTS) {
    if (h.re.test(blob) && !codes.includes(h.code)) codes.push(h.code);
  }
  return codes.slice(0, 8);
}

function asObj(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  return {};
}

function lockedSet(row) {
  return new Set(row?.lockedFields || []);
}

function fill(current, key, value, locks) {
  if (value == null || value === '') return undefined;
  if (locks.has(key)) return undefined;
  if (current == null || current === '' || (Array.isArray(current) && current.length === 0)) return value;
  return undefined;
}

async function canonicalOf(prisma, kind, name) {
  const norm = normalizeName(name);
  if (!norm || !prisma?.nameAlias) return norm;
  try {
    const row = await prisma.nameAlias.findUnique({ where: { kind_alias: { kind, alias: norm } } });
    return row?.canonical || norm;
  } catch (_) {
    return norm;
  }
}

async function evidence(prisma, entityType, entityId, fieldKey, sourceCode, parsedId, value) {
  if (!prisma?.fieldEvidence?.create) return;
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  await prisma.fieldEvidence.create({
    data: {
      entityType,
      entityId,
      fieldKey,
      parsedId: parsedId || null,
      sourceCode: sourceCode || null,
      valueText: text.slice(0, 2000),
    },
  });
}

async function findSchool(prisma, fields) {
  const openAlexId = fields.openAlexId || null;
  if (openAlexId) {
    const byId = await prisma.organization.findFirst({ where: { openAlexId: String(openAlexId) } });
    if (byId) return byId;
  }
  const name = fields.schoolName || fields.name;
  if (!name) return null;
  const nameNorm = await canonicalOf(prisma, 'school', name);
  return prisma.organization.findFirst({
    where: { OR: [{ name }, { nameNorm }] },
  });
}

async function applyOrg(prisma, parsed, fields) {
  const name = fields.name || fields.schoolName;
  if (!name) return { action: 'rejected', note: 'no_name' };
  const nameNorm = await canonicalOf(prisma, fields.unitKind === 'enterprise' || fields.unitKind === 'government' ? 'org' : 'school', name);
  let parent = null;
  if (fields.parentName) {
    const parentNorm = await canonicalOf(prisma, 'school', fields.parentName);
    parent = await prisma.organization.findFirst({ where: { OR: [{ name: fields.parentName }, { nameNorm: parentNorm }] } });
  }
  const unitKind = fields.unitKind || (parent ? 'lab' : 'school');
  const junk = isJunkTitle(name);
  const decision = publishDecision(unitKind === 'lab' ? 'lab' : 'org', {
    name,
    unitKind: parent || unitKind !== 'lab' ? unitKind : 'lab_unplaced',
    sourceCode: fields.sourceCode,
    junk,
  });
  const existing = fields.openAlexId
    ? await prisma.organization.findFirst({ where: { openAlexId: String(fields.openAlexId) } })
    : await prisma.organization.findFirst({ where: { nameNorm, parentId: parent?.id || null } });
  const data = {
    name,
    nameNorm,
    type: fields.orgType || (unitKind === 'government' ? 'GOVERNMENT' : unitKind === 'enterprise' ? 'ENTERPRISE' : unitKind === 'lab' || unitKind === 'college' ? 'LAB_INSTITUTE' : 'UNIVERSITY'),
    unitKind: parent || unitKind !== 'lab' ? unitKind : 'lab',
    parentId: parent?.id || null,
    region: fields.region || null,
    website: fields.website || null,
    summary: fields.summary || null,
    summaryPublic: summaryPublic(fields.summary || ''),
    creditCode: fields.creditCode || null,
    openAlexId: fields.openAlexId || null,
    publishStatus: decision.status,
    publishBlockers: decision.blockers,
    sourceUpdatedAt: new Date(),
    reviewedAt: new Date(),
    extensions: Object.assign(asObj(existing?.extensions), { source: fields.sourceCode || 'ingest', lineage: 'parsed' }),
  };
  if (!parent && unitKind === 'lab') {
    data.publishStatus = 'canonical';
    data.publishBlockers = [...new Set([...(data.publishBlockers || []), 'lab_unplaced'])];
  }
  let row;
  let action = 'created';
  if (existing) {
    const locks = lockedSet(existing);
    const patch = {};
    for (const key of ['region', 'website', 'summary', 'summaryPublic', 'creditCode', 'openAlexId', 'parentId']) {
      const next = fill(existing[key], key, data[key], locks);
      if (next !== undefined) patch[key] = next;
    }
    patch.publishStatus = existing.publishStatus === 'published' ? 'published' : data.publishStatus;
    patch.publishBlockers = data.publishBlockers;
    patch.reviewedAt = new Date();
    patch.sourceUpdatedAt = new Date();
    if (!existing.nameNorm) patch.nameNorm = nameNorm;
    if (!existing.unitKind) patch.unitKind = data.unitKind;
    row = await prisma.organization.update({ where: { id: existing.id }, data: patch });
    action = Object.keys(patch).length ? 'filled' : 'merged';
  } else {
    row = await prisma.organization.create({ data });
  }
  await evidence(prisma, 'Organization', row.id, 'name', fields.sourceCode, parsed.id, name);
  return { action, id: row.id, entity: 'org', publishStatus: row.publishStatus };
}

async function resolvePerson(prisma, fields, school) {
  if (fields.openAlexAuthorId) {
    const hit = await prisma.person.findFirst({ where: { openAlexAuthorId: String(fields.openAlexAuthorId) } });
    if (hit) return { person: hit };
  }
  if (fields.orcid) {
    const hit = await prisma.person.findFirst({ where: { orcid: String(fields.orcid) } });
    if (hit) return { person: hit };
  }
  const nameNorm = await canonicalOf(prisma, 'person', fields.nameZh || fields.name || fields.nameEn || '');
  if (!nameNorm) return { person: null };
  const where = { nameNorm };
  if (school?.id) where.orgId = school.id;
  const same = await prisma.person.findMany({ where, take: 8 });
  if (fields.collegeName) {
    const collegeNorm = normalizeName(fields.collegeName);
    const scoped = [];
    for (const p of same) {
      if (!p.collegeOrgId) continue;
      const college = await prisma.organization.findUnique({ where: { id: p.collegeOrgId } });
      if (college && (college.nameNorm === collegeNorm || normalizeName(college.name) === collegeNorm)) scoped.push(p);
    }
    if (scoped.length === 1) return { person: scoped[0] };
    if (scoped.length > 1) return { ambiguous: true, person: null };
    return { person: null };
  }
  if (same.length > 1) return { ambiguous: true, person: null };
  if (same.length === 1) return { person: same[0] };
  return { person: null };
}

async function applyPerson(prisma, parsed, fields) {
  const name = fields.nameZh || fields.name || fields.nameEn;
  if (!name) return { action: 'rejected', note: 'no_name' };
  const school = await findSchool(prisma, fields);
  const resolved = await resolvePerson(prisma, fields, school);
  if (resolved.ambiguous) {
    return { action: 'rejected', note: 'ambiguous_person', publishStatus: 'canonical' };
  }
  let college = null;
  if (fields.collegeName) {
    college = await applyOrg(prisma, parsed, {
      name: fields.collegeName,
      parentName: school?.name || fields.schoolName,
      unitKind: 'college',
      sourceCode: fields.sourceCode,
    });
  }
  let lab = null;
  if (fields.labName) {
    lab = await applyOrg(prisma, parsed, {
      name: fields.labName,
      parentName: fields.collegeName || school?.name || fields.schoolName,
      unitKind: 'lab',
      summary: fields.labSummary,
      website: fields.homepage,
      sourceCode: fields.sourceCode,
    });
  }
  const summary = fields.researchSummary || '';
  const decision = publishDecision('person', {
    name,
    schoolName: school?.name || fields.schoolName,
    orgId: school?.id,
    researchSummary: summary,
    outcomeCount: resolved.person ? undefined : 0,
    sourceCode: fields.sourceCode,
  });
  const keywords = fields.keywords || [];
  const taxonomyCodes = guessTaxonomy([summary, ...(keywords || [])].join(' '), fields.disciplineCodes || fields.taxonomyCodes);
  const base = {
    name,
    nameNorm: await canonicalOf(prisma, 'person', name),
    orgId: school?.id || null,
    collegeOrgId: college?.id || null,
    labOrgId: lab?.id || null,
    role: (fields.roles && fields.roles[0]) || fields.title || null,
    email: fields.email || null,
    phone: fields.phone || null,
    openAlexAuthorId: fields.openAlexAuthorId || null,
    orcid: fields.orcid || null,
    researchSummary: summary || null,
    keywords,
    taxonomyCodes,
    source: fields.sourceCode || 'ingest',
    publishStatus: decision.status,
    publishBlockers: decision.blockers,
    sourceUpdatedAt: new Date(),
    reviewedAt: new Date(),
  };
  let row = resolved.person;
  let action = 'created';
  if (row) {
    const locks = lockedSet(row);
    const patch = {};
    for (const key of ['email', 'phone', 'orcid', 'openAlexAuthorId', 'researchSummary', 'orgId', 'collegeOrgId', 'labOrgId', 'role']) {
      const next = fill(row[key], key, base[key], locks);
      if (next !== undefined) patch[key] = next;
    }
    if (!row.nameNorm) patch.nameNorm = base.nameNorm;
    if (!(row.keywords || []).length && keywords.length && !locks.has('keywords')) patch.keywords = keywords;
    if (!(row.taxonomyCodes || []).length && taxonomyCodes.length) patch.taxonomyCodes = taxonomyCodes;
    patch.reviewedAt = new Date();
    patch.sourceUpdatedAt = new Date();
    if (row.publishStatus !== 'published') {
      patch.publishStatus = base.publishStatus;
      patch.publishBlockers = base.publishBlockers;
    }
    row = await prisma.person.update({ where: { id: row.id }, data: patch });
    action = 'filled';
  } else {
    row = await prisma.person.create({ data: base });
  }
  if (fields.email) {
    await upsertContact(prisma, { personId: row.id, kind: 'email', value: fields.email, sourceCode: fields.contactSource || fields.sourceCode, confidence: Number(fields.contactConfidence || 0.7), isPublic: true });
  }
  await evidence(prisma, 'Person', row.id, 'name', fields.sourceCode, parsed.id, name);
  return { action, id: row.id, entity: 'person', publishStatus: row.publishStatus };
}

async function upsertContact(prisma, c) {
  if (!c.value) return;
  const existing = await prisma.contactPoint.findFirst({
    where: { kind: c.kind, value: c.value, personId: c.personId || null, orgId: c.orgId || null },
  });
  if (existing) return existing;
  return prisma.contactPoint.create({
    data: {
      personId: c.personId || null,
      orgId: c.orgId || null,
      kind: c.kind,
      value: c.value,
      sourceCode: c.sourceCode || null,
      confidence: c.confidence ?? 0.5,
      isPublic: Boolean(c.isPublic),
    },
  });
}

async function applyOutcome(prisma, parsed, fields) {
  const title = fields.title;
  if (!title) return { action: 'rejected', note: 'no_title' };
  const school = await findSchool(prisma, fields.schoolName ? { schoolName: fields.schoolName, openAlexId: fields.schoolOpenAlexId } : fields);
  let org = school;
  if (!org && (fields.orgName || fields.schoolName)) {
    const created = await applyOrg(prisma, parsed, {
      name: fields.schoolName || fields.orgName,
      unitKind: fields.schoolName ? 'school' : 'enterprise',
      orgType: fields.orgType,
      sourceCode: fields.sourceCode,
      region: fields.region,
      openAlexId: fields.schoolOpenAlexId || null,
    });
    org = created?.id ? await prisma.organization.findUnique({ where: { id: created.id } }) : null;
  }
  if (!org) return { action: 'rejected', note: 'no_school' };
  const externalId = fields.openAlexId || fields.externalId || null;
  let existing = null;
  if (externalId) existing = await prisma.outcome.findFirst({ where: { openAlexId: String(externalId) } });
  if (!existing && fields.doi) existing = await prisma.outcome.findFirst({ where: { doi: String(fields.doi) } });
  if (!existing && fields.patentNo) existing = await prisma.outcome.findFirst({ where: { patentNo: String(fields.patentNo) } });
  if (!existing) existing = await prisma.outcome.findFirst({ where: { orgId: org.id, title } });
  const authors = Array.isArray(fields.authors) ? fields.authors : [];
  let primary = null;
  const linkedAuthors = [];
  for (const a of authors) {
    const linked = await applyPerson(prisma, parsed, {
      name: a.name,
      nameZh: a.name,
      schoolName: org.name,
      openAlexId: org.openAlexId,
      openAlexAuthorId: a.openAlexAuthorId,
      orcid: a.orcid,
      sourceCode: fields.sourceCode,
      roles: a.corresponding ? ['通讯作者'] : ['作者'],
    });
    linkedAuthors.push({ linked, a });
    if (!primary && linked.id && (a.corresponding || a.order === 1 || a.order === 0)) primary = linked;
    if (!primary && linked.id) primary = linked;
  }
  const abstract = fields.abstract || '';
  const decision = publishDecision('outcome', {
    title,
    type: fields.type || 'PAPER',
    year: fields.year,
    externalId,
    doi: fields.doi,
    patentNo: fields.patentNo,
    abstract,
    orgId: org.id,
    personId: primary?.id || existing?.personId || null,
    sourceCode: fields.sourceCode,
    junk: isJunkTitle(title),
  });
  const taxonomyCodes = guessTaxonomy([title, abstract, ...(fields.ipcOrDisc || [])].join(' '), fields.taxonomyCodes);
  const data = {
    orgId: org.id,
    title,
    type: fields.type || 'PAPER',
    abstract: abstract || null,
    summaryPublic: summaryPublic(abstract),
    ipcOrDisc: fields.ipcOrDisc || [],
    trl: fields.trlHint || fields.trl || null,
    rights: fields.rightsHint || fields.rights || null,
    doi: fields.doi || null,
    patentNo: fields.patentNo || null,
    openAlexId: externalId,
    year: fields.year || null,
    personId: primary?.id || null,
    taxonomyCodes,
    publishStatus: decision.status,
    publishBlockers: decision.blockers,
    embeddingModel: fields.embeddingModel || null,
    sourceUpdatedAt: new Date(),
    reviewedAt: new Date(),
    extensions: { source: fields.sourceCode || 'ingest', kind: fields.kind || null, lineage: 'parsed', ruleVersion: RULE_VERSION },
  };
  let row;
  let action = 'created';
  if (existing) {
    const locks = lockedSet(existing);
    const patch = {};
    for (const key of ['abstract', 'summaryPublic', 'doi', 'patentNo', 'openAlexId', 'year', 'personId', 'trl', 'rights']) {
      const next = fill(existing[key], key, data[key], locks);
      if (next !== undefined) patch[key] = next;
    }
    if (!(existing.taxonomyCodes || []).length && taxonomyCodes.length) patch.taxonomyCodes = taxonomyCodes;
    if (!(existing.ipcOrDisc || []).length && data.ipcOrDisc.length) patch.ipcOrDisc = data.ipcOrDisc;
    if (existing.publishStatus !== 'published') {
      patch.publishStatus = data.publishStatus;
      patch.publishBlockers = data.publishBlockers;
    }
    patch.reviewedAt = new Date();
    patch.sourceUpdatedAt = new Date();
    row = await prisma.outcome.update({ where: { id: existing.id }, data: patch });
    action = 'filled';
  } else {
    if (fields.embedding) data.embedding = fields.embedding;
    row = await prisma.outcome.create({ data });
  }
  for (const item of linkedAuthors) {
    if (!item.linked?.id) continue;
    await prisma.authorship.upsert({
      where: { personId_outcomeId: { personId: item.linked.id, outcomeId: row.id } },
      update: { authorOrder: item.a.order || 0, isCorresponding: Boolean(item.a.corresponding) },
      create: {
        personId: item.linked.id,
        outcomeId: row.id,
        authorOrder: item.a.order || 0,
        isCorresponding: Boolean(item.a.corresponding),
      },
    }).catch(() => null);
  }
  if (primary?.id) {
    const year = fields.year || null;
    if (year) {
      await prisma.person.update({
        where: { id: primary.id },
        data: { lastWorkYear: year },
      }).catch(() => null);
    }
  }
  await evidence(prisma, 'Outcome', row.id, 'title', fields.sourceCode, parsed.id, title);
  return { action, id: row.id, entity: 'outcome', publishStatus: row.publishStatus, personId: row.personId };
}

async function applyDemand(prisma, parsed, fields) {
  const title = fields.title;
  if (!title) return { action: 'rejected', note: 'no_title' };
  let org = null;
  if (fields.creditCode) org = await prisma.organization.findFirst({ where: { creditCode: String(fields.creditCode) } });
  if (!org && fields.orgName) {
    const nameNorm = await canonicalOf(prisma, 'org', fields.orgName);
    org = await prisma.organization.findFirst({ where: { OR: [{ name: fields.orgName }, { nameNorm }] } });
  }
  if (!org && fields.orgName) {
    const made = await applyOrg(prisma, parsed, {
      name: fields.orgName,
      unitKind: fields.orgType === 'GOVERNMENT' || fields.orgType === 'government' ? 'government' : 'enterprise',
      orgType: fields.orgType === 'government' ? 'GOVERNMENT' : fields.orgType || 'ENTERPRISE',
      region: fields.region,
      creditCode: fields.creditCode,
      website: fields.website,
      sourceCode: fields.sourceCode,
    });
    org = await prisma.organization.findUnique({ where: { id: made.id } });
  }
  if (!org) return { action: 'rejected', note: 'no_org' };
  const problem = fields.problem || '';
  const demandKind = inferDemandKind(fields.demandKind, [title, problem, fields.expectedOut].join(' '));
  const industry = fields.industry || [];
  const taxonomyCodes = guessTaxonomy([title, problem, ...industry].join(' '), fields.taxonomyCodes);
  const decision = publishDecision('demand', {
    title,
    problem,
    orgId: org.id,
    demandKind,
    taxonomyCodes: taxonomyCodes.length ? taxonomyCodes : industry,
    industry,
    sourceCode: fields.sourceCode,
    junk: isJunkTitle(title),
  });
  const existing = fields.sourceUrl
    ? await prisma.demand.findFirst({ where: { orgId: org.id, extensions: { path: ['sourceUrl'], equals: fields.sourceUrl } } }).catch(() => null)
    : null;
  const byTitle = existing || (await prisma.demand.findFirst({ where: { orgId: org.id, title } }));
  const data = {
    orgId: org.id,
    title,
    problem: problem || title,
    expectedOut: fields.expectedOut || null,
    budgetBand: fields.budgetBand || null,
    industry,
    urgency: fields.urgency || null,
    regionPref: fields.regionPref || fields.region || null,
    licenseNeed: fields.licenseNeed || null,
    minTrl: fields.minTrl || null,
    demandKind,
    deadline: fields.deadline ? new Date(fields.deadline) : null,
    taxonomyCodes,
    summaryPublic: summaryPublic(problem),
    publishStatus: decision.status,
    publishBlockers: decision.blockers,
    sourceUpdatedAt: new Date(),
    reviewedAt: new Date(),
    extensions: { source: fields.sourceCode || 'ingest', sourceUrl: fields.sourceUrl || null, lineage: 'parsed', ruleVersion: RULE_VERSION },
  };
  let row;
  let action = 'created';
  if (byTitle) {
    const locks = lockedSet(byTitle);
    const patch = {};
    for (const key of ['problem', 'expectedOut', 'budgetBand', 'demandKind', 'summaryPublic', 'minTrl', 'licenseNeed']) {
      const next = fill(byTitle[key], key, data[key], locks);
      if (next !== undefined) patch[key] = next;
    }
    if (!(byTitle.industry || []).length && industry.length && !locks.has('industry')) patch.industry = industry;
    if (!(byTitle.taxonomyCodes || []).length && taxonomyCodes.length) patch.taxonomyCodes = taxonomyCodes;
    if (byTitle.publishStatus !== 'published') {
      patch.publishStatus = data.publishStatus;
      patch.publishBlockers = data.publishBlockers;
    }
    patch.sourceUpdatedAt = new Date();
    patch.reviewedAt = new Date();
    patch.extensions = Object.assign(asObj(byTitle.extensions), data.extensions);
    row = await prisma.demand.update({ where: { id: byTitle.id }, data: patch });
    action = 'filled';
  } else {
    if (fields.embedding) data.embedding = fields.embedding;
    row = await prisma.demand.create({ data });
  }
  await evidence(prisma, 'Demand', row.id, 'title', fields.sourceCode, parsed.id, title);
  return { action, id: row.id, entity: 'demand', publishStatus: row.publishStatus };
}

async function applyContact(prisma, parsed, fields) {
  let personId = fields.personId || null;
  if (!personId && fields.personName) {
    const linked = await applyPerson(prisma, parsed, {
      name: fields.personName,
      schoolName: fields.schoolName,
      email: fields.kind === 'email' ? fields.value : undefined,
      sourceCode: fields.sourceCode,
    });
    personId = linked.id || null;
  }
  if (!personId && !fields.orgId) return { action: 'rejected', note: 'no_owner' };
  await upsertContact(prisma, {
    personId,
    orgId: fields.orgId || null,
    kind: fields.kind || 'email',
    value: fields.value,
    sourceCode: fields.sourceCode,
    confidence: Number(fields.confidence || 0.6),
    isPublic: fields.isPublic !== false,
  });
  return { action: 'created', entity: 'contact', id: personId };
}

async function applyOne(prisma, parsed) {
  const fields = Object.assign({}, parsed.fields || {}, { sourceCode: (parsed.fields && parsed.fields.sourceCode) || parsed.sourceCode });
  const hint = parsed.entityHint;
  if (hint === 'org' || hint === 'lab') return applyOrg(prisma, parsed, fields);
  if (hint === 'person') return applyPerson(prisma, parsed, fields);
  if (hint === 'outcome') return applyOutcome(prisma, parsed, fields);
  if (hint === 'demand') return applyDemand(prisma, parsed, fields);
  if (hint === 'contact') return applyContact(prisma, parsed, fields);
  return { action: 'rejected', note: 'unknown_hint' };
}

async function generateCapabilitiesForPerson(prisma, personId) {
  const person = await prisma.person.findUnique({ where: { id: personId } });
  if (!person) return [];
  const yearCut = new Date().getFullYear() - 5;
  const outcomes = await prisma.outcome.findMany({
    where: { personId, publishStatus: 'published' },
    take: 30,
    orderBy: { year: 'desc' },
  });
  const recent = outcomes.filter((o) => !o.year || o.year >= yearCut);
  if (recent.length < 1 && String(person.researchSummary || '').length < 40) return [];
  const words = [];
  for (const o of recent) words.push(...(o.ipcOrDisc || []), ...(o.taxonomyCodes || []));
  words.push(...(person.keywords || []));
  const freq = new Map();
  for (const w of words) {
    if (!w) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6);
  if (ranked.length < 2 && String(person.researchSummary || '').length < 40) return [];
  const title = `${person.name}·${ranked[0] || '研究方向'}`;
  const existing = await prisma.capability.findFirst({ where: { personId, title } });
  if (existing && (existing.lockedFields || []).some((f) => f === 'title' || f === 'summary')) return [existing];
  const summary = person.researchSummary || `由近作主题整理：${ranked.join('、')}`;
  const decision = publishDecision('capability', {
    personId,
    orgId: person.labOrgId || person.orgId,
    summary,
    keywords: ranked,
    evidenceOutcomeIds: recent.slice(0, 3).map((o) => o.id),
  });
  const data = {
    orgId: person.labOrgId || person.orgId,
    personId,
    title,
    keywords: ranked,
    disciplines: ranked.slice(0, 4),
    offerTypes: ['技术咨询', '联合攻关'],
    summary,
    summaryPublic: summaryPublic(summary),
    taxonomyCodes: guessTaxonomy(ranked.join(' '), person.taxonomyCodes),
    publishStatus: decision.status,
    publishBlockers: decision.blockers,
    trl: 4,
    extensions: { source: 'cluster', evidenceOutcomeIds: recent.slice(0, 3).map((o) => o.id), lineage: 'teacher-cluster' },
    reviewedAt: new Date(),
    sourceUpdatedAt: new Date(),
  };
  if (!data.orgId) return [];
  if (existing) {
    return [await prisma.capability.update({ where: { id: existing.id }, data: { keywords: data.keywords, taxonomyCodes: data.taxonomyCodes, reviewedAt: new Date() } })];
  }
  return [await prisma.capability.create({ data })];
}

async function applyParsedRecords(prisma, records) {
  const results = [];
  const personIds = new Set();
  for (const rec of records) {
    try {
      const r = await applyOne(prisma, rec);
      results.push(r);
      if (r.entity === 'person' && r.id) personIds.add(r.id);
      if (r.personId) personIds.add(r.personId);
      if (rec.id && prisma.parsedRecord) {
        await prisma.parsedRecord.update({
          where: { id: rec.id },
          data: { status: r.action === 'rejected' ? 'rejected' : 'accepted', note: r.note || null },
        });
      }
    } catch (err) {
      results.push({ action: 'rejected', note: err?.message || String(err) });
      if (rec.id && prisma.parsedRecord) {
        await prisma.parsedRecord.update({
          where: { id: rec.id },
          data: { status: 'rejected', note: err?.message || String(err) },
        }).catch(() => null);
      }
    }
  }
  const caps = [];
  for (const id of personIds) {
    const made = await generateCapabilitiesForPerson(prisma, id).catch(() => []);
    caps.push(...made);
  }
  return { results, capabilities: caps.length, ruleVersion: RULE_VERSION };
}

module.exports = {
  TAX_HINTS,
  guessTaxonomy,
  applyParsedRecords,
  generateCapabilitiesForPerson,
  applyOne,
};
