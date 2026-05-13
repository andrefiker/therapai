import { createSupabaseServer } from '@/lib/supabase'
import { isAdminEmail } from '@/lib/admin'
import { audit } from '@/lib/audit'
import Link from 'next/link'

export const revalidate = 0
export const dynamic = 'force-dynamic'

const CATEGORY_LABELS: Record<string, string> = {
  foundational_principle: 'Princípios fundadores',
  core_construct: 'Construtos nucleares',
  behavioral_target: 'Alvos comportamentais',
  intervention_primitive: 'Intervenções',
  diagnostic_lens: 'Lentes diagnósticas',
  assessment_protocol: 'Avaliação',
  process_marker: 'Marcadores de processo',
  outcome_indicator: 'Indicadores de desfecho',
  canonical_reference: 'Referências canônicas',
}

const CATEGORY_ORDER = [
  'foundational_principle',
  'core_construct',
  'diagnostic_lens',
  'behavioral_target',
  'intervention_primitive',
  'assessment_protocol',
  'process_marker',
  'outcome_indicator',
  'canonical_reference',
]

const SOURCE_LABELS: Record<string, string> = {
  original_clinical_voice: 'voz clínica original',
  public_domain_text: 'domínio público',
  licensed_summary: 'sumário licenciado',
  derived_synthesis: 'síntese derivada',
  reference_citation_only: 'referência (citação)',
}

type Concept = {
  id: string
  slug: string
  name_pt: string
  name_en: string | null
  category: string
  summary: string
  applicability: string | null
  intervention_hooks: string | null
  source_kind: string
  attribution: string | null
  citation_url: string | null
  clinician_approved: boolean
}

type Line = {
  id: string
  slug: string
  name_pt: string
  name_en: string | null
  description: string | null
  philosophy_notes: string | null
  status: string
  therapai_clinical_concepts: Concept[]
}

