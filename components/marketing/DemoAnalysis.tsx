'use client'

import { useState } from 'react'

type Tab = 'molar' | 'molecular' | 'chat'

export function DemoAnalysis() {
  const [tab, setTab] = useState<Tab>('molar')

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex border-b border-slate-200 bg-slate-50">
        <TabButton active={tab === 'molar'} onClick={() => setTab('molar')}>Análise molar</TabButton>
        <TabButton active={tab === 'molecular'} onClick={() => setTab('molecular')}>Evento molecular</TabButton>
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>Conversa com o caso</TabButton>
      </div>
      <div className="p-6 sm:p-8">
        {tab === 'molar' && <MolarPanel />}
        {tab === 'molecular' && <MolecularPanel />}
        {tab === 'chat' && <ChatPanel />}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-600 text-indigo-700 bg-white'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  )
}

function MolarPanel() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <div className="text-xs text-slate-400 mb-1">
        Mariana — sessão #4 · 18/03/2026 · 52 min · análise gerada em 8s
      </div>

      <h3 className="text-lg font-semibold text-slate-900">3. Análise Funcional</h3>

      <div>
        <div className="font-semibold text-slate-800 mb-1">3.1 Comportamentos-alvo</div>
        <p className="text-slate-700">
          <strong>Citado:</strong> "Eu sei que ela é só uma criança, mas quando ela
          chora desse jeito eu travo. Aí grito mais alto do que devia." <span className="text-xs text-slate-400">[14:22]</span>
        </p>
        <p className="text-slate-700 mt-1">
          <strong>Observado:</strong> Mariana descreve um padrão de escalada vocal
          quando a filha apresenta afeto intenso, seguido de retraimento culpado.
          Relata três episódios na semana, todos sob condições de fadiga (após
          22h) e sem o parceiro presente.
        </p>
        <p className="text-slate-700 mt-1">
          <strong>Hipótese:</strong> O grito funciona como tentativa de regulação
          aversiva — termina o estado afetivo intolerável (choro intenso da
          criança + fadiga + ausência de suporte) por curto prazo. A culpa
          subsequente é a consequência aversiva tardia que mantém o ciclo.
        </p>
      </div>

      <div>
        <div className="font-semibold text-slate-800 mb-1">3.3 RFT: molduras engajadas</div>
        <p className="text-slate-700">
          <strong>Hipótese:</strong> Moldura de <em>identidade</em> derivada ("eu
          sou uma mãe ruim") fortemente coordenada com o evento de grito. Mariana
          opera, no nível verbal, sob a regra "uma mãe boa não perde a paciência",
          o que transforma a função do próprio grito em prova de identidade
          aversiva — não em comportamento contextualizado.
        </p>
      </div>

      <h3 className="text-lg font-semibold text-slate-900 pt-3">5. Sugestões de Intervenção</h3>
      <ul className="list-disc pl-5 text-slate-700 space-y-1">
        <li>Exposição à fala "perdi a paciência" sem coordenação com identidade — exercício de defusão verbal direcionado à derivação "eu sou".</li>
        <li>Análise funcional explícita do gatilho contextual (fadiga + ausência de suporte) como variável manejável, separado da identidade.</li>
        <li>Plano de manejo preventivo para janela 22h-23h: ritual de transição + chamada com parceiro quando ele está fora.</li>
      </ul>

      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mt-6">
        <div className="text-xs font-semibold text-indigo-900 mb-1">Anexo prontuário-CFP gerado automaticamente</div>
        <code className="text-xs text-indigo-900 block whitespace-pre-wrap">
{`{
  "demanda": "Dificuldade no manejo emocional da maternidade...",
  "queixa_principal_sessao": "Episódios de grito com a filha (3 na semana)",
  "hipotese_diagnostica": {
    "formulacao_comportamental": "Escalada vocal como esquiva..."
  },
  "intervencoes_aplicadas": ["psicoeducação afetiva", "análise funcional"],
  "risco_clinico": { "presente": false }
}`}
        </code>
      </div>
    </div>
  )
}

