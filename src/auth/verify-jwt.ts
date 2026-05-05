import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const JWKS = createRemoteJWKSet(new URL(process.env.SUPABASE_JWKS_URL!));

export interface SupabaseJwtPayload extends JWTPayload {
  sub: string;
  email?: string;
  role: 'authenticated';
  aud: 'authenticated';
}

export async function verifySupabaseJwt(token: string): Promise<SupabaseJwtPayload> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    audience: 'authenticated',
  });
  return payload as SupabaseJwtPayload;
}
