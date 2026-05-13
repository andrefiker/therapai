# Registro de Operações de Tratamento (ROPA)

**Base legal:** LGPD art. 37 — operador e controlador devem manter registro das operações de tratamento.
**Operador:** TherapAI / André Fiker · **DPO:** mesmo · **Contato:** andrefiker@gmail.com
**Versão:** 0.1 (draft) · 2026-05-13 · revisar a cada mudança material

---

## Operação 1: Análise clínica automatizada de sessões

| Item | Detalhe |
|---|---|
| Finalidade | Geração de análise molar, molecular, longitudinal e prontuário-CFP estruturado a partir de transcrição de sessão de psicoterapia |
| Base legal | LGPD art. 11, II, "f" — tutela da saúde por profissional regulamentado |
| Categorias de titulares | Pacientes em psicoterapia, atendidos pelo psicólogo-controlador |
| Categorias de dados | Identificação (nome do paciente, aliases), transcrição verbatim, anotações clínicas, hipóteses diagnósticas, CIDs quando aplicável, medicação relatada, eventos de aliança terapêutica, molduras relacionais (RFT) |
| Categorias de dados sensíveis | Dados de saúde (LGPD art. 5º, II) |
| Recipientes (sub-operadores) | Fireflies.ai (transcrição) · Recall.ai (transcrição, em onboarding) · Anthropic (Claude, inferência primária) · OpenAI (GPT, fallback de inferência) · Supabase (armazenamento PostgreSQL em sa-east-1) · Vercel (hospedagem serverless) |
| Transferências internacionais | EUA (Anthropic, OpenAI, Vercel, Fireflies, Recall.ai). Base: salvaguardas contratuais via DPA com cada sub-operador + consentimento específico do clínico em onboarding |
| Retenção | Prontuário e dados clínicos: 5 anos após encerramento do atendimento (CFP Res. 11/2018, art. 13). Após esse prazo: eliminação ou anonimização a pedido do controlador |
| Medidas de segurança | RLS no banco; criptografia TLS 1.3 em trânsito; criptografia em repouso AES-256 (managed); cabeçalhos HTTP de segurança; auditoria estruturada `therapai_audit_log`; secrets em env vars não em código |

## Operação 2: Autenticação e autorização do clínico-usuário

| Item | Detalhe |
|---|---|
| Finalidade | Identificar o clínico-controlador para escopo de acesso a dados (RLS por tenant) |
| Base legal | LGPD art. 7º, V — execução de contrato + art. 7º, II — cumprimento de obrigação legal/regulatória |
| Categorias de titulares | Psicólogos-usuários da plataforma |
| Categorias de dados | Email, nome, CRP, IP (hash), user-agent, timestamps de acesso |
| Recipientes | Supabase Auth (gestão de sessão + envio de link mágico) |
| Transferências internacionais | Mesmo grupo do item 1 |
| Retenção | Conta ativa: enquanto vigente o contrato. Encerramento: 90 dias para restauração eventual, depois eliminação |
| Medidas de segurança | Magic-link sem senha; MFA (pendente F8); HSTS preload; cookies SameSite; CSP restritivo |

## Operação 3: Lista de espera (waitlist) pré-onboarding

| Item | Detalhe |
|---|---|
| Finalidade | Captação de leads de clínicos interessados na plataforma, antes da fase paga |
| Base legal | LGPD art. 7º, IX — legítimo interesse (cadastro voluntário em lista de espera de produto) |
| Categorias de titulares | Profissionais interessados (psicólogos, devs, parceiros) |
| Categorias de dados | Nome, email, CRP (opcional), nota de motivação (opcional) |
| Recipientes | Supabase (armazenamento) |
| Transferências internacionais | Não aplicável (Supabase região sa-east-1) |
| Retenção | Até promoção a usuário ativo ou desistência manifestada, máximo 18 meses sem interação |
| Medidas de segurança | RLS — apenas o operador lê (ISC-36 tightening 2026-05-13). Inserção pública por design (formulário aberto). |

## Operação 4: Pagamento e assinatura

| Item | Detalhe |
|---|---|
| Finalidade | Cobrança de assinatura mensal/anual pela plataforma |
| Base legal | LGPD art. 7º, V — execução de contrato |
| Categorias de titulares | Psicólogos pagantes |
| Categorias de dados | Email, identificadores Stripe (customer, subscription, payment_method), status de assinatura. **Não há dados de cartão na infraestrutura TherapAI** — Stripe é o operador exclusivo desses dados. |
| Recipientes | Stripe (operação completa de pagamento) |
| Transferências internacionais | EUA (Stripe) |
| Retenção | Obrigações fiscais e contábeis brasileiras (mín. 5 anos pós-encerramento) |
| Medidas de segurança | Stripe SOC 1/2, PCI DSS Nível 1; webhook signature verification (`STRIPE_WEBHOOK_SECRET`) |

## Operação 5: Auditoria interna de acessos

| Item | Detalhe |
|---|---|
| Finalidade | Cumprimento da obrigação de demonstrar boa-fé e responsabilização (LGPD art. 6º, X); base para resposta a solicitação Art. 18 |
| Base legal | LGPD art. 7º, II — cumprimento de obrigação legal/regulatória |
| Categorias de titulares | Operador (André) e clínicos-controladores |
| Categorias de dados | `actor_user_id` (auth.uid), ação, tabela alvo, ID da linha alvo, contexto JSON, IP hash, user-agent, timestamp |
| Recipientes | Internos (apenas o próprio actor lê suas próprias linhas via RLS) |
| Transferências internacionais | Não aplicável (Supabase região sa-east-1) |
| Retenção | Mínimo 12 meses |
| Medidas de segurança | RLS `actor_user_id = auth.uid()` para SELECT e INSERT; IP pseudonimizado via SHA-256 com sal |

---

**Última revisão:** 2026-05-13 (criação).
