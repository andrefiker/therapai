// lib/viewer.ts — demo-mode viewer detection.
//
// Period 2026-05-11 → onboarding-of-paying-clinicians: the site is open for
// evaluation by partners (devs + psicólogos). Anyone with a magic link can
// log in. Only André sees his own data as the owner-therapist; everyone else
// is routed to the SYNTHETIC tenant (Dra. Demo) and reads mock patients +
// mock transcripts + mock analyses — never André's real clinical data.
//
// LGPD-compliance pivot (2026-05-12, ISA therapai-lgpd-compliance F2): the
// prior implementation scoped evaluators to ANDRE_THERAPIST_ID via service_role
// (supabaseAdmin bypasses RLS), which leaked real patient transcripts to any
// magic-link login. Replaced with SYNTHETIC_THERAPIST_ID.
//
// When TherapAI starts onboarding real paying clinicians via /admin/waitlist,
// this is the file to revisit — replace blanket-evaluator logic with proper
// multi-tenant routing.

import type { User } from '@supabase/supabase-js';

export const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';
export const ANDRE_EMAIL = 'andrefiker@gmail.com';

// Synthetic demo tenant — evaluators read this tenant's data instead of André's.
// Seed lives in Supabase prod under the same therapai_* tables; flagged with
// '[DEMO — TRANSCRIÇÃO SINTÉTICA, NÃO É PACIENTE REAL]' in every transcript and
// analysis body. See ISA therapai-lgpd-compliance F2.
export const SYNTHETIC_THERAPIST_ID = 'de000000-0000-0000-0000-000000000099';

export type ViewerMode = 'owner' | 'evaluator';

export function viewerMode(user: User | { id?: string; email?: string | null } | null | undefined): ViewerMode | null {
  if (!user) return null;
  const email = (user.email ?? '').toLowerCase().trim();
  if (email === ANDRE_EMAIL) return 'owner';
  return 'evaluator';
}

export function isOwner(user: User | { id?: string; email?: string | null } | null | undefined): boolean {
  return viewerMode(user) === 'owner';
}
