// lib/viewer.ts — tenant + viewer helpers.
//
// Multi-tenant pivot 2026-05-13: TherapAI moves from "single owner + everyone
// else is an evaluator" to a real multi-tenant SaaS where every authenticated
// user with a therapai_therapists row reads their own data via RLS
// (therapist_id = auth.uid()). Internal-tester onboarding lives at
// /onboarding; the synthetic demo tenant ("Dra. Demo") is served via the
// /demo/* route group with no auth required and a service-role read scope.
//
// Earlier surface dropped here: the (owner ? authClient : supabaseAdmin)
// branching, isOwner-as-write-protection. Write protection now means
// "user has a therapai_therapists row tied to their auth.uid()".

import type { SupabaseClient, User } from '@supabase/supabase-js';

export const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';
export const ANDRE_EMAIL = 'andrefiker@gmail.com';

// Synthetic demo tenant — read-only seed served by /demo/* via supabaseAdmin.
// No auth, no real PII. Every transcript flagged '[DEMO — TRANSCRIÇÃO SINTÉTICA,
// NÃO É PACIENTE REAL]'.
export const SYNTHETIC_THERAPIST_ID = 'de000000-0000-0000-0000-000000000099';

export type Therapist = {
  id: string;
  email: string;
  name: string;
  plan: string | null;
  clinical_lens: string | null;
  ingest_source: string;
};

/**
 * Returns the therapist row for the authenticated user, or null if they have
 * no tenant yet (still in onboarding or pending). Uses the auth-aware client
 * so RLS enforces id = auth.uid().
 */
export async function getTherapist(
  supabase: SupabaseClient,
  user: User | { id: string } | null | undefined,
): Promise<Therapist | null> {
  if (!user) return null;
  const { data } = await supabase
    .from('therapai_therapists')
    .select('id, email, name, plan, clinical_lens, ingest_source')
    .eq('id', user.id)
    .maybeSingle();
  return (data as Therapist | null) ?? null;
}

/**
 * Has the operator invited this email to onboard? Reads the waitlist row via
 * service-role (the user has no SELECT on waitlist yet; only the operator does).
 * Used in the login post-flow to decide /onboarding vs /pending routing.
 */
export async function isInvited(
  adminClient: SupabaseClient,
  email: string,
): Promise<boolean> {
  const norm = email.toLowerCase().trim();
  if (norm === ANDRE_EMAIL) return true;
  const { data } = await adminClient
    .from('therapai_waitlist')
    .select('invited_at')
    .eq('email', norm)
    .not('invited_at', 'is', null)
    .limit(1)
    .maybeSingle();
  return !!data?.invited_at;
}

// Backwards-compat shim for callers still importing isOwner. After full refactor
// every read path is RLS-scoped and every write path checks getTherapist(); the
// only legitimate remaining use of isOwner is operator-only UI (admin/biblioteca).
// Marked deprecated.
/** @deprecated Use getTherapist + RLS for tenancy; operator gating via admin module. */
export function isOwner(user: User | { id?: string; email?: string | null } | null | undefined): boolean {
  if (!user) return false;
  const email = (user.email ?? '').toLowerCase().trim();
  return email === ANDRE_EMAIL;
}
