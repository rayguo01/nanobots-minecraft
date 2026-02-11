  VPS 部署步骤                                                                  
  1. 上传代码到 Git 仓库                                                     

  先在本地把 mc-controller 推到                                              
  Git（如果你还没有推过代码的话）。或者你可以直接把整个 mindcraft
  仓库推上去，VPS 上只用 mc-controller 目录。

  2. 在 VPS 上操作

  # 克隆仓库（替换为你的仓库地址）
  git clone <你的仓库地址> ~/mindcraft
  cd ~/mindcraft/mc-controller

  # 安装依赖
  npm install

  # 创建环境配置
  cp .env.example .env
  nano .env

  编辑 .env 文件：
  PORT=3000
  JWT_SECRET=<生成一个随机字符串，比如: openssl rand -hex 32>
  MC_HOST=127.0.0.1
  MC_PORT=25565
  MC_AUTH=offline

  3. 测试启动

  node server.js

  应该看到：
  MC Controller v0.1.0 running on port 3000
  MC Server: 127.0.0.1:25565
  Endpoints: /v1/health, /v1/auth, /v1/bots, /v1/messages, /v1/trades        

  用另一个终端测试：
  curl http://localhost:3000/v1/health
  # 应返回: {"status":"ok","uptime":...}

  4. 用 systemd 设置开机自启

  sudo nano /etc/systemd/system/mc-controller.service

  写入：
  [Unit]
  Description=MC Controller
  After=network.target

  [Service]
  Type=simple
  User=你的用户名
  WorkingDirectory=/home/你的用户名/mindcraft/mc-controller
  ExecStart=/usr/bin/node server.js
  Restart=on-failure
  RestartSec=5
  EnvironmentFile=/home/你的用户名/mindcraft/mc-controller/.env

  [Install]
  WantedBy=multi-user.target

  然后启用服务：
  sudo systemctl daemon-reload
  sudo systemctl enable mc-controller
  sudo systemctl start mc-controller
  sudo systemctl status mc-controller

  5. 验证部署

  curl http://localhost:3000/v1/health

  # 注册一个 agent 测试
  curl -X POST http://localhost:3000/v1/auth/register \
    -H "Content-Type: application/json" \
    -d '{"agentId":"test-agent"}'

  6. 如果需要外网访问

  # 开放防火墙端口
  sudo ufw allow 3000/tcp

  # 或用 nginx 反向代理（推荐）
  sudo apt install nginx