# Foundation 07.7.8-B — Zero-Config Auth Resolution + Visibility

## Objetivo

Eliminar a dependência residual entre Auth Profile e API Service explícito durante o Test Design quando o endpoint já possui runtime `DISCOVERED_OBSERVATION` e o tráfego observado informa o esquema de autenticação.

O caso de referência é:

- Project com `0 API Services`;
- runtime descoberto automaticamente;
- Evidence indica `authObserved=true` e `authScheme=BEARER`;
- existe exatamente um Auth Profile Bearer compatível;
- a credencial está configurada no Environment observado.

Nesse caso o QAgent deve associar o Auth Profile automaticamente e produzir `authProfileRef` no Test Spec sem exigir cadastro manual de API Service.

## Comportamento

### Auto-match seguro

Para `authObservation.status=REQUIRED`:

1. determina os Environments elegíveis;
2. para runtime `DISCOVERED_OBSERVATION`, restringe a resolução aos Environments realmente observados;
3. filtra Auth Profiles ativos com credencial configurada nesses Environments;
4. filtra por compatibilidade de esquema observado;
5. exatamente 1 candidato => `AUTO_MATCHED`;
6. mais de 1 => `AMBIGUOUS`, sem escolha automática;
7. nenhum => `UNAVAILABLE`.

### Compatibilidade Bearer

Bearer observado aceita os perfis já suportados pela base:

- `api_key` em header `Authorization`;
- `oauth2_client_credentials` cujo target header é `Authorization`;
- `login_http_json` cujo target header/scheme resultam em Bearer.

Nenhum token, secret ou credential value entra no Context, diagnostics, Test Design ou Console.

## Escopo de Environment

A mudança central da 07.7.8-B é impedir que um runtime descoberto em STG utilize silenciosamente uma credencial configurada somente em DEV.

Para `DISCOVERED_OBSERVATION`:

- com Environment observado: somente esse conjunto é elegível;
- sem Environment observado: fallback para Environments ativos do Project;
- configuração em Environment diferente não é considerada compatível.

## Test Design

Quando o Bearer é observado e um único Auth Profile é resolvido:

```json
{
  "auth": {
    "requirement": "REQUIRED",
    "authProfileRef": "authp_..."
  }
}
```

A readiness pode ser `READY` se não houver outros blockers.

Importante: 07.7.8-B resolve apenas autenticação. Um cenário com body ainda pode permanecer `NEEDS_DATA`, e métodos side-effect continuam submetidos às políticas do Runner.

## Diagnostics

`qagent.catalog-context-builder.v1.4` acrescenta diagnostics seguros:

- `resolutionStatus`;
- `resolutionSource`;
- `candidateProfileCount`;
- `environmentScopeSource`;
- `selectedAuthProfileRef`;
- `selectedProfileKey`;
- `selectedProfileName`;
- `selectedProfileType`.

Não há material sensível nesses campos.

## Console

A tela de Test Design passa a exibir:

- banner `Auth resolvido automaticamente` quando houver auto-match;
- nome do Auth Profile no card do cenário;
- indicador `Auto-matched`;
- aviso de ambiguidade quando múltiplos profiles forem compatíveis;
- aviso quando Auth for observado mas nenhum profile utilizável existir.

## Componentes alterados

### Gateway

- `src/intelligence/catalogContextBuilder.js`
- `test/test-foundation-07-7-8-b-zero-config-auth-resolution.js`
- `test/test-foundation-07-7-6-a-zero-config-runtime-bootstrap.js`
- `package.json`

### Console

- `components/catalog/CatalogEndpointTestDesign.tsx`
- `lib/intelligence.ts`
- `test/test-foundation-07-7-8-b-console.mjs`
- `package.json`

## Não alterado

- Runner;
- Secret Vault;
- Queue contract;
- Runtime Snapshot contract;
- Test Spec contract;
- D1 schema.

Não há migration nesta Foundation.
