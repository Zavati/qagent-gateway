# Foundation 07.6.3 — AI Test Design Engine — Fix 2

## Motivo

Validação real em produção retornou:

```text
AI_TEST_DESIGN_OUTPUT_INVALID
validationCode = TEST_DESIGN_CONTRACT_INVALID
validationPath = modelOutput.scenarios[1].confidence
provider = openai
model = gpt-4o-mini
```

O contrato `qagent.test-design.v1` permanece congelado e exige `confidence` como enum:

```text
HIGH | MEDIUM | LOW
```

## Correção

Foi adicionada uma camada de normalização determinística **antes** do validator do contrato.

Ela existe apenas como adapter de wire-output da IA e não altera o contrato persistido.

### Confidence

Entradas semanticamente equivalentes são normalizadas para o enum v1:

```text
high / VERY_HIGH / alta       -> HIGH
moderate / medium / média     -> MEDIUM
low / VERY_LOW / baixa        -> LOW
0..1                          -> score percentual
0..100                        -> score percentual
"92%"                         -> HIGH
```

Threshold determinístico para score numérico:

```text
80..100 -> HIGH
50..<80 -> MEDIUM
0..<50  -> LOW
```

A regra `ASSUMED + HIGH = inválido` continua sendo aplicada **depois** da normalização.

### Outros enums

Apenas normalização lexical segura (case/separador/acentos), sem inferência semântica:

```text
category
authRequirement
priority
grounding.level
assertion.type
extract.source
```

## Invariantes preservadas

Não há normalização ou relaxamento para:

- evidenceRefs;
- schemaRefs;
- organizationId/projectId/endpointId;
- method/path;
- apiServiceKey;
- Auth Profile;
- request secrets;
- assertions payload;
- Automation Readiness.

Grounding e referências continuam strict-fail.

## Diagnóstico adicional

Se o enum continuar inválido após repair, a resposta pública segura pode incluir:

```json
{
  "expectedValues": ["HIGH", "MEDIUM", "LOW"],
  "receivedType": "number",
  "receivedValue": 120
}
```

Apenas valores escalares curtos do enum são incluídos. Raw AI output, prompt e contexto não são retornados.

## Observabilidade

Normalizações são registradas somente por path:

```text
testDesign_ai_output_normalized
normalizationCount
normalizationPaths
```

Nenhum valor bruto é logado nesse evento.

## Resultado esperado

Outputs como:

```json
"confidence": 0.87
```

ou:

```json
"confidence": "high"
```

passam a ser convertidos para:

```json
"confidence": "HIGH"
```

sem consumir a tentativa única de repair.
