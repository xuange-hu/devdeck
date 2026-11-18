import { cpSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
mkdirSync(join(root, "dist", "web"), { recursive: true });
cpSync(join(root, "src", "web", "index.html"), join(root, "dist", "web", "index.html"));
console.log("已复制 Web UI 资源到 dist/web");