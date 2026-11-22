# QAgent Gateway 1.0.18 — trial configurável e extensão única de 30 dias

## Escopo e estado
Pacote de fontes completo, baseado no Gateway 1.0.17 FULL_TEST (FIX-10) disponível nesta conversa. Não certifica o checkout/deployment remoto. Nenhuma alteração remota executada nesta entrega. Plugin 2.0.20 e Observation 0.1.6 permanecem sem mudanças. Esta é uma correção de licenciamento; não avança a etapa UI para A.3.

Na base inspecionada, `src/lib/licenseService.js` fixava TRIAL_DAYS em **6**, apesar da referência do usuário a sete dias. A clientKey não tem esse prazo embutido: `clientkey:sha256:<hash>` identifica a credencial, e `license:sha256:<hash>` contém `trialEndsAt`/`expiresAt`. São registros em **QAGENT_KV**, não linhas do D1.

## 1. Integrar sem sobrescrever a frente REST
Faça backup/commit do checkout atual. Extraia o ZIP em outra pasta. Na pasta extraída `qagent-gateway`, execute:

```bash
python entrega/check_update.py --target "C:/git/qagent-gateway"
```

`READY_LOCAL_ONLY` significa que o delta mapeado pode ser aplicado; não representa lock, deploy ou homologação de alterações de outras frentes. Em `CONFLICT`, integre os caminhos indicados antes de prosseguir. Não substitua o repositório inteiro por cima de alterações novas.

Para aplicar somente os caminhos mapeados, preservando `.git`, arquivos locais e as demais variáveis do Wrangler:

```bash
python entrega/check_update.py --target "C:/git/qagent-gateway" --apply
```

O pacote é completo; não exige patches antigos. O checker é uma forma de integrar o conteúdo com verificação/backup, não um pacote incompleto. Backup e rollback de fontes ficam em `.qagent-ops/source-backup-*`. Um rollback de fontes não desfaz uma extensão já realizada no KV.

## 2. Novas licenças: 30 ou 90 dias
No **Worker qagent-gateway**, variável `QAGENT_TRIAL_DAYS`, tipo texto. Não é a variável `QAGENT_UI_CAPTURE_POLICY` do Environment de testes.

```json
"QAGENT_TRIAL_DAYS": "30"
```

Valor padrão: 30 dias. Inteiros de 1 a 365 são aceitos; 90 é suportado. Ausência/vazio usa 30; configuração inválida é erro explícito e é validada antes de criar conta/chave no signup. Não há override de duração enviado pelo cliente do signup.

Na raiz do checkout integrado:

```bash
node tools/configure-trial.mjs --days 90
```

Use `--days 30` para voltar. Esse comando edita somente essa variável local. Depois publique o Gateway; mudar o arquivo não altera o Worker sem deploy. Para configurações por `env` do Wrangler, edite explicitamente a seção correspondente (o helper configura apenas a raiz e recusa ambiguidade).

```bash
npm ci
npm test
npm run test:trial-config
npm run test:stripe-billing
npm run test:plugin-session
npm run test:observation-grant
npm run test:f08-2-a2-fix2
npx wrangler deploy
```

Se usar deploy por Git, comite o código e a variável. Não mude bindings/IDs, flags UI ou credenciais. A configuração local é a referência para não perder uma alteração de variável feita somente pelo painel no deploy seguinte.

**Não muda:** datas de licenças já criadas, duração de pagamento/assinatura, geração/rotação de clientKey, permissões, TTL de sessão do Plugin, grants UI/Observation, baselines persistidas, políticas FULL_TEST/PROTECTED, filas ou autenticação. Não há renovação gratuita automática a cada login. Uma nova key clonada/rotacionada continua herdando a licença conforme o fluxo existente.

## 3. Prorrogar as licenças trial existentes
A variável não reescreve o KV. A extensão é uma operação administrativa explícita e separada, com identidade estável, prévia e backup. Usa o Wrangler já instalado e autenticado; não coloque clientKeys ou tokens nos comandos e não envie credenciais ao chat.

Na raiz `C:/git/qagent-gateway`:

```bash
npx wrangler whoami
node tools/extend-trials.mjs plan --days 30 --operation-id trial-plus-30d-01
```

`plan` faz **somente leituras remotas**, escreve o plano/backup local em `.qagent-ops/trial-plus-30d-01.json` e apresenta as datas previstas. O arquivo contém metadados privados de licença e hashes, nunca a clientKey em texto puro; mantenha-o protegido e fora do Git. O script recusa sobrescrever plano existente.

