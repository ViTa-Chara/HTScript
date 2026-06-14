# Storyboard Studio

一个可部署到 Ubuntu 的在线协作分镜故事板系统，包含用户注册登录、管理员项目管理、音轨上传、多人在线编辑、自动备份、版本回滚和工作记录。

## 功能

- 用户可用邮箱或手机号加密码注册、登录，前端使用 `localStorage` 持久化会话。
- 默认 `OWNER` 管理员由种子脚本创建，可创建用户、创建/删除/调整项目、设置其他管理员。
- 项目支持上传音轨，成员可按毫秒时间段创建、修改、删除分镜。
- 编辑器布局为左侧在线成员、上方工具栏、中心画布预览、下方时间轴。
- 绘图工具包含选择、画笔、橡皮、矩形、椭圆、文字、镜头框、运动箭头、分镜预设。
- 后端记录每次变更，并每 30 秒自动备份，支持按版本回滚。
- Socket.IO 提供在线成员和实时文档同步。

## 技术栈

- 前端：React、Vite、Zustand、Konva、Socket.IO Client
- 后端：Node.js、Express、Prisma、PostgreSQL、Socket.IO、JWT
- 部署：Ubuntu、systemd、Nginx

## 本地开发

1. 准备 PostgreSQL，并创建数据库：

```bash
createdb storyboard
```

2. 配置环境变量：

```bash
cp apps/backend/.env.example apps/backend/.env
```

按需修改 `DATABASE_URL`、`JWT_SECRET`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`。

3. 安装、迁移、初始化管理员：

```bash
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed
```

4. 启动开发服务：

```bash
npm run dev
```

前端默认在 `http://localhost:5173`，后端默认在 `http://localhost:4000`。

## Ubuntu 部署

1. 在服务器上安装基础依赖和 systemd 服务模板：

```bash
sudo APP_DIR=/opt/storyboard-studio DB_PASSWORD='replace-me' bash scripts/setup-ubuntu.sh
```

2. 将项目代码放到 `/opt/storyboard-studio`，并配置环境变量：

```bash
cd /opt/storyboard-studio
cp apps/backend/.env.example apps/backend/.env
nano apps/backend/.env
```

生产环境建议至少修改：

```env
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://storyboard:replace-me@localhost:5432/storyboard
JWT_SECRET=replace-with-a-long-random-string
CORS_ORIGIN=https://your-domain.com
ADMIN_EMAIL=admin@your-domain.com
ADMIN_PASSWORD=replace-with-a-strong-password
UPLOAD_DIR=uploads
```

3. 构建并启动：

```bash
bash scripts/start-production.sh
```

生产脚本会执行 `prisma migrate deploy`，不会创建 shadow database，因此数据库用户不需要 `CREATEDB` 权限。若之前用旧脚本遇到 `P3014 permission denied to create database`，更新代码后直接重新运行上面的命令即可。

4. 配置 Nginx：

```bash
sudo cp scripts/nginx-storyboard.conf /etc/nginx/sites-available/storyboard-studio
sudo ln -s /etc/nginx/sites-available/storyboard-studio /etc/nginx/sites-enabled/storyboard-studio
sudo nano /etc/nginx/sites-available/storyboard-studio
sudo nginx -t
sudo systemctl reload nginx
```

把 `server_name example.com;` 改成你的域名。HTTPS 可用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 常用命令

```bash
npm run build
npm run start
npm run seed
sudo systemctl restart storyboard-studio
sudo journalctl -u storyboard-studio -f
```

## 默认管理员

`npm run seed` 会根据 `apps/backend/.env` 创建或更新 `OWNER` 账号：

- `ADMIN_EMAIL`
- `ADMIN_PHONE`
- `ADMIN_PASSWORD`
- `ADMIN_NAME`

请在第一次部署后立即修改默认密码。
