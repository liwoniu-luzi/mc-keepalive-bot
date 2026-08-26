const mineflayer = require('mineflayer');

const MC_HOST = process.env.MC_HOST || '144.31.46.15';
const MC_PORT = parseInt(process.env.MC_PORT || '10486', 10);
const MC_USER = process.env.MC_USER || 'KeepAliveBot';

let bot = null;

function createBot() {
  console.log(`[+] [${new Date().toLocaleTimeString()}] 正在以玩家 '${MC_USER}' 身份登录 Minecraft 1.21.4 (${MC_HOST}:${MC_PORT})...`);

  bot = mineflayer.createBot({
    host: MC_HOST,
    port: MC_PORT,
    username: MC_USER,
    version: '1.21.4',
    checkTimeoutInterval: 60 * 1000,
    keepAlive: true,
  });

  bot.on('login', () => {
    console.log(`[+] [${new Date().toLocaleTimeString()}] ✅ 账号握手通过，已成功登录进服！`);
  });

  bot.on('spawn', () => {
    const pos = bot.entity.position;
    console.log(`🎉 [${new Date().toLocaleTimeString()}] 【实体生成成功】玩家已正式站在主城世界中！`);
    console.log(`📍 坐标位置: X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}`);

    // 定时微小跳跃，防 AFK 踢出
    setInterval(() => {
      if (bot && bot.entity) {
        bot.setControlState('jump', true);
        setTimeout(() => {
          if (bot) bot.setControlState('jump', false);
        }, 400);
      }
    }, 25000);
  });

  bot.on('kicked', (reason) => {
    console.log(`[-] [${new Date().toLocaleTimeString()}] 玩家被移出:`, reason);
  });

  bot.on('error', (err) => {
    console.log(`[-] [${new Date().toLocaleTimeString()}] 连接异常:`, err.message);
  });

  bot.on('end', (reason) => {
    console.log(`[!] [${new Date().toLocaleTimeString()}] 连接断开 (${reason})。5 秒后自动重新登录进服...`);
    setTimeout(createBot, 5000);
  });
}

createBot();
