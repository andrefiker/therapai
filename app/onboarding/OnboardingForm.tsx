'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Line = { slug: string; name_pt: string }

export function OnboardingForm({ defaultEmail, lines }: { defaultEmail: string; lines: Line[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [crp, setCrp] = useState('')
  const [clinicalLens, setClinicalLens] = useState(lines[0]?.slug ?? 'radical_behaviorism')
  const [ingestSource, setIngestSource] = useState<'fireflies' | 'recall'>('fireflies')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, crp, clinical_lens: clinicalLens, ingest_source: ingestSource }),
    })

    if (res.ok) {
      router.push('/dashboard')
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Erro ao salvar configuração')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
        <input
          type="email"
          value={defaultEmail}
          disabled
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-600"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Nome profissional</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          minLength={2}
          maxLength={120}
          placeholder="Como você assina seu prontuário"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">CRP (opcional)</label>
        <input
          type="text"
          value={crp}
          onChange={e => setCrp(e.target.value)}
          placeholder="06/115147"
          maxLength={32}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Linha teórica primária</label>
        <select
          value={clinicalLens}
          onChange={e => setClinicalLens(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        >
          {lines.map(l => (
            <option key={l.slug} value={l.slug}>{l.name_pt}</option>
          ))}
        </select>
        <p className="text-xs text-slate-400 mt-1">
          Define a linguagem clínica e o conjunto de construtos que a IA aplica nas suas análises.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Fonte de ingestão</label>
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

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        type="submit"
        disabled={loading || !name}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {loading ? 'Provisionando...' : 'Criar minha área de trabalho'}
      </button>
    </form>
  )
}
