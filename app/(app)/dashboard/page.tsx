import { createSupabaseServer } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import Link from 'next/link'

export const revalidate = 0
export const dynamic = 'force-dynamic'

// Multi-tenant pure: RLS scopes every query to therapist_id = auth.uid().
// No demo branching here — the synthetic Dra. Demo tenant is served separately
// at /demo/* via supabaseAdmin (see app/(demo)/).

export default async function HomePage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  // Layout already gated this route on a therapai_therapists row existing.

  const mk = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true })
  const [patientsCount, sessionsCount, analysesCount, patients] = await Promise.all([
    mk('therapai_patients'),
    mk('therapai_sessions'),
    mk('therapai_analyses'),
    supabase
      .from('therapai_patients')
      .select(`id, name, therapai_sessions(id, session_date, status), therapai_longitudinal(sessions_count, period_start, period_end)`)
      .order('name'),
  ])

  const stats = {
    patients: patientsCount.count ?? 0,
    sessions: sessionsCount.count ?? 0,
    analyses: analysesCount.count ?? 0,
  }
  const patientList = patients.data ?? []

  if (user) {
    audit(supabase, user.id, {
      action: 'viewed_dashboard',
      context: { patient_count: stats.patients, session_count: stats.sessions },
    })
  }

  const withLongitudinal = patientList.filter((p: any) => p.therapai_longitudinal?.length > 0)
  const pending = patientList.filter((p: any) => !p.therapai_longitudinal?.length)

  return (
    <div>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Seus pacientes</h1>
          <p className="text-sm text-slate-500">Resumo da sua prática clínica monitorada pela IA.</p>
        </div>
        <Link
          href="/patients/new"
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          + Novo paciente
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label: 'Pacientes', value: stats.patients },
          { label: 'Sessões', value: stats.sessions },
          { label: 'Análises', value: stats.analyses },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="text-3xl font-bold text-slate-900">{s.value}</div>
            <div className="text-sm text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {stats.patients === 0 && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-6 mb-8">
          <h2 className="font-semibold text-slate-900 mb-1">Nenhum paciente ainda.</h2>
          <p className="text-sm text-slate-600 mb-3">
            Quando você gravar a primeira sessão via Fireflies ou Recall.ai
            (vinculado ao seu email <strong>{user?.email}</strong>), ela entra
            automaticamente aqui. Você pode também testar a interface no
            ambiente de demonstração:
          </p>
          <Link href="/demo" className="inline-block text-sm text-indigo-700 hover:text-indigo-800 font-medium underline">
            Ver demo com dados sintéticos →
          </Link>
        </div>
      )}

      {withLongitudinal.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            Relatório longitudinal
            <span className="ml-2 text-sm font-normal text-slate-400">({withLongitudinal.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {withLongitudinal.map((p: any) => {
              const long = p.therapai_longitudinal?.[0]
              const sessions = p.therapai_sessions ?? []
              const done = sessions.filter((s: any) => s.status === 'done').length
              return (
                <Link key={p.id} href={`/patients/${p.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
                      {p.name.charAt(0)}
                    </div>
                    <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">Longitudinal</span>
                  </div>
                  <div className="font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">{p.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{sessions.length} sess. · {done} analisadas</div>
                  {long && <div className="text-xs text-slate-400">{long.period_start} → {long.period_end}</div>}
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 mb-3">
            Aguardando análise
            <span className="ml-2 text-sm font-normal text-slate-400">({pending.length})</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {pending.map((p: any) => (
              <Link key={p.id} href={`/patients/${p.id}`}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-slate-300 transition-all group">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-semibold text-sm mb-3">
                  {p.name.charAt(0)}
                </div>
                <div className="font-medium text-slate-700 group-hover:text-slate-900 text-sm">{p.name}</div>
                <div className="text-xs text-slate-400 mt-1">{(p.therapai_sessions ?? []).length} sess.</div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
