// lib/ingest.ts
//
// Shared transcript-ingest analysis pipeline. Consumed by both Fireflies
// (app/api/webhook/route.ts) and Recall.ai (app/api/recall/webhook/route.ts)
// handlers. Source-specific concerns (auth, transcript fetch, idempotency
// column mapping, payload parsing) stay in the handlers; this module owns
// the analysis pipeline + persistence to therapai_analyses /
// therapai_molecular_analyses / therapai_patient_memory_assertions /
// therapai_longitudinal.
//
// Pivot context (2026-05-14): created so Recall.ai (M4) can wire into the
// same analysis path Fireflies uses, without duplicating ~700 lines. Both
// handlers now collapse to (a) auth + fetch + therapist resolve + session
// insert (source-specific) + (b) runFullAnalysisPipeline (this module).

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

// ─── Configuration ────────────────────────────────────────────────────────────
const ANTHROPIC_MODEL = 'claude-opus-4-5';
const OPENAI_MODEL = 'gpt-4o';
const GEMINI_MODEL = 'gemini-3-pro';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MeetingMetadata {
  title: string | null;
  sessionDate: string; // YYYY-MM-DD
  durationMin: number;
  participants: string[]; // emails or display names; informational
  summaryOverview?: string | null; // optional source-provided summary
}

export interface IngestContext {
  supabase: SupabaseClient;
  therapistId: string;
  sessionId: string;
  patientId: string;
  meta: MeetingMetadata;
  transcriptText: string; // flattened "[mm:ss] Speaker: text" form
}

export interface PipelineResult {
  analysisMd: string;
  molarModel: string;
  sessionNumber: number;
  molecularStatus: 'ok' | 'skipped' | 'failed';
  molecularEvents?: number;
  assertionsMolarStatus: 'ok' | 'skipped' | 'failed';
  assertionsMolecularStatus: 'ok' | 'skipped' | 'failed';
  longitudinalStatus: 'ok' | 'skipped' | 'failed';
}

// ProviderError: thrown when BOTH Claude and OpenAI exhausted retries. Caller
// should map this to a retryable 'failed_retry_pending' session state so a
// rescue worker can re-run the analysis offline.
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ─── System prompts (PT-BR, behaviorism + RFT default voice) ─────────────────
// These match the prompts the Fireflies handler used since D16/F6. If we ever
// branch by clinical_lens, the per-lens prompt selection happens HERE — these
// are the radical_behaviorism + RFT baseline.

const MOLAR_SYSTEM_PROMPT = `Você é um clínico especialista em Análise do Comportamento e RFT.
Avaliações rigorosas, funcionalmente fundamentadas, em português brasileiro técnico.
Sem linguagem vaga. Cada afirmação ancorada em dados da transcrição. Sem preambles.

DISCIPLINA DE VOZ (D16/F6 — obrigatória em cada seção, exceto onde indicado):
Distinga três tipos de conteúdo, marcando-os explicitamente quando aparecerem:
- **Citado:** falas literais do paciente, entre aspas, com timestamp [mm:ss]. O que ele disse, palavra por palavra.
- **Observado:** fatos comportamentais inferidos diretamente da transcrição. O que aconteceu funcionalmente — verbal ou não-verbal — sem interpretação clínica adicional.
- **Hipótese:** sua interpretação clínica, claramente marcada como hipótese. O que VOCÊ está sugerindo, não o que se passou.

Use parágrafos rotulados (\`**Citado:**\`, \`**Observado:**\`, \`**Hipótese:**\`) dentro de cada seção quando os três níveis aparecerem. Seções primariamente factuais (Dados do Caso) podem dispensar rótulos. Seção 7 (Hipóteses para Próxima Sessão) é essencialmente "Hipótese" — não precisa rotular ali.

Seções obrigatórias:
1. Dados do Caso
2. Demandas e Queixas Principais
3. Análise Funcional
   3.1 Comportamentos-alvo
   3.2 Contingências
   3.3 RFT: molduras de avaliação / identidade / temporais / causais / transformação de função / coerência relacional
4. Manejo Terapêutico
5. Sugestões de Intervenção
6. Prognóstico
7. Hipóteses para Próxima Sessão

ANEXO ESTRUTURADO OBRIGATÓRIO (D16/F1 — prontuário psicológico, CFP Resolução 11/2018):
Após a seção 7, emita um bloco JSON fenced (\`\`\`json ... \`\`\`) com a estrutura abaixo. Este bloco é a ponte para sistemas de prontuário e para extração programática de estado clínico longitudinal — não é redundância visual.

Regras:
- Use \`null\` para campos sem evidência na sessão. NÃO invente.
- Strings curtas e específicas. Para campos de lista, emita arrays vazios \`[]\` se não houver itens.
- O JSON deve parsear como JSON válido. Aspas duplas, sem comentários, sem trailing commas.
- Códigos CID-10 só quando explicitamente discutidos ou claramente derivados; caso contrário, omita o array ou use \`[]\`.

\`\`\`json
{
  "identificacao": {
    "nome_paciente": "<nome>",
    "data_sessao": "<YYYY-MM-DD>",
    "duracao_min": <número ou null>
  },
  "demanda": "<demanda original que trouxe o paciente — uma frase>",
  "queixa_principal_sessao": "<o que o paciente trouxe NESTA sessão — uma frase>",
  "hipotese_diagnostica": {
    "formulacao_comportamental": "<formulação funcional curta>",
    "cid_codigos": []
  },
  "intervencoes_aplicadas": ["<intervenção 1>", "<intervenção 2>"],
  "evolucao": "<movimento clínico observado nesta sessão — progressão / regressão / oscilação / estabilidade — com sinal específico>",
  "encaminhamentos": [],
  "risco_clinico": {
    "presente": <true/false>,
    "tipo": "<suicida / heteroagressivo / autolesivo / null>",
    "manejo": "<conduta tomada ou null>"
  },
  "medicacao": {
    "em_uso": [
      { "nome": "<nome ou classe>", "dose": "<dose ou null>", "indicacao": "<para que ou null>" }
    ],
    "mudancas_relatadas": ["<descrição curta de cada mudança discutida ou null>"],
    "adesao_nota": "<observação sobre adesão ou null>",
    "efeitos_relatados": ["<efeito colateral ou subjetivo mencionado ou null>"]
  }
}
\`\`\``;

