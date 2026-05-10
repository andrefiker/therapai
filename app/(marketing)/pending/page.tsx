import Link from 'next/link'

export const metadata = {
  title: 'Acesso pendente — TherapAI',
  description: 'Seu email não está na lista de acesso antecipado ainda.',
}

export default function PendingPage() {
  return (
    <section className="px-6 py-24">
      <div className="max-w-xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-full px-3 py-1 text-xs font-medium text-amber-800 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
          Acesso ainda não liberado
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight mb-4">
          Seu email não está na lista de acesso antecipado.
        </h1>
        <p className="text-slate-600 leading-relaxed mb-8">
          TherapAI está em rodada fechada de clínicos parceiros. Entre na lista
          de espera abaixo e te avisamos quando abrirmos uma vaga. Se você acha
          que já deveria ter acesso, responda a esse email do convite ou escreva
          direto para o André.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/#lista"
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-3 rounded-lg transition-colors"
          >
            Entrar na lista de espera
          </Link>
          <Link
            href="/"
            className="text-slate-700 hover:text-slate-900 font-medium px-5 py-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
          >
            Voltar para o site
          </Link>
        </div>
      </div>
    </section>
  )
}