Regra temporal: `nova data = max(data atual de vencimento, data da prévia) + 30 dias`. A data da prévia é fixa no plano para permitir retomada idempotente. Execute a aplicação após revisar a prévia; se passar muito tempo, revise antes de aplicar, em vez de assumir 30 dias a partir de uma nova execução.

| Registro | Tratamento |
|---|---|
| Trial vigente com clientKey ativa | Soma 30 dias ao vencimento atual. |
| Trial vencido com procedência de trial e sem billing | Reabre como `trial`, por 30 dias a partir da data fixa da operação. |
| Licença com plano `pro`, mas status `trial` | É um trial; pode ser elegível. Não filtra só pelo rótulo `free`. |
| ClientKey/licença revogada, desabilitada, suspensa | Excluída. |
| Licença paga/ativa, canceled, past_due, grace_period, ou histórico de billing | Excluída; não altera Stripe, cobrança ou períodos pagos. |
| Licença legada `license:t:*` | Fora do escopo desta operação. |
| Registro com expiração física KV, vínculo de conta divergente ou datas conflitantes | Excluído para revisão, sem adivinhar o estado. |

Opcional para uma única conta: acrescente `--customer-id cus_...` ao comando de prévia. Sem esse filtro, percorre os trials elegíveis do namespace configurado.

### Aplicar a prévia revisada

**KV não oferece compare-and-swap/transação para esta operação.** O script relê licença, autoridade da key e metadados antes de escrever e detecta conflitos, mas isso **não é lock**. Execute numa janela sem outros escritores desses registros: rotação/revogação, billing, criação de keys e normalização de licença por acessos concorrentes. `--confirm-maintenance` confirma essa condição operacional; não desativa o serviço sozinho.

```bash
node tools/extend-trials.mjs apply --plan .qagent-ops/trial-plus-30d-01.json --confirm-maintenance
```

Somente `license:sha256:*` elegíveis são escritos. Preserva clientKey, licenseId, customerId, plano e outros campos, e mantém `expiresAt`/`trialEndsAt` alinhados. Adiciona `trialExtensionOperations[operationId]` ao registro para impedir reaplicação da mesma operação. Não cria uma rota administrativa pública, D1, migration, fila ou secret.

O plano já contém o valor anterior e o novo. Há um journal local por registro. Alteração concorrente causa `CONFLICT_*`, sem forçar gravação; falha de escrita com resultado incerto causa `WRITE_UNCERTAIN` e interrompe as próximas escritas.

### Verificar e retomar

```bash
node tools/extend-trials.mjs verify --plan .qagent-ops/trial-plus-30d-01.json
```

`VERIFIED` confirma igualdade na leitura atual. A propagação entre localidades do KV pode ser eventual: confirmação de PUT não significa visibilidade global imediata. `NOT_APPLIED_OR_NOT_VISIBLE` exige verificar o estado, não criar outro operation-id. Reaplique **o mesmo arquivo de plano** para retomar; o alvo de data é fixo e não soma novamente 30 dias. Se aparecer `CONFLICT_*` ou `CHANGED_AFTER_PLAN`, revise o registro antes de qualquer mudança.

Não recrie a clientKey para validar. Reconecte/renove a sessão normalmente e confira `/v1/license` ou Console. Tokens/grants previamente emitidos não têm seu TTL aumentado retroativamente.

### Rollback de dados (somente quando necessário)

```bash
node tools/extend-trials.mjs rollback --plan .qagent-ops/trial-plus-30d-01.json --confirm-maintenance
```

Restaura o conteúdo anterior somente se o valor atual ainda for exatamente a saída desta operação e a autoridade da clientKey não mudou. Não reverte uma assinatura/rotação/edição posterior. O rollback pode devolver o trial ao estado vencido anterior; não execute como parte do fluxo normal.

## 4. Smoke checklist
- Novo signup recebe `daysLeft` próximo de 30 ou 90 conforme o Worker.
- Consultar repetidamente a mesma licença não muda seu vencimento.
- Prévia lista somente trials elegíveis; pagas/revogadas permanecem fora.
- Apply + verify mostram o mesmo licenseId/customerId/clientKey e a nova data.
- Reaplicar o mesmo plano é no-op; não soma dias adicionais.
- Sessões e grants continuam com TTL próprio.
- FULL_TEST e captura assíncrona permanecem na versão anterior do comportamento.

## 5. Fontes oficiais de operação
- Variáveis Workers: https://developers.cloudflare.com/workers/configuration/environment-variables/
- Wrangler KV: https://developers.cloudflare.com/workers/wrangler/commands/kv/
- Concorrência/propagação KV: https://developers.cloudflare.com/kv/api/write-key-value-pairs/

São referências para comandos/infraestrutura, não confirmação de execução na conta.
