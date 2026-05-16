// app/api/briefing/[id]/route.ts
//
// F3 (ClinicaFacil V1.5 trio): pre-session briefing endpoint.
// Generates an 8-section "where are we?" briefing for a patient, ancored in
// their longitudinal report + last N molar analyses.
//
// Auth: createSupabaseServer() — RLS-filtered. If the patient row isn't visible
// to the authenticated user (RLS blocks it), this endpoint returns 404 — they
// can't see what they don't own.
//
// Inference fallback: Claude → OpenAI. (Codex CLI tier is CLI-only — Vercel
// can't shell out. If both providers fail with credit/auth errors, return 502.)

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import { getTherapist } from '@/lib/viewer';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-opus-4-5';
const OPENAI_MODEL = 'gpt-4o';
const GEMINI_MODEL = 'gemini-3-pro';
const DEFAULT_SESSIONS = 3;

const BRIEFING_SYSTEM_PROMPT = `Você é assistente clínico do Dr. André Fiker, especialista em Análise do Comportamento e RFT.
Sua tarefa: produzir uma síntese pré-sessão de até 800 palavras, ancorada nos dados clínicos fornecidos abaixo. Em português brasileiro técnico, sem preâmbulos.

REGRAS DURAS:
- Não invente dados. Tudo deve estar ancorado no relatório longitudinal ou nas análises de sessão fornecidas.
- Cite as sessões fonte (data ou número) quando fizer afirmações específicas.
- Use citações DIRETAS do paciente (entre aspas, fala literal) na seção 8 — não paráfrases analíticas.
- Se não houver evidência suficiente para uma seção, escreva "Não há sinal claro nas sessões fornecidas" — NÃO preencha com plausibilidade.
- Distinga claramente: o que o paciente disse | o que foi observado funcionalmente | o que é hipótese sua.

ESTRUTURA OBRIGATÓRIA (8 seções):

1. **Onde paramos** — fio principal da última sessão. Uma frase de continuidade direta.
2. **Contingências não resolvidas** — loops clínicos abertos. Antecedente → comportamento-alvo → consequência. Cite a sessão.
3. **Padrões de evitação ativos** — formas funcionais de esquiva/fuga, incluindo evitação experiencial e padrões de derivação relacional ligados a temas-âncora.
4. **Mudanças recentes** — movimentos clínicos detectados nas últimas sessões. Direção (progressão / regressão / oscilação) + sinal específico.
5. **Conduta terapêutica — espelho funcional do(a) clínico(a)** — quatro micro-blocos curtos, com tato e honestidade clínica:
   - **Aliança:** sinais recentes de fortalecimento, tensão, ruptura ou reparo. Se nada saliente, "Aliança estável; nenhum sinal recente."
   - **Pacing e timing:** intervenções recentes que entraram no momento certo; intervenções que podem ter sido prematuras ou tardias. Linguagem hipotética ("pode ter sido"), não acusatória.
   - **Intervenções que funcionaram:** o que produziu mudança observável nas últimas sessões — para repetir/aprofundar.
   - **Oportunidades possivelmente perdidas:** momentos em que algo clinicamente carregado emergiu e não foi explorado, ou foi explorado de modo que esquivou da intensidade. Útil para considerar retomar.
6. **Foco sugerido para a próxima sessão** — UMA aposta clínica concreta. Por que esse foco agora? Que dado da sessão anterior justifica?
7. **Riscos de desestabilização precoce** — temas que NÃO devem ser abertos agora. Por quê. Qual seria o sinal de que está pronto.
8. **Citações-âncora** — 2 a 4 falas diretas do paciente das análises mais recentes (literais, entre aspas). Marque a data/sessão de cada citação.

---

**Nota final obrigatória ao fim do briefing:**

> Este briefing é hipótese-gerador, destinado a apoiar a preparação clínica e supervisão. Não substitui o julgamento clínico em sessão.`;

