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

// D11 molecular tier — discrete-event ABC analysis. Runs as a SECOND inference pass
// after molar succeeds. Best-effort: if molecular fails, session still completes via molar.
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

CONTAGEM FINAL: Termine com "**Eventos analisados:** N" para o N entre 3 e 7.`;

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
    const mark = await markSessionFailed(supabase, existing?.id, firefliesId, `fireflies_fetch_failed: ${(err as Error).message}`);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'fireflies_fetch', save: mark });
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
    let saveOk = !unidErr;
    let saveErr = unidErr?.message;
    if (unidErr) {
      console.error('[webhook][supabase] unidentified update failed', { sessionId, firefliesId, error: unidErr });
    }
    const verified = saveOk ? await verifyRowStatus(supabase, sessionId, 'unidentified') : false;
    if (saveOk && !verified) {
      console.error('[webhook][supabase] unidentified update returned ok but post-write verify failed', { sessionId, firefliesId });
    }
    return NextResponse.json({
      ok: true,
      status: 'unidentified',
      sessionId,
      detectedName: patientName ?? null,
      save: { ok: saveOk, verified, sessionId, error: saveErr },
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
      const mark = await markSessionFailedRetryPending(supabase, sessionId, firefliesId, reason);
      return NextResponse.json({ ok: true, status: 'failed_retry_pending', reason: 'analysis_provider', save: mark });
    }
    const mark = await markSessionFailed(supabase, sessionId, firefliesId, reason);
    return NextResponse.json({ ok: true, status: 'failed', reason: 'analysis', save: mark });
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
      const mark = await markSessionFailed(supabase, sessionId, firefliesId, `analysis_save_failed: ${analysisErr.message ?? 'unknown'}`);
      return NextResponse.json({ ok: true, status: 'failed', reason: 'analysis_save', save: mark });
    }

  const { error: doneErr } = await supabase
    .from('therapai_sessions')
    .update({
      patient_id: patientId,
      status: 'done',
      model_used: modelUsed,
    })
    .eq('id', sessionId);
  const doneVerified = !doneErr ? await verifyRowStatus(supabase, sessionId, 'done') : false;
  if (doneErr) {
    console.error('[webhook][supabase] sessions→done update failed', { sessionId, firefliesId, error: doneErr });
  } else if (!doneVerified) {
    console.error('[webhook][supabase] sessions→done update returned ok but post-write verify failed', { sessionId, firefliesId });
  }

  // 8b. D11 molecular analysis — best-effort second pass. Failure here is non-fatal;
  //     session is already 'done' via molar. Future re-runs (rescue script) can backfill.
  try {
    await runAndSaveMolecular(supabase, sessionId, patientId, transcript, transcriptText);
  } catch (err) {
    console.error('[webhook] molecular analysis failed (non-fatal)', err);
  }

  // 8c. D25 F2+F5 — extract clinical state assertions from the F1 prontuário JSON
  //     appendix in molar analysis_md. Best-effort. All assertions inserted with
  //     requires_confirmation=true; clinician confirms/dismisses via dashboard.
  try {
    await extractAndSaveAssertions(supabase, sessionId, patientId, analysisMd);
  } catch (err) {
    console.error('[webhook] assertion extraction failed (non-fatal)', err);
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
    save: { ok: !doneErr, verified: doneVerified, sessionId, error: doneErr?.message },
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

// E7 closure: markSession* now returns a typed result + does post-write verification
// SELECT, so callers can surface the real save state in the response. Previously these
// helpers returned void and silent supabase-js failures left "ghost" sessions invisible
// in the dashboard. Now: the response body always includes `save: {ok, verified, error?}`.
interface MarkResult {
  ok: boolean;          // true if the write call returned no error
  verified: boolean;    // true if a follow-up SELECT confirms the status actually stuck
  sessionId?: string;   // resolved session id (the existing one, or fetched after upsert)
  error?: string;       // first error message encountered, if any
}

async function markSessionFailed(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<MarkResult> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed');
}

async function markSessionFailedRetryPending(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
): Promise<MarkResult> {
  return markSessionWithStatus(supabase, sessionId, firefliesId, reason, 'failed_retry_pending');
}

async function markSessionWithStatus(
  supabase: SupabaseClient,
  sessionId: string | undefined,
  firefliesId: string,
  reason: string,
  status: 'failed' | 'failed_retry_pending',
): Promise<MarkResult> {
  if (sessionId) {
    const { error } = await supabase
      .from('therapai_sessions')
      .update({ status, model_used: reason.slice(0, 200) })
      .eq('id', sessionId);
    if (error) {
      console.error(`[webhook][supabase] markSession(${status}) update failed`, { sessionId, firefliesId, reason, error });
      return { ok: false, verified: false, sessionId, error: error.message };
    }
    const verified = await verifyRowStatus(supabase, sessionId, status);
    if (!verified) {
      console.error(`[webhook][supabase] markSession(${status}) update returned ok but post-write verify failed`, { sessionId, firefliesId });
    }
    return { ok: true, verified, sessionId };
  }
  // Upsert path — no existing sessionId. We need to capture the row's id after upsert
  // so verification can confirm it stuck.
  const { data, error } = await supabase
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
    )
    .select('id')
    .maybeSingle();
  if (error) {
    console.error(`[webhook][supabase] markSession(${status}) upsert failed`, { firefliesId, reason, error });
    return { ok: false, verified: false, error: error.message };
  }
  if (!data?.id) {
    // Race or quirk: upsert reported ok but no id returned. Look it up.
    const { data: lookup } = await supabase
      .from('therapai_sessions')
      .select('id')
      .eq('fireflies_id', firefliesId)
      .maybeSingle();
    if (!lookup?.id) {
      console.error(`[webhook][supabase] markSession(${status}) upsert: row not found post-write`, { firefliesId });
      return { ok: false, verified: false, error: 'row_not_found_post_upsert' };
    }
    const verified = await verifyRowStatus(supabase, lookup.id, status);
    return { ok: true, verified, sessionId: lookup.id };
  }
  const verified = await verifyRowStatus(supabase, data.id, status);
  if (!verified) {
    console.error(`[webhook][supabase] markSession(${status}) upsert returned ok but post-write verify failed`, { firefliesId, sessionId: data.id });
  }
  return { ok: true, verified, sessionId: data.id };
}

async function verifyRowStatus(supabase: SupabaseClient, sessionId: string, expected: string): Promise<boolean> {
  const { data } = await supabase
    .from('therapai_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  return data?.status === expected;
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

// ─── D25 F2+F5 assertion extraction ──────────────────────────────────────────
// Parses the F1 prontuário JSON appendix from analysis_md and inserts one row
// per (dimension, sub_key) into therapai_patient_memory_assertions. All rows
// default to requires_confirmation=true — clinician must confirm via dashboard
// before they enter the canonical patient_state.

type AssertionDimension =
  | 'complaint'
  | 'diagnosis_cid'
  | 'medication'
  | 'risk_factor'
  | 'behavioral_theme'
  | 'relational_frame'
  | 'alliance_event'
  | 'historical_event'
  | 'intervention';

interface AssertionInsert {
  dimension: AssertionDimension;
  sub_key: string | null;
  assertion_text: string;
  structured_value: unknown;
}

function extractFencedJson(md: string): unknown | null {
  // Match the LAST fenced ```json ... ``` block in analysis_md (F1 appendix is at end).
  const re = /```json\s*\n([\s\S]*?)\n```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) last = m[1];
  if (!last) return null;
  try { return JSON.parse(last); }
  catch { return null; }
}

function deriveAssertions(prontuario: unknown): AssertionInsert[] {
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

  return out;
}

async function extractAndSaveAssertions(
  supabase: SupabaseClient,
  sessionId: string,
  patientId: string,
  analysisMd: string,
): Promise<void> {
  const prontuario = extractFencedJson(analysisMd);
  if (!prontuario) {
    console.log('[webhook][assertions] no F1 JSON appendix found in molar; skipping extraction');
    return;
  }
  const assertions = deriveAssertions(prontuario);
  if (assertions.length === 0) {
    console.log('[webhook][assertions] F1 JSON parsed but produced 0 assertions');
    return;
  }
  const rows = assertions.map((a) => ({
    patient_id: patientId,
    therapist_id: ANDRE_THERAPIST_ID,
    source_session_id: sessionId,
    dimension: a.dimension,
    sub_key: a.sub_key,
    assertion_text: a.assertion_text,
    structured_value: a.structured_value,
    confidence: null, // deterministic JSON parse, not LLM-emitted confidence
    source_kind: 'webhook_f1_json',
    model_emitted: null,
    requires_confirmation: true,
  }));
  const { error } = await supabase.from('therapai_patient_memory_assertions').insert(rows);
  if (error) {
    throw new Error(`assertions_insert_failed: ${error.message}`);
  }
  console.log(`[webhook][assertions] inserted ${rows.length} pending assertions for session ${sessionId}`);
}

// ─── D11 molecular analysis ───────────────────────────────────────────────────
// Discrete-event ABC analysis. Best-effort: failures logged, don't propagate.

function buildMolecularUserPrompt(t: FirefliesTranscript, transcriptText: string): string {
  const meta = [
    `Título: ${t.title ?? '(sem título)'}`,
    `Data: ${normalizeSessionDate(t.date)}`,
    `Duração: ${Math.round(t.duration)}min`,
  ].join('\n');

  return `Transcrição da sessão clínica abaixo. Identifique 3-7 eventos clínicos discretos e analise cada um separadamente.

