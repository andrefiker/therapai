'use client'

import { useState } from 'react'

export function RecallLaunchBox() {
  const [meetingUrl, setMeetingUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    const res = await fetch('/api/recall/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting_url: meetingUrl }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setResult({ kind: 'ok', msg: data.message ?? `Bot ${data.bot_id} lançado.` })
      setMeetingUrl('')
    } else {
      setResult({ kind: 'err', msg: data.message ?? data.error ?? 'Erro ao lançar bot.' })
    }
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Enviar bot para reunião</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cole o link da reunião (Google Meet, Zoom, Teams). O bot da Recall.ai entra,
            grava, transcreve, e envia a análise automaticamente para o dashboard quando terminar.
          </p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          value={meetingUrl}
          onChange={(e) => setMeetingUrl(e.target.value)}
          required
          placeholder="https://meet.google.com/abc-defg-hij"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={loading || !meetingUrl}
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? 'Lançando...' : 'Enviar bot'}
        </button>
      </form>
      {result && (
        <p className={`mt-3 text-sm ${result.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>
          {result.msg}
        </p>
      )}
      <p className="text-xs text-slate-400 mt-3">
        Funciona com links públicos da reunião. Se a sala exige aprovação para entrar, o bot
        precisa ser admitido por algum participante. A transcrição é casada com o paciente
        usando o título da reunião — defina-o com o nome do paciente para roteamento automático.
      </p>
    </div>
  )
}
