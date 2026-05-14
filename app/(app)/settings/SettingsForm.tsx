'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Line = { slug: string; name_pt: string }

export function SettingsForm({
  initialName,
  initialLens,
  initialIngestSource,
  lines,
}: {
  initialName: string
  initialLens: string | null
  initialIngestSource: string
  lines: Line[]
}) {
  const router = useRouter()
  const [name, setName] = useState(initialName)
  const [lens, setLens] = useState(initialLens ?? lines[0]?.slug ?? 'radical_behaviorism')
  const [ingestSource, setIngestSource] = useState<'fireflies' | 'recall'>(initialIngestSource === 'recall' ? 'recall' : 'fireflies')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  const dirty =
    name !== initialName ||
    lens !== (initialLens ?? lines[0]?.slug) ||
    ingestSource !== initialIngestSource

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setFeedback(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clinical_lens: lens, ingest_source: ingestSource }),
    })
    if (res.ok) {
      setFeedback({ kind: 'ok', msg: 'Salvo.' })
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setFeedback({ kind: 'err', msg: data.message ?? data.error ?? 'Erro ao salvar.' })
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Nome profissional</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Linha teórica primária</label>
        <select
          value={lens}
          onChange={e => setLens(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          {lines.map(l => (
            <option key={l.slug} value={l.slug}>{l.name_pt}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400 mt-1">
          Define o vocabulário e o conjunto de construtos que a IA aplica nas análises.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Fonte de ingestão de sessões</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setIngestSource('fireflies')}
            className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
              ingestSource === 'fireflies'
                ? 'border-indigo-500 bg-indigo-50 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="font-medium">Fireflies</div>
            <div className="text-xs text-slate-400">Em produção</div>
          </button>
          <button
            type="button"
            onClick={() => setIngestSource('recall')}
            className={`text-left rounded-lg border px-3 py-2 text-sm transition-colors ${
              ingestSource === 'recall'
                ? 'border-indigo-500 bg-indigo-50 text-slate-900'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <div className="font-medium">Recall.ai</div>
            <div className="text-xs text-slate-400">Em onboarding</div>
          </button>
        </div>
      </div>

      {feedback && (
        <p className={`text-sm ${feedback.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{feedback.msg}</p>
      )}

      <button
        type="submit"
        disabled={loading || !dirty || !name}
        className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {loading ? 'Salvando...' : dirty ? 'Salvar' : 'Sem alterações'}
      </button>
    </form>
  )
}
