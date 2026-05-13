// app/api/onboarding/route.ts
//
// Internal-tester self-provisioning. POST creates the user's therapai_therapists
// row using their auth.uid() as the row id (matches the RLS convention used
// across every therapai_* table). Idempotent — re-POSTing for an existing
// tenant returns 409. Gated on being on the invited waitlist; non-invited
// users 403 even if they're authenticated.

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase'
import { isInvited } from '@/lib/viewer'

const VALID_INGEST = new Set(['fireflies', 'recall'])

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Block re-onboarding.
  const { data: existing } = await supabase
    .from('therapai_therapists')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()
  if (existing) return NextResponse.json({ error: 'already_provisioned' }, { status: 409 })

  // Must be invited.
  const invited = await isInvited(supabaseAdmin, user.email ?? '')
  if (!invited) return NextResponse.json({ error: 'not_invited' }, { status: 403 })

  // Parse + validate payload.
  let body: { name?: string; crp?: string; clinical_lens?: string; ingest_source?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const name = (body.name ?? '').trim().slice(0, 120)
  if (name.length < 2) {
    return NextResponse.json({ error: 'invalid_name', message: 'Informe seu nome profissional (mín. 2 caracteres).' }, { status: 400 })
  }
  const ingestSource = (body.ingest_source ?? 'fireflies').toLowerCase()
  if (!VALID_INGEST.has(ingestSource)) {
    return NextResponse.json({ error: 'invalid_ingest_source' }, { status: 400 })
  }
  const clinicalLens = (body.clinical_lens ?? 'radical_behaviorism').toLowerCase()

  // Verify lens slug actually exists.
  const { data: lens } = await supabaseAdmin
    .from('therapai_clinical_lines')
    .select('slug')
    .eq('slug', clinicalLens)
    .eq('status', 'active')
    .maybeSingle()
  if (!lens) {
    return NextResponse.json({ error: 'invalid_clinical_lens' }, { status: 400 })
  }

  // Provision. Service-role insert — RLS would block self-INSERT on therapists
  // because the row doesn't exist yet, so auth.uid() can't match its own id.
  const { error: insertErr } = await supabaseAdmin
    .from('therapai_therapists')
    .insert({
      id: user.id,
      email: user.email,
      name,
      plan: 'tester',
      clinical_lens: clinicalLens,
      ingest_source: ingestSource,
    })
  if (insertErr) {
    console.error('[onboarding] insert failed', { user_id: user.id, err: insertErr.message })
    return NextResponse.json({ error: 'provisioning_failed', detail: insertErr.message }, { status: 500 })
  }

  // Audit. Self-insert policy already gates this row by actor_user_id = auth.uid().
  await supabase
    .from('therapai_audit_log')
    .insert({
      actor_user_id: user.id,
      action: 'self_provisioned',
      target_table: 'therapai_therapists',
      target_row_id: user.id,
      context: { clinical_lens: clinicalLens, ingest_source: ingestSource, crp: body.crp ?? null },
    })

  return NextResponse.json({ ok: true })
}
