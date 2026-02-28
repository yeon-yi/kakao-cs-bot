const net = require('net');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const match = redisUrl.match(/redis:\/\/(?:.*@)?([^:]+):(\d+)/);
const host = match ? match[1] : 'localhost';
const port = match ? parseInt(match[2]) : 6379;

const client = net.createConnection({ host, port, timeout: 2000 }, () => {
  client.write('PING\r\n');
});

client.on('data', (data) => {
  const response = data.toString().trim();
  if (response === '+PONG') {
    client.end();
    process.exit(0);
  } else {
    client.end();
    process.exit(1);
  }
});

client.on('error', () => process.exit(1));
client.on('timeout', () => { client.end(); process.exit(1); });
