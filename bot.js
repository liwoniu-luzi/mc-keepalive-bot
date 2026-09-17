const mineflayer = require('mineflayer');
const http = require('http');

// 拟真自然玩家 ID 池（杜绝任何 Bot、KeepAlive 等机器人特征词）
const REALISTIC_PLAYER_NAMES = [
  'Alex_Walker',
  'Lucas_Miller',
  'Arthur_Cole',
  'Felix_Craft',
  'Leo_Vance',
  'Oliver_Sky',
  'Mason_Reed',
  'Noah_Hunter',
  'Ethan_Cross',
  'Liam_Brooks'
];

function getNaturalName(index) {
  return REALISTIC_PLAYER_NAMES[index % REALISTIC_PLAYER_NAMES.length];
}

// 默认多服务器 & 多假人群体配置
function parseServerList() {
  const envServers = process.env.SERVERS || process.env.MC_SERVERS;
  if (envServers) {
    try {
      const parsed = JSON.parse(envServers);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          id: item.id || `server_${idx + 1}`,
          name: item.name || `Node-${idx + 1}`,
          host: item.host,
          port: item.port,
          username: item.username || getNaturalName(idx),
          version: item.version || '1.21.4'
        }));
      }
    } catch {
      const list = envServers.split(',').map((item, idx) => {
        const parts = item.trim().split(':');
        return {
          id: `server_${idx + 1}`,
          name: `Node-${idx + 1}`,
          host: parts[0] || '127.0.0.1',
          port: parseInt(parts[1] || '25565', 10),
          username: parts[2] || getNaturalName(idx),
          version: parts[3] || '1.21.4',
        };
      }).filter(s => s.host);
      if (list.length > 0) return list;
    }
  }

  // 默认内置服务器常驻列表
  return [
    {
      id: 'server_1_bot_1',
      name: 'Server-1 (Legacy)',
      host: process.env.MC_HOST || '144.31.46.15',
      port: parseInt(process.env.MC_PORT || '10486', 10),
      username: process.env.MC_USER || getNaturalName(0), // Alex_Walker
      version: '1.21.4',
    }
  ];
}

const SERVER_CONFIGS = parseServerList();
const HTTP_PORT = parseInt(process.env.PORT || '8080', 10);

// 运行时状态记录器
const runtimeStatus = {};

SERVER_CONFIGS.forEach(cfg => {
  runtimeStatus[cfg.id] = {
    id: cfg.id,
    name: cfg.name || cfg.id,
    target: `${cfg.host}:${cfg.port}`,
    player_name: cfg.username,
    version: cfg.version,
    is_online: false,
    last_spawn_time: null,
    reconnect_count: 0,
    last_error: null,
    bot_position: null,
    last_action: null,
  };
});

