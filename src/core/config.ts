import { homedir } from "node:os";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

export interface DevDeckConfig {
  favorites: number[];
  ignored: number[];
  customPorts: number[];
  snapshotInterval: number;
  reportInterval: number;
  webhookUrl: string;
  interval: number;
  scope: "dev" | "all";
}

const DEFAULT_CONFIG: DevDeckConfig = {
  favorites: [],
  ignored: [],
  customPorts: [],
  snapshotInterval: 0,
  reportInterval: 0,
  webhookUrl: "",
  interval: 3,
  scope: "dev",
};

function cloneDefaults(): DevDeckConfig {
  return {
    ...DEFAULT_CONFIG,
    favorites: [],
    ignored: [],
    customPorts: [],
  };
}

const CONFIG_PATH = join(homedir(), ".devdeck.json");
const BACKUP_PATH = join(homedir(), ".devdeck.json.bak");

function toPort(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export function intList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<number>();
  for (const item of v) {
    const port = toPort(item);
    if (port !== null) seen.add(port);
  }
  return [...seen];
}

function parseConfig(raw: unknown): DevDeckConfig {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const snapshotInterval =
    typeof source.snapshotInterval === "number" &&
    source.snapshotInterval >= 0 &&
    source.snapshotInterval <= 86400
      ? Math.round(source.snapshotInterval)
      : 0;
  const reportInterval =
    typeof source.reportInterval === "number" &&
    source.reportInterval >= 0 &&
    source.reportInterval <= 86400
      ? Math.round(source.reportInterval)
      : 0;
  const interval =
    typeof source.interval === "number" &&
    Number.isFinite(source.interval) &&
    source.interval >= 0 &&
    source.interval <= 60
      ? Math.round(source.interval)
      : DEFAULT_CONFIG.interval;
  return {
    favorites: intList(source.favorites),
    ignored: intList(source.ignored),
    customPorts: intList(source.customPorts),
    interval,
    scope: source.scope === "all" ? "all" : "dev",
    snapshotInterval,
    reportInterval,
    webhookUrl: typeof source.webhookUrl === "string" ? source.webhookUrl.trim() : "",
  };
}

function readConfigFile(path: string): DevDeckConfig | null {
  try {
    if (!existsSync(path)) return null;
    return parseConfig(JSON.parse(readFileSync(path, "utf-8")));
  } catch {
    return null;
  }
}

export function loadConfig(): DevDeckConfig {
  return readConfigFile(CONFIG_PATH) ?? readConfigFile(BACKUP_PATH) ?? cloneDefaults();
}

export function saveConfig(config: DevDeckConfig): void {
  const tmp = `${CONFIG_PATH}.tmp`;
  const body = JSON.stringify(config, null, 2);
  try {
    writeFileSync(tmp, body, "utf-8");
    if (existsSync(CONFIG_PATH)) {
      try {
        copyFileSync(CONFIG_PATH, BACKUP_PATH);
      } catch {
        /* 备份失败不阻塞保存 */
      }
    }
    try {
      renameSync(tmp, CONFIG_PATH);
    } catch {
      // Windows 上目标文件被占用时 rename 可能失败，退化为直接覆盖
      writeFileSync(CONFIG_PATH, body, "utf-8");
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch {
    throw new Error("配置保存失败，请检查主目录写入权限");
  }
}

export function configPath(): string {
  return CONFIG_PATH;
}