# DevDeck for VS Code

在 VS Code 内使用 DevDeck：

- 打开 Web 端口控制台
- 查看全部监听端口
- 按端口终止进程
- 复制端口号

## 前置条件

安装 DevDeck CLI：

```bash
npm install -g devdeck-cli
devdeck version
```

或者从本仓库构建：

```bash
cd ..
npm install
npm run build
```

扩展会自动检测工作区下的 `dist/cli.js`，无需全局安装。

## 本地安装

```bash
cd vscode
npx @vscode/vsce package
code --install-extension devdeck-vscode-0.1.0.vsix
```

然后按 `Ctrl+Shift+P`：

- `DevDeck: 打开端口控制台`
- `DevDeck: 查看监听端口`
- `DevDeck: 按端口终止进程`
- `DevDeck: 停止端口控制台`

状态栏右侧的 `DevDeck` 也可直接打开控制台。

## 配置

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `devdeck.executable` | `devdeck` | CLI 路径；工作区存在 `dist/cli.js` 时自动回退 |
| `devdeck.port` | `7676` | Web 控制台端口 |

## 发布到 Marketplace

1. 在 https://marketplace.visualstudio.com/manage 创建 publisher（需与 `package.json` 的 `publisher` 一致）
2. `npx @vscode/vsce login <publisher>`
3. `npx @vscode/vsce publish`

Marketplace 发布需要开发者账号与 PAT；本仓库只提供可打包的 MVP。