function MolecularPanel() {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <div className="text-xs text-slate-400 mb-1">
        Sessão #4 · evento 3 de 5 · momento clinicamente carregado
      </div>

      <h3 className="text-lg font-semibold text-slate-900">Evento 3 — Defusão emergente sobre identidade-mãe</h3>

      <div>
        <div className="font-semibold text-slate-700">Antecedente</div>
        <p className="text-slate-600">
          Mariana havia descrito o terceiro episódio de grito. O afeto verbal estava
          travado em culpa rígida — "eu sou exatamente o tipo de mãe que jurei
          nunca ser". O clínico ofereceu uma reformulação: "perceba que você está
          construindo uma identidade a partir de um evento. Que diferença faz se
          dissermos: 'você gritou', em vez de 'você é'?"
        </p>
      </div>

      <div>
        <div className="font-semibold text-slate-700">Comportamento observado</div>
        <p className="text-slate-600">
          <em>Citação direta:</em> "Espera... é diferente, né? Tem uma distância
          aí. 'Eu gritei naquela hora' é uma coisa que eu fiz. 'Eu sou' é... é
          um lugar fixo." <span className="text-xs text-slate-400">[31:08]</span>
        </p>
      </div>

      <div>
        <div className="font-semibold text-slate-700">Consequência imediata</div>
        <p className="text-slate-600">
          Mudança visível de afeto: ombros descem, ritmo da fala diminui.
          Silêncio de 8 segundos. Em seguida: "Faz tempo que ninguém mexia
          nessa parte assim." Aproximação clara à dor antes evitada.
        </p>
      </div>

      <div>
        <div className="font-semibold text-slate-700">Frame RFT engajado</div>
        <p className="text-slate-600">Transformação de função — o evento "grito" passa de prova-de-identidade para comportamento-contextual.</p>
      </div>

      <div>
        <div className="font-semibold text-slate-700">Função hipotetizada</div>
        <p className="text-slate-600"><em>Hipótese:</em> Aproximação a conteúdo evitado, sinal claro de fortalecimento da aliança no momento de risco clínico de contato com a culpa.</p>
      </div>

      <div className="bg-green-50 border border-green-100 rounded-lg p-3 mt-4 text-xs">
        <div className="font-semibold text-green-900 mb-1">Afirmações extraídas (pendentes de confirmação)</div>
        <ul className="text-green-800 space-y-0.5">
          <li>· Moldura <code>transformacao_funcao</code> engajada no evento 3</li>
          <li>· Sinal de aliança: <code>fortalecimento</code> no evento 3</li>
        </ul>
      </div>
    </div>
  )
}

function ChatPanel() {
  return (
    <div className="space-y-4 text-sm">
      <div className="text-xs text-slate-400 mb-1">
        Antes da sessão #5 com Mariana — terça-feira, 14h
      </div>

      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <span className="font-medium text-slate-500 mr-2">Q:</span>
        Quais padrões de esquiva experiencial apareceram nas últimas 4 sessões dela?
      </div>

      <div className="prose prose-sm max-w-none text-slate-800 leading-relaxed">
        <p>
          Três padrões consistentes nas últimas 4 sessões:
        </p>
        <p>
          <strong>1. Esquiva via grito ou silêncio na presença de afeto intenso da
          filha</strong> — recorrente, escalada vocal funciona como término aversivo
          do estado emocional intolerável <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-xs">[Sessão #4]</span> <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-xs">[Sessão #2]</span>.
        </p>
        <p>
          <strong>2. Coordenação rígida do evento com identidade-mãe</strong> — "eu
          sou uma mãe ruim", "eu sou exatamente o tipo de mãe que jurei nunca ser"
          <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-xs">[Sessão #4]</span>. Padrão de derivação de identidade a partir de evento
          singular — mantido pela regra verbal "uma mãe boa não perde a paciência"
          <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-xs">[Longitudinal]</span>.
        </p>
        <p>
          <strong>3. Esquiva da fadiga como variável funcional</strong> — Mariana
          tende a tratar a janela 22h-23h como dado fixo, não como contexto
          manejável <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-xs">[Sessão #3]</span>. Esquiva sutil: nomear contexto como
          "minha realidade" em vez de "variável".
        </p>
        <p className="text-slate-600 italic">
          Movimento notável: evento 3 da sessão #4 mostrou primeira defusão
          espontânea do par evento↔identidade. Continuar nessa linha pode acelerar
          a quebra do ciclo.
        </p>
      </div>

      <div className="text-xs text-slate-400 mt-4">
        Resposta gerada em ~6s · 4 sessões + longitudinal + 2 afirmações confirmadas
      </div>
    </div>
  )
}