const MOLECULAR_SYSTEM_PROMPT = `Você é um clínico especialista em Análise do Comportamento e RFT.
Tarefa: análise MOLECULAR — recorte momento-a-momento da sessão, NÃO síntese integrada.

A análise molar (já produzida) cobre a sessão como um todo. Aqui sua tarefa é diferente: identificar 3 a 7 EVENTOS CLÍNICOS DISCRETOS — momentos específicos da transcrição com peso clínico — e analisar cada um isoladamente.

Critério para selecionar um evento: trecho onde algo CLINICAMENTE LOADED ocorreu — esquiva experiencial, aproximação a conteúdo evitado, derivação relacional notável, ruptura ou reparo de aliança, insight, resistência, validação fora-de-frame, momento de coragem clínica, etc. NÃO selecione todos os momentos — apenas os com carga clínica suficiente.

Em português brasileiro técnico, sem preambles.

ESTRUTURA POR EVENTO (replicar para cada um dos 3-7):

### Evento N — [título descritivo curto, 4-8 palavras]

**Antecedente:** Contexto imediatamente anterior. O que estava em jogo, o que o clínico ofereceu/perguntou, o estado afetivo aparente.

**Comportamento observado:** Citação direta do paciente entre aspas, com timestamp [mm:ss]. Palavra por palavra. Inclua não-verbal brevemente se mencionado.

**Consequência imediata:** O que aconteceu logo depois. Resposta do clínico, mudança no rumo da conversa, mudança de afeto, silêncio, esquiva, aproximação. Cite trecho seguinte se relevante.

**Frame RFT engajado:** Moldura relacional operando — avaliação / identidade / temporal / causal / coerência / transformação de função. Como estrutura a fala. Se nenhuma moldura clara, escreva "Não destacado".

**Função hipotetizada:** O que o comportamento serviu funcionalmente — esquiva experiencial, busca de validação, manutenção de regra rígida, aproximação a conteúdo evitado, etc. Hipótese sua, marque como tal.

---

PADRÕES TRANSVERSAIS (após os eventos): 1-3 padrões que aparecem em múltiplos eventos da mesma sessão. Não invente padrões que aparecem apenas uma vez.

CONTAGEM FINAL: depois dos padrões, escreva "**Eventos analisados:** N" para o N entre 3 e 7.

ANEXO ESTRUTURADO OBRIGATÓRIO (D16/F2+F5 V2 — extração programática de estado):
Após a contagem final, emita um bloco JSON fenced (\`\`\`json ... \`\`\`) sumarizando cada evento de forma processável. Este bloco alimenta o sistema de memória clínica longitudinal — não duplica os parágrafos acima, comprime-os em sinal.

Regras:
- Um item de array por evento, na MESMA ordem da narrativa acima.
- \`null\` quando não houver sinal — NÃO invente.
- \`frame_rft_principal\`: única moldura RFT predominante no evento. Vocabulário fechado: \`avaliacao\`, \`identidade\`, \`temporal\`, \`causal\`, \`coerencia\`, \`transformacao_funcao\`, \`null\`.
- \`tipo_evento\`: classificação funcional do evento. Vocabulário fechado: \`esquiva_experiencial\`, \`aproximacao\`, \`derivacao_relacional\`, \`ruptura_alianca\`, \`reparo_alianca\`, \`fortalecimento_alianca\`, \`insight\`, \`validacao_fora_frame\`, \`resistencia\`, \`coragem_clinica\`, \`outro\`.
- \`sinal_alianca\`: presença de sinal de aliança terapêutica neste evento, mesmo que não seja o tipo principal. Vocabulário fechado: \`ruptura\`, \`tensao\`, \`reparo\`, \`fortalecimento\`, \`null\`.
- \`citacao_chave\`: fala mais clínica do paciente neste evento, palavra por palavra (curta, ≤120 caracteres). Sem timestamp na string.
- \`timestamp\`: \`mm:ss\` correspondente à citacao_chave.

\`\`\`json
{
  "eventos_estruturados": [
    {
      "evento_n": 1,
      "tipo_evento": "<vocabulário fechado>",
      "frame_rft_principal": "<vocabulário fechado ou null>",
      "sinal_alianca": "<vocabulário fechado ou null>",
      "citacao_chave": "<≤120 chars>",
      "timestamp": "<mm:ss>"
    }
  ]
}
\`\`\``;

