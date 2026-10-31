// The only way out of the agent's network: an HTTPS CONNECT proxy that opens tunnels to the allowed hosts and nothing else.
import http from 'node:http';
import net from 'node:net';

const port = Number(process.env.EGRESS_PROXY_PORT ?? 3128);
const allowedTargets = new Set((process.env.EGRESS_ALLOWED_TARGETS ?? '').split(',').filter(Boolean));

const server = http.createServer((request, response) => {
  console.log(`denied ${request.method} ${request.url}`);
  response.writeHead(403).end();
});

server.on('connect', (request, clientSocket, head) => {
  const target = request.url ?? '';
  if (!allowedTargets.has(target)) {
    console.log(`denied CONNECT ${target}`);
    clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const separator = target.lastIndexOf(':');
  const upstream = net.connect(Number(target.slice(separator + 1)), target.slice(0, separator), () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(port, () => console.log(`listening on ${port}`));
