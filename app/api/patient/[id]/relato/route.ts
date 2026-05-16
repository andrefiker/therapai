// app/api/patient/[id]/relato/route.ts
//
// "Relato Completo de Caso" — Brazilian-standard psychological case-handoff
// document, generated on-demand from the patient's full clinical history.
//
// Use case: clinician transferring a patient to another professional (CFP
// Resolução 06/2019). Produces the formal document a Brazilian psicólogo
// would write: identificação, queixa inicial, hipóteses, evolução,
// intervenções, medicações, recomendações ao receptor.
//
// Source data: all therapai_analyses (chronological) + therapai_longitudinal
// + confirmed therapai_patient_memory_assertions (especially medications,
// alliance_event, relational_frame dimensions).
//
// Inference: Claude → OpenAI fallback. ~12k max_tokens for the output
// (these documents are long).

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 180;

const ANTHROPIC_MODEL = 'claude-opus-4-5';
const OPENAI_MODEL = 'gpt-4o';
const GEMINI_MODEL = 'gemini-3-pro';

const RELATO_SYSTEM_PROMPT = `Você é o(a) próprio(a) psicólogo(a) clínico Dr. André Fiker (CRP 06/115147), especialista em Análise do Comportamento e Relational Frame Theory, redigindo em primeira pessoa o RELATO PSICOLÓGICO COMPLETO DE CASO de um(a) paciente seu(sua) que está sendo transferido(a) para outro(a) profissional.

CONTEXTO REGULATÓRIO: Conselho Federal de Psicologia, Resolução nº 06/2019 — Manual de Elaboração de Documentos Escritos Produzidos por Psicólogas(os). O documento a produzir é um RELATO PSICOLÓGICO (não laudo, não parecer). Linguagem técnica, terceira pessoa para o(a) paciente, primeira pessoa para o(a) clínico.

REGRAS DURAS:
- Não invente nada. Cada afirmação deve estar ancorada em dados das sessões, relatório longitudinal ou afirmações já consolidadas.
- Use as iniciais do(a) paciente — NUNCA o nome completo no corpo do documento (LGPD + sigilo profissional).
- Cite sessões específicas por número quando fizer afirmações datadas ("Em S5...", "A partir da S12...").
- Quando houver hipótese diagnóstica, marque CLARAMENTE como hipótese (não diagnóstico fechado) e cite o referencial usado (CID-11, DSM-5-TR).
- Linguagem comportamental-analítica + RFT: descreva contingências (antecedente → comportamento → consequência), funções, relações derivadas. Evite linguagem mentalista a-funcional.
- Se um dado não estiver disponível nas fontes, escreva "Não consta no registro" — NÃO preencha com plausibilidade.

ESTRUTURA OBRIGATÓRIA (12 seções, nesta ordem, com cabeçalhos exatos):

# RELATO PSICOLÓGICO DE CASO — TRANSFERÊNCIA DE PACIENTE

## 1. Identificação
- Iniciais do(a) paciente
- Idade / gênero (se constar)
- Estado civil / ocupação (se constar)
- Data de início do acompanhamento
- Número total de sessões realizadas
- Data deste relato

## 2. Motivo da transferência
[Breve. Caso o motivo seja institucional/administrativo, declarar como tal.]

## 3. Queixa inicial e demanda
[Como o caso se apresentou na avaliação inicial — quando possível, com expressão literal do(a) paciente entre aspas. Especificar quem trouxe a demanda.]

## 4. Histórico clínico relevante
[Antecedentes psiquiátricos, atendimentos psicológicos prévios, histórico médico relevante, eventos significativos de vida — quando constarem nas fontes.]

## 5. Avaliação e hipóteses
[Análise funcional do(s) comportamento(s)-alvo principais. Hipóteses diagnósticas marcadas como tal, com referência ao manual. Padrões relacionais (RFT) relevantes.]

## 6. Plano terapêutico adotado
[Frequência das sessões, modalidade (presencial/online), abordagem (descrever: PBT, ACT, FAP, análise contingencial). Objetivos terapêuticos pactuados.]

## 7. Evolução do caso
[Cronologia organizada da progressão clínica. Marcos: momentos de virada, padrões emergentes, regressões, períodos de estabilização. Citar sessões específicas. Mais extensa que as outras seções — é o coração do relato.]

## 8. Intervenções principais utilizadas
[Lista funcional das técnicas/protocolos aplicados, com data ou faixa de sessões. Exemplos: exposição funcional, defusão cognitiva, treino de mindfulness, FAP CRBs, contracondicionamento, etc.]

## 9. Estado clínico atual
[Quadro funcional ao final do acompanhamento por mim. Queixas ativas, padrões em curso, melhoras consolidadas, áreas ainda em processo.]

## 10. Medicações em uso (se houver)
[Extrair das fontes. Nome, dose se constar, prescritor se constar. Caso não conste, omitir esta seção ou escrever "Não consta uso de medicação nas fontes."]

## 11. Recomendações ao(à) profissional receptor(a)
[O QUE CONTINUAR fazendo (intervenções funcionando), O QUE NÃO ABRIR prematuramente (temas que precisam preparação), ALERTAS específicos (riscos, padrões delicados). Concreto e útil — esta seção é o presente clínico para o(a) colega.]

## 12. Prognóstico
[Hipótese de evolução baseada na progressão observada. Honesta — não cor-de-rosa nem catastrófica.]

---

Atenciosamente,

**André Fiker**
Psicólogo
CRP 06/115147

[Data do documento]

---

> Nota: Este documento é uma síntese clínica produzida com apoio de ferramenta de análise automatizada (TherapAI) sobre o material das sessões realizadas por mim. Foi revisado e validado antes da entrega. O conteúdo é hipótese-gerador para o(a) profissional receptor(a); não substitui sua avaliação clínica direta.`;

