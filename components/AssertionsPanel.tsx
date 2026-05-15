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

interface SessionMeta {
  session_number: number | null
  session_date: string | null
}

interface MemoryResponse {
  ok: boolean
  patient_id: string
  patient_name: string
  confirmed: ConfirmedRow[]
  pending: PendingRow[]
  sessions_index?: Record<string, SessionMeta>
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

const DIMENSION_ORDER = [
  'risk_factor',
  'medication',
  'diagnosis_cid',
  'complaint',
  'behavioral_theme',
  'alliance_event',
  'relational_frame',
  'intervention',
  'historical_event',
]

function dimLabel(d: string): string { return DIMENSION_LABELS[d] ?? d }

function sessionChip(meta: SessionMeta | undefined): string {
  if (!meta) return ''
  const n = meta.session_number !== null ? `#${meta.session_number}` : null
  const d = meta.session_date ? meta.session_date.slice(0, 10) : null
  return [n, d].filter(Boolean).join(' · ')
}

function dimSortKey(d: string): number {
  const i = DIMENSION_ORDER.indexOf(d)
  return i === -1 ? DIMENSION_ORDER.length : i
}

export function AssertionsPanel({ patientId, readOnly = false }: { patientId: string; readOnly?: boolean }) {
  const [data, setData] = useState<MemoryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [actingIds, setActingIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  function markActing(ids: string[], on: boolean) {
    setActingIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })
  }

  async function act(assertionId: string, action: 'confirm' | 'dismiss') {
    markActing([assertionId], true)
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
      markActing([assertionId], false)
    }
  }

  async function bulk(ids: string[], action: 'confirm' | 'dismiss', _label: string) {
    if (ids.length === 0) return
    markActing(ids, true)
    try {
      const res = await fetch('/api/assertions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
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
      markActing(ids, false)
    }
  }

  function toggleCollapsed(dim: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(dim)) next.delete(dim); else next.add(dim)
      return next
    })
  }

  if (loading) {
    return <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 text-sm text-slate-400">Carregando memória do paciente…</div>
  }

  if (!data) {
    return null
  }

  const { confirmed, pending } = data
  const sessionsIndex = data.sessions_index ?? {}

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

  const confirmedByDim = new Map<string, ConfirmedRow[]>()
  for (const c of confirmed) {
    const list = confirmedByDim.get(c.dimension) ?? []
    list.push(c)
    confirmedByDim.set(c.dimension, list)
  }
  const confirmedDimsSorted = [...confirmedByDim.entries()].sort((a, b) => dimSortKey(a[0]) - dimSortKey(b[0]))

  const pendingByDim = new Map<string, PendingRow[]>()
  for (const p of pending) {
    const list = pendingByDim.get(p.dimension) ?? []
    list.push(p)
    pendingByDim.set(p.dimension, list)
  }
  const pendingDimsSorted = [...pendingByDim.entries()].sort((a, b) => dimSortKey(a[0]) - dimSortKey(b[0]))

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
            {confirmedDimsSorted.map(([dim, rows]) => (
              <div key={dim} className="border-l-2 border-green-200 pl-3">
                <div className="text-xs font-semibold text-green-700 mb-1">{dimLabel(dim)} ({rows.length})</div>
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
          <div className="space-y-3">
            {pendingDimsSorted.map(([dim, rows]) => {
              const isCollapsed = collapsed.has(dim)
              const dimIds = rows.map((r) => r.id)
              const dimActing = dimIds.some((id) => actingIds.has(id))
              return (
                <div key={dim} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-slate-50 px-3 py-2 border-b border-slate-200">
                    <button
                      onClick={() => toggleCollapsed(dim)}
                      className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
                    >
                      <span className="text-slate-400 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                      {dimLabel(dim)} <span className="text-xs text-slate-400 font-normal">({rows.length})</span>
                    </button>
                    {!readOnly && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => bulk(dimIds, 'confirm', dimLabel(dim))}
                          disabled={dimActing}
                          className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800 border border-green-200 hover:bg-green-200 disabled:opacity-50"
                          title={`Confirmar todos os ${rows.length}`}
                        >
                          {dimActing ? '…' : `Confirmar todos`}
                        </button>
                        <button
                          onClick={() => bulk(dimIds, 'dismiss', dimLabel(dim))}
                          disabled={dimActing}
                          className="px-2 py-1 text-xs font-medium rounded bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50"
                          title={`Descartar todos os ${rows.length}`}
                        >
                          {dimActing ? '…' : `Descartar todos`}
                        </button>
                      </div>
                    )}
                  </div>

                  {!isCollapsed && (
                    <div className="divide-y divide-slate-100">
                      {rows.map((p) => {
                        const acting = actingIds.has(p.id)
                        const meta = p.source_session_id ? sessionsIndex[p.source_session_id] : undefined
                        const chip = sessionChip(meta)
                        return (
                          <div key={p.id} className="p-3 hover:bg-slate-50">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-slate-400 mb-1 flex flex-wrap gap-x-2 gap-y-1">
                                  {p.sub_key && <span>{p.sub_key}</span>}
                                  {chip && (
                                    <span className="text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                      Sessão {chip}
                                    </span>
                                  )}
                                  <span className="text-slate-400">{p.source_kind}</span>
                                </div>
                                <div className="text-sm text-slate-800">{p.assertion_text}</div>
                              </div>
                              {!readOnly && (
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
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