const LONGITUDINAL_SYSTEM_PROMPT = `Você é um clínico especialista em Análise do Comportamento e RFT.
Análise longitudinal rigorosa, em português brasileiro técnico, sintetizando todas as sessões anteriores deste paciente.
Sem preambles.

DISCIPLINA TEMPORAL OBRIGATÓRIA:
As sessões abaixo são apresentadas em ordem cronológica com data explícita no cabeçalho de cada bloco. Sua análise DEVE preservar essa estrutura temporal:
- Refira-se a sessões por data (ex: "na sessão de 14/03/2026") ou por janela temporal ("nas primeiras 4 sessões de março", "no período pós-interrupção de 6 semanas em fevereiro").
- Gaps prolongados entre sessões (marcados com ⚠) são fatos clínicos: interrupções, recaídas, retomadas. Comente quando relevantes.
- Distinga padrões ESTÁVEIS (presentes em múltiplos momentos do tratamento) de MUDANÇAS (apareceram em data X, evoluíram em data Y).
- Em "Movimentos de Mudança", ancore cada movimento em quando começou e em que sessão se consolidou.
- Em "Estado Atual", reflita o que está vivo nas sessões MAIS RECENTES, não a média do período inteiro.

DISCIPLINA DE CONCRETUDE:
- Nomes próprios de figuras relacionais (cônjuge, pais, sogros, irmãos, chefe, etc.) DEVEM aparecer com o nome que o paciente usa. Cada figura recebe caracterização funcional (antecedente / reforçador / punidor / mantenedor / aliado).
- Quando nomear uma moldura RFT, nomeie o CONTEÚDO específico da moldura (ex: "conflito de quadros de coerência: Justiça-via-Mérito vs Família-como-Dádiva"). Listar tipos de moldura sem ancorar conteúdo é falha de especificidade.
- Em "Análise Funcional Síntese", produza UMA fórmula central A → B → C → Função que captura o loop clínico operativo principal, não um catálogo de contingências.

Seções obrigatórias:

1. Trajetória do Caso (linha do tempo clínica — datas chave + janelas)

2. Identificação e Contexto Atual (snapshot consolidado: idade, ocupação, estado civil, status de saúde relevante, motivo original da terapia, motivo do contato terapêutico no período coberto — todos derivados das sessões, "Não consta" quando ausente)

3. Padrões Comportamentais Estáveis (com sinalização da janela em que aparecem; integre regras verbais e esquemas de valores quando o paciente os verbaliza explicitamente)

4. Dinâmica Familiar / Ecossistema Relacional e Mantenedores
   - Para cada figura relacional saliente nas sessões: nome do paciente para ela → papel funcional (antecedente recorrente / reforçador positivo / reforçador negativo / punidor / mantenedor do padrão problema / aliado terapêutico).
   - Mapear contingências que se sustentam no ecossistema (não no indivíduo isolado): quem reforça o quê, quem pune o quê, qual loop coletivo se autoperpetua.

5. Análise Funcional Síntese
   - UMA fórmula central capturando o loop operativo principal do caso:
     - **Antecedente:** [contexto / estímulo recorrente]
     - **Comportamento(s)-alvo:** [topografia + classe funcional]
     - **Consequência imediata:** [o que reforça/mantém]
     - **Função hipotetizada:** [esquiva experiencial / busca de validação / manutenção de regra / etc.]
   - Se o caso tem 2 loops em competição (ex: aproximação vs esquiva), nomeie ambos.

6. Movimentos de Mudança (data-de-início + data-de-consolidação por movimento)

7. Análise RFT Longitudinal (molduras dominantes em cada fase, ancorando o CONTEÚDO específico das molduras, não apenas o tipo)

8. Estado Atual (apenas o que está vivo nas sessões mais recentes)

9. Vetores de Intervenção Prioritários

10. Conduta Terapêutica — Reflexão sobre o(a) Próprio(a) Clínico(a)
    - **Aliança terapêutica:** sinais de fortalecimento, tensão, ruptura, reparo ao longo das sessões. Cite trechos onde a aliança se mostrou.
    - **Pacing e timing:** intervenções que foram introduzidas no momento certo; intervenções que podem ter sido prematuras ou tardias. Honesto, com tato.
    - **Intervenções que funcionaram:** o que produziu mudança observável — para fortalecer no plano futuro.
    - **Oportunidades possivelmente perdidas:** momentos em que algo clinicamente carregado emergiu e não foi explorado, ou foi explorado de modo que esquivou da intensidade. Use linguagem hipotética ("pode ter sido"), não acusatória.
    - Esta seção é especialmente útil para supervisão clínica — é o espelho funcional, não julgamento.

11. Prognóstico Atualizado e Indicadores de Alta / Reavaliação

---

**Nota final obrigatória ao fim do relatório:**

> Este relatório é hipótese-gerador, destinado a apoiar formulação de caso e supervisão clínica. Não substitui julgamento clínico do(a) profissional responsável nem deve ser tratado como ditame prescritivo.`;

// ─── Patient identification (source-agnostic) ─────────────────────────────────

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^meet\b/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d/i,
  /^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/i, // Google Meet codes like xyz-abc-def
];

const DEFAULT_OPERATOR_PATTERNS = ['andre', 'andré', 'fiker', 'ghost'];