export default async function ClinicalLibraryPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  if (!isAdminEmail(user?.email)) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
        <h1 className="text-lg font-semibold text-amber-900 mb-2">Biblioteca clínica indisponível</h1>
        <p className="text-sm text-amber-800">
          A biblioteca de teoria clínica é mantida pelo operador. Conteúdo aguardando exposição
          paramétrica por linha clínica em release futuro.
        </p>
        <Link href="/dashboard" className="inline-block mt-3 text-sm text-amber-900 underline">← Voltar ao dashboard</Link>
      </div>
    )
  }

  const { data: lines, error } = await supabase
    .from('therapai_clinical_lines')
    .select(`id, slug, name_pt, name_en, description, philosophy_notes, status,
             therapai_clinical_concepts (id, slug, name_pt, name_en, category, summary, applicability, intervention_hooks, source_kind, attribution, citation_url, clinician_approved)`)
    .eq('status', 'active')
    .order('name_pt')

  if (user) {
    audit(supabase, user.id, {
      action: 'viewed_clinical_library',
      context: { line_count: lines?.length ?? 0 },
    })
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-800">
        Erro carregando biblioteca: {error.message}
      </div>
    )
  }

  const linesData = (lines ?? []) as unknown as Line[]
  const totalConcepts = linesData.reduce((s, l) => s + (l.therapai_clinical_concepts?.length ?? 0), 0)
  const totalApproved = linesData.reduce(
    (s, l) => s + (l.therapai_clinical_concepts?.filter(c => c.clinician_approved).length ?? 0),
    0,
  )

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Biblioteca clínica</h1>
        <p className="text-sm text-slate-500">
          {linesData.length} linhas ativas · {totalConcepts} conceitos ({totalApproved} aprovados clinicamente, {totalConcepts - totalApproved} aguardando revisão)
        </p>
        <p className="text-xs text-slate-400 mt-2 max-w-3xl">
          Conteúdo de RAG sobre teorias clínicas. Cada conceito tem categoria, fonte e atribuição. Análises futuras
          poderão citar estes conceitos com rotulação explícita ("Baseado em CBT → cognitive_distortions"), separando
          transcrição do paciente, teoria curada e referências externas. Conceitos sem aprovação clínica estão marcados.
        </p>
      </header>

      <div className="space-y-4">
        {linesData.map(line => {
          const concepts = line.therapai_clinical_concepts ?? []
          const byCategory: Record<string, Concept[]> = {}
          for (const c of concepts) {
            ;(byCategory[c.category] = byCategory[c.category] ?? []).push(c)
          }
          const orderedCategories = CATEGORY_ORDER.filter(k => byCategory[k]?.length)

          return (
            <details key={line.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden group">
              <summary className="cursor-pointer px-5 py-4 flex items-start justify-between hover:bg-slate-50 transition-colors list-none">
                <div className="flex-1">
                  <div className="font-semibold text-slate-900">
                    {line.name_pt}
                    {line.name_en && <span className="ml-2 text-sm font-normal text-slate-400">({line.name_en})</span>}
                  </div>
                  {line.description && (
                    <div className="text-sm text-slate-500 mt-1 max-w-3xl">{line.description}</div>
                  )}
                </div>
                <div className="ml-4 flex-shrink-0 text-xs text-slate-500 text-right">
                  <div className="font-medium text-slate-700">{concepts.length} conceitos</div>
                  <div className="mt-0.5">
                    {concepts.filter(c => c.clinician_approved).length}/{concepts.length} aprovados
                  </div>
                </div>
              </summary>

              {line.philosophy_notes && (
                <div className="px-5 pb-3 -mt-1 text-xs text-slate-500 italic max-w-3xl">
                  {line.philosophy_notes}
                </div>
              )}

              <div className="border-t border-slate-100 px-5 py-4 bg-slate-50">
                {orderedCategories.map(cat => (
                  <section key={cat} className="mb-5 last:mb-0">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </h3>
                    <div className="space-y-2">
                      {byCategory[cat].map(c => (
                        <article key={c.id} className="bg-white border border-slate-200 rounded-lg p-3">
                          <header className="flex items-start justify-between gap-3 mb-1">
                            <div className="font-medium text-sm text-slate-900">
                              {c.name_pt}
                              {c.name_en && <span className="ml-2 text-xs font-normal text-slate-400">({c.name_en})</span>}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {c.clinician_approved ? (
                                <span className="text-[10px] font-medium uppercase tracking-wide bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">
                                  aprovado
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded">
                                  rascunho
                                </span>
                              )}
                            </div>
                          </header>
                          <p className="text-xs text-slate-600 leading-relaxed">{c.summary}</p>
                          {c.applicability && (
                            <p className="text-xs text-slate-500 mt-2">
                              <span className="font-semibold text-slate-600">Aplicabilidade:</span> {c.applicability}
                            </p>
                          )}
                          {c.intervention_hooks && (
                            <p className="text-xs text-slate-500 mt-1">
                              <span className="font-semibold text-slate-600">Intervenções:</span> {c.intervention_hooks}
                            </p>
                          )}
                          <footer className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">{SOURCE_LABELS[c.source_kind] ?? c.source_kind}</span>
                            {c.attribution && <span>· {c.attribution}</span>}
                            {c.citation_url && (
                              <a
                                href={c.citation_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-500 hover:text-indigo-700 underline decoration-dotted"
                              >
                                fonte
                              </a>
                            )}
                          </footer>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          )
        })}
      </div>

      <p className="text-xs text-slate-400 mt-8">
        Fonte: síntese a partir de Wikipedia (CC-BY-SA) e bibliografia primária de cada tradição. Conteúdo
        aguarda revisão clínica do operador antes de ser referenciado em análises automatizadas. Direção
        de longo prazo: RAG sobre biblioteca clínica curada (não treinamento de modelo em livros).
      </p>
    </div>
  )
}
