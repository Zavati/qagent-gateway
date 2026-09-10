# qagent-gateway — 08.1.6 Observed Baseline Generation & Provenance

Leia o handoff completo incluído neste repositório antes de publicar. Nenhuma migration nova neste serviço.

Repositório completo baseado no ZIP fornecido; preserve suas configurações e secrets de ambiente. Não copie `node_modules` de outro pacote. Não houve deploy nesta entrega.

```bash
npm ci
npm run test:f08-1-6
npm run check:08.1.6
```

Na Console também execute `npm run build`. A geração no Gateway foi entregue desligada; habilite somente após migrations/receptores compatíveis e restrinja ao projeto piloto. Não publique o Normalizer antes do Catalog compatível. A revisão humana salva nova versão, sem executar.

## Gates pendentes da validação local

Next build não executado: npm DNS `EAI_AGAIN`. Wrangler/Vitest oficial de Catalog/Normalizer indisponível localmente. Um teste legado de política do Runner e cinco verificações estáticas antigas da Console falharam também nos fontes originais. Reconciliar esses gates, sem ignorá-los. Logs e detalhes estão no pacote de validação.

Plugin e Observation permanecem os existentes. Use monitoramento novo e nova versão/snapshot de teste para validar proveniência; não reclassifique dados legados retroativamente.
