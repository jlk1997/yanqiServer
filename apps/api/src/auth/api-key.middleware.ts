import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './token';
import { isOps } from './scope';
import { PrismaService } from '../prisma/prisma.service';
import { consumeSseTicket } from './sse-ticket';

function requestPath(req: Request) {
  const raw = (req.originalUrl || req.url || req.path || '').split('?')[0];
  return raw.startsWith('/') ? raw : '/' + raw;
}

function isPublic(path: string) {
  if (
    path === '/api/health' ||
    path === '/api/health/live' ||
    path === '/api/health/ready' ||
    path === '/health' ||
    path === '/health/live' ||
    path === '/health/ready'
  )
    return true;
  if (path.startsWith('/api/public/') || path.startsWith('/public/')) return true;
  if (path.startsWith('/api/public/team-invite')) return true;
  if (path.startsWith('/api/billing/webhook')) return true;
  if (path === '/api/openapi.json' || path === '/api/docs' || path.startsWith('/api/docs/')) return true;
  if (path === '/api/webhooks/status') return true;
  if (path === '/api/flags' || path === '/api/flags/defaults') return true;
  if (path === '/api/trust/badges') return true;
  if (path === '/api/cases/public' || path.startsWith('/api/cases/public/')) return true;
  if (path.startsWith('/api/matches/one-pager/s/')) return true;
  if (path === '/api/matches/one-pager/tiers') return true;
  if (
    path.startsWith('/api/auth/login') ||
    path.startsWith('/api/auth/register') ||
    path.startsWith('/api/auth/bootstrap') ||
    path.startsWith('/api/auth/demo-accounts') ||
    path.startsWith('/auth/demo-accounts') ||
    path.startsWith('/auth/login') ||
    path.startsWith('/auth/register') ||
    path.startsWith('/auth/bootstrap')
  )
    return true;
  return false;
}