class ServerKeepAliveWorker {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.isDestroyed = false;
    this.reconnectTimer = null;
    this.actionInterval = null;
  }

  start() {
    this.connect();
  }

  connect() {
    if (this.isDestroyed) return;

    const { id, host, port, username, version } = this.config;
    const status = runtimeStatus[id];

    console.log(`[+] [${new Date().toISOString()}] [${id}] 正在以玩家 '${username}' 连接 Minecraft (${host}:${port}) (版本: ${version})...`);

    try {
      this.bot = mineflayer.createBot({
        host,
        port,
        username,
        version,
        checkTimeoutInterval: 60 * 1000,
        keepAlive: true,
      });
    } catch (err) {
      console.error(`[-] [${new Date().toISOString()}] [${id}] 初始化异常:`, err.message);
      status.last_error = err.message;
      this.scheduleReconnect(5000);
      return;
    }

    this.bot.on('login', () => {
      console.log(`[+] [${new Date().toISOString()}] [${id}] ✅ 玩家 '${username}' 登录握手成功！`);
    });

    this.bot.on('spawn', () => {
      status.is_online = true;
      status.last_spawn_time = new Date().toISOString();
      status.last_error = null;

      const pos = this.bot.entity ? this.bot.entity.position : null;
      status.bot_position = pos;
      console.log(`🎉 [${new Date().toISOString()}] [${id}] 【实体生成】玩家 '${username}' 已进入主城世界！坐标:`, pos ? `X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}` : 'N/A');

      // 启动拟真自然生态行为循环（每 20 ~ 40 秒随机执行拟真操作）
      if (this.actionInterval) clearInterval(this.actionInterval);
      this.scheduleNextRealisticAction();
    });

    this.bot.on('kicked', (reason) => {
      status.is_online = false;
      status.bot_position = null;
      const kickMsg = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      console.log(`[-] [${new Date().toISOString()}] [${id}] 玩家 '${username}' 被移出:`, kickMsg);
      status.last_error = `Kicked: ${kickMsg}`;
    });

    this.bot.on('error', (err) => {
      status.is_online = false;
      status.bot_position = null;
      console.log(`[-] [${new Date().toISOString()}] [${id}] 连接错误:`, err.message);
      status.last_error = `Error: ${err.message}`;
    });

    this.bot.on('end', (reason) => {
      status.is_online = false;
      status.bot_position = null;
      status.reconnect_count++;
      if (this.actionInterval) {
        clearTimeout(this.actionInterval);
        this.actionInterval = null;
      }
      console.log(`[!] [${new Date().toISOString()}] [${id}] 连接已断开 (${reason})。5 秒后自动重新进服...`);
      this.scheduleReconnect(5000);
    });
  }

  // 拟真玩家随机行为模拟器（转头环顾、微小移动、挥手打拳、潜行下蹲、跳跃等）
  scheduleNextRealisticAction() {
    if (!this.bot || !runtimeStatus[this.config.id].is_online) return;

    const delay = Math.floor(Math.random() * 20000) + 20000; // 20s ~ 40s 随机间隔
    this.actionInterval = setTimeout(() => {
      this.performRealisticAction();
      this.scheduleNextRealisticAction();
    }, delay);
  }

  performRealisticAction() {
    const { id, username } = this.config;
    const status = runtimeStatus[id];
    if (!this.bot || !status.is_online) return;

    try {
      const actionType = Math.floor(Math.random() * 5);
      switch (actionType) {
        case 0: { // 随机转头视角环顾
          const randomYaw = (Math.random() * 2 - 1) * Math.PI;
          const randomPitch = (Math.random() * 0.8 - 0.4);
          this.bot.look(randomYaw, randomPitch, true).catch(() => {});
          status.last_action = `LookAround (Yaw: ${randomYaw.toFixed(2)}, Pitch: ${randomPitch.toFixed(2)})`;
          break;
        }
        case 1: { // 挥动主手
          this.bot.swingArm('right');
          status.last_action = 'SwingArm';
          break;
        }
        case 2: { // 微小跳跃
          this.bot.setControlState('jump', true);
          setTimeout(() => {
            if (this.bot) this.bot.setControlState('jump', false);
          }, 350);
          status.last_action = 'Jump';
          break;
        }
        case 3: { // 拟真下蹲潜行（Shift）
          this.bot.setControlState('sneak', true);
          setTimeout(() => {
            if (this.bot) this.bot.setControlState('sneak', false);
          }, 800);
          status.last_action = 'Sneak';
          break;
        }
        case 4: { // 微步调整站位
          const moveDir = Math.random() > 0.5 ? 'forward' : 'back';
          this.bot.setControlState(moveDir, true);
          setTimeout(() => {
            if (this.bot) this.bot.setControlState(moveDir, false);
          }, 300);
          status.last_action = `MicroMove (${moveDir})`;
          break;
        }
      }

      if (this.bot.entity && this.bot.entity.position) {
        status.bot_position = this.bot.entity.position;
      }
    } catch (e) {
      // 忽略微小动作异常
    }
  }

  scheduleReconnect(delayMs) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.isDestroyed) return;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delayMs);
  }
}

// 启动所有配置的服务器保活 Worker
const workers = SERVER_CONFIGS.map(cfg => {
  const worker = new ServerKeepAliveWorker(cfg);
  worker.start();
  return worker;
});

// 全局异常防护，确保主进程 100% 不崩溃
process.on('uncaughtException', (err) => {
  console.error(`[CRITICAL] 未捕获异常:`, err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[CRITICAL] 未处理的 Promise 拒绝:`, reason);
});

// 启动 HTTP 服务，满足 Render 健康检查与实时监控
const server = http.createServer((req, res) => {
  const serversList = Object.values(runtimeStatus);
  const totalCount = serversList.length;
  const onlineCount = serversList.filter(s => s.is_online).length;

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    status: 'ok',
    service: 'render-multi-minecraft-keepalive-bot',
    version: '1.4.0',
    summary: {
      total_bots: totalCount,
      online_bots: onlineCount,
    },
    bots: serversList,
    timestamp: new Date().toISOString()
  }, null, 2));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[+] Render HTTP 状态监控服务已在端口 ${HTTP_PORT} 成功启动！`);
});
