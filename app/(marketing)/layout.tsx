import Link from 'next/link'

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <header className="border-b border-slate-100 sticky top-0 bg-white/80 backdrop-blur z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">T</span>
            </div>
            <span className="font-semibold text-slate-900 text-lg">TherapAI</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#como-funciona" className="text-slate-600 hover:text-slate-900 hidden sm:inline">Como funciona</a>
            <a href="#exemplo" className="text-slate-600 hover:text-slate-900 hidden sm:inline">Exemplo</a>
            <a href="#preco" className="text-slate-600 hover:text-slate-900 hidden sm:inline">Preço</a>
            <Link href="/login" className="text-slate-600 hover:text-slate-900">Entrar</Link>
            <a href="#lista" className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Lista de espera
            </a>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-100 mt-24">
        <div className="max-w-6xl mx-auto px-6 py-10 text-sm text-slate-500">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xs">T</span>
                </div>
                <span className="font-semibold text-slate-900">TherapAI</span>
              </div>
              <p className="text-slate-500">
                Análise clínica longitudinal automatizada. Construído por psicólogo
                brasileiro, para psicólogos brasileiros.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-900 mb-2">Conformidade</div>
              <ul className="space-y-1">
                <li>Prontuário psicológico (CFP Resolução 11/2018)</li>
                <li>LGPD — dados em infra brasileira</li>
                <li>Acesso por link mágico, sem senhas</li>
              </ul>
            </div>
            <div>
              <div className="font-semibold text-slate-900 mb-2">Quadro teórico</div>
              <ul className="space-y-1">
                <li>Análise do Comportamento</li>
                <li>RFT — Teoria das Molduras Relacionais</li>
                <li>Process-Based Therapy</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-6 flex flex-col sm:flex-row sm:justify-between gap-2 text-xs">
            <span>© {new Date().getFullYear()} TherapAI. Todos os direitos reservados.</span>
            <span>CRP responsável: André Fiker (CRP 06/115147)</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
