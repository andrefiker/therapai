import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabase'
import LogoutButton from '@/components/LogoutButton'
import { isAdminEmail } from '@/lib/admin'
import { getTherapist, isInvited } from '@/lib/viewer'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Multi-tenant gate: every (app)/* route requires a therapai_therapists row.
  // Without one, the user is either invited (→ /onboarding) or pending (→ /pending).
  const therapist = await getTherapist(supabase, user)
  if (!therapist) {
    const invited = await isInvited(supabaseAdmin, user.email ?? '')
    redirect(invited ? '/onboarding' : '/pending')
  }

  const isAdmin = isAdminEmail(user.email)

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <a href="/dashboard" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-slate-900 text-lg">TherapAI</span>
            {therapist.plan && therapist.plan !== 'pro' && (
              <span className="ml-2 text-[10px] uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded">
                {therapist.plan}
              </span>
            )}
          </a>
          {user && (
            <div className="flex items-center gap-4">
              {isAdmin && (
                <a href="/admin/waitlist" className="text-sm text-indigo-600 hover:text-indigo-700 font-medium">Lista de espera</a>
              )}
              {isAdmin && (
                <a href="/biblioteca-clinica" className="text-sm text-slate-500 hover:text-slate-900">Biblioteca clínica</a>
              )}
              <a href="/settings" className="text-sm text-slate-500 hover:text-slate-900">Configurações</a>
              <span className="text-sm text-slate-500">{user.email}</span>
              <LogoutButton />
            </div>
          )}
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