${meta}

---

${transcriptText}`;
}

function countMolecularEvents(md: string): number {
  // Try the explicit count line first; fall back to counting "### Evento" headings.
  const explicit = md.match(/\*\*Eventos analisados:\*\*\s*(\d+)/i);
  if (explicit) {
    const n = parseInt(explicit[1], 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const headings = md.match(/^###\s+Evento\s+\d+/gim);
  return headings ? headings.length : 0;
}

async function runAndSaveMolecular(
  supabase: SupabaseClient,
  sessionId: string,
  patientId: string,
  transcript: FirefliesTranscript,
  transcriptText: string,
): Promise<void> {
  const result = await runAnalysisWithFallback(
    MOLECULAR_SYSTEM_PROMPT,
    buildMolecularUserPrompt(transcript, transcriptText),
  );
  const eventsCount = countMolecularEvents(result.text);

  const { error } = await supabase.from('therapai_molecular_analyses').upsert({
    session_id: sessionId,
    patient_id: patientId,
    therapist_id: ANDRE_THERAPIST_ID,
    molecular_md: result.text,
    events_count: eventsCount,
    model_used: result.model,
  }, { onConflict: 'session_id' });

  if (error) {
    throw new Error(`molecular_save_failed: ${error.message ?? 'unknown'}`);
  }
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
