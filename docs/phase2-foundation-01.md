# QAgent Phase 2 — Foundation 01

Primeiro pacote incremental da Fase 2.

## Objetivo

Criar uma baseline de testes executável e iniciar a extração segura de responsabilidades do `src/index.js`, sem alterar contratos públicos dos endpoints.

## Alterações realizadas

### Testes

- Corrigidos imports da suíte `test/run-tests.js`.
- Os testes agora importam helpers diretamente dos módulos responsáveis.
- Adicionado `npm run test:generate` para o handler de geração.
- Adicionado `npm run test:all` para executar a baseline principal.

### Refatoração inicial

Criado:

```text
src/lib/http.js
src/lib/autofill.js
```

Movido de `src/index.js` para `src/lib/http.js`:

- `corsHeaders`

Movido de `src/index.js` para `src/lib/autofill.js`:

- `buildAutofillPrompt`
- `normalizeAutofillResponse`

O comportamento público permanece o mesmo; o `index.js` apenas consome os novos módulos.

### Configuração local

Adicionado `.dev.vars.example` somente com os nomes das variáveis necessárias.

O arquivo `.dev.vars` real continua ignorado pelo Git e não deve ser distribuído ou versionado.

## Validação local

Instalar dependências:

```bash
npm install
```

Executar baseline:

```bash
npm run test:all
```

Executar Worker local:

```bash
npx wrangler dev --local --port 8787
```

Ou remoto:

```bash
npx wrangler dev --remote --port 8787
```

## Critério de aceite

- `npm run test:all` verde.
- Worker continua inicializando.
- Endpoints atuais preservados.
- Plugin atual continua consumindo o Gateway sem mudança de contrato.

## Próxima etapa recomendada

Foundation 02 / Router Refactor:

1. inventariar rotas atuais;
2. criar roteador modular;
3. extrair primeiro grupo de endpoints de baixo risco (`health`/diagnóstico);
4. manter `index.js` como composition root;
5. validar testes e execução local a cada extração.
