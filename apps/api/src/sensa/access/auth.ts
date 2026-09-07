import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';

export class ConsumerError extends Error {
  constructor(public readonly status: 400|401|403|404|409|413|503, public readonly code: string) { super(code); }
}
export type ConsumerPrincipal = { issuer: string; subject: string; sessionId: string; email: string | null };
export type ConsumerVerifier = (request: Request) => Promise<ConsumerPrincipal>;
/** The injected key seam is for deterministic signature tests, never request-controlled. */
export function createConsumerVerifier(issuer: string, key: JWTVerifyGetKey): ConsumerVerifier {
  return async request => {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/u)?.[1];
    if (!token) throw new ConsumerError(401, 'authentication_required');
    try {
      const { payload } = await jwtVerify(token, key, { issuer, audience: 'authenticated', algorithms: ['ES256','RS256'] });
      if (!payload.sub || typeof payload.session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(payload.session_id)
        || typeof payload.exp !== 'number') throw new Error('Invalid claims');
      return { issuer, subject: payload.sub, sessionId: payload.session_id, email: typeof payload.email === 'string' ? payload.email : null };
    } catch { throw new ConsumerError(401, 'authentication_required'); }
  };
}
let production: ConsumerVerifier | undefined;
export const verifyConsumer: ConsumerVerifier = request => {
  if (!production) {
    const url = process.env.SUPABASE_URL;
    if (!url || new URL(url).protocol !== 'https:') throw new ConsumerError(503, 'auth_not_configured');
    const issuer = url.replace(/\/$/u,'') + '/auth/v1';
    production = createConsumerVerifier(issuer, createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json')));
  }
  return production(request);
};
