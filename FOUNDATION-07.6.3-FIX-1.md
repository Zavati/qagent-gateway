# QAgent Foundation 07.6.3 — Fix 1

## AI Test Design Contract Guidance + Safe Diagnostics

Este fix mantém `qagent.test-design.v1` congelado e corrige a orientação fornecida aos providers de IA.

### Invariante

O validator continua sendo a autoridade. Nenhuma regra foi relaxada.

### Problema

O JSON Schema usado no prompt definia `assertions.items` e `extract.items` apenas como objetos genéricos, embora o validator exigisse propriedades diferentes para cada assertion. Um provider podia, portanto, obedecer ao schema apresentado e ainda violar o contrato real.

### Resultado

O schema apresentado ao modelo agora é isomórfico aos shapes aceitos pelo validator para assertions/extract. Falhas finais também geram diagnostics públicos limitados a código/caminho de validação.
