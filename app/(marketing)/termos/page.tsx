import Link from 'next/link'

export const metadata = {
  title: 'Termos de Uso — TherapAI',
  description: 'Termos e condições de uso do serviço TherapAI.',
}

export default function TermosPage() {
  return (
    <article className="px-6 py-16 max-w-3xl mx-auto prose prose-slate">
      <div className="text-xs text-slate-400 mb-2">Atualizado em 11/05/2026 · vigente</div>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Termos de Uso</h1>
      <p className="text-sm text-slate-500 mb-8">
        Estes termos regulam o uso do serviço TherapAI. Ao criar uma conta ou
        usar a plataforma, você concorda com estes termos integralmente.
      </p>

      <Section title="1. Objeto">
        <p>
          TherapAI ("plataforma", "serviço") oferece análise clínica automatizada
          para psicólogos atuantes no Brasil, incluindo: análise molar e
          molecular de sessões, prontuário-CFP estruturado, memória clínica
          longitudinal por paciente, e ferramentas de consulta sobre o caso.
        </p>
        <p>
          A plataforma é fornecida por <strong>André Fiker</strong> (CRP
          06/115147), pessoa física, sede em Guarulhos/SP. Contato:{' '}
          <a href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a>.
        </p>
      </Section>

      <Section title="2. Quem pode usar">
        <p>
          O serviço é destinado exclusivamente a <strong>psicólogos com inscrição
          ativa em Conselho Regional de Psicologia (CRP)</strong> no Brasil. Ao
          criar conta, você declara que:
        </p>
        <ul>
          <li>É psicólogo regularmente inscrito no CRP, com inscrição ativa.</li>
          <li>Atua eticamente conforme o Código de Ética Profissional do Psicólogo (CFP).</li>
          <li>Tem capacidade jurídica para contratar.</li>
          <li>Obteve consentimento informado dos pacientes para registrar e processar dados clínicos por meio de ferramenta de IA, conforme CFP Resolução 11/2018.</li>
        </ul>
        <p>
          O acesso atualmente é por convite (lista de espera + aprovação).
          TherapAI pode recusar ou encerrar acesso sem necessidade de justificativa
          em caso de violação destes termos.
        </p>
      </Section>

      <Section title="3. Responsabilidades do clínico-usuário">
        <ul>
          <li>Manter sigilo profissional sobre os dados dos pacientes, inclusive dentro da plataforma.</li>
          <li>Obter consentimento livre e informado dos pacientes para o uso de IA na análise clínica.</li>
          <li>Manter as credenciais de acesso seguras e não compartilhar conta com terceiros.</li>
          <li>Revisar criticamente as análises geradas — TherapAI é ferramenta de apoio, NÃO substitui o juízo clínico do psicólogo.</li>
          <li>Cumprir as obrigações de retenção e segurança previstas no CFP Resolução 11/2018 e na LGPD.</li>
          <li>Pagar pontualmente os valores devidos pelo plano contratado.</li>
        </ul>
      </Section>

      <Section title="4. Responsabilidades da plataforma">
        <ul>
          <li>Operar o serviço com disponibilidade razoável (target de 99% mensal, exceto manutenção programada).</li>
          <li>Manter as medidas de segurança descritas na <Link href="/privacidade" className="text-indigo-600">Política de Privacidade</Link>.</li>
          <li>Tratar dados pessoais conforme a LGPD e o DPA firmado com o psicólogo.</li>
          <li>Comunicar com antecedência razoável alterações relevantes nos termos ou no serviço.</li>
        </ul>
      </Section>

      <Section title="5. Natureza do serviço — não-clínico, não-diagnóstico">
        <p>
          TherapAI é uma ferramenta de <strong>apoio técnico-administrativo ao
          trabalho clínico do psicólogo</strong>. As análises geradas pela
          plataforma:
        </p>
        <ul>
          <li>NÃO constituem diagnóstico clínico.</li>
          <li>NÃO substituem a relação terapêutica, o atendimento clínico ou a avaliação direta do paciente.</li>
          <li>NÃO devem ser entregues ao paciente como produto independente ou laudo psicológico.</li>
          <li>Devem ser tratadas como sugestão técnica passível de validação, correção ou descarte pelo psicólogo.</li>
        </ul>
        <p>
          O psicólogo é o único responsável pelas decisões clínicas tomadas com
          base nas análises geradas pela plataforma.
        </p>
      </Section>

      <Section title="6. Modelo de IA e limitações">
        <p>
          A plataforma utiliza modelos de inteligência artificial fornecidos por
          terceiros (Anthropic, OpenAI). Modelos de IA:
        </p>
        <ul>
          <li>Podem produzir saídas incorretas, incompletas ou enviesadas.</li>
          <li>Podem refletir vieses presentes nos dados de treinamento.</li>
          <li>Têm desempenho variável conforme qualidade da transcrição de entrada.</li>
        </ul>
        <p>
          TherapAI implementa medidas para reduzir esses riscos — exigência de
          citação inline da fonte, recusa explícita quando o material não
          sustenta a resposta, disciplina de voz tripla (Citado / Observado /
          Hipótese) — mas <strong>não garante ausência de erro</strong>. O dever
          de revisão é do clínico.
        </p>
      </Section>

      <Section title="7. Planos, pagamento e cancelamento">
        <p>
          O serviço é oferecido em planos mensais ou anuais com preços e limites
          de uso publicados. Cobrança recorrente via Stripe.
        </p>
        <ul>
          <li>Cancelamento a qualquer momento via portal do cliente Stripe.</li>
          <li>Sem reembolso de período já pago, salvo lei expressa em contrário (CDC art. 49 — direito de arrependimento em 7 dias da contratação à distância).</li>
          <li>Atraso superior a 15 dias resulta em suspensão de acesso; após 60 dias, encerramento da conta com retenção mínima de dados conforme política de retenção.</li>
        </ul>
      </Section>

      <Section title="8. Propriedade intelectual">
        <p>
          O software, marca, design, prompts proprietários e infraestrutura
          técnica pertencem a TherapAI / André Fiker.
        </p>
        <p>
          As <strong>análises geradas para o seu uso clínico</strong> pertencem a
          você (e ao seu paciente, conforme o caso), sujeitas à licença implícita
          de TherapAI processar e armazenar os dados para fornecer o serviço.
        </p>
      </Section>

      <Section title="9. Suspensão e encerramento">
        <p>
          Em caso de violação destes termos, atividade ilícita, risco à segurança
          da plataforma ou inadimplência, TherapAI pode suspender ou encerrar a
          conta. Em caso de encerramento, o usuário tem 90 dias para exportar
          seus dados antes da eliminação definitiva.
        </p>
      </Section>

      <Section title="10. Limitação de responsabilidade">
        <p>
          Na máxima extensão permitida pela legislação aplicável, a
          responsabilidade total de TherapAI por todos os danos relacionados ao
          serviço fica limitada ao valor pago pelo usuário nos 12 meses
          anteriores ao evento que originou a responsabilidade.
        </p>
        <p>
          Esta limitação não se aplica a casos de dolo, fraude ou violação de
          direitos do consumidor protegidos por norma cogente.
        </p>
      </Section>

      <Section title="11. Alterações">
        <p>
          Estes termos podem ser atualizados. Alterações materiais serão
          comunicadas com antecedência mínima de 30 dias. Continuar usando o
          serviço após a alteração implica aceitação dos novos termos.
        </p>
      </Section>

      <Section title="12. Foro e legislação aplicável">
        <p>
          Legislação aplicável: brasileira, em especial LGPD (Lei nº 13.709/2018),
          Código de Defesa do Consumidor, Código de Ética Profissional do
          Psicólogo e Resoluções pertinentes do CFP. Foro: comarca de
          Guarulhos, São Paulo.
        </p>
      </Section>

      <div className="mt-12 text-sm text-slate-500 border-t border-slate-200 pt-6">
        <Link href="/privacidade" className="text-indigo-600 hover:text-indigo-700">Política de Privacidade</Link>
        {' · '}
        <Link href="/dpa" className="text-indigo-600 hover:text-indigo-700">Acordo de Tratamento de Dados (DPA)</Link>
        {' · '}
        <Link href="/" className="text-indigo-600 hover:text-indigo-700">Voltar ao site</Link>
      </div>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold text-slate-900 mb-3 mt-8">{title}</h2>
      <div className="text-slate-700 leading-relaxed space-y-3">{children}</div>
    </section>
  )
}
