/* Mock Service Worker script
   Simula o background (Service Worker) chamando o endpoint /v1/autofill no Worker.

   Uso:
     QAGENT_AUTOFILL_URL=http://127.0.0.1:8787/v1/autofill QAGENT_TEST_TOKEN=yourtoken node test/mock-sw.js

   Observações:
   - O token precisa obedecer à validação: >=24 chars, charset [A-Za-z0-9_-.]
   - Se o Worker estiver rodando localmente via `npx wrangler dev --local --port 8787`, use a URL acima.
*/

const url = process.env.QAGENT_AUTOFILL_URL || process.env.QAGENT_IAFILL_URL || 'http://127.0.0.1:8787/v1/autofill';
const token = process.env.QAGENT_TEST_TOKEN || 'testtoken-abcdefghijklmnopqrstuvwxyz';

const payload = {
  url: 'https://example.com/form',
  title: 'Teste de formulário',
  elements: [
    { selector: '#email', name: 'email', placeholder: 'seu@email.com', type: 'email' },
    { selector: 'input[name=phone]', name: 'phone', placeholder: 'Telefone', type: 'tel' },
    { selector: '#fullname', name: 'fullname', placeholder: 'Nome completo' },
  ],
  meta: { source: 'popup.autofill', ts: Date.now() }
};

(async () => {
  console.log('Calling', url);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log('Status:', res.status);
    try {
      console.log('Response JSON:', JSON.parse(text));
    } catch {
      console.log('Response text:', text);
    }
  } catch (e) {
    console.error('Request failed:', e);
  }
})();
