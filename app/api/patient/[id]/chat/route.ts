// app/api/patient/[id]/chat/route.ts
//
// F4 V1: case chat — single-turn Q&A over a patient's full clinical history.
// Loads longitudinal + last 5 molar + last 5 molecular + confirmed assertions
// + recent pending assertions; runs one inference call with mandatory citation
// rule; returns {answer_md, sources}.
//
// V1 explicitly NOT included: pgvector retrieval (context fits in single call
// at current patient scale), persistent chat history, streaming, multi-turn,
// document-quote extraction beyond what the model emits inline.

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ANTHROPIC_MODEL = 'claude-opus-4-5';
const OPENAI_MODEL = 'gpt-4o';
const RECENT_SESSIONS = 5;
const PENDING_LIMIT = 30;
const HISTORY_LIMIT = 20;

// GET — return the last N queries for this patient. Used by CaseChat on mount.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: patient } = await supabase
    .from('therapai_patients').select('id').eq('id', patientId).maybeSingle();
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: history } = await supabase
    .from('therapai_case_queries')
    .select('id, question, answer_md, model_used, sources_provided, context_size, inference_ok, error_text, created_at')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  return NextResponse.json({ ok: true, history: history ?? [] });
}

const CHAT_SYSTEM_PROMPT = `Você é assistente clínico do Dr. André Fiker, especialista em Análise do Comportamento e RFT.

Sua tarefa: responder à pergunta do clínico sobre um paciente específico, usando APENAS o material clínico fornecido abaixo (relatório longitudinal + análises molares recentes + análises moleculares recentes + afirmações de memória do paciente). Em português brasileiro técnico, sem preâmbulos.

REGRAS DURAS DE CITAÇÃO:
- Para cada afirmação clínica que você fizer na resposta, cite a fonte entre colchetes: [Longitudinal], [Sessão #N], [Sessão #N molecular], [Afirmação confirmada: dimensão], ou [Pendente: dimensão].
- Se a pergunta NÃO PODE ser respondida com o material fornecido, retorne EXATAMENTE: "Não há sinal suficiente no material fornecido para responder essa pergunta com rigor clínico. Sessões adicionais ou conteúdo de transcrição podem ser necessários."
- NÃO INVENTE. Não infira fatos não presentes. Hipóteses são bem-vindas quando claramente marcadas como hipótese e ancoradas em sinais específicos da fonte.

ESTRUTURA DA RESPOSTA:
- Resposta direta à pergunta primeiro (3-15 parágrafos curtos conforme necessário).
- Cada afirmação clínica acompanhada de citação inline.
- Final da resposta: bloco "## Fontes consultadas" com lista das fontes que efetivamente sustentaram a resposta (não tudo que foi fornecido, apenas o que foi citado).

Tom: peer-clinical. Direto. Sem padding. Sem moralizar. Distinga "fato observado" de "hipótese clínica" sempre que houver risco de confusão.`;

interface ChatRequestBody { question?: string }

