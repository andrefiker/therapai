'use client'

import { useState, FormEvent } from 'react'

interface SourceRef {
  kind: 'longitudinal' | 'molar' | 'molecular' | 'assertion_confirmed' | 'assertion_pending'
  session_id?: string
  session_number?: number | null
  assertion_id?: string
  dimension?: string
  description: string
}

interface ChatResponse {
  ok: boolean
  answer_md?: string
  model_used?: string
  patient_name?: string
  sources_provided?: SourceRef[]
  context_size?: {
    longitudinal: boolean
    molar_recent: number
    molecular_recent: number
    confirmed_assertions: number
    pending_assertions: number
  }
  generated_at?: string
  error?: string
  message?: string
}

interface QAEntry {
  question: string
  response: ChatResponse
  asked_at: string
}

function renderInlineMd(md: string): string {
  return md
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold text-slate-800 mt-4 mb-2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold text-slate-700 mt-3 mb-1">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]/g, '<span class="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded mx-0.5">[$1]</span>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-700 list-disc">$1</li>')
    .replace(/\n\n/g, '<br/><br/>')
}

export function CaseChat({ patientId }: { patientId: string }) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<QAEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/patient/${patientId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const json = await res.json() as ChatResponse
      if (!res.ok || (!json.ok && !json.answer_md)) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
      } else {
        setHistory((h) => [{ question: q, response: json, asked_at: new Date().toISOString() }, ...h])
        setQuestion('')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">Conversar com o caso</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Pergunte qualquer coisa sobre este paciente. Respostas ancoradas nas análises e relatório longitudinal,
          com citações inline. Se o material fornecido não sustentar a resposta, o sistema recusa.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mb-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ex: Quais padrões de evitação experiencial apareceram nas últimas 5 sessões?"
          rows={3}
          maxLength={2000}
          disabled={loading}
          className="w-full border border-slate-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-400">{question.length} / 2000</span>
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Pensando…' : 'Perguntar'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-6 border-t border-slate-100 pt-4">
          {history.map((entry, idx) => (
            <div key={idx}>
              <div className="text-xs text-slate-400 mb-1">
                {entry.asked_at.slice(0, 16)} · {entry.response.model_used}
                {entry.response.context_size && (
                  <span className="ml-2">
                    · {entry.response.context_size.molar_recent} molar
                    {entry.response.context_size.molecular_recent > 0 && ` + ${entry.response.context_size.molecular_recent} molecular`}
                    {entry.response.context_size.longitudinal && ' + longitudinal'}
                    {entry.response.context_size.confirmed_assertions > 0 && ` + ${entry.response.context_size.confirmed_assertions} confirmada`}
                    {entry.response.context_size.pending_assertions > 0 && ` + ${entry.response.context_size.pending_assertions} pendente`}
                  </span>
                )}
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-2 text-sm text-slate-700">
                <span className="font-medium text-slate-500 mr-2">Q:</span>{entry.question}
              </div>
              {entry.response.answer_md ? (
                <div
                  className="text-sm text-slate-800 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderInlineMd(entry.response.answer_md) }}
                />
              ) : (
                <div className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {entry.response.message ?? entry.response.error ?? 'Sem resposta'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
