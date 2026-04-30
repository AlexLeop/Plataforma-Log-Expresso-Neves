import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware — Protects API routes by requiring a valid Basic Auth header.
 *
 * Public routes (no auth required):
 *   - /api/machine/companies/register  (public registration)
 *   - /api/webhook/*                   (Machine webhook callbacks — HMAC-validated)
 *   - /api/cron/*                      (Vercel Cron — CRON_SECRET validated)
 *   - /api/auth/*                      (login/register endpoints)
 *   - /api/schedules/confirm/*         (driver confirmation — token-based)
 *
 * Protected routes require:
 *   - Header: Authorization: Basic <base64(email:password)>
 *   - The base64 must decode to a valid email:password format
 *   - Full credential validation happens in resolveTenant() at route level
 */

// Routes that do NOT require auth
const PUBLIC_PREFIXES = [
  '/api/auth/',
  '/api/webhook/',
  '/api/cron/',
  '/api/machine/companies/register',
  '/api/schedules/confirm/',
  '/api/nola/',
];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip non-API routes and public API routes
  if (!pathname.startsWith('/api/') || isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Check for Authorization header
  const authHeader = request.headers.get('authorization');

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return NextResponse.json(
      { error: 'Autenticação requerida', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  // Validate that the Basic auth value is well-formed
  const base64 = authHeader.slice(6); // Remove "Basic "
  if (!base64 || base64.length < 4) {
    return NextResponse.json(
      { error: 'Token de autenticação inválido', code: 'INVALID_TOKEN' },
      { status: 401 }
    );
  }

  // Decode and validate format: must be "email:password"
  try {
    const decoded = atob(base64);
    const colonIndex = decoded.indexOf(':');

    if (colonIndex < 1 || colonIndex === decoded.length - 1) {
      // Must have at least 1 char before and after the colon
      return NextResponse.json(
        { error: 'Formato de credenciais inválido', code: 'INVALID_CREDENTIALS' },
        { status: 401 }
      );
    }

    const email = decoded.substring(0, colonIndex);

    // Basic email format check (contains @ and .)
    if (!email.includes('@') || !email.includes('.')) {
      return NextResponse.json(
        { error: 'Formato de email inválido', code: 'INVALID_EMAIL' },
        { status: 401 }
      );
    }
  } catch {
    // Invalid base64
    return NextResponse.json(
      { error: 'Token de autenticação corrompido', code: 'CORRUPT_TOKEN' },
      { status: 401 }
    );
  }

  // Auth format is valid — proceed to route handler
  // Actual credential validation happens in resolveTenant() (DB lookup)
  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
