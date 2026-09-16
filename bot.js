const mineflayer = require('mineflayer');
const http = require('http');

// 默认服务器保活列表（支持 Render 环境变量 SERVERS / MC_SERVERS 动态覆盖）
function parseServerList() {
  const envServers = process.env.SERVERS || process.env.MC_SERVERS;
  if (envServers) {
    try {
      // 尝试解析 JSON 格式
      const parsed = JSON.parse(envServers);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // 尝试解析逗号分隔格式：host:port:username:version
      const list = envServers.split(',').map((item, idx) => {
        const parts = item.trim().split(':');
        return {
          id: `server_${idx + 1}`,
          host: parts[0] || '127.0.0.1',
          port: parseInt(parts[1] || '25565', 10),
          username: parts[2] || `KeepAliveBot_${idx + 1}`,
          version: parts[3] || '1.21.4',
        };
      }).filter(s => s.host);
      if (list.length > 0) return list;
    }
  }

  // 默认内置多服务器列表
  return [
    {
      id: 'server_1',
      name: 'Server-1 (Legacy)',
      host: process.env.MC_HOST || '144.31.46.15',
      port: parseInt(process.env.MC_PORT || '10486', 10),
      username: process.env.MC_USER || 'KeepAliveBot_1',
      version: '1.21.4',
    },
    {
      id: 'server_2',
      name: 'Server-2 (ceu.gg)',
      host: 'servidores.ceu.gg',
      port: 25905,
      username: 'KeepAliveBot_2',
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
    username: cfg.username,
    version: cfg.version,
    is_online: false,
    last_spawn_time: null,
    reconnect_count: 0,
    last_error: null,
    bot_position: null,
  };
});

class ServerKeepAliveWorker {
  constructor(config) {
    this.config = config;
    this.bot = null;
    this.isDestroyed = false;
    this.reconnectTimer = null;
    this.jumpInterval = null;
  }

  start() {
    this.connect();
  }

  connect() {
    if (this.isDestroyed) return;

    const { id, host, port, username, version } = this.config;
    const status = runtimeStatus[id];

    console.log(`[+] [${new Date().toISOString()}] [${id}] 正在连接 Minecraft 服务器 (${host}:${port}) 用户名: ${username} (版本: ${version})...`);

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
      console.log(`[+] [${new Date().toISOString()}] [${id}] ✅ 登录握手成功！`);
    });

    this.bot.on('spawn', () => {
      status.is_online = true;
      status.last_spawn_time = new Date().toISOString();
      status.last_error = null;

      const pos = this.bot.entity ? this.bot.entity.position : null;
      status.bot_position = pos;
      console.log(`🎉 [${new Date().toISOString()}] [${id}] 【实体生成】玩家已进入世界！坐标:`, pos ? `X=${pos.x.toFixed(1)}, Y=${pos.y.toFixed(1)}, Z=${pos.z.toFixed(1)}` : 'N/A');

      // 启动防 AFK 微动定时器（每 60 秒跳跃一次）
      if (this.jumpInterval) clearInterval(this.jumpInterval);
      this.jumpInterval = setInterval(() => {
        if (this.bot && status.is_online) {
          try {
            this.bot.setControlState('jump', true);
            setTimeout(() => {
              if (this.bot) this.bot.setControlState('jump', false);
            }, 350);
          } catch (_) {}
        }
      }, 60 * 1000);

      // 进服首次微动
      try {
        this.bot.setControlState('jump', true);
        setTimeout(() => {
          if (this.bot) this.bot.setControlState('jump', false);
        }, 400);
      } catch (_) {}
    });

    this.bot.on('kicked', (reason) => {
      status.is_online = false;
      status.bot_position = null;
      const kickMsg = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      console.log(`[-] [${new Date().toISOString()}] [${id}] 玩家被移出:`, kickMsg);
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
      if (this.jumpInterval) {
        clearInterval(this.jumpInterval);
        this.jumpInterval = null;
      }
      console.log(`[!] [${new Date().toISOString()}] [${id}] 连接已断开 (${reason})。5 秒后自动重连...`);
      this.scheduleReconnect(5000);
    });
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
    version: '1.1.0',
    summary: {
      total_servers: totalCount,
      online_servers: onlineCount,
    },
    servers: serversList,
    timestamp: new Date().toISOString()
  }, null, 2));
});

server.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[+] Render HTTP 状态监控服务已在端口 ${HTTP_PORT} 成功启动！`);
});
