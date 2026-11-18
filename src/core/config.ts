import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

const CONFIG_PATH = join(homedir(), ".devdeck.json");

export function intList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const list = v.filter(
    (n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536,
  );
  return [...new Set(list)];
}

export function loadConfig(): DevDeckConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Record<string, unknown>;
    const favorites = intList(raw.favorites);
    const ignored = intList(raw.ignored);
    const customPorts = intList(raw.customPorts ?? []);
    const snapshotInterval = typeof raw.snapshotInterval === "number" && raw.snapshotInterval >= 0 ? Math.round(raw.snapshotInterval) : 0;
    const reportInterval = typeof raw.reportInterval === "number" && raw.reportInterval >= 0 ? Math.round(raw.reportInterval) : 0;
    const webhookUrl = typeof raw.webhookUrl === "string" ? raw.webhookUrl : "";
    const interval =
      typeof raw.interval === "number" &&
      Number.isFinite(raw.interval) &&
      (raw.interval === 0 || (raw.interval >= 1 && raw.interval <= 60))
        ? raw.interval
        : DEFAULT_CONFIG.interval;
    const scope = raw.scope === "all" ? "all" : "dev";
    return { favorites, ignored, customPorts, interval, scope, snapshotInterval, reportInterval, webhookUrl };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: DevDeckConfig): void {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  } catch {
    throw new Error("配置保存失败，请检查主目录写入权限");
  }
}

export function configPath(): string {
  return CONFIG_PATH;
}