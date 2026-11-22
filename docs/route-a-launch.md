# 路线 A 发布清单

目标：把 DevDeck 做成“开发者日常端口工具”的头部，先拿到 **1000 下载 / 100 Star / 10 个真实反馈**，再谈增长。

## 当前事实（先确认）

- npm 未登录：`npm whoami` 返回 `ENEEDAUTH`
- `devdeck-cli` 尚未发布：`npm view devdeck-cli version` 返回 404
- 本机未安装 `gh` CLI
- 代码修改在工作区，**尚未 commit/push**

这些不是代码问题，是发布动作没做。

## 第 0 步：提交并推送

```bash
cd devdeck
git add -A
git commit -m "feat: v0.8.0 全面修复与体验打磨"
git push origin main
```

## 第 1 步：发布 npm

```bash
npm login
npm whoami
npm publish
npm view devdeck-cli version
```

验证：

```bash
npm install -g devdeck-cli
devdeck version
```

## 第 2 步：发布 GitHub Release

打 tag 会触发 `.github/workflows/release.yml`：Windows runner 构建 exe 和 npm 包并上传 Release。

```bash
git tag v0.8.0
git push origin v0.8.0
```

在 Actions 里确认 Release 成功，检查两个资产：

- `devdeck.exe`
- `devdeck-cli-0.8.0.tgz`

如果没有 Actions 权限，也可以手动：

```bash
npm run build
npm run build:exe
npm pack
```

然后在 GitHub Releases 页面上传 `dist/devdeck.exe` 与 `devdeck-cli-0.8.0.tgz`。

## 第 3 步：仓库门面

GitHub 仓库设置里补：

- Description：`本地端口监管控制台：Web + CLI，SSE 实时，Windows 单文件 exe`
- Website：`https://www.npmjs.com/package/devdeck-cli`
- Topics：`port` `port-manager` `developer-tools` `cli` `web-ui` `windows` `macos` `linux` `nodejs` `monitoring` `devops`
- Social preview：上传 `docs/screenshot.png`

README 已经包含截图、功能、对比、安装、VS Code 扩展入口；发布后确认 raw 截图 URL 可访问。

## 第 4 步：VS Code 扩展

```bash
cd vscode
npx @vscode/vsce package
code --install-extension devdeck-vscode-0.1.0.vsix
```

本地验证四条命令：

- `DevDeck: 打开端口控制台`
- `DevDeck: 查看监听端口`
- `DevDeck: 按端口终止进程`
- `DevDeck: 停止端口控制台`

发布 Marketplace：

1. 在 https://marketplace.visualstudio.com/manage 创建 publisher（与 `vscode/package.json` 的 `publisher` 一致）
2. `npx @vscode/vsce login <publisher>`
3. `npx @vscode/vsce publish`

如果没有 Marketplace 账号，先只发 VSIX 到 GitHub Release，收集反馈。

## 第 5 步：包管理器

Release 资产可访问后：

- **Scoop**：在自有 bucket 或 `scoop bucket add` 仓库添加 `devdeck.json`，URL 指向 release 的 `devdeck.exe`，填入 `hash`（`sha256sum devdeck.exe`）
- **winget**：向 `microsoft/winget-pkgs` 提交 manifest，`InstallerUrl` 指向 release exe，`InstallerSha256` 填实际哈希
- **Homebrew**：如果提供 macOS 二进制，建 `homebrew-devdeck` tap；当前 Windows exe 不适合 Homebrew

不要在没有真实 release 资产时提交 manifest。

## 第 6 步：内容分发

第一周集中发 3 篇 + 1 个视频，不要铺 20 个渠道：

- 掘金/V2EX：`docs/launch-zh.md`
- Reddit `r/webdev` / `r/node`：英文版改写，标题突出“Web + CLI + single exe”
- Hacker News：Show HN，标题 `Show HN: DevDeck – local port monitor with web UI and CLI`
- B 站/YouTube：30–60 秒录屏，演示“端口被占用 → 找到进程 → 终止 → 导出”
- Product Hunt：等有 100+ Star 和稳定 Release 后再发

每条内容都带：

- 一张截图/GIF
- 一条安装命令
- 一个明确问题：“你平时怎么处理端口冲突？”

## 第 7 步：指标闸门

| 时间 | 目标 | 判断 |
| --- | --- | --- |
| 7 天 | 100 下载 / 20 Star / 5 反馈 | 有人愿意装 |
| 30 天 | 1000 下载 / 100 Star / 10 反馈 | 发布动作有效 |
| 90 天 | 1 万下载 / 1000 MAU / 1000 Star | PMF 初步成立 |
| 180 天 | 10 万下载 / 1 万 MAU / 100 付费 | 可以谈商业化 |

没有达到 30 天目标，不要继续加功能；先改 README、定位、渠道和 onboarding。

## 现在不要做

- 不要继续加第十批功能
- 不要做多主机/容器/云同步（路线 B 的事）
- 不要在没有用户反馈前做团队版/计费
- 不要把时间花在重构内部代码；当前工程质量已经够用