import { Body, Controller, Get, Post, Put, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { createHash } from 'crypto';
import { WorkbenchService } from './workbench.service';
import { resolveShell } from '../auth/shell';
import { recordHomeCache, homeCacheStats } from './home-cache-stats';
import {
  recordInboxDeltaCache,
  inboxDeltaCacheStats,
  getInboxDeltaCache,
  setInboxDeltaCache,
  bustInboxDeltaCache,
  inboxDeltaTtlMs,
} from './inbox-delta-cache';

@Controller('workbench')
export class WorkbenchController {
  constructor(private wb: WorkbenchService) {}
  /** M44：首页短缓存键按 shell+tenant(+user) 隔离，降串壳脏读 */
  private homeCache = new Map<string, { at: number; body: any; etag: string; key: string }>();
  private homeTtlMs = Number(process.env.WORKBENCH_HOME_CACHE_MS || 4000);
  /** M62：inbox delta 短缓存迁至 inbox-delta-cache（分壳曲线 + 定向 bust） */

  private uid(req: any) {
    if (req?.user?.uid) return req.user.uid as string;
    if (req?.authMeta?.hasKey) return 'api-key-admin';
    return null;
  }

  private homeCacheKey(req: any): string | null {
    const uid = this.uid(req);
    if (!uid) return null;
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    let shell = 'unknown';
    try {
      shell = resolveShell({
        role: req?.user?.role,
        orgId: req?.user?.orgId,
        orgType: req?.user?.orgType || req?.user?.org?.type,
      }).shell;
    } catch (_) {
      shell = String(req?.user?.role || 'unknown');
    }
    return `${uid}::${shell}::${tenantId}`;
  }

  /** M42/M44/M61/M62：写后打穿 home；默认同时定向打穿 inbox/delta */
  bustHome(
    uidOrKey: string | null | undefined,
    opts: { inbox?: boolean; tenantId?: string | null; shell?: string | null } = {},
  ) {
    if (!uidOrKey) return { ok: true, cleared: false, clearedKeys: 0, inbox: null };
    const alsoInbox = opts.inbox !== false;
    let n = 0;
    if (uidOrKey.includes('::')) {
      if (this.homeCache.delete(uidOrKey)) n++;
    } else {
      for (const k of [...this.homeCache.keys()]) {
        if (k === uidOrKey || k.startsWith(uidOrKey + '::')) {
          this.homeCache.delete(k);
          n++;
        }
      }
    }
    let inbox: any = null;
    if (alsoInbox) {
      const parts = String(uidOrKey).split('::');
      const uid = parts[0];
      const shellFromKey = parts.length >= 2 ? parts[1] : null;
      const tenantFromKey = parts.length >= 3 ? parts[2] : null;
      inbox = bustInboxDeltaCache({
        uid,
        tenantId: opts.tenantId ?? tenantFromKey,
        shell: opts.shell ?? shellFromKey,
      });
      n += inbox.clearedKeys || 0;
    }
    return { ok: true, cleared: n > 0, clearedKeys: n, inbox, wave: 'M63' };
  }

  /** M62：仅按租户/壳打穿收件箱（匹配写库后调用，不波及无关壳） */
  bustInboxTargeted(opts: { tenantId?: string | null; shell?: string | null; uid?: string | null } = {}) {
    return bustInboxDeltaCache(opts);
  }

  @Post('home/bust')
  bust(@Req() req: any, @Body() body: { tenantId?: string; shell?: string; inboxOnly?: boolean } = {}) {
    const uid = this.uid(req);
    if (!uid) return { ok: false, message: '请先登录' };
    if (body?.inboxOnly) {
      return this.bustInboxTargeted({
        uid,
        tenantId: body?.tenantId || req?.user?.tenantId || 'default',
        shell: body?.shell || null,
      });
    }
    return this.bustHome(uid, {
      tenantId: body?.tenantId || req?.user?.tenantId || null,
      shell: body?.shell || null,
    });
  }

  @Get('home')
  async home(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const uid = req?.user?.uid;
    if (!uid) return { ok: false, message: '请先登录' };
    const key = this.homeCacheKey(req) || uid;
    const shell = String(key).includes('::') ? String(key).split('::')[1] || 'unknown' : 'unknown';
    const bust = String(req?.query?.fresh || '') === '1';
    if (bust) this.bustHome(uid);
    const hit = this.homeCache.get(key);
    const now = Date.now();
    if (!bust && hit && now - hit.at < this.homeTtlMs) {
      res.setHeader('Cache-Control', 'private, max-age=3, stale-while-revalidate=8');
      res.setHeader('ETag', hit.etag);
      res.setHeader('X-Workbench-Cache', 'HIT');
      res.setHeader('X-Workbench-Cache-Key', key.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120));
      res.setHeader('X-Workbench-Cache-Shell', shell);
      if (req.headers['if-none-match'] === hit.etag) {
        recordHomeCache('NOT_MODIFIED', shell);
        res.status(304);
        return;
      }
      recordHomeCache('HIT', shell);
      return hit.body;
    }
    const body = await this.wb.home(uid);
    const etag = 'W/"' + createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16) + '"';
    this.homeCache.set(key, { at: now, body, etag, key });
    if (this.homeCache.size > 200) {
      const oldest = [...this.homeCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.homeCache.delete(oldest[0]);
    }
    res.setHeader('Cache-Control', 'private, max-age=3, stale-while-revalidate=8');
    res.setHeader('ETag', etag);
    res.setHeader('X-Workbench-Cache', bust ? 'BYPASS' : 'MISS');
    res.setHeader('X-Workbench-Cache-Key', key.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 120));
    res.setHeader('X-Workbench-Cache-Shell', shell);
    recordHomeCache(bust ? 'BYPASS' : 'MISS', shell);
    return body;
  }

  /** M46：home 短缓存 HIT/MISS（也挂在 /api/metrics/home-cache） */
  @Get('home/cache-stats')
  cacheStats() {
    return homeCacheStats();
  }

  /** M62：inbox/delta 分壳命中（也挂在 /api/metrics/inbox-delta-cache） */
  @Get('inbox/cache-stats')
  inboxCacheStats() {
    return inboxDeltaCacheStats();
  }

  /** M59–M61：收件箱真差分（opaque cursor + since + knownIds）+ 短缓存 ETag */
  @Get('inbox/delta')
  async inboxDelta(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Query('since') since?: string,
    @Query('knownIds') knownIds?: string,
    @Query('cursor') cursor?: string,
    @Query('fresh') fresh?: string,
  ) {
    const uid = this.uid(req);
    if (!uid) throw new UnauthorizedException('请先登录');
    const ids = String(knownIds || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 80);
    const tenantId = req?.user?.tenantId || req?.resolvedTenantId || 'default';
    let shell = 'unknown';
    try {
      shell = resolveShell({
        role: req?.user?.role,
        orgId: req?.user?.orgId,
        orgType: req?.user?.orgType || req?.user?.org?.type,
      }).shell;
    } catch (_) {
      shell = String(req?.user?.role || 'unknown');
    }
    const cursorKey = String(cursor || since || '').slice(0, 160);
    const knownHash = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 12);
    const cacheKey = `${uid}::${shell}::${tenantId}::${cursorKey}::${knownHash}`;
    const bust = String(fresh || '') === '1';
    if (bust) {
      bustInboxDeltaCache({ uid });
    }
    const now = Date.now();
    const ttl = inboxDeltaTtlMs();
    const hit = getInboxDeltaCache(cacheKey);
    if (!bust && hit && now - hit.at < ttl) {
      res.setHeader('Cache-Control', 'private, max-age=2, stale-while-revalidate=6');
      res.setHeader('ETag', hit.etag);
      res.setHeader('X-Inbox-Delta-Cache', 'HIT');
      res.setHeader('X-Inbox-Delta-Shell', shell);
      res.setHeader('X-Yanqi-Wave', 'M62');
      if (req.headers['if-none-match'] === hit.etag) {
        recordInboxDeltaCache('NOT_MODIFIED', shell);
        res.status(304);
        return;
      }
      recordInboxDeltaCache('HIT', shell);
      return {
        ...hit.body,
        cache: 'HIT',
        etag: hit.etag,
        timingMs: 0,
        wave: 'M63',
        tipZh: hit.body?.tipZh || '收件箱无变化（短缓存命中）。',
        busyClearZh: hit.body?.busyClearZh || '收件箱已是最新，等待态已清理。',
      };
    }
    // 仅打穿 home（不丢本接口短缓存）；匹配写库走定向 bustInbox
    this.bustHome(uid, { inbox: false });
    const body = await this.wb.inboxDelta(uid, {
      since: since || null,
      knownIds: ids,
      cursor: cursor || null,
    });
    const etag =
      'W/"id-' +
      createHash('sha1')
        .update(
          JSON.stringify({
            c: body?.nextCursor || body?.cursor || null,
            a: (body?.added || []).map((x: any) => x.id),
            u: (body?.updated || []).map((x: any) => x.id),
            r: body?.removedIds || [],
            n: body?.recentCount,
            shell,
            tenantId,
          }),
        )
        .digest('hex')
        .slice(0, 16) +
      '"';
    const storeBody = { ...body, etag, cache: undefined, timingMs: undefined, wave: 'M63' };
    setInboxDeltaCache(cacheKey, {
      at: now,
      body: storeBody,
      etag,
      key: cacheKey,
      shell,
      tenantId,
    });
    res.setHeader('Cache-Control', 'private, max-age=2, stale-while-revalidate=6');
    res.setHeader('ETag', etag);
    res.setHeader('X-Inbox-Delta-Cache', bust ? 'BYPASS' : 'MISS');
    res.setHeader('X-Inbox-Delta-Shell', shell);
    res.setHeader('X-Yanqi-Wave', 'M62');
    recordInboxDeltaCache(bust ? 'BYPASS' : 'MISS', shell);
    if (!bust && req.headers['if-none-match'] === etag) {
      recordInboxDeltaCache('NOT_MODIFIED', shell);
      res.status(304);
      return;
    }
    return {
      ...body,
      etag,
      cache: bust ? 'BYPASS' : 'MISS',
      wave: 'M63',
    };
  }


  @Get('prefs/ops-dash-cards')
  getOpsDashPrefs(@Req() req: any) {
    const uid = this.uid(req);
    if (!uid) throw new UnauthorizedException('请先登录');
    return this.wb.getOpsDashCardPrefs(uid, req?.user?.tenantId || 'default', req?.user?.email || req?.user?.name || uid);
  }

  @Put('prefs/ops-dash-cards')
  putOpsDashPrefs(@Req() req: any, @Body() body: { order?: string[]; hidden?: string[]; migrateFromLocal?: boolean }) {
    const uid = this.uid(req);
    if (!uid) throw new UnauthorizedException('请先登录');
    return this.wb.putOpsDashCardPrefs(uid, req?.user?.tenantId || 'default', body || {});
  }

  @Post('prefs/ops-dash-cards')
  postOpsDashPrefs(@Req() req: any, @Body() body: { order?: string[]; hidden?: string[]; migrateFromLocal?: boolean }) {
    return this.putOpsDashPrefs(req, body);
  }
}