function buildUserPrompt(
  patientName: string,
  initials: string,
  totalSessions: number,
  firstSessionDate: string | null,
  lastSessionDate: string | null,
  longitudinal: { report_md: string | null; sessions_count: number | null; period_start: string | null; period_end: string | null } | null,
  analyses: { session_number: number | null; analysis_md: string | null; session_date: string | null }[],
  medications: Array<{ assertion_text: string; structured_value: unknown; created_at: string }>,
): string {
  const longBlock = longitudinal?.report_md
    ? `=== Relatório Longitudinal já consolidado ===\n${longitudinal.report_md}`
    : `=== Relatório Longitudinal ===\n(não há relatório longitudinal salvo — derive a evolução das análises de sessão)`;

  const analysesBlock = analyses
    .map((a) => `=== Sessão #${a.session_number ?? '?'} — ${a.session_date ?? 'sem data'} ===\n${a.analysis_md ?? '(sem análise)'}`)
    .join('\n\n');

  const medsBlock = medications.length > 0
    ? `=== Afirmações sobre medicação extraídas das sessões ===\n${medications.map((m) => `- ${m.created_at.slice(0, 10)}: ${m.assertion_text}${m.structured_value ? ` [${JSON.stringify(m.structured_value)}]` : ''}`).join('\n')}`
    : `=== Afirmações sobre medicação ===\n(não consta nas afirmações extraídas)`;

  return `Paciente: ${patientName} (use as iniciais "${initials}" no corpo do documento — proteja a identidade)
Total de sessões realizadas comigo: ${totalSessions}
Período de acompanhamento: ${firstSessionDate ?? '?'} → ${lastSessionDate ?? '?'}

${longBlock}

${medsBlock}

=== Análises de sessão (em ordem cronológica) ===

${analysesBlock}

Produza o RELATO PSICOLÓGICO COMPLETO DE CASO nas 12 seções obrigatórias, em primeira pessoa, em português brasileiro técnico, ancorado nas fontes acima.`;
}

class ProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'ProviderError'; }
}

function isFatalProviderError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? '').toLowerCase();
  if (msg.includes('credit balance') || msg.includes('credit_balance')) return true;
  if (msg.includes('insufficient_quota')) return true;
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  return false;
}

async function tryWithRetry(label: string, fn: () => Promise<string>): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await fn(); }
    catch (err) {
      console.error(`[relato] ${label} attempt ${attempt + 1} failed`, err);
      if (isFatalProviderError(err)) throw err;
      if (attempt === 0) { await sleep(1000); continue; }
      throw err;
    }
  }
  throw new Error(`${label}: unreachable`);
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const resp = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: { systemInstruction: systemPrompt, maxOutputTokens: 12000 },
  });
  const text = resp.text;
  if (!text) throw new Error('gemini_no_text');
  return text;
}

