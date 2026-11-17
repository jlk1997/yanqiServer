import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { can, Perm } from './permissions';

export type AuthUser = {
  uid: string;
  role: string;
  email: string;
  orgId?: string | null;
  tenantId?: string | null;
  jti?: string;
};

/** 可读运营数据（含只读运营、经纪人） */
export function isOps(role?: string | null) {
  return role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER' || role === 'BROKER';
}

export function isAdmin(role?: string | null) {
  return role === 'ADMIN';
}

export function isBroker(role?: string | null) {
  return role === 'BROKER';
}

export function isTenantStaff(role?: string | null) {
  return role === 'ORG_USER' || role === 'TENANT_ADMIN';
}

export function requireUser(req: any): AuthUser {
  const u = req?.user as AuthUser | undefined;
  if (!u?.uid) throw new ForbiddenException('请先登录');
  return u;
}

export function requirePerm(req: any, perm: Perm) {
  if (req?.authMeta?.hasKey) return;
  const role = req?.user?.role || req?.authMeta?.role;
  if (!can(role, perm)) throw new ForbiddenException(`当前角色无权：${perm}`);
}

export function scopedOrgId(req: any, requestedOrgId?: string | null): string | undefined {
  const u = req?.user as AuthUser | undefined;
  const role = u?.role || req?.authMeta?.role;
  if (req?.authMeta?.hasKey || role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER') {
    return requestedOrgId || undefined;
  }
  if (role === 'BROKER') return requestedOrgId || undefined;
  if (isTenantStaff(role)) {
    if (!u?.orgId) throw new ForbiddenException('请先绑定组织后再访问机构数据');
    if (requestedOrgId && requestedOrgId !== u.orgId) {
      throw new ForbiddenException('无权访问其他组织的数据');
    }
    return u.orgId;
  }
  return requestedOrgId || undefined;
}

export function assertFound<T>(row: T | null | undefined, msg = '资源不存在'): T {
  if (!row) throw new NotFoundException(msg);
  return row;
}

/** 租户过滤：运营看指定/默认；机构用户锁本租户 */
export function tenantFilter(req: any): { tenantId?: string } {
  if (req?.authMeta?.hasKey) return { tenantId: req?.user?.tenantId || req?.resolvedTenantId || undefined };
  const role = req?.user?.role || req?.authMeta?.role;
  if (role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER' || role === 'BROKER') {
    return { tenantId: req?.user?.tenantId || req?.resolvedTenantId || undefined };
  }
  return { tenantId: req?.user?.tenantId || req?.resolvedTenantId || 'default' };
}

/** 读：运营可读全部；机构只能读本组织相关 */
export function assertCanAccessOrgRecord(req: any, orgId?: string | null) {
  if (req?.authMeta?.hasKey) return;
  const role = req?.user?.role || req?.authMeta?.role;
  if (role === 'ADMIN' || role === 'OPERATOR' || role === 'OPS_VIEWER' || role === 'BROKER') return;
  if (isTenantStaff(role)) {
    if (!orgId || req?.user?.orgId !== orgId) {
      throw new ForbiddenException('无权查看其他组织的数据');
    }
    return;
  }
  throw new ForbiddenException('无权查看');
}

/** 写：运营可写（只读运营除外）；机构只能写本组织 */
export function assertCanMutateOrg(req: any, orgId?: string | null) {
  if (req?.authMeta?.hasKey) return;
  const role = req?.user?.role || req?.authMeta?.role;
  if (role === 'OPS_VIEWER') throw new ForbiddenException('运营只读账号不能改数据');
  if (role === 'ADMIN' || role === 'OPERATOR') return;
  if (role === 'BROKER') throw new ForbiddenException('经纪人不能改组织主数据');
  if (isTenantStaff(role)) {
    if (!orgId || req?.user?.orgId !== orgId) {
      throw new ForbiddenException('无权修改其他组织的数据');
    }
    return;
  }
  throw new ForbiddenException('无权修改');
}
