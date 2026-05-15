'use client'

import { useState } from 'react'

interface RelatoResponse {
  ok: boolean
  relato?: string
  patient_initials?: string
  sessions_used?: number
  has_longitudinal?: boolean
  medications_count?: number
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

export function RelatoButton({ patientId, readOnly = false }: { patientId: string; readOnly?: boolean }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RelatoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/patient/${patientId}/relato`, { method: 'POST' })
      const json = (await res.json()) as RelatoResponse
      if (!res.ok && !json.ok) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else if (!json.ok) {
        setError(json.message ?? 'Relato recusado.')
      } else {
        setResult(json)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function copyToClipboard() {
    if (!result?.relato) return
    navigator.clipboard.writeText(result.relato)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Relato psicológico de caso</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Documento completo no padrão CFP Res. 06/2019 — para transferência de paciente a outro(a) psicólogo(a). Iniciais do paciente, sem dados identificadores.
          </p>
        </div>
        {readOnly ? (
          <span className="text-xs text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-full">
            Modo demonstração — somente leitura
          </span>
        ) : (
          <button
            onClick={generate}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Gerando…' : result ? 'Gerar novamente' : 'Gerar relato de caso'}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
          {error}
        </div>
      )}

      {result?.ok && result.relato && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-slate-400">
              {result.patient_initials} · {result.sessions_used} sessão{result.sessions_used !== 1 ? 'es' : ''}
              {result.has_longitudinal ? ' + longitudinal' : ''}
              {typeof result.medications_count === 'number' && result.medications_count > 0
                ? ` · ${result.medications_count} medicaç${result.medications_count !== 1 ? 'ões' : 'ão'}`
                : ''}
              {' · '}
              {result.model_used} · {result.generated_at?.slice(0, 16).replace('T', ' ')}
            </div>
            <button
              onClick={copyToClipboard}
              className="text-xs text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 px-2.5 py-1 rounded-md transition-colors"
            >
              Copiar markdown
            </button>
          </div>
          <div
            className="text-slate-700 text-sm leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderInlineMd(result.relato) }}
          />
        </div>
      )}
    </div>
  )
}
