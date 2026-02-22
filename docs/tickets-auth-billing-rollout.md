# Decomposição em tickets — Auth, Trial e Billing

Base: [blueprint-auth-billing.md](./blueprint-auth-billing.md)

Guia de início técnico: [implementation-kickoff-auth-billing.md](./implementation-kickoff-auth-billing.md)

## Convenções

- Trilhas: `BE` (backend), `LP` (landing page), `BL` (billing/provedor).
- Estimativa em `SP` (story points) e faixa de duração em dias úteis (`d`).
- Ordem: executar tickets por fase e sequência numérica.
- Dependências usam IDs dos tickets.

## Resumo por fase (capacidade sugerida)

| Fase | Objetivo | SP total | Duração estimada |
|---|---|---:|---:|
| Fase 0 | Fundamentos e segurança base | 15 | 4-6d |
| Fase 1 | Signup + trial end-to-end | 24 | 6-9d |
| Fase 2 | Webhook de pagamento + estado | 28 | 7-10d |
| Fase 3 | Compatibilidade e migração | 20 | 5-8d |
| Fase 4 | Endurecimento e operação | 21 | 6-9d |
| **Total** |  | **108 SP** | **28-42d** |

---

## Fase 0 — Preparação

### Ordem recomendada

1. `BE-0001` → `BE-0002` → `BE-0003`
2. `BL-0001` e `LP-0001` em paralelo após `BE-0002`

### Tickets

#### BE-0001 — Extrair domínio de licença para módulo dedicado
- **Trilha:** Backend
- **Descrição:** Mover lógica de licença/token de `src/index.js` para módulos (`licenseService`, `customerService`, `keyService`).
- **Entregáveis:** interfaces de serviço + testes unitários básicos do domínio.
- **Dependências:** nenhuma
- **Estimativa:** 5 SP (1-2d)
- **DoD:** `src/index.js` só roteia; lógica de negócio fica isolada.

#### BE-0002 — Hardening de configuração e segredos
- **Trilha:** Backend
- **Descrição:** Normalizar `wrangler.jsonc`, remover ambiguidade de KV e documentar segredos (`WEBHOOK_SIGNING_SECRET`, `PAYMENT_PROVIDER_SECRET`).
- **Entregáveis:** config limpa + docs operacionais.
- **Dependências:** `BE-0001`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** deploy local/remoto sem warning de binding conflitante.

#### BE-0003 — Contratos versionados e erros padronizados
- **Trilha:** Backend
- **Descrição:** Criar schema JSON de request/response e padrão de erro (`code`, `message`, `requestId`).
- **Entregáveis:** arquivo de contratos + validação central.
- **Dependências:** `BE-0001`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** endpoints novos já nascem com validação compartilhada.

#### BL-0001 — Definição de evento normalizado do provedor
- **Trilha:** Billing
- **Descrição:** Mapear payload nativo do provedor para o evento interno normalizado (`provider`, `eventId`, `billing`, `reference`).
- **Entregáveis:** documento de mapeamento + exemplos reais de sandbox.
- **Dependências:** `BE-0003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** evento normalizado cobre casos de pagamento aprovado/falha/cancelamento.

#### LP-0001 — Contrato frontend para signup-trial
- **Trilha:** Landing
- **Descrição:** Definir payload de formulário, regras de validação e tratamento de erro para `POST /v1/signup-trial`.
- **Entregáveis:** contrato FE + mensagens UX de erro/sucesso.
- **Dependências:** `BE-0003`
- **Estimativa:** 2 SP (0.5d)
- **DoD:** FE e BE concordam em campos obrigatórios e erros.

---

## Fase 1 — Signup e Trial

### Ordem recomendada

1. `BE-1001` → `BE-1002` → `BE-1003`
2. `LP-1001` em paralelo com `BE-1002`
3. `BE-1004` após `BE-1001` e `BE-1002`
4. `LP-1002` após `LP-1001` e `BE-1003`

### Tickets

#### BE-1001 — Gerar `clientKey` e persistir hash
- **Trilha:** Backend
- **Descrição:** Criar geração segura de `clientKey` (prefixo por ambiente), persistir apenas `keyHash` em `clientkey:{keyHash}`.
- **Entregáveis:** utilitário criptográfico + persistência + testes.
- **Dependências:** `BE-0001`, `BE-0003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** nenhuma chave em texto puro em armazenamento/log.

#### BE-1002 — Implementar `POST /v1/signup-trial`
- **Trilha:** Backend
- **Descrição:** Criar customer + license trial + resposta contratada; tratar duplicidade (`409`).
- **Entregáveis:** endpoint funcional + validações + testes de contrato.
- **Dependências:** `BE-1001`
- **Estimativa:** 8 SP (2-3d)
- **DoD:** fluxo completo retorna `customer`, `license`, `credentials.delivery`.

