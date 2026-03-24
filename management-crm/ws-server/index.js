const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = 3001;
const NOTIFY_SECRET = process.env.WS_NOTIFY_SECRET || 'ws-notify-2026!';

// --- WebSocket 서버 ---
const server = http.createServer((req, res) => {
  // POST /notify — Next.js API에서 호출하는 브로드캐스트 엔드포인트
  if (req.method === 'POST' && req.url === '/notify') {
    const secret = req.headers['x-ws-secret'];
    if (secret !== NOTIFY_SECRET) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const payload = JSON.stringify(data);
        let sent = 0;
        wss.clients.forEach(client => {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(payload);
            sent++;
          }
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sent }));
      } catch {
        res.writeHead(400);
        res.end('Bad JSON');
      }
    });
    return;
  }

  // GET /health
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // 연결 시 확인 메시지
  ws.send(JSON.stringify({ type: 'connected' }));

  // 30초 ping/pong (죽은 연결 정리)
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// 죽은 연결 정리 (30초마다)
const pingInterval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ws-server] listening on :${PORT} (clients: ${wss.clients.size})`);
});