@Injectable()
export class ApiKeyMiddleware implements NestMiddleware {
  constructor(private prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const path = requestPath(req);
    if (!path.startsWith('/api') && !path.startsWith('/auth') && path !== '/health') {
      return next();
    }
    if (isPublic(path)) return next();

    const expected = process.env.ADMIN_API_KEY || 'yanqi-admin-demo-key';
    const key = (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
    const cookie = req.headers.cookie || '';
    let role: string | null = null;
    let uid: string | null = null;
    let orgId: string | null = null;
    let tenantId: string | null = null;

    const applyPayload = (payload: any) => {
      role = payload.role;
      uid = payload.uid;
      orgId = (payload as any).orgId || null;
      tenantId = (payload as any).tenantId || 'default';
      (req as any).user = { ...payload, tenantId };
    };

    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const payload = verifyToken(auth.slice(7));
      if (payload) applyPayload(payload);
    }
    // M46–M48：优先一次性短票 ?sse_ticket=；path 绑定 + 可选 jobId 绑定（错绑 → 401 且不消费）
    if (!role) {
      const sst = (req.query.sse_ticket || req.query.sseTicket) as string | undefined;
      if (sst) {
        const qJob =
          (req.query.id as string | undefined) ||
          (req.query.jobId as string | undefined) ||
          (req.query.job_id as string | undefined) ||
          '';
        let pathJob = '';
        const mImp = /\/imports\/enterprise\/jobs\/([^/]+)\/progress/.exec(path);
        const mJob = /\/jobs\/([^/]+)\/progress/.exec(path);
        if (mImp) pathJob = mImp[1];
        else if (mJob && mJob[1] !== 'progress') pathJob = mJob[1];
        const requestJobId = String(qJob || pathJob || '').trim() || null;
        const consumed = consumeSseTicket(String(sst), { streamPath: path, jobId: requestJobId });
        if (consumed.ok) {
          applyPayload(consumed.payload);
          (req as any).authViaSseTicket = true;
          (req as any).authViaQueryToken = false;
          (req as any).sseTicketStreamPath = consumed.streamPath || path;
          (req as any).sseTicketJobId = consumed.jobId || requestJobId;
        } else if (consumed.reason === 'path_mismatch' || consumed.reason === 'path_required') {
          throw new UnauthorizedException({
            ok: false,
            code: 'SSE_TICKET_PATH_MISMATCH',
            messageZh: `SSE 短票路径不匹配：票绑定 ${consumed.boundPath || '（无）'}，请求 ${consumed.requestPath || path}。请按目标流路径重新领取短票。`,
            boundPath: consumed.boundPath || null,
            requestPath: consumed.requestPath || path,
          });
        } else if (consumed.reason === 'job_mismatch') {
          throw new UnauthorizedException({
            ok: false,
            code: 'SSE_TICKET_JOB_MISMATCH',
            messageZh: `SSE 短票任务不匹配：票绑定 jobId=${consumed.boundJobId || '（无）'}，请求 ${consumed.requestJobId || '（无）'}。请按目标任务重新领取短票。`,
            boundJobId: consumed.boundJobId || null,
            requestJobId: consumed.requestJobId || null,
          });
        } else if (consumed.reason === 'expired') {
          throw new UnauthorizedException({
            ok: false,
            code: 'SSE_TICKET_EXPIRED',
            messageZh: 'SSE 短票已过期，请重新领取。',
          });
        }
        // not_found：可能已被消费，继续走 cookie / access_token 兜底
      }
    }
    // M45 兜底：EventSource 无法自定义头 → ?access_token= / ?token=（优先 cookie / 短票）
    if (!role) {
      const qTok = (req.query.access_token || req.query.token) as string | undefined;
      if (qTok) {
        const payload = verifyToken(String(qTok));
        if (payload) {
          applyPayload(payload);
          (req as any).authViaQueryToken = true;
        }
      }
    }
    if (!role) {
      const m = /yanqi_token=([^;]+)/.exec(cookie);
      if (m) {
        const payload = verifyToken(decodeURIComponent(m[1]));
        if (payload) applyPayload(payload);
      }
    }

    // 吊销会话：带 jti 的 token 若已 revoke 则清空身份
    const u = (req as any).user;
    if (u?.jti) {
      try {
        const sess = await this.prisma.authSession.findUnique({ where: { jti: u.jti } });
        if (sess?.revokedAt) {
          role = null;
          uid = null;
          orgId = null;
          (req as any).user = undefined;
        }
      } catch (_) {
        /* 表未就绪时跳过 */
      }
    }

    const hasOpsCookie = cookie.includes('yanqi_ops=1');
    const hasKey = Boolean(key && key === expected);

    if (!hasKey && !hasOpsCookie && !role) {
      throw new UnauthorizedException('请登录或提供有效的 X-API-Key');
    }

    const apiPath = path.startsWith('/api') ? path : '/api' + path;
    const method = (req.method || 'GET').toUpperCase();

    if (role === 'ORG_USER') {
      const blockedWrite = [
        '/api/jobs',
        '/api/schedules',
        '/api/admin',
        '/api/billing/admin',
        '/api/brokers',
        '/api/tenants',
        '/api/imports',
        '/api/events',
        '/api/commissions',
        '/api/users',
      ];
      // M46：业务壳可领 SSE 短票，并可取消/续跑与己相关的匹配任务
      const jobSelfServe =
        apiPath === '/api/jobs/sse-ticket' ||
        /^\/api\/jobs\/[^/]+\/(cancel|resume)$/.test(apiPath);
      if (method !== 'GET' && blockedWrite.some((p) => apiPath.startsWith(p)) && !jobSelfServe) {
        throw new ForbiddenException('机构用户无权操作运营任务');
      }
      // 审计只读/导出仅运营
      if (apiPath.startsWith('/api/audits')) {
        throw new ForbiddenException('机构用户不能查看或导出审计日志');
      }
      if (apiPath.startsWith('/api/leads') && method !== 'GET') {
        throw new ForbiddenException('机构用户不能直接操作线索发信');
      }
      if (apiPath.startsWith('/api/quality/scan') && method !== 'GET') {
        throw new ForbiddenException('机构用户不能跑全局质检');
      }
      if (apiPath.startsWith('/api/integrations') && method !== 'GET') {
        throw new ForbiddenException('机构用户不能改集成配置');
      }
      // 禁止自我提权：任何改角色/套餐的接口
      if (method !== 'GET' && (apiPath.startsWith('/api/auth/role') || apiPath.startsWith('/api/auth/promote'))) {
        throw new ForbiddenException('机构用户不能提升角色');
      }
      if (method !== 'GET') {
        const orgScopedWrite = ['/api/orgs', '/api/capabilities', '/api/outcomes', '/api/demands', '/api/people'];
        if (orgScopedWrite.some((p) => apiPath === p || apiPath.startsWith(p + '/'))) {
          if (!orgId && !(req as any).user?.orgId) {
            throw new ForbiddenException('请先绑定组织后再改数据；建议走门户自助接口');
          }
        }
      }
    }


    if (role === 'OPS_VIEWER') {
      if (method !== 'GET' && method !== 'HEAD') {
        // 允许会话自管与告警确认
        const allow =
          apiPath.startsWith('/api/auth/sessions') ||
          apiPath.startsWith('/api/metrics/alerts') ||
          apiPath.startsWith('/api/notifications') ||
          // 园区观察员可推进征集审批 + 一键脱敏进案例池（不可建窗）
          (apiPath.startsWith('/api/park/approvals') && method === 'PATCH') ||
          (apiPath.startsWith('/api/park/approvals/') && apiPath.endsWith('/publish-case') && method === 'POST') ||
          (apiPath.startsWith('/api/park/docs') && (method === 'POST' || method === 'PATCH')) ||
          // M32：园区可审案例（通过/驳回/下架/回队列），不可手工改稿 PUT
          (apiPath.startsWith('/api/cases/') &&
            method === 'POST' &&
            (/\/(publish|reject|unpublish|requeue)$/.test(apiPath) ||
              apiPath.includes('/cases/from-match/')));
        if (!allow) throw new ForbiddenException('运营只读账号不能改数据');
      }
    }

    if (role === 'TENANT_ADMIN') {
      const blockedWrite = [
        '/api/jobs', '/api/schedules', '/api/admin', '/api/billing', '/api/brokers',
        '/api/tenants', '/api/imports', '/api/events', '/api/commissions', '/api/integrations', '/api/audits',
      ];
      // 企业自助账单：下单 / 模拟支付 / 提醒草稿（演示不扣款），不开放运营对账写接口
      const billingSelfServe =
        apiPath === '/api/billing/order' ||
        apiPath === '/api/billing/checkout' ||
        /^\/api\/billing\/checkout\/[^/]+\/simulate-pay$/.test(apiPath) ||
        apiPath === '/api/billing/reminders/notify-draft';
      // M46：业务壳 SSE 短票 + 匹配取消/续跑（导入仍仅运营）
      const jobSelfServe =
        apiPath === '/api/jobs/sse-ticket' ||
        /^\/api\/jobs\/[^/]+\/(cancel|resume)$/.test(apiPath);
      if (
        method !== 'GET' &&
        blockedWrite.some((p) => apiPath.startsWith(p)) &&
        !(apiPath.startsWith('/api/billing') && billingSelfServe) &&
        !jobSelfServe
      ) {
        throw new ForbiddenException('机构管理员不能操作平台运营接口');
      }
      if (apiPath.startsWith('/api/leads') && method !== 'GET') {
        throw new ForbiddenException('机构管理员不能直接发信');
      }
    }

    if (role === 'BROKER') {
      if (method !== 'GET') {
        const allowed =
          apiPath.startsWith('/api/matches') ||
          apiPath.startsWith('/api/brokers') ||
          apiPath.startsWith('/api/leads') ||
          apiPath.startsWith('/api/feedback') ||
          apiPath.startsWith('/api/notifications') ||
          apiPath.startsWith('/api/commissions');
        // commissions POST 在 controller 再拦状态修改
        if (!allowed) {
          throw new ForbiddenException('经纪人角色仅可跟进匹配与线索');
        }
      }
    }

    // Host 解析出的租户落到请求上，供服务层使用
    if ((req as any).resolvedTenantId && !(req as any).user?.tenantId) {
      (req as any).hostTenantId = (req as any).resolvedTenantId;
    }

    (req as any).authMeta = { role, uid, orgId, tenantId, hasKey, hasOpsCookie, path: apiPath, isOps: isOps(role) || hasKey };
    return next();
  }
}