export interface PatientIdentificationInput {
  title: string | null;
  speakers: { name: string; count: number }[]; // candidate speakers, frequency from transcript
  operatorPatterns?: string[]; // names to skip when looking for the patient
}

export function identifyPatient(input: PatientIdentificationInput): string | null {
  const operatorPatterns = (input.operatorPatterns ?? DEFAULT_OPERATOR_PATTERNS).map((p) => p.toLowerCase());
  const containsOperator = (s: string) => operatorPatterns.some((p) => s.toLowerCase().includes(p));

  const title = (input.title ?? '').trim();
  if (title && !GENERIC_TITLE_PATTERNS.some((re) => re.test(title)) && !containsOperator(title)) {
    return title;
  }

  const filtered = input.speakers.filter((s) => s.name && !containsOperator(s.name));
  if (filtered.length === 0) return null;
  filtered.sort((a, b) => b.count - a.count);
  return filtered[0].name;
}

export async function matchOrNullPatient(
  supabase: SupabaseClient,
  therapistId: string,
  candidateName: string,
  threshold = 0.85,
): Promise<string | null> {
  const { data: patients } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('therapist_id', therapistId);
  if (!patients || patients.length === 0) return null;

  const candidate = candidateName.trim().toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const p of patients) {
    const score = similarity(candidate, (p.name ?? '').toLowerCase());
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= threshold ? best.id : null;
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[n][m];
  const maxLen = Math.max(n, m);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

export async function nextSessionNumberForPatient(
  supabase: SupabaseClient,
  patientId: string,
): Promise<number> {
  const { count } = await supabase
    .from('therapai_analyses')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId);
  return (count ?? 0) + 1;
}

// ─── Inference layer ─────────────────────────────────────────────────────────

function isFatalProviderError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? '').toLowerCase();
  if (msg.includes('credit balance') || msg.includes('credit_balance')) return true;
  if (msg.includes('insufficient_quota')) return true;
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryProviderWithRetry(label: string, fn: () => Promise<string>): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`[ingest] ${label} attempt ${attempt + 1} failed`, err);
      if (isFatalProviderError(err)) throw err;
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: unreachable`);
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('claude_no_text_block');
  return block.text;
}

async function callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 8000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error('openai_no_content');
  return text;
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const resp = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens: 8000,
    },
  });
  const text = resp.text;
  if (!text) throw new Error('gemini_no_text');
  return text;
}

export async function runAnalysisWithFallback(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; model: string }> {
  // Provider order (2026-05-15): Gemini primary → Claude → OpenAI.
  // Gemini 3 Pro is ~6x cheaper than Claude Opus at equivalent quality;
  // the prompts were calibrated against Gemini's case-formulation bar.
  // Gemini stays opt-in via env var so a missing key falls through to
  // the original Claude/OpenAI chain without breaking production.
  const geminiEnabled = !!process.env.GEMINI_API_KEY;
  let geminiErr: unknown = null;
  if (geminiEnabled) {
    try {
      const text = await tryProviderWithRetry('gemini', () => callGemini(systemPrompt, userPrompt));
      return { text, model: GEMINI_MODEL };
    } catch (err) {
      geminiErr = err;
      console.error('[ingest] gemini exhausted, falling back to claude', err);
    }
  }
  try {
    const text = await tryProviderWithRetry('claude', () => callClaude(systemPrompt, userPrompt));
    return { text, model: ANTHROPIC_MODEL };
  } catch (claudeErr) {
    console.error('[ingest] claude exhausted, falling back to openai', claudeErr);
    try {
      const text = await tryProviderWithRetry('openai', () => callOpenAI(systemPrompt, userPrompt));
      return { text, model: OPENAI_MODEL };
    } catch (openaiErr) {
      const geminiMsg = geminiEnabled ? `gemini: ${(geminiErr as Error)?.message ?? 'unknown'} | ` : '';
      const claudeMsg = (claudeErr as Error)?.message ?? 'unknown';
      const openaiMsg = (openaiErr as Error)?.message ?? 'unknown';
      throw new ProviderError(`${geminiMsg}claude: ${claudeMsg} | openai: ${openaiMsg}`);
    }
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildMolarUserPrompt(meta: MeetingMetadata, transcriptText: string): string {
  const metaLines = [
    `Título: ${meta.title ?? '(sem título)'}`,
    `Data: ${meta.sessionDate}`,
    `Duração: ${Math.round(meta.durationMin)}min`,
    `Participantes: ${(meta.participants ?? []).join(', ') || '—'}`,
    meta.summaryOverview ? `Resumo da ingestão: ${meta.summaryOverview}` : null,
  ].filter(Boolean).join('\n');

  return `Transcrição da sessão clínica abaixo. Produza a análise completa nas 7 seções obrigatórias.

${metaLines}

---

${transcriptText}`;
}

function buildMolecularUserPrompt(meta: MeetingMetadata, transcriptText: string): string {
  const metaLines = [
    `Título: ${meta.title ?? '(sem título)'}`,
    `Data: ${meta.sessionDate}`,
    `Duração: ${Math.round(meta.durationMin)}min`,
  ].join('\n');

  return `Transcrição da sessão clínica abaixo. Identifique 3-7 eventos clínicos discretos, analise cada um separadamente em narrativa, E emita OBRIGATORIAMENTE o anexo JSON estruturado ao final (\`eventos_estruturados[]\`). O bloco JSON é parte da entrega — sem ele a análise é considerada incompleta e o sistema de memória clínica perde o sinal por sessão. Se a transcrição não tiver conteúdo verbal suficiente para identificar eventos (apenas timestamps/overview), explique brevemente e emita \`{"eventos_estruturados": []}\` como anexo.

${metaLines}

---

${transcriptText}`;
}

