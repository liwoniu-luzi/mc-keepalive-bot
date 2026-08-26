const mineflayer = require('mineflayer');
const http = require('http');

const MC_HOST = process.env.MC_HOST || '144.31.46.15';
const MC_PORT = parseInt(process.env.MC_PORT || '10486', 10);
const MC_USER = process.env.MC_USER || 'KeepAliveBot';
const HTTP_PORT = parseInt(process.env.PORT || '8080', 10);

let bot = null;
let isSpawned = false;
let lastSpawnTime = null;
let reconnectCount = 0;

function createBot() {
  console.log(`[+] [${new Date().toISOString()}] 正在以玩家 '${MC_USER}' 身份登录 Minecraft 1.21.4 (${MC_HOST}:${MC_PORT})...`);

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USER,
    version: '1.21.4',
    checkTimeoutInterval: 60 * 1000,
    keepAlive: true,
  });

  bot.on('login', () => {
    console.log(`[+] [${new Date().toISOString()}] ✅ 账号握手通过，已成功登录进服！`);
  });

  bot.on('spawn', () => {
    isSpawned = true;
    lastSpawnTime = new Date().toISOString();
    const pos = bot.entity.position;
    console.log(`🎉 [${new Date().toISOString()}] 【实体生成成功】玩家已正式站在主城世界中！`);
    console.log(`📍 坐标位置: X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}`);

    // 定时微小跳跃，防 AFK 踢出
    bot.setControlState('jump', true);
    setTimeout(() => {
      if (bot) bot.setControlState('jump', false);
    }, 400);
  });

  bot.on('kicked', (reason) => {
    isSpawned = false;
    console.log(`[-] [${new Date().toISOString()}] 玩家被移出:`, reason);
  });

  bot.on('error', (err) => {
    isSpawned = false;
    console.log(`[-] [${new Date().toISOString()}] 连接异常:`, err.message);
  });

  bot.on('end', (reason) => {
    isSpawned = false;
    reconnectCount++;
    console.log(`[!] [${new Date().toISOString()}] 连接断开 (${reason})。5 秒后自动重新登录进服...`);
    setTimeout(createBot, 5000);
  });
}

// 启动 HTTP 服务满足 Render 的健康检查要求，并提供公网实时监控
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'render-minecraft-7x24-bot',
    target: `${MC_HOST}:${MC_PORT}`,
    player_name: MC_USER,
    is_online: isSpawned,
    last_spawn_time: lastSpawnTime,
    reconnect_count: reconnectCount,
    bot_position: (bot && bot.entity) ? bot.entity.position : null,
    timestamp: new Date().toISOString()
  }));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[+] Render HTTP health check server listening on port ${HTTP_PORT}`);
});

createBot();