#### BE-1003 — Evento de envio de email (assíncrono)
- **Trilha:** Backend
- **Descrição:** Publicar evento de entrega de credencial e aceitar callback `email-dispatched` (se habilitado).
- **Entregáveis:** publisher + endpoint opcional + auditoria mínima.
- **Dependências:** `BE-1002`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** signup não bloqueia por latência de envio de email.

#### BE-1004 — Observabilidade signup/trial
- **Trilha:** Backend
- **Descrição:** Adicionar `requestId`, métricas de sucesso/falha, logs com PII mínima.
- **Entregáveis:** logs estruturados + dashboard mínimo (ou queries).
- **Dependências:** `BE-1002`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** rastreio de ponta a ponta por `requestId`.

#### LP-1001 — Formulário de cadastro trial
- **Trilha:** Landing
- **Descrição:** Implementar formulário com validação de `email`, `acceptTerms`, `acceptPrivacy` e submit para backend.
- **Entregáveis:** tela funcional + estados de loading/erro/sucesso.
- **Dependências:** `LP-0001`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** taxa de erro client-side reduzida (campos inválidos bloqueados antes do submit).

#### LP-1002 — Página de confirmação e instruções
- **Trilha:** Landing
- **Descrição:** Exibir confirmação de trial criado e instrução de verificar email para receber chave.
- **Entregáveis:** UX pós-cadastro + tracking de conversão.
- **Dependências:** `LP-1001`, `BE-1003`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** usuário recebe feedback claro mesmo sem chave imediata em tela.

---

## Fase 2 — Webhooks de pagamento

### Ordem recomendada

1. `BE-2001` → `BL-2001`
2. `BE-2002` → `BE-2003`
3. `BL-2002` em paralelo com `BE-2003`
4. `BE-2004` por último

### Tickets

#### BE-2001 — Verificação de assinatura e anti-replay
- **Trilha:** Backend
- **Descrição:** Implementar verificação HMAC/assinatura nativa + janela temporal para prevenir replay.
- **Entregáveis:** middleware de assinatura reutilizável.
- **Dependências:** `BE-0002`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** webhook inválido retorna 401/403 com motivo interno auditável.

#### BL-2001 — Configurar webhook no provedor (sandbox)
- **Trilha:** Billing
- **Descrição:** Criar endpoint sandbox, configurar eventos necessários e validar entrega/retry.
- **Entregáveis:** configuração ativa + coleção de payloads de teste.
- **Dependências:** `BE-2001`, `BL-0001`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** eventos chegam ao gateway com assinatura válida.

#### BE-2002 — Implementar `POST /v1/webhooks/payment`
- **Trilha:** Backend
- **Descrição:** Receber evento normalizado, persistir `payment_event`, aplicar idempotência por `provider:eventId`.
- **Entregáveis:** endpoint + armazenamento de eventos + resposta idempotente.
- **Dependências:** `BE-2001`
- **Estimativa:** 8 SP (2-3d)
- **DoD:** replay do mesmo evento não duplica efeitos.

#### BE-2003 — Motor de transição de estado de licença
- **Trilha:** Backend
- **Descrição:** Aplicar tabela de transição (`trial`, `active`, `past_due`, `grace_period`, etc.) com regras de acesso premium.
- **Entregáveis:** state machine + testes de transição.
- **Dependências:** `BE-2002`
- **Estimativa:** 8 SP (2-3d)
- **DoD:** transições inválidas bloqueadas e auditadas.

#### BL-2002 — Fluxo de checkout com referência técnica
- **Trilha:** Billing
- **Descrição:** Garantir envio de `customerId`/referência (`clientKey` ou metadata equivalente) no checkout.
- **Entregáveis:** checkout com metadata consistente para reconciliação.
- **Dependências:** `BL-2001`, `BE-1002`
- **Estimativa:** 2 SP (0.5d)
- **DoD:** todos os eventos de produção trazem referência reconciliável.

#### BE-2004 — Testes de contrato dos webhooks
- **Trilha:** Backend
- **Descrição:** Cobrir contratos de eventos principais (approved, failed, canceled, renewed).
- **Entregáveis:** suíte de testes de contrato e regressão.
- **Dependências:** `BE-2002`, `BE-2003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** regressão bloqueia deploy quando contrato quebra.

---

## Fase 3 — Compatibilidade e migração

### Ordem recomendada

1. `BE-3001` → `BE-3002`
2. `BE-3003` e `LP-3001` em paralelo
3. `BE-3004` após estabilidade da migração

### Tickets

#### BE-3001 — Compatibilidade do `GET /v1/license`
- **Trilha:** Backend
- **Descrição:** Manter endpoint atual aceitando chave nova e token legado durante janela de migração.
- **Entregáveis:** adaptador de credencial legado.
- **Dependências:** `BE-1002`, `BE-2003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** extensão atual continua funcional sem mudança imediata.

