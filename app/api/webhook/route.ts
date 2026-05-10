// app/api/webhook/route.ts
//
// TherapAI — Fireflies webhook handler.
// Locked decisions: D9, D10, D11, D12 (DECISIONS.md). Spec: WEBHOOK_SPEC.md.
//
// Flow per request:
//   1. Verify X-Fireflies-Secret header.
//   2. Parse payload, extract Fireflies transcript ID.
//   3. Idempotency check: if fireflies_id already exists in therapai_sessions, no-op 200.
//   4. Insert session row (status='processing'); insert may race-fail on the unique index, treat as no-op.
//   5. Fetch full transcript via Fireflies GraphQL.
//   6. Identify patient (title-first; fallback to most-frequent non-André speaker).
//   7. Match against existing therapai_patients by fuzzy name; on no match → status='unidentified'.
//   8. Run molar analysis (Claude → retry → OpenAI fallback → mark failed).
//   9. Save analysis row.
//  10. Rebuild longitudinal report for the patient (every new session, per D9/D12).
//  11. Update session status='done', set model_used, set patient_id.
//  12. Return 200.
//
// Errors mid-flow update the session row to 'failed' and return 200 (don't make Fireflies retry).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export const runtime = 'nodejs';
export const maxDuration = 300; // Vercel Pro supports up to 300s; long transcripts need it.

// ─── Env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const FIREFLIES_API_KEY = process.env.FIREFLIES_API_KEY!;
const FIREFLIES_WEBHOOK_SECRET = process.env.FIREFLIES_WEBHOOK_SECRET!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

const ANTHROPIC_MODEL = 'claude-opus-4-5';
const OPENAI_MODEL = 'gpt-4o';

// V1 — single therapist hardcoded. Multi-tenant onboarding will derive this from auth.
// Post-RLS migration (D20): this UUID = auth.users.id for andrefiker@gmail.com.
// Service role bypasses RLS so the webhook still inserts/updates freely;
// the constant only needs to match the current owning therapist's auth uid.
// Old sentinel value (pre-D20): 'a0000000-0000-0000-0000-000000000001'.
const ANDRE_THERAPIST_ID = '60fdab49-c4dd-45cc-9e2b-51bec3504d35';

// Patterns to skip when matching speaker names — these are André's voice across speaker labels.
const ANDRE_NAME_PATTERNS = ['andre', 'andré', 'fiker', 'ghost'];

// Title-skipping patterns (Fireflies generic titles not derived from clinical content).
const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^meet\b/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d/i,
  /^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/i, // Google Meet codes like xyz-abc-def
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface FirefliesSentence {
  speaker_name: string;
  text: string;
  start_time: number;
}

interface FirefliesTranscript {
  id: string;
  title: string | null;
  date: number | string;
  duration: number;
  participants: string[];
  summary: { overview: string | null } | null;
  sentences: FirefliesSentence[];
}

interface FirefliesWebhookPayload {
  meetingId?: string;
  meeting_id?: string;
  transcriptId?: string;
  eventType?: string;
  event?: string;
}

// ─── Prompts (Brazilian Portuguese, behaviorism + RFT) ────────────────────────
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
  }
}
\`\`\``;

const LONGITUDINAL_SYSTEM_PROMPT = `Você é um clínico especialista em Análise do Comportamento e RFT.
Análise longitudinal rigorosa, em português brasileiro técnico, sintetizando todas as sessões anteriores deste paciente.
Sem preambles.

Seções obrigatórias:
1. Trajetória do Caso
2. Padrões Comportamentais Estáveis
3. Movimentos de Mudança
4. Análise RFT Longitudinal
5. Estado Atual
6. Vetores de Intervenção Prioritários
7. Prognóstico Atualizado
8. Indicadores de Alta / Reavaliação`;

