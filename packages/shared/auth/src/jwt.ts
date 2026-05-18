/**
 * JWT issuance and verification.
 *
 * HS256 with a 256-bit-or-stronger secret from JWT_SECRET. Tokens
 * carry the minimum context needed to authorize a request without
 * a DB lookup on the hot path: subject (User id), JTI (links to
 * ApiSession), tier (gates feature access), and standard timing
 * claims. The DB lookup still happens for any operation that mutates
 * state, but the cheap auth path stays cheap.
 *
 * Why `jose` and not `jsonwebtoken`: jose is ESM-first, has a strict
 * verification API that fails closed on weak algorithms, and runs in
 * any modern JS runtime (Bun, Node, Workers) without polyfills.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'node:crypto';

const ALG = 'HS256';
const ISSUER = 'strong-tower-mods';
const AUDIENCE = 'companion-api';

/**
 * Default token lifetime — kept short so a leaked token has limited
 * blast radius. Clients should refresh by reopening the SSO flow.
 */
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

export interface SessionClaims extends JWTPayload {
  sub: string; // User.id
  jti: string; // ApiSession.jwtJti
  tier: string; // "basic" | "premium" | "custom" | ...
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface IssueTokenInput {
  userId: string;
  tier: string;
  /** Optional override for token TTL in seconds. */
  ttlSeconds?: number;
  /** Optional pre-allocated jti so the caller can persist ApiSession first. */
  jti?: string;
}

function getSecret(): Uint8Array {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error(
      'JWT_SECRET must be set to at least 32 chars (256 bits) before issuing or verifying tokens'
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a session token. Returns the compact JWS string and the jti so
 * the caller can persist an ApiSession row with the same identifier.
 */
export async function issueSessionToken(
  input: IssueTokenInput
): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const jti = input.jti ?? randomUUID();
  const ttl = input.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;

  const token = await new SignJWT({ tier: input.tier })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.userId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(getSecret());

  return { token, jti, expiresAt: new Date(exp * 1000) };
}

/**
 * Verify a session token. Throws on any verification failure
 * (signature mismatch, expiry, wrong issuer, wrong audience, missing
 * required claim). Errors are intentionally generic so the caller can
 * surface them as 401 without leaking which claim failed.
 */
export async function verifySessionToken(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, getSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: [ALG],
  });

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Token missing required claim: sub');
  }
  if (!payload.jti || typeof payload.jti !== 'string') {
    throw new Error('Token missing required claim: jti');
  }
  if (typeof payload['tier'] !== 'string') {
    throw new Error('Token missing required claim: tier');
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new Error('Token missing required timing claims');
  }

  return {
    ...payload,
    sub: payload.sub,
    jti: payload.jti,
    tier: payload['tier'],
    iat: payload.iat,
    exp: payload.exp,
    iss: ISSUER,
    aud: AUDIENCE,
  };
}
