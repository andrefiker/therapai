'use client'

import { useState } from 'react'

interface LongitudinalRow {
  report_md: string | null
  sessions_count: number | null
  period_start: string | null
  period_end: string | null
  updated_at?: string | null
}

interface RebuildResponse {
  ok: boolean
  patient_name?: string
  longitudinal?: LongitudinalRow | null
  rebuilt_at?: string
  error?: string
  message?: string
}

function renderInlineMd(md: string): string {
  return md
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-slate-900 mt-6 mb-2">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-slate-800 mt-5 mb-2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-slate-700 mt-4 mb-1">$1</h3>')
    .replace(/^(\d+)\. \*\*(.+?)\*\*/gm, '<h3 class="text-base font-semibold text-slate-800 mt-5 mb-1">$1. $2</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-700 list-disc">$1</li>')
    .replace(/^---$/gm, '<hr class="border-slate-200 my-4">')
    .replace(/\n\n/g, '<br/><br/>')
}

export function LongitudinalButton({
  patientId,
  initialLongitudinal,
  readOnly = false,
}: {
  patientId: string
  initialLongitudinal: LongitudinalRow | null
  readOnly?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [longitudinal, setLongitudinal] = useState<LongitudinalRow | null>(initialLongitudinal)
  const [lastRebuiltAt, setLastRebuiltAt] = useState<string | null>(initialLongitudinal?.updated_at ?? null)
  const [error, setError] = useState<string | null>(null)

  async function rebuild() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/patient/${patientId}/longitudinal`, { method: 'POST' })
      const json = (await res.json()) as RebuildResponse
      if (!res.ok || !json.ok) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else {
        if (json.longitudinal) setLongitudinal(json.longitudinal)
        setLastRebuiltAt(json.rebuilt_at ?? new Date().toISOString())
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const hasReport = !!longitudinal?.report_md

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Relatório Longitudinal</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {hasReport
              ? `${longitudinal?.sessions_count ?? '?'} sessões · ${longitudinal?.period_start ?? '?'} → ${longitudinal?.period_end ?? '?'}`
              : 'Não gerado ainda. Clique no botão para criar a partir das análises de sessão.'}
            {lastRebuiltAt && hasReport && ` · atualizado em ${lastRebuiltAt.slice(0, 16).replace('T', ' ')}`}
          </p>
        </div>
        {readOnly ? (
          <span className="text-xs text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
            Modo demonstração — somente leitura
          </span>
        ) : (
          <button
            onClick={rebuild}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Gerando…' : hasReport ? 'Atualizar longitudinal' : 'Gerar longitudinal'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          {error}
        </div>
      )}

      {hasReport && longitudinal?.report_md && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div
            className="text-slate-700 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInlineMd(longitudinal.report_md) }}
          />
        </div>
      )}
    </div>
  )
}
