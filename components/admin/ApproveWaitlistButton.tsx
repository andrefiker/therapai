'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ApproveWaitlistButton({ waitlistId, email, name }: { waitlistId: string; email: string; name: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createCustomer, setCreateCustomer] = useState(true)

  async function approve() {
    if (!window.confirm(`Aprovar ${name || email}? Isso cria a conta de clínico.${createCustomer ? ' Também cria customer no Stripe.' : ''}`)) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/approve-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waitlist_id: waitlistId, create_stripe_customer: createCustomer }),
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
        onClick={approve}
        disabled={loading}
        className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
      >
        {loading ? 'Aprovando…' : 'Aprovar'}
      </button>
      <label className="flex items-center gap-1.5 mt-2 text-xs text-slate-500 cursor-pointer justify-end">
        <input
          type="checkbox"
          checked={createCustomer}
          onChange={(e) => setCreateCustomer(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600"
        />
        Criar customer Stripe
      </label>
      {error && (
        <div className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 text-left">
          {error}
        </div>
      )}
    </div>
  )
}
