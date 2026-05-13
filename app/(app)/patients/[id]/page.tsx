import { createSupabaseServer } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { BriefingButton } from '@/components/BriefingButton'
import { AssertionsPanel } from '@/components/AssertionsPanel'
import { CaseChat } from '@/components/CaseChat'
import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'

export const revalidate = 0
export const dynamic = 'force-dynamic'

// Multi-tenant pure: RLS scopes to therapist_id = auth.uid().
async function getPatient(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from('therapai_patients')
    .select(`
      id, name, notes, created_at,
      therapai_sessions (
        id, session_date, status,
        therapai_analyses (id, analysis_md, session_number),
        therapai_molecular_analyses (id, molecular_md, events_count)
      ),
      therapai_longitudinal (
        id, report_md, sessions_count, period_start, period_end, updated_at
      )
    `)
    .eq('id', id)
    .limit(1)
  if (error || !data || data.length === 0) return null
  return data[0]
}

function MarkdownViewer({ md }: { md: string }) {
  const html = md
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 mt-6 mb-2">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-slate-800 mt-5 mb-2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-700 mt-4 mb-1">$1</h3>')
    .replace(/^#### (.+)$/gm, '<h4 class="text-sm font-semibold text-slate-600 mt-3 mb-1">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-700 list-disc">$1</li>')
    .replace(/^---$/gm, '<hr class="border-slate-200 my-4">')
    .replace(/\n\n/g, '<br/><br/>')
  return (
    <div
      className="text-slate-700 text-sm leading-relaxed"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  const patient = await getPatient(supabase, id)

  if (!patient) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Paciente não encontrado.</p>
        <Link href="/" className="text-indigo-600 text-sm mt-4 inline-block">← Voltar</Link>
      </div>
    )
  }

  if (user) {
    audit(supabase, user.id, {
      action: 'viewed_patient',
      target_table: 'therapai_patients',
      target_row_id: patient.id,
      context: {
        sessions_count: (patient.therapai_sessions ?? []).length,
        has_longitudinal: (patient.therapai_longitudinal ?? []).length > 0,
      },
    })
  }

  const sessions = [...(patient.therapai_sessions ?? [])].sort(
    (a: any, b: any) => new Date(b.session_date).getTime() - new Date(a.session_date).getTime()
  )
  const longitudinal = (patient.therapai_longitudinal ?? [])[0]
  const analysedCount = sessions.filter((s: any) => s.therapai_analyses?.length > 0).length

  return (
    <div>
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-400 hover:text-slate-600 mb-3 inline-block">
          ← Todos os pacientes
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">
            {patient.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{patient.name}</h1>
            <p className="text-sm text-slate-400">
              {sessions.length} sessões · {analysedCount} analisadas
              {longitudinal && ` · ${longitudinal.period_start} → ${longitudinal.period_end}`}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Sessões</h2>
          <div className="space-y-2">
            {sessions.map((s: any) => {
              const hasAnalysis = s.therapai_analyses?.length > 0
              return (
                <div key={s.id} className={`rounded-lg border p-3 ${hasAnalysis ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">{s.session_date}</span>
                    {hasAnalysis
                      ? <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">Analisada</span>
                      : <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Pendente</span>
                    }
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          <CaseChat patientId={patient.id} readOnly={false} />
          <AssertionsPanel patientId={patient.id} readOnly={false} />
          <BriefingButton patientId={patient.id} readOnly={false} />

          {longitudinal && (
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-slate-900">Relatório Longitudinal</h2>
                <span className="text-xs text-slate-400">
                  {longitudinal.sessions_count} sessões · {longitudinal.period_start} → {longitudinal.period_end}
                </span>
              </div>
              <MarkdownViewer md={longitudinal.report_md ?? ''} />
            </div>
          )}

          {sessions.filter((s: any) => s.therapai_analyses?.length > 0).map((s: any) => {
            const molecular = s.therapai_molecular_analyses?.[0]
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-base font-semibold text-slate-900 mb-4">
                  Análise — {s.session_date}
                  <span className="ml-2 text-xs text-slate-400 font-normal">
                    Sessão nº {s.therapai_analyses[0].session_number}
                  </span>
                  {molecular && (
                    <span className="ml-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                      + molecular ({molecular.events_count ?? '?'} eventos)
                    </span>
                  )}
                </h2>
                <div>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Molar (síntese)</h3>
                  <MarkdownViewer md={s.therapai_analyses[0].analysis_md ?? ''} />
                </div>
                {molecular && (
                  <div className="mt-6 pt-6 border-t border-slate-100">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      Molecular ({molecular.events_count ?? '?'} eventos discretos)
                    </h3>
                    <MarkdownViewer md={molecular.molecular_md ?? ''} />
                  </div>
                )}
              </div>
            )
          })}

          {!longitudinal && analysedCount === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
              <div className="text-slate-400 text-sm">Nenhuma análise disponível ainda.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
