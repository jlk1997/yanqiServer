import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SECRET = () => process.env.AUTH_SECRET || process.env.ADMIN_API_KEY || 'yanqi-dev-secret';

/** scrypt 口令哈希：salt:hash。生产可迁 argon2id，见 docs/安全口令与会话-M10.md */
export function hashPassword(password: string, salt?: string) {
  const s = salt || randomBytes(16).toString('hex');
  const hash = scryptSync(password, s, 32).toString('hex');
  return `scrypt$${s}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  let raw = stored;
  if (raw.startsWith('scrypt$')) raw = raw.slice('scrypt$'.length);
  // 兼容旧格式 salt:hash
  const [s, hash] = raw.split(':');
  if (!s || !hash) return false;
  const next = scryptSync(password, s, 32).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
  } catch {
    return false;
  }
}

export function passwordHashMeta(stored: string) {
  if (stored.startsWith('scrypt$') || /^[a-f0-9]+:[a-f0-9]+$/i.test(stored)) {
    return { algo: 'scrypt', ok: true, note: '当前为 Node scrypt；更高等级可迁 argon2id（见文档）' };
  }
  return { algo: 'unknown', ok: false, note: '未知哈希格式' };
}

export type TokenPayload = {
  uid: string;
  role: string;
  email: string;
  orgId?: string | null;
  tenantId?: string | null;
  jti?: string;
  exp: number;
};

export function newJti() {
  return randomBytes(16).toString('hex');
}

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSec = 60 * 60 * 24 * 7) {
  const body: TokenPayload = {
    ...payload,
    jti: payload.jti || newJti(),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const raw = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', SECRET()).update(raw).digest('base64url');
  return { token: `${raw}.${sig}`, jti: body.jti!, exp: body.exp };
}

export function verifyToken(token: string): TokenPayload | null {
  const [raw, sig] = token.split('.');
  if (!raw || !sig) return null;
  const expect = createHmac('sha256', SECRET()).update(raw).digest('base64url');
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
