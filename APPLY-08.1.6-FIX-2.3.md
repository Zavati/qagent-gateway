# Aplicação da 08.1.6 FIX-2.3

Aplicar sobre a base indicada no manifesto da entrega; preservar configurações/flags/bindings/secrets. Não sobrescrever wrangler com valores de exemplo da base. `OBSERVED_BASELINE_GENERATION_ENABLED=true` continua global.

Esta FIX altera Gateway, Runner, Evolution, Registry, Results e Console. Não altera Orchestrator/captura. Results migration 0007 e Evolution 0011 devem preceder os emissores; publicar consumidores antes dos produtores dos novos tipos de assertion. Nenhuma migration neste repositório além das indicadas no handoff para seu serviço.

Executar `npm ci`, `npm run test:f08-1-6-fix2-3`, `npm run check:08.1.6-fix2-3`; na Console, também `npm run build`. Reconciliar o teste de configuração de mutação herdado do Runner sem enfraquecer autorização. A validação local não substitui release/homologação.

Ver o handoff e relatório de validação da entrega. CHANGED-FILES não é um repositório completo, mas contém os arquivos cumulativos novos/alterados desta FIX. Testes usam fixtures sintéticas e não acessam APIs de clientes.
