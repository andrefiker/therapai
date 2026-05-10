'use client'

import { useState } from 'react'

interface BriefingResponse {
  ok: boolean
  briefing?: string
  patient_name?: string
  sessions_used?: number
  has_longitudinal?: boolean
  model_used?: string
  generated_at?: string
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

export function BriefingButton({ patientId }: { patientId: string }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BriefingResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/briefing/${patientId}`, { method: 'POST' })
      const json = await res.json() as BriefingResponse
      if (!res.ok && !json.ok) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else if (!json.ok) {
        // 200 with ok=false (refusal: insufficient material, etc.)
        setError(json.message ?? 'Briefing recusado.')
      } else {
        setResult(json)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Briefing pré-sessão</h2>
          <p className="text-xs text-slate-500 mt-0.5">Síntese de 8 seções a partir das últimas análises + relatório longitudinal.</p>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Gerando…' : (result ? 'Gerar novamente' : 'Preparar próxima sessão')}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          {error}
        </div>
      )}

      {result && result.ok && result.briefing && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="text-xs text-slate-400 mb-3">
            Modelo: {result.model_used} · {result.sessions_used} sessão{result.sessions_used !== 1 ? 'es' : ''} {result.has_longitudinal ? '+ longitudinal' : 'sem longitudinal'} · {result.generated_at?.slice(0, 16)}
          </div>
          <div
            className="text-slate-700 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInlineMd(result.briefing) }}
          />
        </div>
      )}
    </div>
  )
}
