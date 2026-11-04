# Handoff — licenciamento configurável

Gateway 1.0.18, base 1.0.17 FULL_TEST. QAGENT_TRIAL_DAYS (Worker var, default30, 1..365), preflight de configuração no signup, política existente de pagamentos inalterada. Expiração das novas licenças é calculada uma vez na criação; leituras não renovam prazo. Rotação/múltiplas keys continuam herdando licença pelo fluxo existente.

Prorrogação de existentes: ferramenta administrativa local usando Wrangler/KV remoto, sem endpoint novo. Plan/apply/verify/rollback, writer único, hashes, prévia com valores antes/depois e identidade de operação. Trial vencido elegível pode voltar a trial; pagas, revogadas e histórico de billing excluídos. `trialExtensionOperations` é metadado adicional no JSON da licença, sem migration D1.

Entregue, não implantado remotamente. ZIP completo, comparação local obrigatória para não sobrescrever outra frente. Não alterar Observation/Plugin para isso. Próximo passo funcional UI permanece testar FULL_TEST e completar aceite A.2; A.3 não implementada aqui.
