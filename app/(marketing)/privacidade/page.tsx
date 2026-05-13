import Link from 'next/link'

export const metadata = {
  title: 'Política de Privacidade — TherapAI',
  description: 'Como a TherapAI trata dados pessoais e dados de saúde, sob a LGPD.',
}

export default function PrivacidadePage() {
  return (
    <article className="px-6 py-16 max-w-3xl mx-auto prose prose-slate">
      <div className="text-xs text-slate-400 mb-2">Atualizado em 10/05/2026 · vigente</div>
      <h1 className="text-3xl font-bold text-slate-900 mb-2">Política de Privacidade</h1>
      <p className="text-sm text-slate-500 mb-8">
        Esta política descreve como TherapAI coleta, usa, armazena e protege
        dados pessoais. Documento elaborado em conformidade com a Lei nº
        13.709/2018 (Lei Geral de Proteção de Dados — LGPD) e com a Resolução
        CFP 11/2018.
      </p>

      <Section title="1. Quem somos e papel jurídico">
        <p>
          TherapAI é um serviço de análise clínica automatizada para psicólogos,
          operado por <strong>André Fiker</strong> (CRP 06/115147), pessoa
          física, com sede em Guarulhos/SP. Email para contato e exercício de
          direitos: <a href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a>.
        </p>
        <p>
          Em relação aos <strong>dados de visitantes e candidatos à lista de
          espera</strong>, TherapAI é <em>controlador</em> dos dados.
        </p>
        <p>
          Em relação aos <strong>dados de pacientes</strong> tratados pelo
          psicólogo-cliente dentro da plataforma, TherapAI atua como{' '}
          <em>operador</em> (processor) — o psicólogo é o controlador. As
          condições desse tratamento estão no{' '}
          <Link href="/dpa" className="text-indigo-600 hover:text-indigo-700">
            Acordo de Tratamento de Dados (DPA)
          </Link>
          {' '}celebrado entre o psicólogo e TherapAI.
        </p>
      </Section>

      <Section title="2. Que dados coletamos diretamente">
        <ul>
          <li><strong>Lista de espera:</strong> nome, email, CRP (opcional), nota de motivação (opcional).</li>
          <li><strong>Autenticação:</strong> email do clínico para envio de link mágico de acesso.</li>
          <li><strong>Conta do clínico:</strong> email, nome, número do CRP, plano contratado, data de criação.</li>
          <li><strong>Metadados técnicos:</strong> endereço IP (em forma de hash), user-agent do navegador, horário de cada requisição — apenas para fins de segurança e prevenção de abuso.</li>
        </ul>
        <p>
          <strong>Não usamos cookies de rastreamento, pixels publicitários,
          analytics de comportamento ou ferramentas de terceiros que perfilem o
          visitante.</strong> Cookies utilizados são exclusivamente de sessão
          (autenticação) e essenciais para o funcionamento da plataforma.
        </p>
      </Section>

      <Section title="3. Dados sensíveis de saúde">
        <p>
          A plataforma processa transcrições de sessões de psicoterapia, análises
          clínicas, prontuários estruturados e anotações comportamentais
          inseridas pelo psicólogo. Esses dados são <strong>dados pessoais
          sensíveis de saúde</strong> (LGPD, art. 5º, II e art. 11).
        </p>
        <p>
          <strong>Base legal:</strong> tratamento necessário à tutela da saúde,
          em procedimento realizado por profissional de saúde — psicólogo —
          legitimamente regulamentado (LGPD, art. 11, II, "f"). O consentimento
          específico dos pacientes para o tratamento por meio da plataforma é
          obtido pelo psicólogo-controlador antes da ingestão dos dados, por
          dever ético-profissional (CFP Resolução 11/2018, art. 8º).
        </p>
        <p>
          <strong>Limitação de acesso:</strong> os dados clínicos de cada
          paciente ficam isolados por inquilino (tenant), com Row Level Security
          (RLS) habilitada no banco de dados — cada conta de psicólogo só
          consegue ler e escrever as próprias linhas. Verificado pelo linter
          de segurança do Supabase. TherapAI (André Fiker) tem acesso técnico
          aos dados apenas para fins de operação, manutenção e diagnóstico de
          falhas, sem acesso clínico no sentido terapêutico.
        </p>
        <p>
          Durante o período de demonstração para parceiros avaliadores, qualquer
          conta que não seja a do operador (André Fiker) é roteada para um
          inquilino sintético de demonstração, com pacientes, transcrições e
          análises fictícias claramente marcadas — nenhum dado clínico real é
          exposto fora do operador.
        </p>
      </Section>

      <Section title="4. Finalidade do tratamento">
        <ul>
          <li>Cadastro e autenticação do clínico-usuário.</li>
          <li>Comunicação sobre o serviço (convites, notificações de produto).</li>
          <li>Operação técnica da análise clínica automatizada — geração de análises molar, molecular, longitudinal e prontuário-CFP estruturado.</li>
          <li>Segurança da plataforma, prevenção de fraude e abuso.</li>
          <li>Cumprimento de obrigação legal ou regulatória, quando aplicável.</li>
        </ul>
        <p>
          <strong>TherapAI não usa dados de pacientes para treinar modelos de
          IA, nem repassa-os a anunciantes ou terceiros não-essenciais.</strong>
        </p>
      </Section>

      <Section title="5. Sub-operadores e transferências internacionais">
        <p>
          Para operar, TherapAI utiliza serviços de processamento de terceiros
          chamados <em>sub-operadores</em>. Cada um trata dados em escopo
          estritamente necessário, sob contrato de processamento de dados:
        </p>
        <ul>
          <li><strong>Supabase</strong> (banco de dados PostgreSQL) — região <em>sa-east-1</em> (São Paulo). Armazenamento de transcrições, análises, contas de usuário.</li>
          <li><strong>Vercel</strong> (hospedagem da aplicação) — processamento efêmero de requisições; sem armazenamento persistente.</li>
          <li><strong>Anthropic (Claude)</strong> — geração de análise clínica via API. Dados enviados sem retenção para treinamento (Anthropic API zero-retention policy padrão).</li>
          <li><strong>OpenAI (GPT)</strong> — fallback de inferência quando Anthropic indisponível. Dados enviados via API com política contratual de não-uso para treinamento.</li>
          <li><strong>Fireflies.ai</strong> — captura de transcrição de sessão (apenas se o psicólogo opta por integrar). Plataforma de terceiros com termos próprios — consulte o psicólogo.</li>
        </ul>
        <p>
          Algumas dessas transferências envolvem servidores fora do Brasil (EUA,
          principalmente). A base legal é o cumprimento contratual e o legítimo
          interesse de prover o serviço, com salvaguardas contratuais nos termos
          do art. 33 da LGPD.
        </p>
      </Section>

      <Section title="6. Retenção">
        <ul>
          <li><strong>Dados da lista de espera:</strong> mantidos até a promoção a usuário ativo ou desistência manifestada — retenção máxima de 18 meses sem interação.</li>
          <li><strong>Conta de clínico:</strong> mantida durante a vigência do contrato. Após encerramento, há retenção de 90 dias para eventual restauração, seguida de eliminação ou anonimização.</li>
          <li><strong>Prontuário e dados clínicos:</strong> retenção mínima de 5 anos contados do encerramento do atendimento, conforme CFP Resolução 11/2018, art. 13. Após esse prazo, dados são eliminados ou anonimizados a pedido do controlador-psicólogo.</li>
        </ul>
      </Section>

      <Section title="7. Direitos do titular (LGPD art. 18)">
        <p>Você pode exercer, a qualquer momento e sem custo, os seguintes direitos:</p>
        <ul>
          <li>Confirmação da existência de tratamento dos seus dados.</li>
          <li>Acesso aos dados.</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados.</li>
          <li>Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD.</li>
          <li>Portabilidade dos dados.</li>
          <li>Eliminação dos dados pessoais tratados com seu consentimento.</li>
          <li>Informação sobre as entidades públicas ou privadas com as quais houve uso compartilhado.</li>
          <li>Revogação do consentimento.</li>
        </ul>
        <p>
          Para exercer qualquer direito, envie um email para{' '}
          <a href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a> com o
          assunto "LGPD — solicitação de [direito]". Resposta em até 15 dias
          úteis.
        </p>
        <p>
          <strong>Pacientes de psicólogos-usuários</strong> devem encaminhar
          solicitações primeiro ao seu psicólogo (controlador). TherapAI
          coopera com o controlador no atendimento da solicitação.
        </p>
      </Section>

      <Section title="8. Segurança">
        <ul>
          <li>Conexões cifradas com TLS em todas as rotas (HSTS, max-age 2 anos).</li>
          <li>Banco de dados com criptografia em repouso (Supabase managed, AES-256).</li>
          <li>Autenticação por link mágico via email — sem senhas armazenadas.</li>
          <li>Isolamento por inquilino com Row Level Security no banco — cada psicólogo só acessa os próprios pacientes; isolamento verificado por linter de segurança do Supabase.</li>
          <li>Chaves de API e segredos em variáveis de ambiente da plataforma de hospedagem (Vercel), não em código nem em colunas de banco.</li>
          <li>Logs operacionais via Supabase e Vercel. Auditoria estruturada por linha de aplicação está sendo implementada — quando ativa, registra cada acesso a dados clínicos por psicólogo, com retenção mínima de 12 meses.</li>
        </ul>
        <p>
          Em caso de incidente de segurança que envolva risco ou dano relevante,
          a ANPD e os titulares afetados serão comunicados em prazo razoável,
          conforme art. 48 da LGPD.
        </p>
      </Section>

      <Section title="9. DPO / Encarregado">
        <p>
          O Encarregado de Proteção de Dados (DPO) é{' '}
          <strong>André Fiker</strong>. Contato:{' '}
          <a href="mailto:andrefiker@gmail.com">andrefiker@gmail.com</a>.
        </p>
      </Section>

      <Section title="10. Alterações">
        <p>
          Esta política pode ser atualizada para refletir mudanças no serviço,
          novas obrigações legais ou aprimoramento das medidas de segurança.
          Alterações materiais serão comunicadas aos usuários ativos com pelo
          menos 30 dias de antecedência. A data de atualização consta no topo
          do documento.
        </p>
      </Section>

      <div className="mt-12 text-sm text-slate-500 border-t border-slate-200 pt-6">
        <p>
          Foro: comarca de Guarulhos, São Paulo, Brasil. Legislação aplicável:
          legislação brasileira, em especial Lei nº 13.709/2018.
        </p>
        <p className="mt-4">
          <Link href="/termos" className="text-indigo-600 hover:text-indigo-700">Termos de Uso</Link>
          {' · '}
          <Link href="/dpa" className="text-indigo-600 hover:text-indigo-700">Acordo de Tratamento de Dados (DPA)</Link>
          {' · '}
          <Link href="/" className="text-indigo-600 hover:text-indigo-700">Voltar ao site</Link>
        </p>
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
