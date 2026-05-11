// lib/viewer.ts — demo-mode viewer detection.
//
// Period 2026-05-11 → onboarding-of-paying-clinicians: the site is open for
// evaluation by partners (devs + psicólogos). Anyone with a magic link can
// log in. Only André sees the data as the owner-therapist; everyone else sees
// the same data in READ-ONLY evaluator mode.
//
// When TherapAI starts onboarding real paying clinicians via /admin/waitlist,
// this is the file to revisit — replace blanket-evaluator logic with proper
// multi-tenant routing.

import type { User } from '@supabase/supabase-js';

export const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';
export const ANDRE_EMAIL = 'andrefiker@gmail.com';

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