interface SourceRef {
  kind: 'longitudinal' | 'molar' | 'molecular' | 'assertion_confirmed' | 'assertion_pending';
  session_id?: string;
  session_number?: number | null;
  assertion_id?: string;
  dimension?: string;
  description: string;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id: patientId } = await params;
  if (!patientId) return NextResponse.json({ error: 'missing_patient_id' }, { status: 400 });

  let body: ChatRequestBody;
  try { body = (await req.json()) as ChatRequestBody; }
  catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const question = body.question?.trim();
  if (!question) return NextResponse.json({ error: 'missing_question' }, { status: 400 });
  if (question.length > 2000) return NextResponse.json({ error: 'question_too_long', max: 2000 }, { status: 400 });

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Confirm patient is visible to caller (RLS handles ownership)
  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('id', patientId)
    .maybeSingle();
  if (!patient) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Pull full context in parallel
  const [longRes, molarRes, molecularRes, confirmedRes, pendingRes] = await Promise.all([
    supabase.from('therapai_longitudinal')
      .select('report_md, sessions_count, period_start, period_end')
      .eq('patient_id', patientId).maybeSingle(),
    supabase.from('therapai_analyses')
      .select('session_id, session_number, analysis_md, created_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(RECENT_SESSIONS),
    supabase.from('therapai_molecular_analyses')
      .select('session_id, molecular_md, events_count, created_at')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(RECENT_SESSIONS),
    supabase.rpc('therapai_patient_state', { p_patient_id: patientId }),
    supabase.from('therapai_patient_memory_assertions')
      .select('id, dimension, sub_key, assertion_text')
      .eq('patient_id', patientId)
      .is('confirmed_by_clinician_at', null)
      .is('dismissed_by_clinician_at', null)
      .is('superseded_by_id', null)
      .order('created_at', { ascending: false })
      .limit(PENDING_LIMIT),
  ]);

  const longitudinal = longRes.data;
  const molarRecent = (molarRes.data ?? []).reverse(); // chronological order
  const molecularRecent = (molecularRes.data ?? []).reverse();
  const confirmedState = confirmedRes.data ?? [];
  const pendingAssertions = pendingRes.data ?? [];

  const totalSignal = (longitudinal ? 1 : 0) + molarRecent.length + molecularRecent.length + confirmedState.length + pendingAssertions.length;
  if (totalSignal === 0) {
    return NextResponse.json({
      ok: false,
      error: 'no_context',
      message: 'Sem nenhum material clínico para este paciente. Aguardando primeira análise.',
    });
  }

  // Build the user prompt
  const blocks: string[] = [`Paciente: ${patient.name}`, '', `PERGUNTA DO CLÍNICO:`, question, ''];

  if (longitudinal?.report_md) {
    blocks.push('=== Relatório Longitudinal ===');
    blocks.push(`Sessões cobertas: ${longitudinal.sessions_count ?? '?'} (${longitudinal.period_start ?? '?'} → ${longitudinal.period_end ?? '?'})`);
    blocks.push(longitudinal.report_md);
    blocks.push('');
  }

  if (confirmedState.length > 0) {
    blocks.push('=== Estado clínico confirmado ===');
    type ConfirmedRow = { dimension: string; sub_key: string | null; assertion_text: string };
    for (const c of confirmedState as ConfirmedRow[]) {
      blocks.push(`- [${c.dimension}${c.sub_key ? ` · ${c.sub_key}` : ''}] ${c.assertion_text}`);
    }
    blocks.push('');
  }

  if (pendingAssertions.length > 0) {
    blocks.push('=== Afirmações pendentes (não confirmadas pelo clínico) ===');
    for (const p of pendingAssertions) {
      blocks.push(`- [${p.dimension}${p.sub_key ? ` · ${p.sub_key}` : ''}] ${p.assertion_text}`);
    }
    blocks.push('');
  }

  for (const a of molarRecent) {
    blocks.push(`=== Sessão #${a.session_number ?? '?'} — análise molar (${a.created_at ? (a.created_at as string).slice(0, 10) : 'sem data'}) ===`);
    blocks.push(a.analysis_md ?? '(sem análise)');
    blocks.push('');
  }

  for (const m of molecularRecent) {
    blocks.push(`=== Sessão (molecular, ${m.created_at ? (m.created_at as string).slice(0, 10) : 'sem data'}) — ${m.events_count ?? '?'} eventos discretos ===`);
    blocks.push(m.molecular_md ?? '(sem análise molecular)');
    blocks.push('');
  }

  blocks.push('Responda à pergunta usando APENAS o material acima. Cite as fontes inline conforme as regras.');

  const userPrompt = blocks.join('\n');

  // Inference with two-tier fallback (no Codex on Vercel)
  let result: { text: string; model: string };
  try {
    result = await runChatInference(userPrompt);
  } catch (err) {
    console.error('[chat] inference failed', err);
    // Persist the failed attempt for audit trail
    await supabase.from('therapai_case_queries').insert({
      patient_id: patient.id,
      therapist_id: user.id,
      question,
      answer_md: null,
      model_used: null,
      sources_provided: null,
      context_size: {
        longitudinal: !!longitudinal,
        molar_recent: molarRecent.length,
        molecular_recent: molecularRecent.length,
        confirmed_assertions: confirmedState.length,
        pending_assertions: pendingAssertions.length,
      },
      inference_ok: false,
      error_text: (err as Error).message?.slice(0, 500) ?? 'unknown',
    });
    return NextResponse.json({
      ok: false,
      error: 'inference_failed',
      message: 'Não foi possível gerar a resposta no momento (provedores indisponíveis).',
    }, { status: 502 });
  }

  // Build source descriptors (what was provided to the model — note: not necessarily what was cited)
  const sources: SourceRef[] = [];
  if (longitudinal?.report_md) {
    sources.push({ kind: 'longitudinal', description: `Relatório longitudinal (${longitudinal.sessions_count ?? '?'} sessões)` });
  }
  for (const a of molarRecent) {
    sources.push({
      kind: 'molar',
      session_id: a.session_id as string,
      session_number: a.session_number,
      description: `Sessão #${a.session_number ?? '?'} molar — ${(a.created_at as string)?.slice(0, 10) ?? 'sem data'}`,
    });
  }
  for (const m of molecularRecent) {
    sources.push({
      kind: 'molecular',
      session_id: m.session_id as string,
      description: `Molecular — ${(m.created_at as string)?.slice(0, 10) ?? 'sem data'} · ${m.events_count ?? '?'} eventos`,
    });
  }
  type ConfirmedRow = { dimension: string; sub_key: string | null };
  for (const c of confirmedState as ConfirmedRow[]) {
    sources.push({
      kind: 'assertion_confirmed',
      dimension: c.dimension,
      description: `Confirmada · ${c.dimension}${c.sub_key ? ` · ${c.sub_key}` : ''}`,
    });
  }
  for (const p of pendingAssertions) {
    sources.push({
      kind: 'assertion_pending',
      assertion_id: p.id,
      dimension: p.dimension,
      description: `Pendente · ${p.dimension}${p.sub_key ? ` · ${p.sub_key}` : ''}`,
    });
  }

  const contextSize = {
    longitudinal: !!longitudinal,
    molar_recent: molarRecent.length,
    molecular_recent: molecularRecent.length,
    confirmed_assertions: confirmedState.length,
    pending_assertions: pendingAssertions.length,
  };

  // Persist the Q&A for audit trail + history-from-DB. Don't fail the request if this fails.
  const { data: persisted, error: insertErr } = await supabase.from('therapai_case_queries').insert({
    patient_id: patient.id,
    therapist_id: user.id,
    question,
    answer_md: result.text,
    model_used: result.model,
    sources_provided: sources,
    context_size: contextSize,
    inference_ok: true,
  }).select('id, created_at').maybeSingle();
  if (insertErr) {
    console.error('[chat] persist failed (non-fatal)', insertErr);
  }

  return NextResponse.json({
    ok: true,
    id: persisted?.id ?? null,
    answer_md: result.text,
    model_used: result.model,
    patient_name: patient.name,
    sources_provided: sources,
    context_size: contextSize,
    generated_at: persisted?.created_at ?? new Date().toISOString(),
  });
}

async function runChatInference(userPrompt: string): Promise<{ text: string; model: string }> {
  // Try Claude first
  try {
    const text = await callClaude(userPrompt);
    return { text, model: ANTHROPIC_MODEL };
  } catch (err) {
    console.error('[chat] claude failed, trying openai', err);
    const text = await callOpenAI(userPrompt);
    return { text, model: OPENAI_MODEL };
  }
}

async function callClaude(userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const resp = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 4000,
    system: CHAT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('claude_no_text_block');
  return block.text;
}

async function callOpenAI(userPrompt: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const resp = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });
  const text = resp.choices[0]?.message?.content;
  if (!text) throw new Error('openai_no_content');
  return text;
}
