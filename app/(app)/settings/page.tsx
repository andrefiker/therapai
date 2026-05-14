import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase'
import { subscriptionStatusLabel } from '@/lib/stripe'
import { ManageSubscriptionButton } from '@/components/ManageSubscriptionButton'
import { SettingsForm } from './SettingsForm'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function SettingsPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: t } = await supabase
    .from('therapai_therapists')
    .select('id, email, name, plan, sessions_limit, clinical_lens, ingest_source, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_current_period_end, created_at')
    .eq('id', user!.id)
    .maybeSingle()

  const { data: lines } = await supabaseAdmin
    .from('therapai_clinical_lines')
    .select('slug, name_pt')
    .eq('status', 'active')
    .order('name_pt')

  const status = subscriptionStatusLabel(t?.subscription_status ?? null)
  const toneClass: Record<typeof status.tone, string> = {
    ok: 'bg-green-50 text-green-800 border-green-200',
    warn: 'bg-amber-50 text-amber-900 border-amber-200',
    bad: 'bg-red-50 text-red-800 border-red-200',
    neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Configurações</h1>
      <p className="text-sm text-slate-500 mb-8">Conta, preferências clínicas e assinatura.</p>

      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Preferências clínicas</h2>
        <p className="text-xs text-slate-500 mb-4">Email <strong>{t?.email}</strong> não pode ser alterado (vinculado ao login).</p>
        <SettingsForm
          initialName={t?.name ?? ''}
          initialLens={t?.clinical_lens ?? null}
          initialIngestSource={t?.ingest_source ?? 'fireflies'}
          lines={(lines ?? []) as { slug: string; name_pt: string }[]}
        />
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4">Conta</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Field label="Email" value={t?.email ?? '—'} />
          <Field label="Conta criada em" value={t?.created_at ? t.created_at.slice(0, 10) : '—'} />
          <Field label="Plano contratado" value={t?.plan ?? '—'} />
          <Field label="Limite de sessões" value={t?.sessions_limit?.toString() ?? '—'} />
        </div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Assinatura</h2>
            <p className="text-sm text-slate-500 mt-0.5">Estado da assinatura via Stripe.</p>
          </div>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${toneClass[status.tone]}`}>
            {status.label}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm mb-6">
          <Field
            label="Próxima cobrança / fim do período"
            value={t?.subscription_current_period_end ? t.subscription_current_period_end.slice(0, 10) : '—'}
          />
        </div>

        {t?.stripe_customer_id ? (
          <ManageSubscriptionButton />
        ) : (
          <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-4">
            Você ainda não tem assinatura ativa. Para iniciar um plano pago,
            entre em contato com <a className="text-indigo-600 hover:text-indigo-700" href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a>.
          </div>
        )}
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-3">Conformidade</h2>
        <ul className="text-sm text-slate-700 space-y-1">
          <li><Link href="/privacidade" className="text-indigo-600 hover:text-indigo-700">Política de Privacidade</Link></li>
          <li><Link href="/termos" className="text-indigo-600 hover:text-indigo-700">Termos de Uso</Link></li>
          <li><Link href="/dpa" className="text-indigo-600 hover:text-indigo-700">Acordo de Tratamento de Dados (DPA)</Link></li>
        </ul>
      </section>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-slate-900 font-medium">{value}</div>
    </div>
  )
}
