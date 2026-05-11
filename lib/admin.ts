// lib/admin.ts — simple admin allowlist for early-stage single-admin operations.
//
// V1: admin = André. Env var ADMIN_EMAILS overrides; defaults to andrefiker@gmail.com
// for safety. Comma-separated for future multi-admin.

const FALLBACK_ADMIN = 'andrefiker@gmail.com';

function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? FALLBACK_ADMIN;
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.toLowerCase().trim());
}
