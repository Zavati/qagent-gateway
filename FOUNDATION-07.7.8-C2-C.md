# Foundation 07.7.8-C2-C — Hybrid Test Data Planner

## Objetivo

Conectar o Observed Test Data Reservoir validado em 07.7.8-C2-A/B ao Test Data Planner do Gateway sem alterar o execution plane atual.

C2-C decide deterministicamente a fonte de massa por selector. A resolução do literal observado no momento do Run pertence à 07.7.8-C2-D.

## Escopo implementado

- Catalog Context Builder v1.8 consulta, de forma opcional e não bloqueante:
  - `/v1/catalog/endpoints/{endpointId}/observed-test-data`
  - `/v1/catalog/endpoints/{endpointId}/observed-test-data/samples`
- valores literais retornados pelo Catalog são descartados antes do Test Design Context/Prompt;
- o sidecar `qagent.observed-test-data-planning-context.v1` contém apenas metadata segura de selector/tipo/Environment/counters;
- `contextFingerprint` considera somente a forma segura que pode mudar a decisão do Planner, nunca o literal observado;
- Test Data Planner v1.2 usa estratégia default `HYBRID`;
- nova fonte de Test Data: `OBSERVED`;
- `OBSERVED` é planejado apenas para BODY nesta Foundation;
- explicit Test Data configurado pelo QA continua tendo precedência;
- SECRET continua fail-closed e nunca pode ser substituído por OBSERVED;
- fields referenciais / enum-like preferem OBSERVED quando existe massa 2xx com cobertura em todos os Environments observados;
- free text / dados geráveis continuam GENERATED mesmo quando existe valor observado;
- successful observed request samples podem completar deterministicamente o shape de cenários positivos sem transportar os literais;
- NEGATIVE/AUTHORIZATION não recebem baseline observado automaticamente, preservando omissões intencionais;
- cobertura incompleta por Environment não vira OBSERVED automaticamente;
- OBSERVED não vira READY nesta Foundation: `observedRuntimeEnabled=false` mantém `needsData=true` até C2-D.

## Sem mudança

- qagent-normalizer C2-A
- qagent-catalog C2-B
- qagent-test-registry
- qagent-runner
- qagent-console
- qagent-test-results
- migrations
- Secret Vault
- queue contracts

## Política HYBRID inicial

Precedência:

1. selector sensível -> SECRET
2. binding explícito do QA -> GENERATED/FIXED/SECRET conforme configuração
3. referential / enum-like com Observed 2xx e cobertura completa -> OBSERVED
4. referential sem Observed confiável -> FIXED / NEEDS_DATA
5. schema/value gerável -> GENERATED

Exemplos esperados:

- `$.leaveTypeId` -> OBSERVED
- `$.empNumber` -> OBSERVED
- `$.duration.type` -> OBSERVED
- `$.comment` -> GENERATED
- `$.custom2` -> GENERATED
- `$.password` -> SECRET

## Segurança

O literal monitorado não entra em:

- `CATALOG_CONTEXT_JSON` enviado à IA;
- diagnostics do Planner;
- contextFingerprint;
- Test Design persistido;
- Test Registry.

Um binding OBSERVED persistido contém apenas target/selector/source/valueType/bindingKey.

## Boundary C2-C / C2-D

C2-C apenas decide que a massa deve vir do Reservoir.

C2-D deverá:

- resolver OBSERVED pelo Environment selecionado no Run;
- preferir HTTP_2XX;
- preservar correlação usando request samples quando múltiplos OBSERVED aparecem no mesmo cenário;
- congelar os valores no Runtime Snapshot/Execution Plan;
- permitir que o Planner remova o blocker OBSERVED somente depois desse capability estar ativo.
