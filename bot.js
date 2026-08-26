const mineflayer = require('mineflayer');
const http = require('http');

const MC_HOST = process.env.MC_HOST || '144.31.46.15';
const MC_PORT = parseInt(process.env.MC_PORT || '10486', 10);
const MC_USER = process.env.MC_USER || 'KeepAliveBot';
const HTTP_PORT = parseInt(process.env.PORT || '8080', 10);

let bot = null;
let isSpawned = false;
let lastSpawnTime = null;
let totalReconnections = 0;

function startBot() {
  console.log(`[+] [${new Date().toISOString()}] Connecting Mineflayer Bot to ${MC_HOST}:${MC_PORT} as '${MC_USER}' (1.21.4)...`);

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USER,
    version: '1.21.4',
    checkTimeoutInterval: 60 * 1000,
    keepAlive: true,
  });

  bot.on('login', () => {
    console.log(`[+] [${new Date().toISOString()}] ✅ Logged in to ${MC_HOST}:${MC_PORT}`);
  });

  bot.on('spawn', () => {
    isSpawned = true;
    lastSpawnTime = new Date().toISOString();
    console.log(`🎉 [${new Date().toISOString()}] [SUCCESS] Bot SPAWNED into world! Position:`, bot.entity.position);
    
    // 随机微小移动或原地跳跃，保持活跃防 AFK
    bot.setControlState('jump', true);
    setTimeout(() => {
      if (bot) bot.setControlState('jump', false);
    }, 500);
  });

  bot.on('kicked', (reason) => {
    isSpawned = false;
    console.log(`[-] [${new Date().toISOString()}] Bot was kicked:`, reason);
  });

  bot.on('error', (err) => {
    isSpawned = false;
    console.log(`[-] [${new Date().toISOString()}] Bot error:`, err.message);
  });

  bot.on('end', (reason) => {
    isSpawned = false;
    totalReconnections++;
    console.log(`[!] [${new Date().toISOString()}] Connection ended (${reason}). Auto-reconnecting in 10s...`);
    setTimeout(startBot, 10000);
  });
}

// 启动健康探活 HTTP 服务
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'mc-mineflayer-keepalive-bot',
    target: `${MC_HOST}:${MC_PORT}`,
    player_name: MC_USER,
    player_spawned: isSpawned,
    last_spawn_time: lastSpawnTime,
    reconnections: totalReconnections,
    bot_position: (bot && bot.entity) ? bot.entity.position : null,
    timestamp: new Date().toISOString()
  }));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[+] HTTP probe server listening on port ${HTTP_PORT}`);
});

startBot();
