import { supabaseAdmin, THERAPIST_ID } from '@/lib/supabase'

export const revalidate = 0

export default async function DebugPage() {
  // Test 1: basic connection
  const { data: therapist, error: e1 } = await supabaseAdmin
    .from('therapai_therapists')
    .select('*')
    .limit(1)
    .single()

  // Test 2: patients
  const { data: patients, error: e2, count } = await supabaseAdmin
    .from('therapai_patients')
    .select('id, name, therapist_id', { count: 'exact' })
    .limit(5)

  // Test 3: specific patient with therapist_id filter
  const firstPatient = patients?.[0]
  const { data: patientById, error: e3 } = firstPatient ? await supabaseAdmin
    .from('therapai_patients')
    .select('id, name')
    .eq('therapist_id', THERAPIST_ID)
    .eq('id', firstPatient.id)
    .single() : { data: null, error: 'no patients' }

  return (
    <div className="font-mono text-sm space-y-6">
      <h1 className="text-xl font-bold">Debug</h1>

      <section>
        <h2 className="font-bold mb-2">THERAPIST_ID constant</h2>
        <pre className="bg-slate-100 p-3 rounded">{THERAPIST_ID}</pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">Therapist row</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {e1 ? `ERROR: ${JSON.stringify(e1)}` : JSON.stringify(therapist, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">Patients (first 5, total: {count})</h2>
        <pre className="bg-slate-100 p-3 rounded overflow-auto">
          {e2 ? `ERROR: ${JSON.stringify(e2)}` : JSON.stringify(patients, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-bold mb-2">Patient by ID (therapist_id filter)</h2>
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
