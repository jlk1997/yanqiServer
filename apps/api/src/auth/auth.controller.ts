import { permissionMatrixDoc } from './permissions';
import { Body, Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { demoAccountsDoc, resolveShell } from './shell';
import { clientIp } from '../common/rate-limit';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Get('permissions')
  permissions() {
    return { ok: true, ...permissionMatrixDoc() };
  }

  private setCookies(res: Response, result: any) {
    const role = result?.user?.role;
    if (role === 'ADMIN' || role === 'OPERATOR') {
      res.append('Set-Cookie', 'yanqi_ops=1; Path=/; HttpOnly; SameSite=Lax');
    } else {
      res.append('Set-Cookie', 'yanqi_ops=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    }
    res.append(
      'Set-Cookie',
      `yanqi_token=${encodeURIComponent(result.token)}; Path=/; HttpOnly; SameSite=Lax`,
    );
  }

  private clearCookies(res: Response) {
    res.append('Set-Cookie', 'yanqi_ops=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.append('Set-Cookie', 'yanqi_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  }

  @Post('login')
  async login(
    @Body() body: { username?: string; password?: string; email?: string },
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.ensureSeedUsers();
    const id = body.email || body.username || '';
    const result = await this.auth.login(id, body.password || '', {
      userAgent: req.headers?.['user-agent'],
      ip: clientIp(req),
    });
    this.setCookies(res, result);
    return result;
  }

  @Post('register')
  async register(
    @Body()
    body: { email?: string; password?: string; name?: string; orgName?: string; orgType?: string },
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.register(
      {
        email: body.email || '',
        password: body.password || '',
        name: body.name || '',
        orgName: body.orgName,
        orgType: body.orgType,
      },
      { userAgent: req.headers?.['user-agent'], ip: clientIp(req) },
    );
    this.setCookies(res, result);
    return result;
  }

  @Get('me')
  async me(@Req() req: any) {
    const payload = this.auth.parseAuthHeader(req);
    const active = await this.auth.assertSessionActive(payload);
    if (!active) return { ok: false, user: null };
    const user = await this.auth['prisma'].user.findUnique({
      where: { id: active.uid },
      include: {
        org: true,
        subscriptions: { include: { plan: true }, take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
    if (!user) return { ok: false, user: null };
    const { passwordHash, ...safe } = user as any;
    const shell = resolveShell({
      role: safe.role,
      orgId: safe.orgId,
      orgType: safe.org?.type,
    });
    return {
      ok: true,
      user: { ...safe, orgType: safe.org?.type || null, ...shell },
      shell: shell.shell,
      homePath: shell.homePath,
      persona: shell.persona,
      personaLabel: shell.personaLabel,
      jti: active.jti || null,
    };
  }

  @Get('demo-accounts')
  demoAccounts() {
    return { ok: true, noteZh: '试点演示号，密码均为 yanqi123', items: demoAccountsDoc() };
  }

  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const payload = this.auth.parseAuthHeader(req);
    const r = await this.auth.logout(payload);
    this.clearCookies(res);
    return r;
  }

  @Get('sessions')
  async sessions(@Req() req: any) {
    const payload = await this.auth.assertSessionActive(this.auth.parseAuthHeader(req));
    if (!payload) return { ok: false, items: [], message: '请先登录' };
    const items = await this.auth.listSessions(payload.uid);
    return { ok: true, items, currentJti: payload.jti || null };
  }

  @Post('sessions/:jti/revoke')
  async revokeOne(@Param('jti') jti: string, @Req() req: any) {
    const payload = await this.auth.assertSessionActive(this.auth.parseAuthHeader(req));
    if (!payload) return { ok: false, message: '请先登录' };
    return this.auth.revokeSession(payload.uid, jti, payload.email);
  }

  @Post('sessions/revoke-others')
  async revokeOthers(@Req() req: any) {
    const payload = await this.auth.assertSessionActive(this.auth.parseAuthHeader(req));
    if (!payload) return { ok: false, message: '请先登录' };
    return this.auth.revokeAllSessions(payload.uid, payload.jti);
  }

  @Post('sessions/revoke-all')
  async revokeAll(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const payload = await this.auth.assertSessionActive(this.auth.parseAuthHeader(req));
    if (!payload) return { ok: false, message: '请先登录' };
    const r = await this.auth.revokeAllSessions(payload.uid);
    this.clearCookies(res);
    return r;
  }

  @Post('bootstrap')
  async bootstrap() {
    const r = await this.auth.ensureSeedUsers();
    return { ok: true, ...r };
  }
}
