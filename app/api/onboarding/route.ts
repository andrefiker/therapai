import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fireflies_api_key } = await request.json()

  // Validate key with a quick Fireflies API call
  try {
    const res = await fetch('https://api.fireflies.ai/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fireflies_api_key}` },
      body: JSON.stringify({ query: '{ transcripts(limit: 1) { id } }' }),
    })
    if (!res.ok) throw new Error('Invalid key')
    const data = await res.json()
    if (data.errors) throw new Error('Invalid key')
  } catch {
    return NextResponse.json({ error: 'Chave do Fireflies inválida. Verifique e tente novamente.' }, { status: 400 })
  }

  // Save to therapist record
  const { error } = await supabaseAdmin
    .from('therapai_therapists')
    .update({ fireflies_api_key })
    .eq('auth_user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
