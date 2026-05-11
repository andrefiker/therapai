'use client'

import { useState } from 'react'

export function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [crp, setCrp] = useState('')
  const [notes, setNotes] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    if (!consent) {
      setError('Você precisa aceitar os Termos de Uso, a Política de Privacidade e o DPA para entrar na lista.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), crp: crp.trim(), notes: notes.trim(), consent: true }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { message?: string }
        setError(json.message ?? `Erro HTTP ${res.status}`)
        return
      }
      setDone(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-2xl p-8 text-center">
        <div className="text-3xl mb-3">✓</div>
        <div className="font-semibold text-green-900 mb-1">Você está na lista.</div>
        <p className="text-sm text-green-800">
          Vamos te avisar quando abrir a próxima rodada de acesso. Enquanto isso,
          se quiser conversar diretamente sobre o produto, responda o email de
          confirmação.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-4 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nome" value={name} onChange={setName} placeholder="Como você é chamada(o)" />
        <Field label="CRP (opcional)" value={crp} onChange={setCrp} placeholder="06/000000" />
      </div>
      <Field type="email" label="Email" value={email} onChange={setEmail} placeholder="voce@exemplo.com" required />
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">O que você quer resolver?</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Opcional — uma linha sobre o que você espera que isso te ajude a resolver."
          rows={3}
          maxLength={500}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <label className="flex items-start gap-3 text-sm text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span>
          Li e aceito os{' '}
          <a href="/termos" target="_blank" rel="noopener" className="text-indigo-600 hover:text-indigo-700 underline">Termos de Uso</a>,
          a{' '}
          <a href="/privacidade" target="_blank" rel="noopener" className="text-indigo-600 hover:text-indigo-700 underline">Política de Privacidade</a>{' '}
          e o{' '}
          <a href="/dpa" target="_blank" rel="noopener" className="text-indigo-600 hover:text-indigo-700 underline">Acordo de Tratamento de Dados</a>.
        </span>
      </label>
      {error && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !email.trim() || !consent}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Enviando…' : 'Entrar na lista'}
      </button>
    </form>
  )
}

function Field({
  label, value, onChange, placeholder, type = 'text', required = false,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
    </div>
  )
}
