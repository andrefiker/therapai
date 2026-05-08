import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnon

export const supabase = createClient(supabaseUrl, supabaseAnon)

// Server-side client — uses service role when available, falls back to anon
export const supabaseAdmin = createClient(supabaseUrl, supabaseService)

export const THERAPIST_ID = 'a0000000-0000-0000-0000-000000000001'
