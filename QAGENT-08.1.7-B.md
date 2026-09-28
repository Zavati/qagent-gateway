# QAgent — 08.1.7-B — Gateway

## Alterações locais

Novo `src/readiness/learningAdmissionV2.js`, utilizado em `consoleLearningResolution`, `exploratoryLearningData` e `executionPlanMaterializerService`. Nos cenários `NATIVE_V2`, valida o contrato/issues, ignora blocker text e o label legacy como autoridade e revalida os guards estruturais. V2 presente mas inválido falha fechado; cenário legacy usa adapter e policy original conservadora.

O preflight pode preparar apenas PATH_PARAM ordinário já suportado, respeitando configuração FIXED/SECRET e preservação de intenção. `preparationAllowed=true` autoriza somente resolução privada de dados, nunca execução. O Run exige reavaliação favorável após preparo e os resolvers reais de runtime/auth/data. A política REGRESSION não mudou.

A resposta do Analyze acrescenta, em `learning`, `admissionBasis`, `sourceExecutionStatus`, `executionStatus`, `issueCodes`, `resolvedIssueCodes`, `coverageStatus` e `confirmationRequiresCoverage`. `semanticDiagnostics.basis=SYSTEM_STRUCTURED_READINESS_V2` identifica a interpretação nativa. Os campos v1 existentes permanecem; não é uma alteração de UI. `requiresRuntimePreflight=true` continua obrigatório.

A ponte ao Runner emite exatamente `qagent.exploratory-learning-admission.v1`, com os três campos originais. A tradução dos códigos estruturados para o vocabulário `LEARNING_*` é determinística; não usa texto nativo. Não enviar readiness do browser nem alterar Runner.

## Limites da entrega

Somente **08.1.7-B — Structured Learning Admission**. Não há reconciliação/maturity promotion C, workspace D, novas propostas, autoaprovação, migration ou alteração do Runner, Results, Orchestrator e Console.

A execução LEARNING continua explícita, por seleção de cenários. Ler/Analyze não executa nem aplica; aprovação não dispara Run. `HYPOTHESIS` e `coverage=PARTIAL` não são bloqueios operacionais por si só. Bloqueios técnicos, autenticação, segredo, intenção negativa, isolamento de tenant, runtime e Mutation Safety continuam independentes. GET/HEAD/OPTIONS somente; nenhum alargamento do Learning de mutations.

O JSON persistido permanece imutável. Resolver dados em cópia privada não promove expectativa/cobertura. As derivações existentes continuam usando a invalidação seletiva da A: cenário alterado sem snapshot obsoleto, adapter em leitura, `PENDING_VERIFICATION`. A evidência da versão N não verifica N+1.

## Publicação e rollback

Publicar **Registry compatível → Evolution → Gateway**. Preservar bindings, secrets e configurações efetivas dos ambientes; não substituir configuração de produção indiscriminadamente pelo ZIP.

`SCENARIO_READINESS_V2_ENABLED=true` habilita admissão no Gateway e criação de proofs estruturados no Evolution. No Registry, a mesma flag mantém sua função da A para o Explorer; validação de proofs antigos/novos não depende da flag de leitura.

A flag já pode estar true no Gateway pela A: nesse caso, publicar o código B ativa a admissão imediatamente. Para rollout controlado, desligar temporariamente a flag do Gateway/Evolution antes da atualização, publicar na ordem, conferir vínculos dos serviços e reativar. Essa mesma flag controla geração/projeção da A: desligá-la também afeta essas funções, sem apagar versões persistidas. Não há flag B independente nesta entrega.

Novos proofs carregam o discriminador opcional fechado `admissionBasis=STRUCTURED_READINESS_V2`. Proofs sem o campo continuam interpretados pela política original. Uma proposta já persistida conserva sua interpretação mesmo se a flag mudar antes da aprovação. Manter o código compatível do Registry/Evolution durante rollback por flag; voltar esses binários a versões pré-B pode rejeitar proofs novos pendentes. Não editar proofs para contornar isso.

## Testes

```sh
npm run test:f08-1-7-b
```

A execução local foi feita em Node v22.16.0. O Registry declara Node >=24; repetir no runtime oficial. Consulte validation report para regressão e smokes ainda pendentes. Não houve deploy por esta implementação.
