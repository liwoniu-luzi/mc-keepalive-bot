const net = require('net');
const http = require('http');
const mineflayer = require('mineflayer');

const MC_HOST = process.env.MC_HOST || '144.31.46.15';
const MC_PORT = parseInt(process.env.MC_PORT || '10486', 10);
const MC_USER = process.env.MC_USER || 'KeepAliveBot';
const MC_VERSION = process.env.MC_VERSION || '1.21.4';
const HTTP_PORT = parseInt(process.env.PORT || '8080', 10);

let tcpActiveCount = 0;
let lastPingTime = null;
let lastServerStatus = 'unknown';

// 1. Raw Minecraft TCP Keep-Alive & Handshake Stream (Works on ANY Minecraft version including 26.2 snapshot)
function startTcpKeepAliveStream() {
  function sendPing() {
    const socket = new net.Socket();
    socket.setTimeout(8000);

    socket.connect(MC_PORT, MC_HOST, () => {
      tcpActiveCount++;
      lastPingTime = new Date().toISOString();
      
      // Handshake Packet (Protocol 0, Server Address, Port, Next State 1: Status)
      const hostBuf = Buffer.from(MC_HOST, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(MC_PORT, 0);

      // Construct VarInt Length + Handshake payload
      const handshakePayload = Buffer.concat([
        Buffer.from([0x00]), // Packet ID 0x00 (Handshake)
        Buffer.from([0x00]), // Protocol Version (0 for query/any)
        Buffer.from([hostBuf.length]),
        hostBuf,
        portBuf,
        Buffer.from([0x01])  // Next state: 1 (status)
      ]);

      const handshakePacket = Buffer.concat([
        Buffer.from([handshakePayload.length]),
        handshakePayload
      ]);

      // Status Request Packet: Length 1, Packet ID 0x00
      const statusRequestPacket = Buffer.from([0x01, 0x00]);

      socket.write(handshakePacket);
      socket.write(statusRequestPacket);
    });

    socket.on('data', (data) => {
      lastServerStatus = 'online';
      console.log(`[+] [${new Date().toISOString()}] TCP Keep-Alive probe active: Received ${data.length} bytes from MC server.`);
    });

    socket.on('error', (err) => {
      console.log(`[-] [${new Date().toISOString()}] TCP probe notice: ${err.message}`);
    });

    socket.on('timeout', () => {
      socket.destroy();
    });

    socket.on('close', () => {
      // Normal close
    });
  }

  // Send TCP Keep-Alive ping every 15 seconds to maintain active external TCP connection for host probes
  setInterval(sendPing, 15000);
  sendPing();
}

// 2. Full Player Entity Bot (Attempts full player entity login)
let currentBot = null;
let botReconnectTimer = null;

function tryEntityBotLogin() {
  if (botReconnectTimer) {
    clearTimeout(botReconnectTimer);
    botReconnectTimer = null;
  }

  try {
    const bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      username: MC_USER,
      version: MC_VERSION,
      checkTimeoutInterval: 60000,
      hideErrors: true
    });

    currentBot = bot;

    bot.on('spawn', () => {
      console.log(`[+] [${new Date().toISOString()}] Player Entity Bot "${MC_USER}" successfully entered world!`);
      setInterval(() => {
        if (!bot || !bot.entity) return;
        try {
          bot.setControlState('jump', true);
          setTimeout(() => {
            if (bot && bot.setControlState) bot.setControlState('jump', false);
          }, 300);
        } catch (e) {}
      }, 30000);
    });

    bot.on('end', () => {
      currentBot = null;
      if (!botReconnectTimer) {
        botReconnectTimer = setTimeout(tryEntityBotLogin, 30000);
      }
    });

    bot.on('error', () => {
      if (!botReconnectTimer) {
        botReconnectTimer = setTimeout(tryEntityBotLogin, 30000);
      }
    });
  } catch (err) {
    if (!botReconnectTimer) {
      botReconnectTimer = setTimeout(tryEntityBotLogin, 30000);
    }
  }
}

// 3. HTTP Health Check Server (Port 8080)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'mc-keepalive-bot',
    target: `${MC_HOST}:${MC_PORT}`,
    server_status: lastServerStatus,
    last_ping: lastPingTime,
    probes_sent: tcpActiveCount,
    entity_bot_active: !!(currentBot && currentBot.entity)
  }, null, 2));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Minecraft 7x24 Keep-Alive Bot Started!`);
  console.log(`🎯 Target Server : ${MC_HOST}:${MC_PORT}`);
  console.log(`🌐 HTTP Probe    : http://0.0.0.0:${HTTP_PORT}`);
  console.log(`=======================================================`);
});

// Launch keep-alive stream & player login
startTcpKeepAliveStream();
tryEntityBotLogin();
