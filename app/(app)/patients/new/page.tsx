import { NewPatientForm } from './NewPatientForm'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default function NewPatientPage() {
  return (
    <div className="max-w-xl">
      <Link href="/dashboard" className="text-sm text-slate-400 hover:text-slate-600 mb-3 inline-block">
        ← Voltar ao dashboard
      </Link>
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Novo paciente</h1>
      <p className="text-sm text-slate-500 mb-6">
        Adicione o paciente manualmente. Quando sessões com esse nome forem
        capturadas via Fireflies ou Recall.ai, elas serão automaticamente
        vinculadas ao registro. Você pode editar ou apagar depois.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <NewPatientForm />
      </div>

      <div className="mt-4 text-xs text-slate-400 bg-amber-50 border border-amber-100 rounded-lg p-3">
        <strong>Privacidade.</strong> O nome é armazenado criptografado em
        repouso. Use um identificador que faça sentido para você — primeiro
        nome + sobrenome, iniciais, pseudônimo clínico. O sistema usa o nome
        para casar com o título das reuniões e identificar o paciente.
      </div>
    </div>
  )
}
