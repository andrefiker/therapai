import Link from 'next/link'

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-center text-xs text-amber-900">
        <strong>Modo demonstração</strong> — dados clínicos <strong>sintéticos</strong> (tenant Dra. Demo).
        Nenhum paciente real exibido. Sem login. Somente leitura.
      </div>
      <nav className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/demo" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-slate-900 text-lg">TherapAI</span>
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded">demo</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">Voltar ao site</Link>
            <Link href="/login" className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg font-medium">Entrar</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}
