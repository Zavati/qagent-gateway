# 08.1.6 FIX-2.1

Aplicar sobre FIX-2; apenas Gateway/Runner/Console. Consulte QAGENT-08.1.6-FIX-2.1-HANDOFF.md da entrega. Nenhuma migration nova. Preserve wrangler, secrets, IDs e variáveis publicadas. A flag global true é suficiente; PROJECT_IDS foi aposentada no código.

`npm run test:f08-1-6-fix2-1`

`npm run check:08.1.6-fix2-1`

Console também exige `npm run build`. Runner tem gate preexistente de flag de mutação a reconciliar.
