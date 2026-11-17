/**
 * 权利 / TRL 冲突检测（口语提示，给解释面板与门户对接卡）
 * demand: { licenseNeed, minTrl, expectedOut, problem, title }
 * supply: { licenseOpenness, rights, trl, readinessBand, title }
 */
function normLic(v) {
  const s = String(v || '').toLowerCase().trim();
  if (!s) return null;
  if (s === 'exclusive' || /独占|排他/.test(s)) return 'exclusive';
  if (s === 'open' || /开放|非独占|免费许可/.test(s)) return 'open';
  if (s === 'negotiable' || /协商|可谈|可许可/.test(s)) return 'negotiable';
  if (s === 'any' || s === 'unclear') return 'any';
  return s;
}

function inferDemandLicenseNeed(demand = {}) {
  const explicit = normLic(demand.licenseNeed);
  if (explicit && explicit !== 'any') return explicit;
  const blob = `${demand.expectedOut || ''} ${demand.problem || ''} ${demand.title || ''}`;
  if (/独占|排他许可|独家/.test(blob)) return 'exclusive';
  if (/开放许可|非独占/.test(blob)) return 'open';
  return null;
}

function inferSupplyLicense(supply = {}) {
  const explicit = normLic(supply.licenseOpenness);
  if (explicit) return explicit;
  const rights = String(supply.rights || '');
  if (/独占|不可转|仅自用/.test(rights)) return 'exclusive';
  if (/开放|可许可|非独占/.test(rights)) return 'open';
  if (/协商|可谈/.test(rights)) return 'negotiable';
  return null;
}

/**
 * @returns {{ conflicts: Array<{code,severityZh,severity,severityTone}>, ok: boolean }}
 */
function detectRightsConflicts(demand = {}, supply = {}) {
  const conflicts = [];
  const need = inferDemandLicenseNeed(demand);
  const have = inferSupplyLicense(supply);
  const trl = typeof supply.trl === 'number' ? supply.trl : null;
  const minTrl =
    typeof demand.minTrl === 'number'
      ? demand.minTrl
      : /量产|产线|上线交付/.test(`${demand.expectedOut || ''} ${demand.problem || ''}`)
        ? 6
        : null;

  if (need === 'exclusive' && have === 'open') {
    conflicts.push({
      code: 'license_exclusive_vs_open',
      severity: 'high',
      tone: 'danger',
      labelZh: '许可冲突',
      tipZh: '需求方要偏独占许可，但供给侧更偏开放/非独占——合同前务必对齐能否收窄范围。',
    });
  }
  if (need === 'exclusive' && have === 'negotiable') {
    conflicts.push({
      code: 'license_exclusive_needs_talk',
      severity: 'medium',
      tone: 'warning',
      labelZh: '许可需谈',
      tipZh: '需求想要独占，供给目前是可协商——先问清能否给排他期/区域。',
    });
  }
  if (need === 'open' && have === 'exclusive') {
    conflicts.push({
      code: 'license_open_vs_exclusive',
      severity: 'high',
      tone: 'danger',
      labelZh: '许可冲突',
      tipZh: '需求只要开放/非独占合作，但供给标成偏独占——可能谈不拢，建议换卡或改诉求。',
    });
  }
  if (minTrl != null && trl != null && trl < minTrl) {
    conflicts.push({
      code: 'trl_too_low',
      severity: trl + 2 <= minTrl ? 'high' : 'medium',
      tone: trl + 2 <= minTrl ? 'danger' : 'warning',
      labelZh: '成熟度偏低',
      tipZh: `需求侧期望大约 TRL≥${minTrl}，供给当前约 TRL ${trl}——更适合联合攻关/小试，不宜直接当交钥匙。`,
    });
  }
  if (minTrl != null && trl == null) {
    conflicts.push({
      code: 'trl_unknown',
      severity: 'low',
      tone: 'warning',
      labelZh: 'TRL 未填',
      tipZh: `需求侧提到工程化/交付门槛，但供给还没填 TRL——跟进时先问清楚成熟度。`,
    });
  }
  const ready = String(supply.readinessBand || '').toLowerCase();
  if (minTrl != null && minTrl >= 7 && ready === 'lab') {
    conflicts.push({
      code: 'readiness_lab_vs_prod',
      severity: 'medium',
      tone: 'warning',
      labelZh: '工程化差距',
      tipZh: '需求偏产线/交付，供给仍标实验室就绪——要预算中试或降预期。',
    });
  }

  return { ok: conflicts.filter((c) => c.severity === 'high').length === 0, conflicts, need, have, trl, minTrl };
}

/** 软惩罚：高冲突略降分，避免压过语义主轴 */
function conflictScorePenalty(conflicts) {
  let p = 0;
  for (const c of conflicts || []) {
    if (c.severity === 'high') p += 0.035;
    else if (c.severity === 'medium') p += 0.018;
    else p += 0.005;
  }
  return Math.min(0.08, p);
}

module.exports = {
  detectRightsConflicts,
  conflictScorePenalty,
  inferDemandLicenseNeed,
  inferSupplyLicense,
  normLic,
};
