'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function OnboardingPage() {
  const [fireliesKey, setFirefliesKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fireflies_api_key: fireliesKey }),
    })

    if (res.ok) {
      router.push('/')
    } else {
      const data = await res.json()
      setError(data.error || 'Erro ao salvar configuração')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-md shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <div>
            <div className="font-bold text-slate-900 text-lg">TherapAI</div>
            <div className="text-xs text-slate-400">Configuração inicial</div>
          </div>
        </div>

        <h2 className="font-semibold text-slate-900 text-lg mb-1">Bem-vindo!</h2>
        <p className="text-sm text-slate-400 mb-6">
          Conecte sua conta do Fireflies para começar a importar transcrições automaticamente.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Fireflies API Key
            </label>
            <input
              type="text"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={fireliesKey}
              onChange={e => setFirefliesKey(e.target.value)}
              required
              className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-slate-400 mt-1.5">
              Encontre em{' '}
              <a href="https://app.fireflies.ai/integrations/custom/fireflies"
                target="_blank" rel="noopener"
                className="text-indigo-600 hover:underline">
                app.fireflies.ai → Integrations → Developer
              </a>
            </p>
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Salvando...' : 'Conectar e começar'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-6 text-center">
          Pode pular por agora e configurar depois em Configurações.
        </p>
        <button
          onClick={() => router.push('/')}
          className="w-full text-center text-xs text-slate-400 hover:text-slate-600 mt-2"
        >
          Pular →
        </button>
      </div>
    </div>
  )
}
