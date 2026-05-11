'use client'

import { useState } from 'react'

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const json = await res.json() as { url?: string; message?: string; error?: string }
      if (!res.ok || !json.url) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
        setLoading(false)
        return
      }
      window.location.href = json.url
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={open}
        disabled={loading}
        className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? 'Abrindo…' : 'Gerenciar assinatura'}
      </button>
      {error && (
        <div className="mt-3 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  )
}
