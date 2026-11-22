const vscode = require("vscode");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let output;
let consoleProcess = null;

function settings() {
  return vscode.workspace.getConfiguration("devdeck");
}

function localCli() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return null;
  const candidate = path.join(folders[0].uri.fsPath, "dist", "cli.js");
  return fs.existsSync(candidate) ? candidate : null;
}

function invocation(args) {
  const configured = String(settings().get("executable") || "devdeck").trim();
  const local = configured === "devdeck" ? localCli() : null;
  if (local) return { cmd: process.execPath, args: [local, ...args], shell: false };
  return { cmd: configured, args, shell: process.platform === "win32" };
}

function exec(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const inv = invocation(args);
    execFile(
      inv.cmd,
      inv.args,
      { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024, shell: inv.shell },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || "").trim() || err.message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function showError(err) {
  const message = err instanceof Error ? err.message : String(err);
  output.appendLine(message);
  vscode.window.showErrorMessage("DevDeck: " + message);
}

async function openConsole() {
  const port = Number(settings().get("port")) || 7676;
  if (consoleProcess && !consoleProcess.killed) {
    vscode.window.showInformationMessage("DevDeck 控制台已在运行");
    return;
  }
  const inv = invocation(["ui", "-p", String(port), "--no-open"]);
  output.show(true);
  output.appendLine("启动: " + inv.cmd + " " + inv.args.join(" "));
  let child;
  try {
    child = spawn(inv.cmd, inv.args, {
      windowsHide: true,
      shell: inv.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    showError(err);
    return;
  }
  consoleProcess = child;
  let opened = false;
  const open = (url) => {
    if (opened) return;
    opened = true;
    vscode.env.openExternal(vscode.Uri.parse(url));
  };
  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    output.append(text);
    const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) open(match[0]);
  });
  child.stderr.on("data", (chunk) => output.append(String(chunk)));
  child.on("error", (err) => {
    output.appendLine("启动失败: " + err.message);
    vscode.window.showErrorMessage(
      "DevDeck 启动失败。请安装 devdeck，或在设置中填写 devdeck.executable。",
    );
  });
  child.on("exit", (code) => {
    output.appendLine("DevDeck 已退出，code=" + code);
    if (consoleProcess === child) consoleProcess = null;
  });
  setTimeout(() => open(`http://127.0.0.1:${port}`), 4000);
}

function stopConsole() {
  if (!consoleProcess) {
    vscode.window.showInformationMessage("DevDeck 控制台未在运行");
    return;
  }
  try {
    consoleProcess.kill();
  } catch {
    /* ignore */
  }
  consoleProcess = null;
  output.appendLine("已停止 DevDeck 控制台");
}

async function scanPorts() {
  try {
    const { stdout } = await exec(["scan", "--all", "--json"]);
    const list = JSON.parse(stdout);
    if (!Array.isArray(list) || list.length === 0) {
      vscode.window.showInformationMessage("没有发现监听端口");
      return;
    }
    const items = list.map((entry) => ({
      label: entry.port + " " + String(entry.protocol || "tcp").toUpperCase(),
      description: entry.process + " · PID " + entry.pid,
      detail: entry.label || "",
      entry,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "选择端口查看详情或终止",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    const action = await vscode.window.showQuickPick(
      [
        { label: "查看详情", value: "detail" },
        { label: "终止进程", value: "kill" },
        { label: "复制端口号", value: "copy" },
      ],
      { placeHolder: picked.entry.port + " " + picked.entry.process },
    );
    if (!action) return;
    if (action.value === "copy") {
      await vscode.env.clipboard.writeText(String(picked.entry.port));
      vscode.window.showInformationMessage("已复制端口 " + picked.entry.port);
      return;
    }
    if (action.value === "kill") {
      const confirm = await vscode.window.showWarningMessage(
        "终止 " + picked.entry.process + "（PID " + picked.entry.pid + "）？",
        { modal: true },
        "终止",
      );
      if (confirm !== "终止") return;
      await exec(["kill", String(picked.entry.pid)]);
      vscode.window.showInformationMessage("已终止 PID " + picked.entry.pid);
      return;
    }
    output.show(true);
    output.appendLine(JSON.stringify(picked.entry, null, 2));
  } catch (err) {
    showError(err);
  }
}

async function killPort() {
  const value = await vscode.window.showInputBox({
    prompt: "要终止的端口号",
    placeHolder: "例如 8080",
    validateInput: (v) =>
      /^\d+$/.test(v) && Number(v) > 0 && Number(v) < 65536 ? undefined : "请输入 1-65535",
  });
  if (!value) return;
  const confirm = await vscode.window.showWarningMessage(
    "终止端口 " + value + " 上的进程？",
    { modal: true },
    "终止",
  );
  if (confirm !== "终止") return;
  try {
    const { stdout } = await exec(["kill-port", value]);
    vscode.window.showInformationMessage(stdout.trim() || "已终止端口 " + value);
  } catch (err) {
    showError(err);
  }
}

function activate(context) {
  output = vscode.window.createOutputChannel("DevDeck");
  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand("devdeck.openConsole", openConsole),
    vscode.commands.registerCommand("devdeck.stopConsole", stopConsole),
    vscode.commands.registerCommand("devdeck.scanPorts", scanPorts),
    vscode.commands.registerCommand("devdeck.killPort", killPort),
  );
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(plug) DevDeck";
  status.tooltip = "打开 DevDeck 端口控制台";
  status.command = "devdeck.openConsole";
  status.show();
  context.subscriptions.push(status);
}

function deactivate() {
  if (consoleProcess) {
    try {
      consoleProcess.kill();
    } catch {
      /* ignore */
    }
    consoleProcess = null;
  }
}

module.exports = { activate, deactivate };