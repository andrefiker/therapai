import Link from 'next/link'

export const metadata = {
  title: 'Acordo de Tratamento de Dados — TherapAI',
  description: 'DPA entre o psicólogo (controlador) e TherapAI (operador), conforme LGPD art. 39.',
}

export default function DpaPage() {
  return (
    <article className="px-6 py-16 max-w-3xl mx-auto prose prose-slate">
      <div className="text-xs text-slate-400 mb-2">Versão 1.0 · vigente a partir de 11/05/2026</div>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Acordo de Tratamento de Dados (DPA)</h1>
      <p className="text-sm text-slate-500 mb-8">
        Este Acordo de Tratamento de Dados (Data Processing Agreement) é parte
        integrante dos <Link href="/termos" className="text-indigo-600">Termos de Uso</Link> da
        plataforma TherapAI e disciplina o tratamento de dados pessoais de
        pacientes pelo psicólogo-controlador, com TherapAI atuando como
        operador, nos termos da LGPD (Lei nº 13.709/2018) e da Resolução CFP
        11/2018.
      </p>

      <Section title="1. Partes">
        <ul>
          <li>
            <strong>CONTROLADOR:</strong> o psicólogo-usuário titular da conta na
            plataforma, identificado pelos dados de cadastro fornecidos no momento
            da contratação (nome, CRP, email, CPF/CNPJ).
          </li>
          <li>
            <strong>OPERADOR:</strong> TherapAI / André Fiker (CRP 06/115147),
            pessoa física, Guarulhos/SP, identificado nos{' '}
            <Link href="/termos" className="text-indigo-600">Termos de Uso</Link>.
          </li>
        </ul>
      </Section>

      <Section title="2. Objeto e natureza do tratamento">
        <p>
          O operador trata dados pessoais e dados pessoais sensíveis de saúde de
          pacientes do controlador, exclusivamente para os fins de prestação do
          serviço TherapAI: ingestão de transcrição de sessão, geração de
          análise clínica (molar, molecular e longitudinal), estruturação de
          prontuário-CFP, manutenção de memória clínica longitudinal por
          paciente e respostas a consultas analíticas do controlador sobre o
          caso.
        </p>
      </Section>

      <Section title="3. Categorias de dados tratados">
        <ul>
          <li>Identificação do paciente: nome.</li>
          <li>Transcrições verbatim de sessões de psicoterapia.</li>
          <li>Anotações, hipóteses clínicas, diagnósticos (CID-10) e intervenções inseridas pelo controlador.</li>
          <li>Dados sensíveis de saúde derivados da análise: medicação relatada, fatores de risco clínico, padrões comportamentais, eventos de aliança terapêutica, molduras relacionais.</li>
          <li>Metadados: datas de sessão, números de sessão, durações.</li>
        </ul>
      </Section>

      <Section title="4. Categorias de titulares">
        <ul>
          <li>Pacientes atendidos pelo controlador, em contexto psicoterapêutico.</li>
        </ul>
      </Section>

      <Section title="5. Base legal e consentimento">
        <p>
          Base legal do tratamento: art. 11, II, "f" da LGPD — tratamento
          necessário à tutela da saúde, em procedimento realizado por
          profissional de saúde (psicólogo) legitimamente regulamentado.
        </p>
        <p>
          <strong>Obrigação do controlador:</strong> obter previamente
          consentimento livre, informado e específico do paciente para o uso da
          plataforma TherapAI no processamento dos seus dados clínicos,
          conforme art. 7º da Resolução CFP 11/2018 e art. 11 da LGPD. O
          operador NÃO obtém esse consentimento diretamente.
        </p>
      </Section>

      <Section title="6. Duração do tratamento">
        <p>
          O tratamento perdura enquanto vigente a relação contratual entre
          controlador e operador, observadas as regras de retenção dos arts. 13
          e seguintes da Resolução CFP 11/2018 (mínimo de 5 anos contados do
          encerramento do atendimento).
        </p>
      </Section>

      <Section title="7. Obrigações do operador">
        <ul>
          <li>Tratar dados pessoais somente conforme instruções documentadas do controlador e das finalidades descritas neste DPA.</li>
          <li>Garantir confidencialidade dos dados, incluindo dever de sigilo de todo o pessoal autorizado.</li>
          <li>Implementar medidas técnicas e administrativas adequadas de segurança da informação (criptografia em trânsito e em repouso, controle de acesso, isolamento por inquilino via Row Level Security).</li>
          <li>Auxiliar o controlador no cumprimento dos direitos dos titulares (art. 18 LGPD).</li>
          <li>Comunicar ao controlador, sem demora indevida, incidente de segurança que envolva dados pessoais tratados em razão do serviço.</li>
          <li>Eliminar ou devolver dados ao final do contrato, conforme instrução do controlador, observada a retenção legal.</li>
          <li>Demonstrar conformidade mediante registros de tratamento e cooperação em auditoria razoável.</li>
        </ul>
      </Section>

      <Section title="8. Sub-operadores">
        <p>
          O controlador autoriza o operador a contratar sub-operadores para
          prestação parcial do serviço. Lista atual de sub-operadores:
        </p>
        <ul>
          <li><strong>Supabase</strong> (sa-east-1) — armazenamento PostgreSQL.</li>
          <li><strong>Vercel</strong> — hospedagem e execução da aplicação.</li>
          <li><strong>Anthropic</strong> — inferência via API (Claude), retenção zero.</li>
          <li><strong>OpenAI</strong> — inferência via API (GPT) em fallback, retenção zero.</li>
          <li><strong>Fireflies.ai</strong> — captura de transcrição, apenas quando integrado pelo controlador.</li>
        </ul>
        <p>
          Alterações materiais nessa lista serão comunicadas com antecedência
          mínima de 30 dias. O controlador pode opor-se a um novo sub-operador,
          hipótese em que o operador poderá rescindir o contrato sem multa.
        </p>
      </Section>

      <Section title="9. Transferência internacional">
        <p>
          Parte do tratamento ocorre fora do Brasil (servidores Anthropic, OpenAI
          e Vercel nos EUA). As transferências respeitam o art. 33 da LGPD,
          fundamentadas em garantia contratual de proteção equivalente. O
          controlador é informado e consente com essas transferências ao aceitar
          este DPA.
        </p>
      </Section>

      <Section title="10. Direitos dos titulares (pacientes)">
        <p>
          O paciente pode exercer os direitos do art. 18 da LGPD por meio do
          controlador (psicólogo). O operador auxilia o controlador no
          atendimento dessas solicitações em até 10 dias úteis a partir da
          comunicação. Solicitações de portabilidade, eliminação e correção
          executadas via interface da plataforma quando tecnicamente viáveis.
        </p>
      </Section>

      <Section title="11. Incidentes de segurança">
        <p>
          O operador comunicará incidente de segurança relevante ao controlador
          em até 72 horas após a detecção, contendo: natureza do incidente,
          categorias e número aproximado de titulares e registros afetados,
          medidas adotadas para mitigar e prevenir, e contato do encarregado
          (DPO).
        </p>
      </Section>

      <Section title="12. Auditoria e cooperação">
        <p>
          O operador disponibilizará ao controlador, mediante solicitação
          razoável, informações necessárias para demonstrar conformidade. Não
          serão admitidas auditorias on-site disruptivas; pedidos formais por
          email serão respondidos em até 15 dias úteis.
        </p>
      </Section>

      <Section title="13. Encerramento e devolução de dados">
        <p>
          Ao encerrar o contrato, o operador disponibilizará exportação dos
          dados em formato estruturado (JSON ou CSV) por até 90 dias. Decorrido
          esse prazo, os dados são eliminados ou anonimizados, salvo retenção
          legal obrigatória.
        </p>
      </Section>

      <Section title="14. Encarregado de proteção de dados (DPO)">
        <p>
          DPO do operador: <strong>André Fiker</strong>. Contato:{' '}
          <a href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a>.
        </p>
        <p>
          O controlador deve indicar seu próprio DPO ou encarregado caso atue em
          contexto profissional que o exija (art. 41 LGPD).
        </p>
      </Section>

      <Section title="15. Aceite">
        <p>
          Este DPA é aceito eletronicamente pelo controlador no momento de
          contratação do serviço TherapAI, mediante marcação de checkbox de
          consentimento e/ou conclusão do cadastro. O aceite é registrado com
          timestamp, IP em hash e identidade da conta para fins probatórios.
        </p>
        <p>
          Em caso de necessidade de aceite formal por escrito (com firma
          reconhecida) para fins de auditoria, política institucional ou
          exigência regulatória, o controlador pode solicitar versão em PDF
          assinável por <a href="mailto:andrefiker@gmail.com">email</a>.
        </p>
      </Section>

      <div className="mt-12 text-sm text-slate-500 border-t border-slate-200 pt-6">
        <Link href="/privacidade" className="text-indigo-600 hover:text-indigo-700">Política de Privacidade</Link>
        {' · '}
        <Link href="/termos" className="text-indigo-600 hover:text-indigo-700">Termos de Uso</Link>
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
