# Runbook de Resposta a Incidente de Segurança (LGPD)

**Aplicação:** TherapAI (clinica-pipeline @ awumxiqawrzkjvjtdscf, sa-east-1)
**Base regulatória:** LGPD art. 48; ANPD Res. 15/2024 (notificação de incidente).
**Versão:** 0.1 (draft) · 2026-05-13
**DPO responsável:** André Fiker — andrefiker@gmail.com

> Em incidente, **velocidade é regulatória**: ANPD Res. 15/2024 estabelece prazo de **2 dias úteis** para comunicação inicial à autoridade quando houver "risco ou dano relevante" aos titulares. Este runbook foi feito para ser seguido com a página aberta, durante o incidente, não estudado depois.

---

## Fase 1 — Detecção (T+0 a T+1h)

**Origens possíveis de alerta:**
- Erro 5xx em volume incomum no Vercel (deploy logs).
- Linhas atípicas em `therapai_audit_log` (acessos fora do horário usual, IPs novos, volume anômalo).
- Advisor de segurança do Supabase reportando regressão (RLS desabilitada, política permissiva nova).
- Sub-operador (Anthropic, OpenAI, Recall.ai, Fireflies) comunicando incidente próprio.
- Relato externo de pesquisador, paciente, clínico ou parceiro.

**Ações imediatas:**
1. Confirmar que o alerta é real — reproduzir o sintoma se possível, ou pedir evidência ao reportador.
2. Tirar screenshot/cópia da evidência (não confiar em memória).
3. Abrir um arquivo de incidente em `COMPLIANCE/incidents/YYYY-MM-DD-slug.md` com o template ao final deste runbook.

## Fase 2 — Triagem (T+1h a T+4h)

**Perguntas a responder, na ordem:**
1. **Há vazamento de dado pessoal?** Se sim, é dado sensível (saúde)?
2. **Quantos titulares afetados?** Estimativa mínima e máxima.
3. **Qual é a janela temporal?** Quando começou, quando terminou (ou está em andamento).
4. **Há acesso indevido em andamento agora?** Se sim, contenção é prioridade absoluta — bloquear o vetor (rotacionar credenciais, desabilitar conta, derrubar deploy se preciso) ANTES de continuar a investigação.
5. **A causa-raiz é interna ou externa?** Falha de configuração própria vs. ataque externo vs. comprometimento de sub-operador.

**Classificação de severidade:**

| Severidade | Critério | Notificação ANPD? |
|---|---|---|
| Crítico | Vazamento de dado clínico sensível (transcrição, análise, prontuário) de paciente real | Sim, em ≤2 dias úteis |
| Alto | Vazamento de dado pessoal identificável (nome, email, CRP) sem conteúdo clínico | Sim se "risco relevante" — geralmente sim |
| Médio | Falha de configuração corrigida antes de exploração observável | Provavelmente não; documentar internamente |
| Baixo | Bug funcional sem exposição de dado | Não |

## Fase 3 — Contenção (paralelo à triagem)

**Vetores de contenção por categoria:**
- **Credencial vazada:** rotacionar imediatamente no painel do provedor (Supabase service_role, Vercel env, Anthropic key, OpenAI key, Fireflies/Recall webhook secret).
- **RLS regressão:** aplicar migração reabilitando + bloqueando o vetor; rodar Supabase advisor para confirmar zero findings.
- **Endpoint público acidental:** revogar deploy via Vercel rollback; corrigir e re-deployar com testes.
- **Sub-operador comprometido:** suspender ingest pelo sub-operador, comunicar o sub-operador, avaliar substituição.

## Fase 4 — Notificação à ANPD (≤2 dias úteis para incidentes Críticos/Altos)

**Canal:** formulário ANPD em https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento.

**Conteúdo mínimo (Res. 15/2024 art. 5º):**

1. Descrição da natureza do incidente.
2. Categorias e número aproximado de titulares afetados.
3. Categorias e número aproximado de registros afetados.
4. Consequências técnicas e prováveis riscos aos titulares.
5. Medidas técnicas e administrativas adotadas para reverter ou mitigar.
6. Indicação do encarregado (DPO): André Fiker, andrefiker@gmail.com.
7. Data e hora do incidente (início e fim, se conhecidas).
8. Data da detecção pelo operador.

Se algum item ainda não estiver claro em T+2 dias úteis, **comunicar parcialmente no prazo** e complementar depois (Res. 15/2024 permite comunicações suplementares).

## Fase 5 — Notificação aos titulares afetados

**Obrigatória para Crítico/Alto.** Canal:
- Para clínicos-controladores afetados: email direto ao endereço cadastrado em `therapai_therapists.email`.
- Para pacientes afetados: o clínico-controlador notifica (TherapAI é operador, não controlador desses dados). TherapAI fornece ao clínico o material necessário (escopo, recomendações).

**Conteúdo mínimo:**
- O que aconteceu (linguagem clara, não técnica).
- Que dados foram afetados.
- Quais são os riscos prováveis ao titular.
- O que TherapAI/operador está fazendo.
- O que o titular pode fazer (ex: trocar senha — não aplicável aqui pois magic-link, mas pode revogar consentimento ou solicitar eliminação).
- Contato do DPO.

## Fase 6 — Post-mortem (T+1 semana a T+2 semanas)

Documento em `COMPLIANCE/incidents/YYYY-MM-DD-slug.md` deve incluir, ao final:

- Timeline detalhada (T+0 ao fim da contenção, com timestamps em UTC).
- Causa-raiz técnica (5 porquês ou equivalente).
- Causa-raiz processual (por que a detecção não foi mais rápida? por que a contenção não foi imediata?).
- Ações corretivas adotadas (com link para PRs/migrações).
- Ações preventivas a ser tomadas (com responsável e prazo).
- Lições aprendidas — adicionar ao RIPD se mudou o perfil de risco.

---

## Template de arquivo de incidente

Salvar em `COMPLIANCE/incidents/YYYY-MM-DD-<slug>.md`:

```markdown
# Incidente <slug> — YYYY-MM-DD

## Detecção
- T+0 (UTC): <quando o sinal apareceu>
- Origem: <log/audit/external>
- Reportador: <nome/sistema>

## Triagem
- Severidade: <Critical|High|Medium|Low>
- Titulares afetados (estimativa): <n>
- Categorias de dado: <transcrição/análise/identificação/etc.>
- Janela temporal: <início — fim>

## Contenção
- T+<delta> (UTC): <ação>
- T+<delta> (UTC): <ação>

## Notificação
- ANPD: <data/canal/protocolo>
- Titulares: <data/canal>

## Post-mortem
- Causa-raiz técnica:
- Causa-raiz processual:
- Ações corretivas (com PR/commit):
- Ações preventivas (com responsável e prazo):
- Atualização do RIPD: <sim/não, link se sim>
```

---

**Última revisão:** 2026-05-13 (criação).
