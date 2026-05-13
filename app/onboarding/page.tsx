import { redirect } from 'next/navigation'
import { createSupabaseServer, supabaseAdmin } from '@/lib/supabase'
import { getTherapist, isInvited } from '@/lib/viewer'
import { OnboardingForm } from './OnboardingForm'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Already has a tenant → straight to dashboard.
  const existing = await getTherapist(supabase, user)
  if (existing) redirect('/dashboard')

  // Not invited → /pending. Internal-tester pivot 2026-05-13.
  const invited = await isInvited(supabaseAdmin, user.email ?? '')
  if (!invited) redirect('/pending')

  // Pull active clinical lines for the lens dropdown.
  const { data: lines } = await supabaseAdmin
    .from('therapai_clinical_lines')
    .select('slug, name_pt')
    .eq('status', 'active')
    .order('name_pt')

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 w-full max-w-lg shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-lg">T</span>
          </div>
          <div>
            <div className="font-bold text-slate-900 text-lg">TherapAI</div>
            <div className="text-xs text-slate-400">Configuração inicial</div>
          </div>
        </div>

        <h1 className="font-semibold text-slate-900 text-xl mb-1">Bem-vindo(a)!</h1>
        <p className="text-sm text-slate-500 mb-6">
          Vamos provisionar sua área de trabalho. Pegue 30 segundos para escolher como
          o sistema deve falar com você sobre seus casos.
        </p>

        <OnboardingForm
          defaultEmail={user.email ?? ''}
          lines={(lines ?? []) as { slug: string; name_pt: string }[]}
        />

        <p className="text-xs text-slate-400 mt-6">
          Você pode mudar tudo isso depois em <strong>Configurações</strong>. A linha
          teórica define o vocabulário e as ferramentas que a IA aplica nas análises;
          a fonte de ingestão decide se a IA escuta pelo Fireflies (já em produção) ou
          pelo Recall.ai (em onboarding).
        </p>
      </div>
    </div>
  )
}