async function runWithFallback(systemPrompt: string, userPrompt: string): Promise<{ text: string; model: string }> {
  const geminiEnabled = !!process.env.GEMINI_API_KEY;
  let geminiErr: unknown = null;
  if (geminiEnabled) {
    try {
      const text = await tryWithRetry('gemini', () => callGemini(systemPrompt, userPrompt));
      return { text, model: GEMINI_MODEL };
    } catch (err) {
      geminiErr = err;
      console.error('[relato] gemini exhausted, falling back to claude', err);
    }
  }
  try {
    const text = await tryWithRetry('claude', () => callClaude(systemPrompt, userPrompt));
    return { text, model: ANTHROPIC_MODEL };
  } catch (claudeErr) {
    console.error('[relato] claude exhausted, falling back to openai', claudeErr);
    try {
      const text = await tryWithRetry('openai', () => callOpenAI(systemPrompt, userPrompt));
      return { text, model: OPENAI_MODEL };
    } catch (openaiErr) {
      const geminiMsg = geminiEnabled ? `gemini: ${(geminiErr as Error)?.message ?? 'unknown'} | ` : '';
      throw new ProviderError(`${geminiMsg}claude: ${(claudeErr as Error)?.message ?? 'unknown'} | openai: ${(openaiErr as Error)?.message ?? 'unknown'}`);
    }
  }
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 12000,
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
    max_tokens: 12000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error('openai_no_content');
  return text;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function patientInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((p) => p.length > 0 && !/^(de|da|do|das|dos|e)$/i.test(p))
    .map((p) => p.charAt(0).toUpperCase())
    .join('.') + '.';
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.json({ error: 'forbidden', message: 'Tenant não provisionado.' }, { status: 403 });

  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', patientId)
    .maybeSingle();
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Aggregate everything: all analyses (chronological), longitudinal, medications.
  const [analysesRes, longRes, medsRes] = await Promise.all([
    supabase.from('therapai_analyses')
      .select('session_number, analysis_md, created_at, therapai_sessions(session_date)')
      .eq('patient_id', patient.id)
      .order('session_number', { ascending: true }),
    supabase.from('therapai_longitudinal')
      .select('report_md, sessions_count, period_start, period_end')
      .eq('patient_id', patient.id)
      .maybeSingle(),
    supabase.from('therapai_patient_memory_assertions')
      .select('assertion_text, structured_value, created_at')
      .eq('patient_id', patient.id)
      .eq('dimension', 'medication')
      .is('dismissed_by_clinician_at', null)
      .order('created_at', { ascending: true }),
  ]);

  const analysesRaw = analysesRes.data ?? [];
  if (analysesRaw.length === 0) {
    return NextResponse.json({
      ok: false,
      error: 'no_analyses',
      message: 'Nenhuma análise de sessão disponível para este paciente. Não há base para gerar relato.',
    }, { status: 200 });
  }

  const analyses = analysesRaw.map((a) => {
    const sess = (a as { therapai_sessions?: { session_date?: string | null } | Array<{ session_date?: string | null }> | null }).therapai_sessions;
    const session_date = Array.isArray(sess) ? sess[0]?.session_date ?? null : sess?.session_date ?? null;
    return {
      session_number: a.session_number as number | null,
      analysis_md: a.analysis_md as string | null,
      session_date: (session_date as string | null) ?? null,
    };
  });

  const sessionDates = analyses.map((a) => a.session_date).filter((d): d is string => !!d).sort();
  const firstSessionDate = sessionDates[0] ?? null;
  const lastSessionDate = sessionDates[sessionDates.length - 1] ?? null;
  const initials = patientInitials(patient.name);

  let result: { text: string; model: string };
  try {
    result = await runWithFallback(
      RELATO_SYSTEM_PROMPT,
      buildUserPrompt(
        patient.name,
        initials,
        analyses.length,
        firstSessionDate,
        lastSessionDate,
        longRes.data ?? null,
        analyses,
        (medsRes.data ?? []) as Array<{ assertion_text: string; structured_value: unknown; created_at: string }>,
      ),
    );
  } catch (err) {
    console.error('[relato] both providers failed', err);
    if (err instanceof ProviderError) {
      return NextResponse.json({
        ok: false,
        error: 'all_providers_failed',
        message: 'Inferência indisponível no momento. Tente novamente em alguns minutos.',
      }, { status: 502 });
    }
    return NextResponse.json({ error: 'inference_error', message: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    relato: result.text,
    patient_name: patient.name,
    patient_initials: initials,
    sessions_used: analyses.length,
    has_longitudinal: !!longRes.data,
    medications_referenced: (medsRes.data ?? []).length,
    model_used: result.model,
    generated_at: new Date().toISOString(),
  });
}
