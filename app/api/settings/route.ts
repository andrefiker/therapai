// app/api/settings/route.ts
//
// PATCH /api/settings — therapist updates their own preferences (name,
// clinical_lens, ingest_source). RLS scopes the UPDATE to id = auth.uid().

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase'
import { audit, extractClientIp } from '@/lib/audit'

const VALID_INGEST = new Set(['fireflies', 'recall'])

export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { name?: string; clinical_lens?: string; ingest_source?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const updates: Record<string, string> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (name.length < 2 || name.length > 120) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 })
    }
    updates.name = name
  }

  if (typeof body.clinical_lens === 'string') {
    const lens = body.clinical_lens.toLowerCase()
    const { data: lensRow } = await supabaseAdmin
      .from('therapai_clinical_lines')
      .select('slug')
      .eq('slug', lens)
      .eq('status', 'active')
      .maybeSingle()
    if (!lensRow) return NextResponse.json({ error: 'invalid_clinical_lens' }, { status: 400 })
    updates.clinical_lens = lens
  }

  if (typeof body.ingest_source === 'string') {
    const src = body.ingest_source.toLowerCase()
    if (!VALID_INGEST.has(src)) return NextResponse.json({ error: 'invalid_ingest_source' }, { status: 400 })
    updates.ingest_source = src
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 400 })
  }

  // RLS scopes UPDATE to id = auth.uid(); explicit eq() defends in depth.
  const { error } = await supabase
    .from('therapai_therapists')
    .update(updates)
    .eq('id', user.id)

  if (error) {
    console.error('[settings] update failed', { user_id: user.id, err: error.message })
    return NextResponse.json({ error: 'update_failed', message: error.message }, { status: 500 })
  }

  audit(supabase, user.id, {
    action: 'updated_settings',
    target_table: 'therapai_therapists',
    target_row_id: user.id,
    context: { fields: Object.keys(updates) },
    ip: extractClientIp(request.headers),
    user_agent: request.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true, updated: Object.keys(updates) })
}