function buildLongitudinalUserPrompt(
  patientName: string,
  analyses: { session_number: number | null; analysis_md: string | null; session_date?: string | null }[],
): string {
  const sorted = [...analyses].sort((a, b) => {
    const da = a.session_date ?? '';
    const db = b.session_date ?? '';
    if (da && db && da !== db) return da.localeCompare(db);
    return (a.session_number ?? 0) - (b.session_number ?? 0);
  });

  const blocks: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const num = a.session_number ?? '?';
    const date = a.session_date ?? '(sem data)';
    let gapNote = '';
    if (i > 0) {
      const prev = sorted[i - 1].session_date;
      if (prev && a.session_date) {
        const days = Math.round((new Date(a.session_date).getTime() - new Date(prev).getTime()) / 86_400_000);
        if (days >= 14) gapNote = ` · ⚠ ${days}d desde a sessão anterior`;
        else if (days > 0) gapNote = ` · +${days}d`;
      }
    }
    blocks.push(`=== Sessão ${num} · ${date}${gapNote} ===\n${a.analysis_md ?? ''}`);
  }

  const span = sorted.length > 0 && sorted[0].session_date && sorted[sorted.length - 1].session_date
    ? `${sorted[0].session_date} → ${sorted[sorted.length - 1].session_date} (${sorted.length} sessões)`
    : `${sorted.length} sessões`;

  return `Análises de sessão para ${patientName} abaixo, em ordem cronológica (${span}).
Sintetize a análise longitudinal completa nas 8 seções obrigatórias. Cada afirmação clínica que faça referência temporal deve ancorar-se na data da(s) sessão(ões) correspondente(s) — não trate as sessões como uma lista plana. Gaps longos entre sessões (sinalizados com ⚠) são clinicamente relevantes (interrupções, recaídas, retomadas).

${blocks.join('\n\n')}`;
}

// ─── Assertion extraction ────────────────────────────────────────────────────

type AssertionDimension =
  | 'complaint' | 'diagnosis_cid' | 'medication' | 'risk_factor'
  | 'behavioral_theme' | 'relational_frame' | 'alliance_event'
  | 'historical_event' | 'intervention';

interface AssertionInsert {
  dimension: AssertionDimension;
  sub_key: string | null;
  assertion_text: string;
  structured_value: unknown;
}

function extractFencedJson(md: string): unknown | null {
  const re = /```json\s*\n([\s\S]*?)\n```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) last = m[1];
  if (!last) return null;
  try { return JSON.parse(last); }
  catch { return null; }
}

