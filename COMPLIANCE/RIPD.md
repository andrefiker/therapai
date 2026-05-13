# Relatório de Impacto à Proteção de Dados Pessoais (RIPD / DPIA)

**Operador:** TherapAI / André Fiker (CRP 06/115147)
**Versão:** 0.1 (draft) · 2026-05-13
**Status:** documento vivo, revisar a cada release ou mudança material no tratamento
**Base regulatória:** LGPD (Lei nº 13.709/2018), arts. 5º, 11, 33, 37, 38, 46, 48; ANPD Res. 15/2024 (incidentes); CFP Res. 11/2018 (prontuário psicológico).

> **Aviso de rascunho:** este documento foi gerado como primeiro corte técnico-operacional pelo time TherapAI. Antes de ser apresentado em fiscalização ANPD, deve passar por revisão jurídica especializada em LGPD para saúde.

---

## 1. Identificação do tratamento

| Item | Detalhe |
|---|---|
| Nome do tratamento | Análise clínica longitudinal automatizada de sessões de psicoterapia |
| Operador | André Fiker, PF, CRP 06/115147, Guarulhos/SP |
| Encarregado (DPO) | André Fiker — andrefiker@gmail.com (a ser migrado para andre@therapai.app) |
| Controladores | Psicólogos-usuários da plataforma (cada conta é controladora dos próprios dados de paciente) |
| Sub-operadores | Fireflies.ai · Recall.ai (em onboarding) · Anthropic · OpenAI · Supabase (DB em sa-east-1) · Vercel (hosting) · Stripe (pagamento) |
| Finalidade | Geração de análise clínica molar (síntese), molecular (eventos discretos), longitudinal (memória do caso), prontuário-CFP estruturado e respostas a consultas analíticas do controlador |
| Bases legais | LGPD art. 11, II, "f" — tratamento necessário à tutela da saúde, por profissional regulamentado |

## 2. Necessidade e proporcionalidade

**Por que o tratamento é necessário:**
Psicólogos clínicos não conseguem reter, no fluxo manual de prontuário, o nível de detalhe funcional-comportamental (RFT, contingências, molduras relacionais) que sustenta intervenções precisas em quadros complexos. A análise automatizada produz esse detalhe em escala que o trabalho humano isolado não alcança.

**Por que a categoria de dados é proporcional:**
Apenas transcrições de sessão (já produzidas pelo psicólogo no exercício profissional regulamentado) e anotações inseridas pelo próprio controlador são tratadas. Nenhum dado é coletado fora do contexto clínico autorizado pelo paciente perante o psicólogo (CFP Res. 11/2018, art. 8º).

**Minimização aplicada:**
- Não há coleta de dados pessoais sensíveis adicionais (raça, religião, orientação sexual etc.) salvo se mencionados na sessão pelo paciente — e nesse caso fazem parte do registro clínico legítimo.
- Não há *enriquecimento* com fontes externas (redes sociais, dados públicos do paciente).
- IDs internos (UUID) são usados em logs operacionais; nomes só aparecem em campos `name` explícitos sob RLS.

## 3. Identificação de riscos ao titular

