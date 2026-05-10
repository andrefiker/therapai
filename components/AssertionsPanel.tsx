'use client'

import { useEffect, useState } from 'react'

interface ConfirmedRow {
  dimension: string
  sub_key: string | null
  assertion_text: string
  structured_value: unknown
  source_session_id: string | null
  confirmed_at: string | null
}

interface PendingRow {
  id: string
  dimension: string
  sub_key: string | null
  assertion_text: string
  structured_value: unknown
  source_session_id: string | null
  source_kind: string
  model_emitted: string | null
  confidence: number | null
  created_at: string
}

interface MemoryResponse {
  ok: boolean
  patient_id: string
  patient_name: string
  confirmed: ConfirmedRow[]
  pending: PendingRow[]
}

const DIMENSION_LABELS: Record<string, string> = {
  complaint: 'Demanda / Queixa',
  diagnosis_cid: 'CID',
  medication: 'Medicação',
  risk_factor: 'Risco clínico',
  behavioral_theme: 'Tema comportamental',
  relational_frame: 'Frame relacional',
  alliance_event: 'Evento de aliança',
  historical_event: 'Histórico',
  intervention: 'Intervenção',
}

function dimLabel(d: string): string { return DIMENSION_LABELS[d] ?? d }

export function AssertionsPanel({ patientId }: { patientId: string }) {
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const res = await fetch(`/api/patient/${patientId}/memory`, { cache: 'no-store' })
      const json = await res.json() as MemoryResponse
      if (!res.ok) {
        setError((json as { message?: string }).message ?? `HTTP ${res.status}`)
        return
      }
      setData(json)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [patientId])

  async function act(assertionId: string, action: 'confirm' | 'dismiss') {
    setActingId(assertionId)
    try {
      const res = await fetch(`/api/assertions/${assertionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const err = await res.json() as { message?: string }
        setError(err.message ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setActingId(null)
    }
  }

  if (loading) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 text-sm text-slate-400">Carregando memória do paciente…</div>
  }

  if (!data) {
    return null
  }

  const { confirmed, pending } = data

  if (confirmed.length === 0 && pending.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-2">Memória clínica do paciente</h2>
        <p className="text-sm text-slate-500">
          Sem afirmações ainda. Novas sessões com prontuário-CFP estruturado (F1) gerarão automaticamente
          afirmações pendentes para revisão aqui.
        </p>
      </div>
    )
  }

  // Group confirmed by dimension for display
  const confirmedByDim = new Map<string, ConfirmedRow[]>()
  for (const c of confirmed) {
    const list = confirmedByDim.get(c.dimension) ?? []
    list.push(c)
    confirmedByDim.set(c.dimension, list)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Memória clínica do paciente</h2>
        {error && <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">{error}</span>}
      </div>

      {confirmed.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Estado confirmado ({confirmed.length})
          </h3>
          <div className="space-y-3">
            {[...confirmedByDim.entries()].map(([dim, rows]) => (
              <div key={dim} className="border-l-2 border-green-200 pl-3">
                <div className="text-xs font-semibold text-green-700 mb-1">{dimLabel(dim)}</div>
                <ul className="space-y-1">
                  {rows.map((r, i) => (
                    <li key={`${dim}-${r.sub_key ?? ''}-${i}`} className="text-sm text-slate-700">
                      {r.sub_key && <span className="text-xs text-slate-400 mr-1">[{r.sub_key}]</span>}
                      {r.assertion_text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Pendentes de revisão ({pending.length})
          </h3>
          <div className="space-y-2">
            {pending.map((p) => {
              const acting = actingId === p.id
              return (
                <div key={p.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-400 mb-1">
                        <span className="font-semibold text-slate-600">{dimLabel(p.dimension)}</span>
                        {p.sub_key && <span className="ml-1">· {p.sub_key}</span>}
                        <span className="ml-1">· {p.source_kind}</span>
                      </div>
                      <div className="text-sm text-slate-800">{p.assertion_text}</div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => act(p.id, 'confirm')}
                        disabled={acting}
                        className="px-3 py-1 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-200 hover:bg-green-200 disabled:opacity-50"
                      >
                        {acting ? '…' : 'Confirmar'}
                      </button>
                      <button
                        onClick={() => act(p.id, 'dismiss')}
                        disabled={acting}
                        className="px-3 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
                      >
                        {acting ? '…' : 'Descartar'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
