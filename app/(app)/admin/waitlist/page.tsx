import { createSupabaseServer } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'
import { redirect } from 'next/navigation'
import { ApproveWaitlistButton } from '@/components/admin/ApproveWaitlistButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface WaitlistRow {
  id: string
  email: string
  name: string | null
  crp: string | null
  notes: string | null
  created_at: string
  consent_terms_at: string | null
  consent_privacy_at: string | null
  consent_dpa_at: string | null
  promoted: boolean
}

export default async function AdminWaitlistPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !isAdminEmail(user.email)) {
    redirect('/dashboard')
  }

  // Fetch waitlist + existing therapists (to mark already-promoted entries).
  const [{ data: waitlist }, { data: therapists }] = await Promise.all([
    supabase.from('therapai_waitlist')
      .select('id, email, name, crp, notes, created_at, consent_terms_at, consent_privacy_at, consent_dpa_at')
      .order('created_at', { ascending: false }),
    supabase.from('therapai_therapists').select('email'),
  ])

  const promotedEmails = new Set((therapists ?? []).map((t) => (t.email ?? '').toLowerCase()))
  const rows: WaitlistRow[] = (waitlist ?? []).map((w) => ({
    ...w,
    promoted: promotedEmails.has((w.email ?? '').toLowerCase()),
  }))

  const pending = rows.filter((r) => !r.promoted)
  const promoted = rows.filter((r) => r.promoted)

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Lista de espera</h1>
      <p className="text-sm text-slate-500 mb-8">
        {pending.length} aguardando · {promoted.length} já promovidos · {rows.length} total.
        Aprovar cria uma linha em <code className="text-xs">therapai_therapists</code> com
        a permissão de login. O psicólogo então recebe o link mágico no email cadastrado.
      </p>

      {pending.length > 0 ? (
        <section className="mb-12">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Aguardando</h2>
          <div className="space-y-3">
            {pending.map((row) => (
              <WaitlistCard key={row.id} row={row} />
            ))}
          </div>
        </section>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-6 text-sm text-slate-500 mb-12">
          Nenhuma inscrição pendente.
        </div>
      )}

      {promoted.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Já promovidos</h2>
          <div className="space-y-2">
            {promoted.map((row) => (
              <div key={row.id} className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-sm">
                <span className="text-slate-900 font-medium">{row.name ?? '—'}</span>
                <span className="text-slate-400 ml-2">· {row.email}</span>
                {row.crp && <span className="text-slate-400 ml-2">· CRP {row.crp}</span>}
                <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full ml-3">Aprovado</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function WaitlistCard({ row }: { row: WaitlistRow }) {
  const consents = [row.consent_terms_at, row.consent_privacy_at, row.consent_dpa_at].filter(Boolean).length
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-slate-900">{row.name ?? '(sem nome)'}</div>
          <div className="text-sm text-slate-500 break-all">{row.email}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            {row.crp && <span>CRP {row.crp}</span>}
            <span>{row.created_at.slice(0, 10)}</span>
            <span>{consents}/3 consentimentos</span>
          </div>
        </div>
        <ApproveWaitlistButton waitlistId={row.id} email={row.email} name={row.name ?? ''} />
      </div>
      {row.notes && (
        <div className="text-sm text-slate-600 bg-slate-50 border border-slate-100 rounded-lg p-3 mt-2 whitespace-pre-wrap">
          {row.notes}
        </div>
      )}
    </div>
  )
}
