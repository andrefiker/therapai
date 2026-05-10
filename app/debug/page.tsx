import { createSupabaseServer } from '@/lib/supabase'

export const revalidate = 0

// Post-D20 RLS migration: this page now probes what the *currently authenticated user* sees
// via the RLS-filtered server client. If RLS policies are correct, an authenticated therapist
// sees their own row + their patients; an attacker without auth sees nothing.

export default async function DebugPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  // Test 1: my therapist row (RLS: id = auth.uid())
  const { data: therapist, error: e1 } = await supabase
    .from('therapai_therapists')
    .select('*')
    .limit(1)
    .single()

  // Test 2: my patients (RLS: therapist_id = auth.uid()) — no app-layer eq needed
  const { data: patients, error: e2, count } = await supabase
    .from('therapai_patients')
    .select('id, name, therapist_id', { count: 'exact' })
    .limit(5)

  // Test 3: a specific patient by id (RLS still gates; eq('id', x) is just disambiguation)
  const firstPatient = patients?.[0]
  const { data: patientById, error: e3 } = firstPatient ? await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', firstPatient.id)
    .single() : { data: null, error: 'no patients' }

  return (
    <div className="font-mono text-sm space-y-6">
      <h1 className="text-xl font-bold">Debug (RLS-aware)</h1>

      <section>
        <h2 className="font-bold mb-2">Authenticated user</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {JSON.stringify({ id: user?.id ?? null, email: user?.email ?? null }, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">My therapist row (RLS: id = auth.uid())</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {e1 ? `ERROR: ${JSON.stringify(e1)}` : JSON.stringify(therapist, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">My patients (first 5, total: {count}) — RLS-filtered</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {e2 ? `ERROR: ${JSON.stringify(e2)}` : JSON.stringify(patients, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">Patient by id (RLS gates; eq is disambiguation)</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {typeof e3 === 'string' ? e3 : e3 ? `ERROR: ${JSON.stringify(e3)}` : JSON.stringify(patientById, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">ENV vars present</h2>
        <pre className="bg-slate-100 p-3 rounded">
          NEXT_PUBLIC_SUPABASE_URL: {process.env.NEXT_PUBLIC_SUPABASE_URL ? 'YES' : 'MISSING'}{'\n'}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: {process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'YES' : 'MISSING'}{'\n'}
          SUPABASE_SERVICE_ROLE_KEY: {process.env.SUPABASE_SERVICE_ROLE_KEY ? 'YES' : 'MISSING'}
        </pre>
      </section>
    </div>
  )
}