// ─── Webhook entry point ──────────────────────────────────────────────────────
export async function POST(req: NextRequest): Promise<NextResponse> {
    // 1. Authenticate via shared secret. Accept from query param ?secret=
    //    (Fireflies webhook URL embedding -- V1 default) OR X-Fireflies-Secret
    //    header (manual tests). HMAC verification is Phase 2 per D7.
    const providedQuery = req.nextUrl.searchParams.get('secret');
    const providedHeader = req.headers.get('x-fireflies-secret');
    const provided = providedQuery ?? providedHeader;
    if (!provided || provided !== FIREFLIES_WEBHOOK_SECRET) {
          return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

  // 2. Parse payload.
  let payload: FirefliesWebhookPayload;
  try {
    payload = (await req.json()) as FirefliesWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const firefliesId = payload.transcriptId ?? payload.meetingId ?? payload.meeting_id;
  if (!firefliesId) {
    return NextResponse.json({ error: 'missing_transcript_id' }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 3. Idempotency: short-circuit if we've already processed this fireflies_id to completion.
  const { data: existing } = await supabase
    .from('therapai_sessions')
    .select('id, status')
    .eq('fireflies_id', firefliesId)
    .maybeSingle();

  if (existing && existing.status === 'done') {
    return NextResponse.json({ ok: true, status: 'already_processed', sessionId: existing.id });
  }

  // 4. Fetch full transcript from Fireflies.
  let transcript: FirefliesTranscript;
  try {
    transcript = await fetchFirefliesTranscript(firefliesId);
  } catch (err) {
    console.error('[webhook] fireflies fetch failed', err);
    await markSessionFailed(supabase, existing?.id, firefliesId, `fireflies_fetch_failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'fireflies_fetch' });
  }

  // 5. Build / update session row in 'processing' state.
  const sessionDate = normalizeSessionDate(transcript.date);
  const sessionId = await upsertProcessingSession(
    supabase,
    existing?.id,
    firefliesId,
    sessionDate,
    sentencesToTranscriptText(transcript.sentences),
  );

  // 6. Identify patient.
  const patientName = identifyPatient(transcript);
  let patientId: string | null = null;
  if (patientName) {
    patientId = await matchOrNullPatient(supabase, patientName);
  }

  if (!patientId) {
    const { error: unidErr } = await supabase
      .from('therapai_sessions')
      .update({ status: 'unidentified', patient_id: null })
      .eq('id', sessionId);
        if (unidErr) console.error('[webhook][supabase] unidentified update failed', { sessionId, firefliesId, error: unidErr });
    return NextResponse.json({
      ok: true,
      status: 'unidentified',
      sessionId,
      detectedName: patientName ?? null,
    });
  }

  // 7. Run molar analysis with retry + fallback.
  const transcriptText = sentencesToTranscriptText(transcript.sentences);
  let analysisMd: string;
  let modelUsed: string;
  try {
    const result = await runAnalysisWithFallback(
      MOLAR_SYSTEM_PROMPT,
      buildMolarUserPrompt(transcript, transcriptText),
    );
    analysisMd = result.text;
    modelUsed = result.model;
  } catch (err) {
    console.error('[webhook] analysis failed both providers', err);
    const reason = `analysis_failed: ${(err as Error).message}`;
    // Provider-side failure (credit / auth / transient) is retryable from outside Vercel
    // via the rescue script's Codex tier. Mark differently so the rescue picker can find it.
    if (err instanceof ProviderError) {
      await markSessionFailedRetryPending(supabase, sessionId, firefliesId, reason);
      return NextResponse.json({ ok: true, status: 'failed_retry_pending', reason: 'analysis_provider' });
    }
    await markSessionFailed(supabase, sessionId, firefliesId, reason);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'analysis' });
  }

  // 8. Save analysis row + update session row.
  const sessionNumber = await nextSessionNumberForPatient(supabase, patientId);

  const { error: analysisErr } = await supabase.from('therapai_analyses').upsert(
    {
      session_id: sessionId,
      patient_id: patientId,
      therapist_id: ANDRE_THERAPIST_ID,
      analysis_md: analysisMd,
      session_number: sessionNumber,
    },
    { onConflict: 'session_id' },
  );
    if (analysisErr) {
          console.error('[webhook][supabase] analysis upsert failed', { sessionId, firefliesId, error: analysisErr });
          await markSessionFailed(supabase, sessionId, firefliesId, `analysis_save_failed: ${analysisErr.message ?? 'unknown'}`);
          return NextResponse.json({ ok: true, status: 'failed', reason: 'analysis_save' });
    }

const { error: doneErr } =   await supabase
    .from('therapai_sessions')
    .update({
      patient_id: patientId,
      status: 'done',
      model_used: modelUsed,
    })
    .eq('id', sessionId);
    if (doneErr) {
          console.error('[webhook][supabase] sessions→done update failed', { sessionId, firefliesId, error: doneErr });
    }

  // 9. Rebuild longitudinal for this patient (D9/D12 — every new session).
  try {
    await rebuildLongitudinalForPatient(supabase, patientId);
  } catch (err) {
    // Longitudinal failure is non-fatal — session analysis is already saved.
    console.error('[webhook] longitudinal rebuild failed (non-fatal)', err);
  }

  return NextResponse.json({
    ok: true,
    status: 'done',
    sessionId,
    patientId,
    model: modelUsed,
  });
}

// ─── Fireflies GraphQL ────────────────────────────────────────────────────────
async function fetchFirefliesTranscript(id: string): Promise<FirefliesTranscript> {
  const query = `query Transcript($id: String!) {
    transcript(id: $id) {
      id title date duration participants
      summary { overview }
      sentences { speaker_name text start_time }
    }
  }`;

  const res = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIREFLIES_API_KEY}`,
    },
    body: JSON.stringify({ query, variables: { id } }),
  });

  if (!res.ok) {
    throw new Error(`fireflies_http_${res.status}`);
  }
  const json = (await res.json()) as { data?: { transcript?: FirefliesTranscript }; errors?: unknown };
  if (json.errors) {
    throw new Error(`fireflies_graphql_error: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data?.transcript) {
    throw new Error('fireflies_transcript_missing');
  }
  return json.data.transcript;
}

// ─── Patient identification ───────────────────────────────────────────────────
function identifyPatient(transcript: FirefliesTranscript): string | null {
  // 1. Try title-derived name.
  const title = (transcript.title ?? '').trim();
  if (title && !GENERIC_TITLE_PATTERNS.some((re) => re.test(title))) {
    if (!containsAndrePattern(title)) {
      // Title is the patient's name (clinician-set convention).
      return title;
    }
  }

  // 2. Fallback: most-frequent non-André speaker.
  const counts = new Map<string, number>();
  for (const sentence of transcript.sentences) {
    const name = (sentence.speaker_name ?? '').trim();
    if (!name) continue;
    if (containsAndrePattern(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0][0];
}

function containsAndrePattern(s: string): boolean {
  const lower = s.toLowerCase();
  return ANDRE_NAME_PATTERNS.some((p) => lower.includes(p));
}

async function matchOrNullPatient(supabase: SupabaseClient, candidateName: string): Promise<string | null> {
  const { data: patients } = await supabase
    .from('therapai_patients')
    .select('id, name')
    .eq('therapist_id', ANDRE_THERAPIST_ID);
  if (!patients || patients.length === 0) return null;

  const candidate = candidateName.trim().toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const p of patients) {
    const score = similarity(candidate, (p.name ?? '').toLowerCase());
    if (!best || score > best.score) best = { id: p.id, score };
  }
  // Threshold 0.85 — adjust per accuracy observed in production.
  return best && best.score >= 0.85 ? best.id : null;
}

// Levenshtein-based similarity, normalized to [0, 1]. Cheap; fine for short patient names.
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

// ─── Sessions table helpers ───────────────────────────────────────────────────
async function upsertProcessingSession(
  supabase: SupabaseClient,
  existingId: string | undefined,
  firefliesId: string,
  sessionDate: string,
  transcriptText: string,
): Promise<string> {
  if (existingId) {
    await supabase
      .from('therapai_sessions')
      .update({
        status: 'processing',
        transcript_text: transcriptText,
        session_date: sessionDate,
      })
      .eq('id', existingId);
    return existingId;
  }
  const { data, error } = await supabase
    .from('therapai_sessions')
    .insert({
      therapist_id: ANDRE_THERAPIST_ID,
      session_date: sessionDate,
      transcript_text: transcriptText,
      status: 'processing',
      fireflies_id: firefliesId,
    })
    .select('id')
    .single();
  if (error || !data) {
    // Race: another webhook already inserted. Fetch and reuse.
    const { data: existing2 } = await supabase
      .from('therapai_sessions')
      .select('id')
      .eq('fireflies_id', firefliesId)
      .single();
    if (existing2) return existing2.id;
    throw new Error(`session_insert_failed: ${error?.message ?? 'unknown'}`);
  }
  return data.id;
}

async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<void> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed');
}

async function markSessionFailedRetryPending(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<void> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed_retry_pending');
}

async function markSessionWithStatus(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
  status: 'failed' | 'failed_retry_pending',
): Promise<void> {
  if (sessionId) {
    const { error } = await supabase
      .from('therapai_sessions')
      .update({ status, model_used: reason.slice(0, 200) })
      .eq('id', sessionId);
    if (error) {
      console.error(`[webhook][supabase] markSession(${status}) update failed`, { sessionId, firefliesId, reason, error });
    }
    return;
  }
  const { error } = await supabase
    .from('therapai_sessions')
    .upsert(
      {
        therapist_id: ANDRE_THERAPIST_ID,
        session_date: new Date().toISOString().slice(0, 10),
        status,
        fireflies_id: firefliesId,
        model_used: reason.slice(0, 200),
      },
      { onConflict: 'fireflies_id' },
    );
  if (error) {
    console.error(`[webhook][supabase] markSession(${status}) upsert failed`, { firefliesId, reason, error });
  }
}

async function nextSessionNumberForPatient(supabase: SupabaseClient, patientId: string): Promise<number> {
  const { count } = await supabase
    .from('therapai_analyses')
    .select('id', { count: 'exact', head: true })
    .eq('patient_id', patientId);
  return (count ?? 0) + 1;
}

// ─── Inference (Claude primary → OpenAI fallback) ─────────────────────────────
//
// Provider-error classification:
//   - credit_balance_too_low / 401 auth / 403 forbidden → fatal for THIS provider; do not retry.
//   - 429 rate-limit / 5xx / network → transient; retry once with small backoff.
//
// When both providers exhaust, throw ProviderError so the caller can mark the session
// as 'failed_retry_pending' (retryable by rescue script with Codex tier — outside Vercel).

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

function isFatalProviderError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? '').toLowerCase();
  if (msg.includes('credit balance') || msg.includes('credit_balance')) return true;
  if (msg.includes('insufficient_quota')) return true;
  // Anthropic SDK / OpenAI SDK throw with .status on APIError
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  return false;
}

async function tryProviderWithRetry(
  label: string,
  fn: () => Promise<string>,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      console.error(`[webhook] ${label} attempt ${attempt + 1} failed`, err);
      if (isFatalProviderError(err)) {
        // No point retrying — credit / auth issue.
        throw err;
      }
      if (attempt === 0) {
        await sleep(800);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: unreachable`);
}

async function runAnalysisWithFallback(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; model: string }> {
  // Try Claude first.
  try {
    const text = await tryProviderWithRetry('claude', () => callClaude(systemPrompt, userPrompt));
    return { text, model: ANTHROPIC_MODEL };
  } catch (claudeErr) {
    console.error('[webhook] claude exhausted, falling back to openai', claudeErr);
    // Fallback to OpenAI.
    try {
      const text = await tryProviderWithRetry('openai', () => callOpenAI(systemPrompt, userPrompt));
      return { text, model: OPENAI_MODEL };
    } catch (openaiErr) {
      // Both providers failed — surface a typed error so caller can route to failed_retry_pending.
      const claudeMsg = (claudeErr as Error)?.message ?? 'unknown';
      const openaiMsg = (openaiErr as Error)?.message ?? 'unknown';
      throw new ProviderError(`claude: ${claudeMsg} | openai: ${openaiMsg}`);
    }
  }
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
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
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Prompt builders ──────────────────────────────────────────────────────────
function buildMolarUserPrompt(t: FirefliesTranscript, transcriptText: string): string {
  const meta = [
    `Título: ${t.title ?? '(sem título)'}`,
    `Data: ${normalizeSessionDate(t.date)}`,
    `Duração: ${Math.round(t.duration)}min`,
    `Participantes: ${(t.participants ?? []).join(', ') || '—'}`,
    t.summary?.overview ? `Resumo Fireflies: ${t.summary.overview}` : null,
  ].filter(Boolean).join('\n');

  return `Transcrição da sessão clínica abaixo. Produza a análise completa nas 7 seções obrigatórias.

${meta}

---

${transcriptText}`;
}

function buildLongitudinalUserPrompt(patientName: string, analyses: { session_number: number | null; analysis_md: string | null; }[]): string {
  const sorted = [...analyses].sort((a, b) => (a.session_number ?? 0) - (b.session_number ?? 0));
  const body = sorted
    .map((a) => `=== Sessão ${a.session_number ?? '?'} ===\n${a.analysis_md ?? ''}`)
    .join('\n\n');
  return `Análises de sessão para ${patientName} abaixo. Sintetize a análise longitudinal completa nas 8 seções obrigatórias.

${body}`;
}

// ─── Longitudinal rebuild ─────────────────────────────────────────────────────
async function rebuildLongitudinalForPatient(supabase: SupabaseClient, patientId: string): Promise<void> {
  const { data: patient } = await supabase
    .from('therapai_patients')
    .select('name')
    .eq('id', patientId)
    .single();
  if (!patient) return;

  const { data: analyses } = await supabase
    .from('therapai_analyses')
    .select('session_number, analysis_md, created_at')
    .eq('patient_id', patientId);
  if (!analyses || analyses.length === 0) return;

  const result = await runAnalysisWithFallback(
    LONGITUDINAL_SYSTEM_PROMPT,
    buildLongitudinalUserPrompt(patient.name, analyses),
  );

  const dates = analyses
    .map((a) => a.created_at as string | null)
    .filter((d): d is string => !!d)
    .sort();
  const periodStart = dates[0]?.slice(0, 10) ?? null;
  const periodEnd = dates[dates.length - 1]?.slice(0, 10) ?? null;

  // Upsert pattern: one longitudinal row per patient.
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
      therapist_id: ANDRE_THERAPIST_ID,
      report_md: result.text,
      sessions_count: analyses.length,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sentencesToTranscriptText(sentences: FirefliesSentence[]): string {
  return sentences
    .map((s) => {
      const ts = formatTimestamp(s.start_time);
      return `[${ts}] ${s.speaker_name}: ${s.text}`;
    })
    .join('\n');
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function normalizeSessionDate(input: number | string): string {
  if (typeof input === 'number') {
    return new Date(input).toISOString().slice(0, 10);
  }
  // ISO string or date — slice to YYYY-MM-DD.
  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}
