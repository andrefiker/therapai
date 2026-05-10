import Link from 'next/link'
import { WaitlistForm } from '@/components/marketing/WaitlistForm'
import { DemoAnalysis } from '@/components/marketing/DemoAnalysis'

export default function LandingPage() {
  return (
    <>
      {/* ─────── HERO ─────── */}
      <section className="px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-full px-3 py-1 text-xs font-medium text-indigo-700 mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
              Acesso antecipado — psicólogos no Brasil
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 leading-[1.05]">
              Toda sessão analisada.{' '}
              <span className="text-indigo-600">Sem você redigir nada.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl">
              Grava no Google Meet, conecta o Fireflies, e cada sessão entra
              automaticamente como análise clínica completa — molar, molecular,
              prontuário-CFP estruturado, e memória longitudinal do caso. Você abre
              a próxima sessão com o paciente já mapeado.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#lista" className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-5 py-3 rounded-lg transition-colors">
                Entrar na lista de espera
              </a>
              <a href="#exemplo" className="text-slate-700 hover:text-slate-900 font-medium px-5 py-3 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                Ver análise real
              </a>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              Construído por um psicólogo clínico em atuação há 12 anos. Análise do
              Comportamento + RFT. Não substitui o clínico — escala a memória dele.
            </p>
          </div>
        </div>
      </section>

      {/* ─────── THE PROBLEM ─────── */}
      <section className="bg-slate-50 border-y border-slate-100 px-6 py-16">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-10 items-start">
          <div>
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
              O problema
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-snug mb-4">
              Você atende 20+ pacientes por semana. Você não lembra dos detalhes.
            </h2>
            <p className="text-slate-600 leading-relaxed">
              Prontuário fica desatualizado. Detalhes finos somem entre sessões.
              O paciente menciona algo que ele te contou três sessões atrás e você
              acena como se lembrasse. Você passa o domingo tentando reorganizar
              cabeças. Pior: você sabe que o trabalho clínico fica abaixo do que
              poderia se tudo estivesse na sua memória de trabalho ao mesmo tempo.
            </p>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
              A solução
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-snug mb-4">
              Um copiloto clínico que lê toda sessão e lembra de tudo.
            </h2>
            <p className="text-slate-600 leading-relaxed">
              TherapAI não substitui o seu raciocínio clínico. Ele oferece o que
              nenhum humano oferece: memória perfeita sobre N pacientes em paralelo,
              estrutura comportamental rigorosa atualizada sessão-a-sessão, e a
              capacidade de você <em>conversar com o caso</em> antes da próxima
              consulta — em segundos.
            </p>
          </div>
        </div>
      </section>

      {/* ─────── HOW IT WORKS / FEATURES ─────── */}
      <section id="como-funciona" className="px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-12">
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
              Como funciona
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">
              Da gravação ao caso mapeado — sem você escrever uma linha.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Feature
              number="01"
              title="Análise molar + molecular"
              body="Cada sessão recebe duas leituras: a síntese clínica em sete seções (Análise Funcional, RFT, Manejo, Prognóstico) e o recorte momento-a-momento de 3-7 eventos críticos — esquivas experienciais, derivações relacionais, rupturas e reparos de aliança, com citação direta e timestamp."
            />
            <Feature
              number="02"
              title="Memória clínica longitudinal"
              body="Demanda, queixa, formulação comportamental, frames RFT engajados, eventos de aliança, medicação — extraídos automaticamente em afirmações estruturadas. Você confirma ou descarta. O que confirmar vira a memória canônica do paciente, retomada na próxima sessão."
            />
            <Feature
              number="03"
              title="Conversa com o caso"
              body="Antes da sessão, abra a aba do paciente e pergunte: 'que padrão de esquiva apareceu nas últimas 4 sessões?', 'compare com a sessão de fevereiro', 'o que ainda não foi trabalhado da demanda inicial?'. Resposta ancorada nas suas análises, com citações inline. Se o material não sustenta, o sistema recusa."
            />
          </div>
        </div>
      </section>

      {/* ─────── DEMO ─────── */}
      <section id="exemplo" className="bg-slate-50 border-y border-slate-100 px-6 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
              Exemplo (caso sintético)
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight mb-4">
              Análise de uma sessão real — formato real.
            </h2>
            <p className="text-slate-600 leading-relaxed">
              Abaixo, um excerto da análise que TherapAI produziria sobre uma sessão
              de 50 minutos. Caso ilustrativo, com paciente fictícia — formato e
              rigor idênticos ao que você recebe na plataforma.
            </p>
          </div>
          <DemoAnalysis />
        </div>
      </section>

      {/* ─────── PROOF / DIFFERENTIATORS ─────── */}
      <section className="px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="max-w-2xl mb-10">
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
              Por que não é mais um ChatGPT-de-receita
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight">
              Construído com quadro teórico — não cola pronta.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Differentiator title="Disciplina de voz tripla" body="Cada parágrafo da análise distingue Citado (fala literal), Observado (fato comportamental), e Hipótese (inferência clínica) — explicitamente rotulado. Você nunca confunde o que o paciente disse com o que a IA inferiu." />
            <Differentiator title="Citação obrigatória, recusa explícita" body="Toda afirmação é ancorada em material da sessão, com referência [Sessão #N] ou [Longitudinal]. Quando o material não sustenta a resposta, o sistema recusa em vez de inventar. Sem alucinação." />
            <Differentiator title="Prontuário-CFP estruturado" body="Cada sessão emite o anexo prontuário em formato CFP Resolução 11/2018: demanda, queixa, formulação, intervenções, evolução, risco, medicação. Pronto para anexar no seu prontuário oficial." />
            <Differentiator title="Memória que você controla" body="A IA propõe afirmações sobre o paciente; você confirma uma a uma — ou em lote por dimensão. O que entra na memória canônica é o que você aprovou. Você é o clínico, ela é o copiloto." />
          </div>
        </div>
      </section>

      {/* ─────── PRICING ─────── */}
      <section id="preco" className="bg-slate-50 border-y border-slate-100 px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-xs font-semibold tracking-wide uppercase text-slate-500 mb-3">
            Preço
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight mb-4">
            Acesso antecipado fechado — preço fixado nos primeiros 50 clínicos.
          </h2>
          <p className="text-slate-600 leading-relaxed mb-8">
            O modelo de preço está sendo finalizado com os clínicos da lista de
            espera. Quem entrar agora trava a tarifa inicial e participa do desenho
            das funcionalidades.
          </p>
          <a href="#lista" className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 py-3 rounded-lg inline-block transition-colors">
            Reservar acesso antecipado
          </a>
        </div>
      </section>

      {/* ─────── WAITLIST ─────── */}
      <section id="lista" className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-8">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 leading-tight mb-3">
              Lista de espera
            </h2>
            <p className="text-slate-600 leading-relaxed">
              Deixe email e CRP. Você recebe convite quando abrirmos uma vaga, e
              participa da rodada de feedback que define o produto.
            </p>
          </div>
          <WaitlistForm />
          <p className="text-xs text-slate-400 text-center mt-4">
            Sem compromisso. Sem cartão. Email usado apenas para enviar convite e
            atualizações de produto. Você sai da lista a qualquer momento.
          </p>
        </div>
      </section>

      {/* ─────── CTA FINAL ─────── */}
      <section className="bg-slate-900 px-6 py-16 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight mb-4">
            Você já tem o trabalho clínico. Está na hora da memória escalar com ele.
          </h2>
          <p className="text-slate-300 mb-6 max-w-xl mx-auto">
            Construído por psicólogo clínico. Operando hoje sobre 55+ pacientes
            em prática real.
          </p>
          <a href="#lista" className="bg-white hover:bg-slate-100 text-slate-900 font-medium px-6 py-3 rounded-lg inline-block transition-colors">
            Entrar na lista de espera
          </a>
        </div>
      </section>
    </>
  )
}

function Feature({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-indigo-200 hover:shadow-sm transition-all">
      <div className="text-xs font-mono text-indigo-600 mb-3">{number}</div>
      <h3 className="text-lg font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  )
}

function Differentiator({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-l-2 border-indigo-200 pl-5">
      <h3 className="font-semibold text-slate-900 mb-1.5">{title}</h3>
      <p className="text-sm text-slate-600 leading-relaxed">{body}</p>
    </div>
  )
}