| Risco | Probabilidade | Impacto | Mitigação primária | ISA ref. |
|---|---|---|---|---|
| Vazamento de transcrição via API key pública | Baixa | Alto | RLS habilitada em todas as tabelas `therapai_*`. Probe anônima 2026-05-13 retornou `[]` em todas as 9 tabelas | ISC-1..3, 29, 30 |
| Acesso indevido por colega/parceiro com link mágico | Média (antes da F2) → Baixa (após) | Alto | F2: evaluators roteados para tenant sintético (Dra. Demo); nenhum dado real é exposto fora do operador | ISC-4, 5 |
| Comprometimento de credencial admin (Vercel/Supabase) | Baixa | Crítico | F8 pendente (MFA em todos os painéis do operador); F10 pendente (criptografia em coluna para minimizar exposure mesmo no caso de breach DB) | F8, F10 |
| Erro de mapeamento paciente/transcrição (Fireflies speaker mislabel) | Média | Médio | D43 deferido — afeta atribuição mas não vaza dado; impacto limitado a um único caso clínico | D43 |
| Retenção indevida pós-encerramento do contrato | Baixa | Médio | Política de retenção em /privacidade §6: dados de paciente seguem CFP 5 anos; outros dados purgáveis após 90 dias do encerramento da conta | F11, ISC-20-22 |
| Transferência internacional para sub-operadores em EUA (Anthropic, OpenAI, Vercel) | Alta (estrutural) | Médio | Cláusulas contratuais via DPA com cada sub-operador; consentimento específico do clínico em onboarding; finalidade restrita a inferência analítica sem treinamento | F9, ISC-27, 28 |
| Log de aplicação contendo PHI | Baixa | Médio | F7 auditoria 2026-05-13: produção limpa (apenas IDs/contagens/erros nos console.log) | ISC-13 (verificado) |
| Não atendimento de solicitação Art. 18 dentro do prazo | Baixa | Médio | F11 endpoints técnicos shipped 2026-05-13 (`/api/me/export`, `/api/patient/[id]/forget`); processo manual via email back-up | ISC-18, 19 |

## 4. Medidas de mitigação implementadas

**Técnicas (verificadas 2026-05-13):**
- Row Level Security em todas as 9 tabelas `therapai_*`.
- Auditoria estruturada por linha de aplicação: `therapai_audit_log` registra cada acesso a paciente/sessão/análise/memória.
- Cabeçalhos de segurança: HSTS preload 2 anos, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy restritiva, Content-Security-Policy com allowlist explícita.
- TLS 1.3 em todas as rotas (Vercel managed).
- Criptografia em repouso AES-256 no banco (Supabase managed).
- Segredos em variáveis de ambiente do provedor de hospedagem, não em código nem em colunas de banco.
- Função PL/pgSQL `therapai_patient_state` com `search_path` fixado para evitar privilege escalation por shadowing.
- IP em logs de auditoria pseudonimizado via SHA-256 com sal rotacionável (`AUDIT_IP_SALT`).

**Operacionais:**
- Webhook do ingest signado e verificado (Svix HMAC-SHA256 para Recall.ai; segredo compartilhado rotacionável para Fireflies).
- Modo demonstração com tenant sintético (Dra. Demo) para parceiros avaliadores — nenhum dado real é exposto fora do operador.
- Política de exclusão de logs locais de prompt-content (728KB removidos 2026-05-13 do laptop do operador).

**Pendentes (rastreados em `MEMORY/WORK/therapai-lgpd-compliance/ISA.md`):**
- F8: MFA em todos os painéis do operador (Vercel, Supabase, Anthropic, OpenAI, Fireflies).
- F10: criptografia em nível de coluna para `transcript_text`, `analysis_md`, `report_md`, `molecular_md`.
- F8.1: tratamento de erro no callback de magic-link — shipped 2026-05-13.
- ISC-27: verificação documental de zero-retenção em Anthropic + OpenAI.

## 5. Risco residual

Após a aplicação das mitigações listadas, o risco residual mais relevante é **comprometimento de credencial administrativa** (chave service_role do Supabase ou conta operador da Vercel/Supabase), que daria acesso a dados clínicos em texto claro enquanto F10 não estiver concluído. Mitigação parcial: F8 (MFA), monitoramento manual de acessos atípicos, rotação periódica de chaves.

**Avaliação:** o tratamento é proporcional à finalidade clínica legítima, com mitigações técnicas verificadas empiricamente. Pendências F8 e F10 mantêm o sistema em estado *aceitável-mas-incompleto* — não bloqueia operação interna em modo demonstração, mas deve ser concluído antes de onboarding de clínicos pagantes.

## 6. Revisão

Este RIPD será revisado:
- A cada nova versão maior da plataforma.
- A cada novo sub-operador adicionado ao fluxo.
- A cada incidente de segurança que envolva dados pessoais.
- A cada 12 meses como parte da revisão anual de conformidade.

Última revisão: 2026-05-13 (criação).