function deriveProntuarioAssertions(prontuario: unknown): AssertionInsert[] {
  if (!prontuario || typeof prontuario !== 'object') return [];
  const p = prontuario as Record<string, unknown>;
  const out: AssertionInsert[] = [];
  const pushIf = (text: unknown, dim: AssertionDimension, sub_key: string | null, structured?: unknown) => {
    if (typeof text === 'string' && text.trim() && text.trim().toLowerCase() !== 'null') {
      out.push({ dimension: dim, sub_key, assertion_text: text.trim(), structured_value: structured ?? null });
    }
  };

  pushIf(p.demanda, 'complaint', 'initial_demanda');
  pushIf(p.queixa_principal_sessao, 'complaint', 'current_session');
  pushIf(p.evolucao, 'behavioral_theme', 'movimento_clinico');

  const hd = p.hipotese_diagnostica as Record<string, unknown> | undefined;
  if (hd && typeof hd === 'object') {
    pushIf(hd.formulacao_comportamental, 'behavioral_theme', 'formulacao');
    const cids = Array.isArray(hd.cid_codigos) ? hd.cid_codigos : [];
    for (const code of cids) {
      if (typeof code === 'string' && code.trim()) {
        out.push({ dimension: 'diagnosis_cid', sub_key: code.trim(), assertion_text: code.trim(), structured_value: { code } });
      }
    }
  }

  const ints = Array.isArray(p.intervencoes_aplicadas) ? p.intervencoes_aplicadas : [];
  for (let i = 0; i < ints.length; i++) {
    const v = ints[i];
    if (typeof v === 'string' && v.trim()) {
      out.push({ dimension: 'intervention', sub_key: `s${i}`, assertion_text: v.trim(), structured_value: null });
    }
  }

  const enc = Array.isArray(p.encaminhamentos) ? p.encaminhamentos : [];
  for (let i = 0; i < enc.length; i++) {
    const v = enc[i];
    if (typeof v === 'string' && v.trim()) {
      out.push({ dimension: 'historical_event', sub_key: `encaminhamento_${i}`, assertion_text: v.trim(), structured_value: { kind: 'encaminhamento' } });
    }
  }

  const risco = p.risco_clinico as Record<string, unknown> | undefined;
  if (risco && typeof risco === 'object' && risco.presente === true) {
    const tipo = typeof risco.tipo === 'string' ? risco.tipo : 'inespecificado';
    const manejo = typeof risco.manejo === 'string' ? risco.manejo : null;
    out.push({
      dimension: 'risk_factor',
      sub_key: tipo,
      assertion_text: manejo ? `Risco ${tipo} presente — manejo: ${manejo}` : `Risco ${tipo} presente`,
      structured_value: { tipo, manejo, presente: true },
    });
  }

  const medicacao = p.medicacao as Record<string, unknown> | undefined;
  if (medicacao && typeof medicacao === 'object') {
    const emUso = Array.isArray(medicacao.em_uso) ? medicacao.em_uso : [];
    for (const item of emUso) {
      if (!item || typeof item !== 'object') continue;
      const md = item as Record<string, unknown>;
      const nome = typeof md.nome === 'string' ? md.nome.trim() : '';
      if (!nome || nome.toLowerCase() === 'null') continue;
      const dose = typeof md.dose === 'string' && md.dose.trim().toLowerCase() !== 'null' ? md.dose.trim() : null;
      const indicacao = typeof md.indicacao === 'string' && md.indicacao.trim().toLowerCase() !== 'null' ? md.indicacao.trim() : null;
      const text = [nome, dose && `(${dose})`, indicacao && `— ${indicacao}`].filter(Boolean).join(' ');
      out.push({
        dimension: 'medication',
        sub_key: nome.toLowerCase().replace(/\s+/g, '_').slice(0, 64),
        assertion_text: text,
        structured_value: { nome, dose, indicacao, status: 'em_uso' },
      });
    }
    const mudancas = Array.isArray(medicacao.mudancas_relatadas) ? medicacao.mudancas_relatadas : [];
    for (let i = 0; i < mudancas.length; i++) {
      const v = mudancas[i];
      if (typeof v !== 'string' || !v.trim() || v.trim().toLowerCase() === 'null') continue;
      out.push({ dimension: 'medication', sub_key: `mudanca_${i}`, assertion_text: v.trim(), structured_value: { kind: 'mudanca' } });
    }
    const efeitos = Array.isArray(medicacao.efeitos_relatados) ? medicacao.efeitos_relatados : [];
    for (let i = 0; i < efeitos.length; i++) {
      const v = efeitos[i];
      if (typeof v !== 'string' || !v.trim() || v.trim().toLowerCase() === 'null') continue;
      out.push({ dimension: 'medication', sub_key: `efeito_${i}`, assertion_text: v.trim(), structured_value: { kind: 'efeito_relatado' } });
    }
    const adesao = typeof medicacao.adesao_nota === 'string' ? medicacao.adesao_nota.trim() : '';
    if (adesao && adesao.toLowerCase() !== 'null') {
      out.push({ dimension: 'medication', sub_key: 'adesao', assertion_text: `Adesão: ${adesao}`, structured_value: { kind: 'adesao_nota' } });
    }
  }

  return out;
}

const FRAME_RFT_VOCAB = new Set(['avaliacao', 'identidade', 'temporal', 'causal', 'coerencia', 'transformacao_funcao']);
const ALIANCA_VOCAB = new Set(['ruptura', 'tensao', 'reparo', 'fortalecimento']);
const TIPO_ALIANCA_DERIVADO = new Set(['ruptura_alianca', 'reparo_alianca', 'fortalecimento_alianca']);

function deriveMolecularAssertions(molecular: unknown): AssertionInsert[] {
  if (!molecular || typeof molecular !== 'object') return [];
  const m = molecular as Record<string, unknown>;
  const eventos = Array.isArray(m.eventos_estruturados) ? m.eventos_estruturados : [];
  const out: AssertionInsert[] = [];

  for (const raw of eventos) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = raw as Record<string, unknown>;
    const n = typeof ev.evento_n === 'number' && Number.isFinite(ev.evento_n) ? ev.evento_n : null;
    const tipo = typeof ev.tipo_evento === 'string' ? ev.tipo_evento.trim() : '';
    const frame = typeof ev.frame_rft_principal === 'string' ? ev.frame_rft_principal.trim() : '';
    const aliancaField = typeof ev.sinal_alianca === 'string' ? ev.sinal_alianca.trim() : '';
    const citacao = typeof ev.citacao_chave === 'string' ? ev.citacao_chave.trim() : '';
    const ts = typeof ev.timestamp === 'string' ? ev.timestamp.trim() : '';
    if (n === null) continue;

    if (frame && FRAME_RFT_VOCAB.has(frame)) {
      const exemplo = citacao ? ` — "${citacao}"${ts ? ` [${ts}]` : ''}` : '';
      out.push({
        dimension: 'relational_frame',
        sub_key: `evt${n}_${frame}`,
        assertion_text: `Moldura ${frame} engajada no evento ${n}${exemplo}`,
        structured_value: { evento_n: n, frame, citacao: citacao || null, timestamp: ts || null, tipo_evento: tipo || null },
      });
    }

    let sinalAlianca: string | null = null;
    if (aliancaField && ALIANCA_VOCAB.has(aliancaField)) sinalAlianca = aliancaField;
    else if (TIPO_ALIANCA_DERIVADO.has(tipo)) sinalAlianca = tipo.replace('_alianca', '');
    if (sinalAlianca) {
      const trecho = citacao ? ` — "${citacao}"${ts ? ` [${ts}]` : ''}` : '';
      out.push({
        dimension: 'alliance_event',
        sub_key: `evt${n}_${sinalAlianca}`,
        assertion_text: `Aliança — ${sinalAlianca} no evento ${n}${trecho}`,
        structured_value: { evento_n: n, sinal: sinalAlianca, tipo_evento: tipo || null, citacao: citacao || null, timestamp: ts || null },
      });
    }
  }

  return out;
}

