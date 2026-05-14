'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  connected: boolean
  grantedEmail: string | null
  ingestSource: string
  autoLaunch: boolean
}

export function GoogleCalendarPanel({ connected, grantedEmail, ingestSource, autoLaunch: initialAutoLaunch }: Props) {
  const router = useRouter()
  const [autoLaunch, setAutoLaunch] = useState(initialAutoLaunch)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function disconnect() {
    if (!window.confirm('Desconectar Google Calendar? O bot não vai mais entrar automaticamente nas suas reuniões.')) return
    setBusy(true)
    setFeedback(null)
    const res = await fetch('/api/auth/google/disconnect', { method: 'POST' })
    if (res.ok) {
      setFeedback({ kind: 'ok', msg: 'Desconectado.' })
      router.refresh()
    } else {
      const data = await res.json().catch(() => ({}))
      setFeedback({ kind: 'err', msg: data.message ?? 'Falha ao desconectar.' })
    }
    setBusy(false)
  }

  async function toggleAutoLaunch(next: boolean) {
    setAutoLaunch(next)
    setBusy(true)
    setFeedback(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_launch_calendar_bot: next }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setAutoLaunch(!next) // revert
      setFeedback({ kind: 'err', msg: data.message ?? 'Falha ao salvar.' })
    } else {
      setFeedback({ kind: 'ok', msg: next ? 'Auto-join ativado.' : 'Auto-join desativado.' })
      router.refresh()
    }
    setBusy(false)
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Google Calendar</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Conecte sua agenda para que o bot da Recall.ai entre automaticamente nas reuniões marcadas.
          </p>
        </div>
        {connected ? (
          <span className="text-xs font-medium bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-full whitespace-nowrap">
            Conectado
          </span>
        ) : (
          <span className="text-xs font-medium bg-slate-50 text-slate-500 border border-slate-200 px-2 py-1 rounded-full whitespace-nowrap">
            Não conectado
          </span>
        )}
      </div>

      {connected ? (
        <>
          <div className="text-sm text-slate-700 mb-4">
            Conta vinculada: <strong>{grantedEmail ?? '(sem email registrado)'}</strong>
          </div>

          {ingestSource === 'recall' ? (
            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 mb-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoLaunch}
                  onChange={(e) => toggleAutoLaunch(e.target.checked)}
                  disabled={busy}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-900">Enviar bot automaticamente</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    A cada 10 minutos, o sistema escaneia suas próximas 24h de agenda. Eventos com link
                    de Google Meet, Zoom ou Teams recebem o bot da Recall.ai automaticamente — sem você
                    fazer nada. Idempotente: cada evento recebe no máximo um bot.
                  </div>
                </div>
              </label>
            </div>
          ) : (
            <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              Auto-join precisa de <strong>Fonte de ingestão = Recall.ai</strong>. Mude acima e volte aqui.
            </div>
          )}

          <button
            onClick={disconnect}
            disabled={busy}
            className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
          >
            {busy ? '...' : 'Desconectar Google Calendar'}
          </button>
        </>
      ) : (
        <a
          href="/api/auth/google/start"
          className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          Conectar Google Calendar
        </a>
      )}

      {feedback && (
        <p className={`mt-3 text-sm ${feedback.kind === 'ok' ? 'text-green-700' : 'text-red-600'}`}>{feedback.msg}</p>
      )}
    </section>
  )
}
