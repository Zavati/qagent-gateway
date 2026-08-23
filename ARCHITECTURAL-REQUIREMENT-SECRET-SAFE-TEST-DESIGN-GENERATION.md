# Architectural Requirement — Secret-Safe Test Design Generation

## Regra principal

Test Design é um artefato persistente de estratégia e execução. Ele nunca pode ser usado como Secret Store.

```text
AI
→ pode propor intenção
→ não pode materializar credential/secret
```

## Separação de responsabilidades

```text
Test Design
  estrutura, intenção, assertions, refs, readiness

Secret Vault / Auth Runtime
  credenciais e tokens de autenticação

Future Test Data Runtime
  GENERATED / FIXED / SECRET refs resolvidas em execução
```

## Fail closed em três camadas

### 1. Prompt

Orienta a IA a não emitir material sensível.

### 2. Deterministic Sanitizer

Remove material proibido antes da persistência e transforma dependência de secret em readiness explícita.

### 3. Contract Validator

Continua rejeitando qualquer material proibido que atravesse as camadas anteriores.

Nenhuma camada pode relaxar a seguinte.

## Não usar placeholders informais

São proibidos como solução implícita:

```text
${PASSWORD}
{{TOKEN}}
fake-secret
senha123
```

Placeholders só poderão existir futuramente se forem parte de um contrato formal de Test Data Runtime com refs tipadas e resolução JIT.

## Auth headers são system-owned

`Authorization`, Cookie e API keys não pertencem ao request DSL produzido pela IA. O Auth Runtime é a única camada autorizada a injetá-los.

## Persistência

Nenhum material removido pode chegar a:

- Test Registry;
- Gateway D1;
- Queue;
- Runtime Snapshot;
- Execution Plan;
- logs;
- Results Plane.

Diagnostics podem conter somente metadados bounded, como tipo de remoção e path seguro do campo.
