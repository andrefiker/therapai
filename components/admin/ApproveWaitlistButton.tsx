'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ApproveWaitlistButton({ waitlistId, email, name, invited }: { waitlistId: string; email: string; name: string; invited: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (invited) {
    return (
      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
        Convidado(a)
      </span>
    )
  }

  async function invite() {
    if (!window.confirm(`Convidar ${name || email}? O usuário poderá entrar via magic link e se auto-provisionar em /onboarding.`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/approve-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlist_id: waitlistId }),
      })
      const json = await res.json() as { ok?: boolean; message?: string; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.message ?? json.error ?? `HTTP ${res.status}`)
        setLoading(false)
        return
      }
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div className="text-right shrink-0">
      <button
        onClick={invite}
        disabled={loading}
        className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? 'Convidando…' : 'Convidar'}
      </button>
      {error && (
        <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-left">
          {error}
        </div>
      )}
    </div>
  )
}
