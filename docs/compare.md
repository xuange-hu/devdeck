# DevDeck 与同类工具对比

> 公开数据截至 2026-11-18，Star 数会变化；这里只用于说明定位，不用于排名。

| 项目 | 形态 | 核心能力 | 与 DevDeck 的关系 |
| --- | --- | --- | --- |
| **DevDeck** | Web 控制台 + CLI + Windows 单文件 exe | 端口扫描、进程详情、终止/批量终止、SSE 实时、UDP、导出、i18n | 本仓库 |
| [port-killer](https://github.com/productdevbook/port-killer) | 桌面 GUI（约 5.1k star） | 跨平台查看与释放端口 | 最直接竞品；DevDeck 多了 CLI、SSE、导出与单文件分发 |
| [somo](https://github.com/theopfr/somo) | TUI（约 2.6k star） | netstat 的人类友好替代 | 终端体验更强；DevDeck 提供 Web 图形界面与历史/告警 |
| [portracker](https://github.com/mostafa-wahied/portracker) | 自托管服务（约 2.5k star） | 实时端口监控、多主机 | 面向团队/多主机；DevDeck 专注单机、本地优先 |
| [kill-port](https://www.npmjs.com/package/kill-port) | npm 库（周下载约 270 万） | 按端口杀进程 | 被其他项目调用的底层库，不是终端用户工具 |
| [get-port](https://www.npmjs.com/package/get-port) | npm 库（周下载约 3600 万） | 找可用端口 | 同上；DevDeck 的 `free` 命令覆盖日常使用场景 |

## DevDeck 的差异点

- **Web + CLI 双形态**：浏览器里看表格，终端里 `devdeck scan/kill/find`
- **SSE 实时推送**：新端口、关闭、内存变化不需要手动刷新
- **Windows 单文件 exe**：内置 Node 运行时，不需要用户安装 Node
- **导出全家桶**：CSV / JSON / Markdown / HTML / Excel XML
- **中英文界面**：动态内容也跟随语言切换
- **零运行时依赖**：除 Node 本身外不引入第三方运行库
- **安全默认**：只监听 `127.0.0.1`，启动令牌 + Host/Origin/Content-Type 校验

## DevDeck 当前不做什么

- 不做多主机远程监控（需要 agent/SSH，超出单机工具范围）
- 不做容器/K8s 端口归属（依赖 Docker/K8s 运行时，跨环境不稳定）
- 不做云同步/团队账号（当前定位是个人开发者本地工具）

如果这些正是你的需求，`portracker` 或带容器能力的工具更合适；如果只想在本地快速看清并释放端口，DevDeck 更轻。

## 什么时候选 DevDeck

- 你同时用浏览器和终端，想要一致的端口视图
- 你在 Windows 上不想为了一个端口工具安装 Node
- 你需要把端口清单导出给同事或写进报告
- 你希望用中文界面，且不想依赖云端

## 什么时候不选 DevDeck

- 你要监控几十台服务器 → 选 portracker 一类方案
- 你只需要在代码里找空闲端口 → 直接用 `get-port`
- 你只需要一条 `kill-port 8080` → 直接用 `kill-port` 库或系统命令