#### BE-3002 — Feature flags de migração
- **Trilha:** Backend
- **Descrição:** Flags para ativar validação por nova credencial por coorte/tenant.
- **Entregáveis:** estratégia de rollout parcial.
- **Dependências:** `BE-3001`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** rollback rápido via configuração.

#### BE-3003 — Métricas de adoção e erro por coorte
- **Trilha:** Backend
- **Descrição:** Medir uso de token legado vs `clientKey`, erro 401/403, taxa de migração por período.
- **Entregáveis:** painéis/queries operacionais.
- **Dependências:** `BE-3002`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** visibilidade diária da migração.

#### LP-3001 — Ajustes de comunicação na landing
- **Trilha:** Landing
- **Descrição:** Atualizar mensagens de onboarding para fluxo oficial de chave por email + trial.
- **Entregáveis:** copy e tracking ajustados.
- **Dependências:** `LP-1002`, `BE-3001`
- **Estimativa:** 2 SP (0.5d)
- **DoD:** conteúdo alinhado com comportamento real do sistema.

#### BE-3004 — Encerramento de janela legado
- **Trilha:** Backend
- **Descrição:** Planejar e executar depreciação do token legado com comunicação e data de corte.
- **Entregáveis:** plano de sunset + guardrails.
- **Dependências:** `BE-3003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** corte executado sem impacto crítico (>99% tráfego migrado).

---

## Fase 4 — Endurecimento

### Ordem recomendada

1. `BE-4001` → `BE-4002`
2. `BE-4003` e `BL-4001` em paralelo
3. `BE-4004` no fechamento

### Tickets

#### BE-4001 — Rotação de segredos e credenciais
- **Trilha:** Backend
- **Descrição:** Implementar rotação operacional de segredos e chave de assinatura sem downtime.
- **Entregáveis:** processo de rotação + suporte a chave ativa/secundária.
- **Dependências:** `BE-2001`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** rotação testada em ambiente de staging.

#### BE-4002 — Revogação de `clientKey` por cliente
- **Trilha:** Backend
- **Descrição:** Permitir revogar credenciais comprometidas com trilha de auditoria.
- **Entregáveis:** endpoint/admin flow de revogação.
- **Dependências:** `BE-1001`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** chave revogada perde acesso imediatamente.

#### BE-4003 — Rate-limit por plano/tier
- **Trilha:** Backend
- **Descrição:** Aplicar limites distintos por plano (`trial`, `pro`, futuro enterprise).
- **Entregáveis:** política de limite centralizada.
- **Dependências:** `BE-2003`
- **Estimativa:** 5 SP (1-2d)
- **DoD:** limites configuráveis por ambiente e plano.

#### BL-4001 — Reconciliação financeira básica
- **Trilha:** Billing
- **Descrição:** Rotina de conferência entre eventos processados e assinaturas ativas no provedor.
- **Entregáveis:** relatório de divergência diário.
- **Dependências:** `BE-2002`, `BL-2001`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** divergências críticas sinalizadas em até 24h.

#### BE-4004 — Testes de caos e runbook operacional
- **Trilha:** Backend
- **Descrição:** Simular falhas de webhook/retry/duplicidade e documentar respostas operacionais.
- **Entregáveis:** runbook + cenários validados.
- **Dependências:** `BE-4001`, `BE-4002`, `BE-4003`
- **Estimativa:** 3 SP (0.5-1d)
- **DoD:** time consegue operar incidentes sem intervenção ad hoc.

---

## Caminho crítico

1. `BE-0001` → `BE-0003`
2. `BE-1001` → `BE-1002`
3. `BE-2001` → `BE-2002` → `BE-2003`
4. `BE-3001` → `BE-3002`
5. `BE-4001`

Atrasos nesses pontos afetam diretamente a data de entrada em produção.

## Plano de execução sugerido (sprints)

- **Sprint 1:** Fase 0 completa + `BE-1001`.
- **Sprint 2:** Fase 1 completa.
- **Sprint 3:** Fase 2 completa.
- **Sprint 4:** Fase 3 completa + início da Fase 4.
- **Sprint 5:** Fase 4 completa + estabilização.

## Critério de priorização

Quando houver conflito de capacidade, priorizar:

1. Segurança e idempotência (`BE-2001`, `BE-2002`)
2. Continuidade do fluxo de aquisição (`BE-1002`, `LP-1001`)
3. Compatibilidade da extensão atual (`BE-3001`)
4. Endurecimento operacional (`Fase 4`)