function buildUserPrompt(
  patientName: string,
  longitudinal: { report_md: string | null; sessions_count: number | null; period_start: string | null; period_end: string | null } | null,
  recentAnalyses: { session_number: number | null; analysis_md: string | null; created_at: string | null }[],
): string {
  const longBlock = longitudinal && longitudinal.report_md
    ? `=== Relatório Longitudinal (${longitudinal.sessions_count ?? '?'} sessões${longitudinal.period_start ? `, ${longitudinal.period_start} → ${longitudinal.period_end}` : ''}) ===
${longitudinal.report_md}`
    : `=== Relatório Longitudinal ===
(sem relatório longitudinal disponível para este paciente)`;

  const recentBlock = recentAnalyses
    .map((a) => `=== Sessão #${a.session_number ?? '?'} (${a.created_at ? a.created_at.slice(0, 10) : 'sem data'}) ===
${a.analysis_md ?? '(sem análise)'}`)
    .join('\n\n');

  return `Paciente: ${patientName}

${longBlock}

${recentBlock}

Produza o briefing pré-sessão completo nas 8 seções obrigatórias.`;
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
      console.error(`[briefing] ${label} attempt ${attempt + 1} failed`, err);
      if (isFatalProviderError(err)) throw err;
      if (attempt === 0) { await sleep(800); continue; }
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
    config: { systemInstruction: systemPrompt, maxOutputTokens: 8000 },
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
      console.error('[briefing] gemini exhausted, falling back to claude', err);
    }
  }
  try {
    const text = await tryWithRetry('claude', () => callClaude(systemPrompt, userPrompt));
    return { text, model: ANTHROPIC_MODEL };
  } catch (claudeErr) {
    console.error('[briefing] claude exhausted, falling back to openai', claudeErr);
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

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  // Auth via RLS-aware client. If no user, middleware should have already redirected,
  // but we defend in depth.
  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const therapist = await getTherapist(supabase, user);
  if (!therapist) return NextResponse.json({ error: 'forbidden', message: 'Tenant não provisionado.' }, { status: 403 });

  // Pull patient + longitudinal + recent analyses. RLS filters to current user.
  const sessionsToInclude = (() => {
    const sp = req.nextUrl.searchParams.get('sessions');
    const n = sp ? Number(sp) : DEFAULT_SESSIONS;
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : DEFAULT_SESSIONS;
  })();

  const { data: patient, error: pErr } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', patientId)
    .maybeSingle();
  if (pErr) {
    console.error('[briefing] patient lookup failed', pErr);
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [{ data: longitudinal }, { data: analyses }] = await Promise.all([
    supabase.from('therapai_longitudinal')
      .select('report_md, sessions_count, period_start, period_end')
      .eq('patient_id', patient.id).maybeSingle(),
    supabase.from('therapai_analyses')
      .select('session_number, analysis_md, created_at')
      .eq('patient_id', patient.id)
      .order('created_at', { ascending: false })
      .limit(sessionsToInclude),
  ]);

  const recentAnalyses = (analyses ?? []).reverse(); // chronological order in the prompt

  if (recentAnalyses.length < 2) {
    return NextResponse.json({
      ok: false,
      error: 'insufficient_material',
      message: `Material insuficiente — ${recentAnalyses.length} análise(s) disponíveis. Pelo menos 2 sessões anteriores são necessárias.`,
      sessions_available: recentAnalyses.length,
    }, { status: 200 }); // 200 with ok=false; not a server error, just a refusal
  }

  let result: { text: string; model: string };
  try {
    result = await runWithFallback(
      BRIEFING_SYSTEM_PROMPT,
      buildUserPrompt(patient.name, longitudinal, recentAnalyses),
    );
  } catch (err) {
    console.error('[briefing] both providers failed', err);
    if (err instanceof ProviderError) {
      return NextResponse.json({
        ok: false,
        error: 'all_providers_failed',
        message: 'Inferência indisponível no momento. Tente novamente em alguns minutos ou use o CLI local com tier Codex.',
      }, { status: 502 });
    }
    return NextResponse.json({ error: 'inference_error', message: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    briefing: result.text,
    patient_name: patient.name,
    sessions_used: recentAnalyses.length,
    has_longitudinal: !!longitudinal,
    model_used: result.model,
    generated_at: new Date().toISOString(),
  });
}
