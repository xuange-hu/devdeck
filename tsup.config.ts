import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

// 构建期把 package.json 的版本号烧进产物，SEA 单文件运行时不再依赖 package.json
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    target: "node18",
    platform: "node",
    loader: { ".html": "text" },
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    clean: true,
    define: { __DEVDECK_VERSION__: JSON.stringify(pkg.version) },
  },
]);
