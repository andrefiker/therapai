import { createSupabaseServer } from '@/lib/supabase'
import { SupabaseClient } from '@supabase/supabase-js'
import Link from 'next/link'

export const revalidate = 0
export const dynamic = 'force-dynamic'

// Post-D20 RLS migration: queries run via the authenticated server client.
// RLS policies (therapist_id = auth.uid()) filter automatically — no app-layer
// .eq('therapist_id', X) needed. Middleware redirects unauthenticated requests
// to /login before this page renders.

async function getStats(supabase: SupabaseClient) {
  const [patients, sessions, analyses] = await Promise.all([
    supabase.from('therapai_patients').select('id', { count: 'exact', head: true }),
    supabase.from('therapai_sessions').select('id', { count: 'exact', head: true }),
    supabase.from('therapai_analyses').select('id', { count: 'exact', head: true }),
  ])
  return { patients: patients.count ?? 0, sessions: sessions.count ?? 0, analyses: analyses.count ?? 0 }
}

async function getPatients(supabase: SupabaseClient) {
  const { data } = await supabase
    .from('therapai_patients')
    .select(`id, name, therapai_sessions(id, session_date, status), therapai_longitudinal(sessions_count, period_start, period_end)`)
    .order('name')
  return data ?? []
}

export default async function HomePage() {
  const supabase = await createSupabaseServer()
  const [stats, patients] = await Promise.all([getStats(supabase), getPatients(supabase)])

  const withLongitudinal = patients.filter((p: any) => p.therapai_longitudinal?.length > 0)
  const pending = patients.filter((p: any) => !p.therapai_longitudinal?.length)

  return (
    <div>
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
