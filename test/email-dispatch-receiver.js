// Simple HTTP receiver to simulate EMAIL_DISPATCH_WEBHOOK_URL for local testing
// Usage: node test/email-dispatch-receiver.js [port]

import http from 'http';
const port = Number(process.argv[2] || process.env.PORT || 3030);

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'only POST allowed' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      // ignore parse error
    }

    console.log('--- EMAIL DISPATCH RECEIVED ---');
    console.log('Headers:', req.headers);
    console.log('Body:', parsed || body);
    console.log('-------------------------------');

    // Simulate success or failure via query ?fail=1
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.searchParams.get('fail')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'simulated failure' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(port, () => console.log(`Email dispatch receiver listening on http://127.0.0.1:${port}`));