function countMolecularEvents(md: string): number {
  const explicit = md.match(/\*\*Eventos analisados:\*\*\s*(\d+)/i);
  if (explicit) {
    const n = parseInt(explicit[1], 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const headings = md.match(/^###\s+Evento\s+\d+/gim);
  return headings ? headings.length : 0;
}

// ─── Pipeline entry points (consumed by webhook handlers) ────────────────────

export async function runMolarAndPersist(
  ctx: IngestContext,
): Promise<{ analysisMd: string; model: string; sessionNumber: number }> {
  const result = await runAnalysisWithFallback(
    MOLAR_SYSTEM_PROMPT,
    buildMolarUserPrompt(ctx.meta, ctx.transcriptText),
  );

  const sessionNumber = await nextSessionNumberForPatient(ctx.supabase, ctx.patientId);

  const { error } = await ctx.supabase.from('therapai_analyses').upsert(
    {
      session_id: ctx.sessionId,
      patient_id: ctx.patientId,
      therapist_id: ctx.therapistId,
      analysis_md: result.text,
      session_number: sessionNumber,
    },
    { onConflict: 'session_id' },
  );
  if (error) throw new Error(`analysis_save_failed: ${error.message}`);

  return { analysisMd: result.text, model: result.model, sessionNumber };
}

export async function runMolecularAndPersist(ctx: IngestContext): Promise<number> {
  const result = await runAnalysisWithFallback(
    MOLECULAR_SYSTEM_PROMPT,
    buildMolecularUserPrompt(ctx.meta, ctx.transcriptText),
  );
  const eventsCount = countMolecularEvents(result.text);

  const { error } = await ctx.supabase.from('therapai_molecular_analyses').upsert({
    session_id: ctx.sessionId,
    patient_id: ctx.patientId,
    therapist_id: ctx.therapistId,
    molecular_md: result.text,
    events_count: eventsCount,
    model_used: result.model,
  }, { onConflict: 'session_id' });
  if (error) throw new Error(`molecular_save_failed: ${error.message ?? 'unknown'}`);

  // Best-effort assertion extraction from molecular JSON appendix.
  try {
    await extractAndSaveMolecularAssertions(ctx, result.text);
  } catch (err) {
    console.error('[ingest] molecular assertion extraction failed (non-fatal)', err);
  }

  return eventsCount;
}

export async function extractAndSaveAssertions(ctx: IngestContext, analysisMd: string): Promise<number> {
  const prontuario = extractFencedJson(analysisMd);
  if (!prontuario) return 0;
  const assertions = deriveProntuarioAssertions(prontuario);
  if (assertions.length === 0) return 0;
  // Auto-confirm at insert (André's call 2026-05-15): no human-in-the-loop
  // confirmation step. Land assertions as already-confirmed so the UI shows
  // them directly without the pending bucket.
  const now = new Date().toISOString();
  const rows = assertions.map((a) => ({
    patient_id: ctx.patientId,
    therapist_id: ctx.therapistId,
    source_session_id: ctx.sessionId,
    dimension: a.dimension,
    sub_key: a.sub_key,
    assertion_text: a.assertion_text,
    structured_value: a.structured_value,
    confidence: null,
    source_kind: 'webhook_f1_json',
    model_emitted: null,
    requires_confirmation: false,
    confirmed_by_clinician_at: now,
  }));
  const { error } = await ctx.supabase.from('therapai_patient_memory_assertions').insert(rows);
  if (error) throw new Error(`assertions_insert_failed: ${error.message}`);
  return rows.length;
}

export async function extractAndSaveMolecularAssertions(ctx: IngestContext, molecularMd: string): Promise<number> {
  const molecular = extractFencedJson(molecularMd);
  if (!molecular) return 0;
  const assertions = deriveMolecularAssertions(molecular);
  if (assertions.length === 0) return 0;
  const now = new Date().toISOString();
  const rows = assertions.map((a) => ({
    patient_id: ctx.patientId,
    therapist_id: ctx.therapistId,
    source_session_id: ctx.sessionId,
    dimension: a.dimension,
    sub_key: a.sub_key,
    assertion_text: a.assertion_text,
    structured_value: a.structured_value,
    confidence: null,
    source_kind: 'webhook_molecular_json',
    model_emitted: null,
    requires_confirmation: false,
    confirmed_by_clinician_at: now,
  }));
  const { error } = await ctx.supabase.from('therapai_patient_memory_assertions').insert(rows);
  if (error) throw new Error(`molecular_assertions_insert_failed: ${error.message}`);
  return rows.length;
}

export async function rebuildLongitudinalForPatient(
  supabase: SupabaseClient,
  therapistId: string,
  patientId: string,
): Promise<void> {
  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('name')
    .eq('id', patientId)
    .single();
  if (!patient) return;

  const { data: analyses } = await supabase
    .from('therapai_analyses')
    .select('session_number, analysis_md, created_at, therapai_sessions(session_date)')
    .eq('patient_id', patientId);
  if (!analyses || analyses.length === 0) return;

  const withDate = analyses.map((a) => {
    const sess = (a as { therapai_sessions?: { session_date?: string | null } | Array<{ session_date?: string | null }> | null }).therapai_sessions;
    const session_date = Array.isArray(sess) ? sess[0]?.session_date ?? null : sess?.session_date ?? null;
    return {
      session_number: a.session_number as number | null,
      analysis_md: a.analysis_md as string | null,
      session_date: (session_date as string | null) ?? null,
    };
  });

  const result = await runAnalysisWithFallback(
    LONGITUDINAL_SYSTEM_PROMPT,
    buildLongitudinalUserPrompt(patient.name, withDate),
  );

  const sessionDates = withDate.map((a) => a.session_date).filter((d): d is string => !!d).sort();
  const createdAtDates = analyses.map((a) => a.created_at as string | null).filter((d): d is string => !!d).sort();
  const dates = sessionDates.length > 0 ? sessionDates : createdAtDates;
  const periodStart = dates[0]?.slice(0, 10) ?? null;
  const periodEnd = dates[dates.length - 1]?.slice(0, 10) ?? null;

  const { data: existing } = await supabase
    .from('therapai_longitudinal')
    .select('id')
    .eq('patient_id', patientId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('therapai_longitudinal')
      .update({
        report_md: result.text,
        sessions_count: analyses.length,
        period_start: periodStart,
        period_end: periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('therapai_longitudinal').insert({
      patient_id: patientId,
      therapist_id: therapistId,
      report_md: result.text,
      sessions_count: analyses.length,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }
}

// ─── Full pipeline orchestrator ──────────────────────────────────────────────

/**
 * Runs the full analysis pipeline against an already-created session row.
 * Caller is responsible for: creating therapai_sessions row in 'processing'
 * state (source-specific idempotency key), resolving therapist_id, and
 * identifying the matched patient_id. Once those are settled, call this
 * function; it handles molar → analysis save → session 'done' → molecular →
 * assertions → longitudinal.
 *
 * Throws ProviderError if both Claude and OpenAI exhausted retries on the
 * MOLAR pass (the gating step). Molecular / assertions / longitudinal
 * failures are caught and reported in the return value but do not throw.
 */
export async function runFullAnalysisPipeline(ctx: IngestContext): Promise<PipelineResult> {
  // 0. Passive transcript-quality probe — warn if the session looks dead-mic
  // (low char-per-minute ratio) so we catch garbage before spending inference
  // tokens. Doesn't block; downstream analysis still runs.
  // Threshold: ~100 chars/min covers normal therapy speech with pauses;
  // anything below is almost always silence, dropped audio, or wrong-language
  // detection. Tune in production by inspecting low_signal_transcript logs.
  const durationMin = Math.max(ctx.meta.durationMin || 0, 0.5);
  const charsPerMin = ctx.transcriptText.length / durationMin;
  if (charsPerMin < 100) {
    console.warn('[ingest] low_signal_transcript', {
      sessionId: ctx.sessionId,
      therapistId: ctx.therapistId,
      transcriptChars: ctx.transcriptText.length,
      durationMin,
      charsPerMin: Math.round(charsPerMin),
    });
  }

  // 1. Molar (gating)
  const molar = await runMolarAndPersist(ctx);

  // 2. Mark session done
  const { error: doneErr } = await ctx.supabase
    .from('therapai_sessions')
    .update({ status: 'done', model_used: molar.model, patient_id: ctx.patientId })
    .eq('id', ctx.sessionId);
  if (doneErr) {
    console.error('[ingest] session→done update failed', doneErr);
  }

  // 3. Molecular (best-effort)
  let molecularStatus: 'ok' | 'failed' = 'ok';
  let molecularEvents: number | undefined;
  try {
    molecularEvents = await runMolecularAndPersist(ctx);
  } catch (err) {
    console.error('[ingest] molecular failed (non-fatal)', err);
    molecularStatus = 'failed';
  }

  // 4. Assertions from prontuário JSON (best-effort)
  let assertionsMolarStatus: 'ok' | 'failed' = 'ok';
  try {
    await extractAndSaveAssertions(ctx, molar.analysisMd);
  } catch (err) {
    console.error('[ingest] assertion extraction failed (non-fatal)', err);
    assertionsMolarStatus = 'failed';
  }

  // (assertions from molecular were already attempted inside runMolecularAndPersist)
  const assertionsMolecularStatus: 'ok' | 'failed' | 'skipped' = molecularStatus === 'ok' ? 'ok' : 'skipped';

  // 5. Longitudinal rebuild — REMOVED 2026-05-15 from auto-pipeline.
  // André's call: don't auto-rebuild on every session ingest. The
  // longitudinal report is now generated on-demand via the "Atualizar
  // longitudinal" button on the patient page → POST /api/patient/[id]/longitudinal.
  // Returned status is fixed to 'skipped' to preserve the PipelineResult shape.
  const longitudinalStatus: 'ok' | 'failed' | 'skipped' = 'skipped';

  return {
    analysisMd: molar.analysisMd,
    molarModel: molar.model,
    sessionNumber: molar.sessionNumber,
    molecularStatus,
    molecularEvents,
    assertionsMolarStatus,
    assertionsMolecularStatus,
    longitudinalStatus,
  };
}
