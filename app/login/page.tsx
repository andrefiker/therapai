'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/api/auth/callback` }
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-sm shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <div>
            <div className="font-bold text-slate-900 text-lg">TherapAI</div>
            <div className="text-xs text-slate-400">Análise clínica automatizada</div>
          </div>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="text-4xl mb-4">📬</div>
            <h2 className="font-semibold text-slate-900 mb-2">Verifique seu email</h2>
            <p className="text-sm text-slate-500">
              Enviamos um link de acesso para <strong>{email}</strong>.
              Clique no link para entrar.
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-semibold text-slate-900 mb-1">Entrar</h2>
            <p className="text-sm text-slate-400 mb-6">
              Receba um link mágico no seu email
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {error && <p className="text-red-500 text-xs">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {loading ? 'Enviando...' : 'Enviar link de acesso'}
              </button>
            </form>
            <p className="text-xs text-slate-400 mt-6 text-center">
              Sem senha. Acesso seguro por email.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
