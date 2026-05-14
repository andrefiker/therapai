'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function NewPatientForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, notes }),
    })
    if (res.ok) {
      const data = (await res.json()) as { id: string }
      router.push(`/patients/${data.id}`)
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.message ?? data.error ?? 'Erro ao criar paciente.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Nome do paciente</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          required
          minLength={2}
          maxLength={200}
          placeholder="Ex.: Maria Silva"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Notas iniciais (opcional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Contexto inicial, encaminhamento, demanda inicial, qualquer coisa que te ajude a abrir o caso."
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading || !name}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {loading ? 'Criando...' : 'Criar paciente'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="border border-slate-200 text-slate-700 rounded-lg px-4 py-2 text-sm font-medium hover:border-slate-300"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
