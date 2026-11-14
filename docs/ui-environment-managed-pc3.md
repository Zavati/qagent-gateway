# Grant PC.3 r2: dados de teste geridos pelo ambiente

A revisão `08.2-PC.3.r2` usa a rota existente `POST /v1/plugin/ui-capture-grants`, com sessão Plugin,
licença e escopo existentes. O pedido de captura inclui `configurationMode: "ENVIRONMENT"`.
O cliente não fornece `organizationId`, `environmentType`, política ou hash autorizado.

O Gateway consulta o ambiente persistido no escopo da sessão e só admite captura r2 quando:

- `environmentType` é `DEV` ou `STG`;
- a política existente `QAGENT_UI_CAPTURE_POLICY` seleciona `FULL_TEST`;
- captura está habilitada globalmente e no ambiente;
- Observation anuncia a revisão r2, origem `OBSERVED_ENVIRONMENT_MANAGED`, capacidade
  `ENVIRONMENT_MANAGED_TEST_DATA`, armazenamento privado inerte e ingestão assíncrona durável.

Nome do ambiente, hostname ou campo enviado pelo cliente não substituem o tipo persistido.
Ambientes `QA`, `PROD`, `CUSTOM` ou sem tipo recusam a captura r2. Política `PROTECTED` ou
ausência de configuração FULL_TEST também recusam. Não há nova variável de ativação nem checkbox.

## Política resolvida e assinatura

Somente r2 acrescenta `dataProtection: "ENVIRONMENT_MANAGED"` à política. O campo participa do
SHA-256 canônico `capturePolicyHash` assinado no grant. A mesma sessão, projeto, ambiente,
origem, propósito e validade limitada continuam vinculados à assinatura.

O perfil usa texto público `body`, screenshot `body`, valores de
`input:not([type="file"]),textarea,select` e `maskSelectors: []`. Seletores funcionais e caminhos
explicitamente configurados continuam delimitando a captura; máscaras configuradas não são
aplicadas nesse perfil. Headers de teste como `authorization`, `cookie` e `x-api-key` podem ser
declarados em `businessHeaderNames`, mantendo regras de nome, tamanho e quantidade.

A responsabilidade pelo preparo dos dados é do ambiente. Este perfil não remove informações
pessoais ou credenciais de teste do conteúdo capturado. Não lê valores de AuthProfile/Vault nem
outras variáveis de ambiente; apenas resolve a configuração de captura já existente.

## Compatibilidade

Pedidos `08.2-A.1.r1`, `08.2-A.2.r1` e `08.2-PC.3.r1` mantêm seus contratos e filtros anteriores.
O novo perfil nunca é ativado implicitamente por um pedido r1. Grants de leitura histórica r2
continuam independentes da política atual de captura, da habilitação de escrita e de mudança
posterior do tipo do ambiente; sessão, licença, escopo e suporte de leitura continuam obrigatórios.

Observation e Plugin precisam reconhecer r2 e o hash da política. O Gateway não publica uma
captura diretamente nem altera filas, tabelas, artefatos históricos ou infraestrutura.

`npm run test:pc3` cobre grants r1 e r2. `npm run check:pc3` inclui regressões de configuração,
autorização, capabilities e rotas. Os testes usam o handler real com armazenamento e Service Binding locais.
