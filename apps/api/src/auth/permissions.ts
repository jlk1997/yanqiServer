/** M14 细粒度权限矩阵（角色 → 能力） */
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: '平台超管',
  OPERATOR: '运营',
  OPS_VIEWER: '运营只读',
  BROKER: '经纪人',
  TENANT_ADMIN: '机构管理员',
  ORG_USER: '机构成员',
};

export type Perm =
  | 'ops.read'
  | 'ops.write'
  | 'ops.audit'
  | 'ops.tenants'
  | 'ops.integrations'
  | 'ops.billing'
  | 'match.write'
  | 'lead.send'
  | 'broker.follow'
  | 'org.read'
  | 'org.write'
  | 'org.invite'
  | 'portal.self';

const MATRIX: Record<string, Perm[]> = {
  ADMIN: [
    'ops.read', 'ops.write', 'ops.audit', 'ops.tenants', 'ops.integrations', 'ops.billing',
    'match.write', 'lead.send', 'broker.follow', 'org.read', 'org.write', 'org.invite', 'portal.self',
  ],
  OPERATOR: [
    'ops.read', 'ops.write', 'ops.audit', 'ops.tenants', 'ops.integrations',
    'match.write', 'lead.send', 'broker.follow', 'org.read', 'org.write', 'portal.self',
  ],
  OPS_VIEWER: ['ops.read', 'org.read', 'portal.self'],
  BROKER: ['ops.read', 'match.write', 'lead.send', 'broker.follow', 'org.read', 'portal.self'],
  TENANT_ADMIN: ['org.read', 'org.write', 'org.invite', 'portal.self', 'match.write'],
  ORG_USER: ['org.read', 'org.write', 'portal.self'],
};

export function permsOf(role?: string | null): Perm[] {
  return MATRIX[role || ''] || [];
}

export function can(role: string | null | undefined, perm: Perm): boolean {
  return permsOf(role).includes(perm);
}

export function permissionMatrixDoc() {
  return {
    noteZh: '写操作以中间件 + 控制器双重校验；API Key 视为超管。',
    roles: Object.keys(MATRIX).map((role) => ({
      role,
      label: ROLE_LABELS[role] || role,
      perms: MATRIX[role],
    })),
  };
}
