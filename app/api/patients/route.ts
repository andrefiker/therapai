// app/api/patients/route.ts
//
// POST /api/patients — manual patient creation by an authenticated tenant.
// RLS scopes the INSERT to therapist_id = auth.uid(). Returns the new id.
//
// Notes: this is the manual entry path. Patients also get created
// automatically by the Fireflies/Recall webhook when title-derived names
// match no existing patient (D9). Both paths converge on the same table.

import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase'
import { getTherapist } from '@/lib/viewer'
import { audit, extractClientIp } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const therapist = await getTherapist(supabase, user)
  if (!therapist) return NextResponse.json({ error: 'tenant_not_provisioned' }, { status: 403 })

  let body: { name?: string; notes?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }

  const name = (body.name ?? '').trim().slice(0, 200)
  if (name.length < 2) {
    return NextResponse.json({ error: 'invalid_name', message: 'Nome precisa ter ao menos 2 caracteres.' }, { status: 400 })
  }
  const notes = (body.notes ?? '').toString().slice(0, 2000) || null

  const { data, error } = await supabase
    .from('therapai_patients')
    .insert({ therapist_id: therapist.id, name, notes })
    .select('id')
    .single()

  if (error || !data) {
    console.error('[patients] insert failed', { user_id: user.id, err: error?.message })
    return NextResponse.json({ error: 'insert_failed', message: error?.message }, { status: 500 })
  }

  audit(supabase, user.id, {
    action: 'created_patient',
    target_table: 'therapai_patients',
    target_row_id: data.id,
    context: { name_length: name.length, has_notes: !!notes },
    ip: extractClientIp(request.headers),
    user_agent: request.headers.get('user-agent'),
  })

  return NextResponse.json({ ok: true, id: data.id })
}
