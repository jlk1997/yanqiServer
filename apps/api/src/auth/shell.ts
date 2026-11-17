/** M27：登录后落到哪个产品壳 */
export type ShellId = 'ops' | 'enterprise' | 'research' | 'broker' | 'guest' | 'onboarding';

export type ShellInfo = {
  shell: ShellId;
  persona: string;
  personaLabel: string;
  homePath: string;
  theme: 'light' | 'dark';
};

const OPS_ROLES = new Set(['ADMIN', 'OPERATOR', 'OPS_VIEWER']);

export function resolveShell(input: {
  role?: string | null;
  orgType?: string | null;
  orgId?: string | null;
}): ShellInfo {
  const role = input.role || 'ORG_USER';
  if (role === 'OPS_VIEWER') {
    return {
      shell: 'guest',
      persona: 'park_viewer',
      personaLabel: '园区 / 政府观察',
      homePath: '/work-park.html',
      theme: 'light',
    };
  }
  if (OPS_ROLES.has(role)) {
    const label = role === 'ADMIN' ? '平台超管' : '平台运营';
    return {
      shell: 'ops',
      persona: 'ops',
      personaLabel: label,
      homePath: '/ops.html',
      theme: 'dark',
    };
  }
  if (role === 'BROKER') {
    return {
      shell: 'broker',
      persona: 'broker',
      personaLabel: '技术经理人 / 经纪人',
      homePath: '/work-broker.html',
      theme: 'light',
    };
  }
  if (!input.orgId) {
    return {
      shell: 'onboarding',
      persona: 'unbound',
      personaLabel: '待认领单位',
      homePath: '/portal.html#auth',
      theme: 'light',
    };
  }
  const t = (input.orgType || '').toUpperCase();
  if (t === 'ENTERPRISE') {
    return {
      shell: 'enterprise',
      persona: 'enterprise',
      personaLabel: '企业用户',
      homePath: '/work-enterprise.html',
      theme: 'light',
    };
  }
  if (t === 'UNIVERSITY' || t === 'LAB_INSTITUTE' || t === 'RESEARCH') {
    return {
      shell: 'research',
      persona: 'research',
      personaLabel: '高校 / 实验室',
      homePath: '/work-research.html',
      theme: 'light',
    };
  }
  if (t === 'GOVERNMENT' || t === 'PARK') {
    return {
      shell: 'guest',
      persona: 'park',
      personaLabel: '园区 / 政府访客',
      homePath: '/work-park.html',
      theme: 'light',
    };
  }
  // 机构成员但组织类型未归类：进门户工作台，不进运营
  return {
    shell: 'enterprise',
    persona: 'org_generic',
    personaLabel: '机构用户',
    homePath: '/work-enterprise.html',
    theme: 'light',
  };
}

export function demoAccountsDoc() {
  return [
    { login: 'admin', email: 'admin@yanqi.local', password: 'yanqi123', shell: 'ops', noteZh: '超管 · 运营中台' },
    { login: 'operator@yanqi.local', email: 'operator@yanqi.local', password: 'yanqi123', shell: 'ops', noteZh: '运营' },
    { login: 'broker', email: 'broker@yanqi.local', password: 'yanqi123', shell: 'broker', noteZh: '经纪人工作台' },
    { login: 'enterprise', email: 'enterprise@yanqi.local', password: 'yanqi123', shell: 'enterprise', noteZh: '企业 · 发需求看匹配' },
    { login: 'uni', email: 'uni@yanqi.local', password: 'yanqi123', shell: 'research', noteZh: '高校 · 上架能力成果' },
    { login: 'park', email: 'park@yanqi.local', password: 'yanqi123', shell: 'guest', noteZh: '园区观察壳（只读）' },
  ];
}
