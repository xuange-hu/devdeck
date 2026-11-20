# DevDeck · 开发端口监管控制台

本地端口监控与释放工具：**Web 图形控制台** + **命令行**双形态，零运行时依赖。

用于快速看清「哪个端口被哪个进程占用」，并一键释放。

## 特性

- **实时监控**：Web 控制台自动刷新（1/2/3/5/10/30 秒可调，可暂停）
- **服务识别**：内置 40+ 常见开发端口映射（React、Vite、PostgreSQL、Redis、MongoDB、Docker、K8s、Kafka、Elasticsearch 等）
- **分类筛选**：开发 / 数据库 / 缓存 / 其他
- **搜索排序**：按端口、进程名、PID、服务标签搜索；表头点击排序
- **进程详情**：可执行路径、完整命令行、启动时间
- **一键释放**：单个终止、批量终止，带二次确认
- **变化追踪**：新监听 / 已关闭事件历史（持久化到 `~/.devdeck-history.json`，重启保留），新端口 `NEW` 高亮 + 浏览器通知
- **导出**：CSV（Excel 可直接打开）/ JSON
- **个性化**：收藏置顶、忽略列表、端口备注、暗色/亮色主题
- **跨平台**：Windows（`netstat`+`tasklist`）/ macOS 与 Linux（`lsof`/`ss`）

## 安装

```bash
cd devdeck
npm install
npm run build
```

### 全局安装（可选）

```bash
npm link          # 之后可在任意目录直接执行 devdeck
devdeck --help
```

不全局安装也可以直接使用构建产物：

```bash
node dist/cli.js ui
```

## 快速开始

```bash
# 启动 Web 控制台（默认 http://127.0.0.1:7676，自动打开浏览器）
devdeck

# 指定端口 / 不自动开浏览器
devdeck ui -p 7699 --no-open

# 命令行列出常用开发端口
devdeck scan

# 列出全部监听端口
devdeck scan --all

# 按端口或进程名查询
devdeck find 8080
devdeck find node

# 实时监控（每 3 秒刷新）
devdeck watch -i 3 --all

# 终止进程（可一次多个）
devdeck kill 12345 23456

# 导出端口列表
devdeck export -f csv -o ports.csv --all
devdeck export -f json -o ports.json
```

## Web 控制台功能

| 区域 | 功能 |
|------|------|
| 顶栏 | 监听/开发/数据库/缓存统计、刷新间隔、立即刷新、历史、通知、主题 |
| 工具栏 | 搜索、范围切换（常用开发端口/全部监听）、分类筛选、批量终止、批量忽略、导出、设置 |
| 表格 | 收藏、端口+NEW 标记、分类标签、服务、进程名（点击看详情）、PID、内存、占用时长、终止/复制/忽略 |
| 快捷键 | `/` 聚焦搜索、`r` 立即刷新、`Esc` 关闭弹窗 |
| 交互 | 双击行编辑端口备注；点击进程名查看路径/命令行/启动时间；导出下载 |

## 配置

配置保存在用户主目录 `~/.devdeck.json`：

```json
{
  "favorites": [8080],
  "ignored": [135, 445],
  "interval": 3,
  "scope": "dev"
}
```

控制台与 API 均可修改，保存即生效。

## HTTP API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ports?scope=dev\|all` | 端口列表 + 统计 + 元信息 |
| GET | `/api/history` | 端口变化事件（新监听/已关闭） |
| GET | `/api/process?pid=<pid>` | 进程详情 |
| GET | `/api/export?format=csv\|json&scope=dev\|all` | 导出下载 |
| POST | `/api/kill` | 终止进程，body `{ "pids": [123] }` |
| GET / PUT | `/api/config` | 读取 / 更新配置 |

服务仅监听 `127.0.0.1`，默认端口 `7676`，被占用时自动顺延。

## 开发

```bash
npm run typecheck   # TypeScript 类型检查
npm run build       # tsup 构建 + 复制 Web 资源到 dist
npm run start       # 运行构建产物
```

## 项目结构

```
devdeck/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── scripts/copy-web.js      # 构建后复制 Web 资源
├── src/
│   ├── cli.ts               # CLI 入口：ui/scan/watch/find/export/kill/help/version
│   ├── core/
│   │   ├── ports.ts         # 跨平台端口扫描、进程详情、终止
│   │   ├── server.ts        # HTTP 服务 + REST API + 历史追踪
│   │   └── config.ts        # 配置持久化
│   └── web/index.html       # Web 控制台（单文件，无外部 CDN 依赖）
└── dist/                    # 构建产物
```

## 说明

- 终止受系统保护的进程需要管理员权限；失败时会给出明确提示。
- Windows 下进程路径/命令行对部分系统进程可能因权限不可读，属正常现象。
- 端口扫描基于系统命令输出，扫描耗时取决于已监听端口数量（通常 < 1 秒）。

## 单文件可执行（Windows）

```bash
npm run build:exe
```

生成 `dist/devdeck.exe`（约 90MB，内置 Node 运行时与 Web UI，无需安装 Node 即可运行）。

```bash
dist/devdeck.exe             # 启动 Web 控制台
dist/devdeck.exe scan --all  # 命令行
```

原理：esbuild 打包 CJS → Node SEA 生成 blob → postject 注入 Node 运行时（`scripts/build-exe.js` 自动化）。

## 发布

```bash
npm run build        # 构建
npm test             # 单元 + 端到端测试
npm pack --dry-run   # 检查包内容
npm publish          # 发布（需先 npm login）
```

发布包名：`devdeck-cli`，安装后命令名：`devdeck`。
