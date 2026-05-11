# TherapAI

Análise clínica longitudinal automatizada para psicólogos brasileiros, com extração programática de estado clínico (CFP Resolução 11/2018) e memória de paciente operável por afirmações.

**Demo ao vivo:** [therapai-one.vercel.app](https://therapai-one.vercel.app) — qualquer email entra via link mágico em modo demonstração (somente-leitura sobre o dataset clínico real do André).

> Construído por **André Fiker** (CRP 06/115147), psicólogo clínico em prática há 12 anos. ~60 horas de desenvolvimento focado nas últimas duas semanas. Operando hoje sobre 59 pacientes / 132 sessões reais.

---

## O que é

TherapAI é um copiloto clínico: cada sessão é capturada por Fireflies, analisada em duas escalas (molar = síntese, molecular = recorte momento-a-momento), comprimida em afirmações estruturadas sobre o paciente, e disponibilizada de volta ao clínico como (1) prontuário automatizado, (2) memória longitudinal confirmável, (3) chat sobre o caso com citação inline obrigatória.

A diferença em relação a "ChatGPT-wrapper-de-receita":
- Quadro teórico explícito: **Análise do Comportamento + RFT (Teoria das Molduras Relacionais)**, não cola pronta.
- **Disciplina de voz tripla:** cada parágrafo da análise distingue *Citado* (fala literal) / *Observado* (fato comportamental) / *Hipótese* (inferência clínica) — explicitamente rotulado.
- **Citação obrigatória, recusa explícita:** toda afirmação é ancorada em `[Sessão #N]` ou `[Longitudinal]` ou `[Afirmação confirmada: dimensão]`. Quando o material não sustenta, o sistema recusa em vez de inventar.
- **Vocabulários fechados** para extração programática: `frame_rft_principal ∈ {avaliacao, identidade, temporal, causal, coerencia, transformacao_funcao}`, `sinal_alianca ∈ {ruptura, tensao, reparo, fortalecimento}`, etc.

---

## Stack

- **Front:** Next.js 15 (App Router, route groups), TypeScript, Tailwind, React Server Components.
- **Auth:** Supabase magic-link OTP. Row Level Security gate por tenant.
- **DB:** Supabase Postgres (`sa-east-1` São Paulo). Schema sob prefixo `therapai_*`.
- **Inferência:** três tiers em fallback — Anthropic Claude (`claude-opus-4-5`) → OpenAI (`gpt-4o`) → Codex CLI (`gpt-5.4`). Webhook em runtime serverless usa só os dois primeiros; CLI scripts (rescue / reanalyze / backfill) usam os três.
- **Ingestão:** Fireflies AI captura Google Meet → webhook em `/api/webhook` → pipeline.
- **Hosting:** Vercel.
- **Billing (scaffold, não ativo):** Stripe Customer Portal + webhook listener.

---

## Arquitetura — fluxo de uma sessão

```
Google Meet (gravado por Fireflies)
        ↓
Webhook → /api/webhook
        ↓
Identificar paciente (título / falante mais frequente)
        ↓
MOLAR (Análise síntese em 7 seções + JSON prontuário CFP)
   ├── Citado / Observado / Hipótese rotulados
   ├── Análise funcional (comportamentos-alvo, contingências)
   └── RFT (molduras engajadas)
        ↓
MOLECULAR (3-7 eventos discretos com ABC + frame RFT por evento)
   ├── Citação literal com timestamp
   ├── Função hipotetizada
   └── JSON estruturado: tipo_evento, frame_rft, sinal_alianca, citacao_chave
        ↓
EXTRAÇÃO DE AFIRMAÇÕES (F2+F5 V2)
   ├── Do JSON prontuário: complaint, intervention, medication, risk, diagnosis_cid
   └── Do JSON molecular: relational_frame, alliance_event
        ↓
CONFIRMAÇÃO PELO CLÍNICO (UI agrupada por dimensão, ações em lote)
        ↓
LONGITUDINAL (regenerada por paciente a cada sessão)
        ↓
CHAT DO CASO — Q&A ancorado em todo o material do paciente
```

---

## Dimensões da memória clínica

Cada paciente tem afirmações categorizadas em 9 dimensões. Confirmar uma afirmação a promove ao "estado canônico" do paciente, consultável pelo chat e pelo briefing pré-sessão. Descartar marca como falso-positivo.

| Dimensão | Fonte | O que captura |
|---|---|---|
| `complaint` | F1 prontuário | Demanda original + queixa da sessão |
| `behavioral_theme` | F1 prontuário | Formulação comportamental, evolução |
| `intervention` | F1 prontuário | Intervenções aplicadas na sessão |
| `diagnosis_cid` | F1 prontuário | Códigos CID-10 discutidos |
| `risk_factor` | F1 prontuário | Risco suicida / heteroagressivo / autolesivo + manejo |
| `medication` | F1 prontuário | Medicação em uso, mudanças, adesão, efeitos |
| `historical_event` | F1 prontuário | Encaminhamentos, eventos relevantes |
| `relational_frame` | JSON molecular | Molduras RFT engajadas por evento |
| `alliance_event` | JSON molecular | Rupturas / tensões / reparos / fortalecimentos por evento |

---

## Estado atual (2026-05-11)

- **59 pacientes** no tenant principal.
- **132 sessões processadas** em status `done`. Destas, **81 com transcrição completa** (sentence-level com timestamps) e 51 com OVERVIEW-only (ingest legado — só molar é possível).
- **~335 afirmações pendentes** distribuídas entre as 9 dimensões:
  - 204 `relational_frame`
  - 84 `alliance_event`
  - 25 `medication`
  - 103 `intervention`, 62 `behavioral_theme`, 57 `complaint`, etc.
- **23 dos 23 pacientes com transcrição completa têm pelo menos uma sessão molecular populada.** 46 sessões ainda aguardando o segundo passo do gap-fill (D38/D39 — refresh de quota Codex amanhã, script idempotente pega o resto).
- **Marketing público em LGPD compliance:** [/privacidade](https://therapai-one.vercel.app/privacidade) / [/termos](https://therapai-one.vercel.app/termos) / [/dpa](https://therapai-one.vercel.app/dpa). Lista de espera com checkbox de consentimento + timestamps.

---

## Como rodar local

```bash
bun install

# Variáveis de ambiente necessárias (.env.local):
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_ROLE_KEY=
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# FIREFLIES_API_KEY=
# FIREFLIES_WEBHOOK_SECRET=

bun dev
# http://localhost:3000
```

Sem essas credenciais a app sobe mas sem dados / sem inferência. Para revisar com dataset real, use o demo em `therapai-one.vercel.app` (qualquer email → modo demonstração somente-leitura sobre o tenant do André).

---

## Decisões arquiteturais notáveis

> Detalhe completo (D1 → D43, com formato Deutsch de conjectura/refutação/aprendizado) vive em log privado de operação. Resumo público abaixo.

- **Multi-tenant via RLS, não tabela-per-tenant.** Todo CRUD passa pelo `auth.uid()` do Supabase, exceto o webhook (service_role bypassa RLS para ingest).
- **Webhook fail-state semântico.** `failed_retry_pending` para falhas de provider (resgatável de fora do Vercel via `rescue-pending.ts` na tier Codex). `failed` para falhas estruturais que precisam de intervenção. Permite distinguir "credit balance vazio" de "transcrição corrompida".
- **F1 prontuário-CFP em JSON estruturado** dentro do markdown da análise molar — não em coluna SQL separada. Razão: clínico precisa do narrativo + estruturado na mesma vista. Parsing é determinístico (regex do fenced JSON block).
- **Append-only memory layer.** `therapai_patient_memory_assertions` nunca atualiza, só insere com `superseded_by_id` quando uma afirmação substitui outra. `therapai_patient_state(patient_id)` é uma função SQL `SECURITY INVOKER` que materializa o estado canônico no momento da query.
- **Vocabulários fechados para extração.** Modelos free-form em texto inventam termos. Modelos com vocabulário fechado emitem JSON parseável e enumerável. Os 6 frames RFT + 4 sinais de aliança + 10 tipos de evento são exatamente o que aparece nos dados, não o que o LLM julgou "soar clínico".
- **Disciplina de voz tripla obrigatória no prompt.** Reduz risco do clínico confundir "o paciente disse isso" com "a IA inferiu isso" — modo de falha catastrófico para produto clínico.
- **Concorrência por paciente, serial dentro do paciente.** Evita race em `session_number`. Driver de backfill multiplica isso em ~3-4 patients paralelos.
- **Três-tier de inferência com Codex CLI como fallback.** Quando ambas as APIs pagas dão credit-balance-low, Codex CLI subscription-billed mantém a luz acesa. Trade-off: codex é local-CLI, então não roda em runtime Vercel — só em scripts CLI no host do operador.
- **Demo mode binário (owner vs evaluator).** Período atual: qualquer email entra, só o owner (André) tem write access. Evaluators veem o tenant do André em read-only via `supabaseAdmin` scoped to `ANDRE_THERAPIST_ID`. Quando entrarem clínicos pagos, vira multi-tenant proper. Arquivo a revisitar: `lib/viewer.ts`.

---

## O que NÃO está pronto (deliberado)

- **Stripe operacional.** Schema + webhook listener + customer portal estão prontos. Faltam `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` em Vercel env e configuração do endpoint webhook no Stripe dashboard. Decisão consciente: nada de cobrança até o primeiro clínico parceiro estar pronto para entrar.
- **Streaming de chat.** Resposta atual bloqueia ~10s. Streaming é UX, não signal. Defer até primeiros usuários pagos.
- **pgvector retrieval.** Contexto cabe inteiro no prompt até ~30 sessões/paciente. Não há gargalo ainda.
- **Speaker disambiguation.** Fireflies às vezes etiqueta o falante errado. Defer até 3+ exemplos concretos para diff.
- **HMAC do webhook.** Fireflies não assina nativamente. Hardening real é IP allowlist + rotação de secret (já feita). Item original era baseado em premissa errada.
- **Edit-before-confirm em afirmações.** O clínico hoje confirma/descarta. Editar texto antes de promover é polish — não é blocker.

---

## Próximo bloco de trabalho

1. **Terminar o gap-fill molecular** (May 12, 14:11 após refresh do Codex) — 46 sessões pendentes.
2. **Stripe operational config** quando o primeiro clínico parceiro entrar.
3. **A-tier marketing**: OG image para link-share, Plausible analytics, custom domain.
4. **Iteração de prompts** baseada no output do gap-fill.

---

## Caminho rápido para revisar sem clonar

- [`/app/api/webhook/route.ts`](app/api/webhook/route.ts) — coração do pipeline (~1200 linhas, prompts + parsers + DB)
- [`/app/(app)/patients/[id]/page.tsx`](app/(app)/patients/[id]/page.tsx) — view do paciente
- [`/components/AssertionsPanel.tsx`](components/AssertionsPanel.tsx) — UI de confirmação de afirmações (grouping + bulk)
- [`/components/CaseChat.tsx`](components/CaseChat.tsx) — chat com citação inline obrigatória
- [`/lib/viewer.ts`](lib/viewer.ts) — owner-vs-evaluator binary do demo mode

Demo ao vivo: [therapai-one.vercel.app](https://therapai-one.vercel.app).
