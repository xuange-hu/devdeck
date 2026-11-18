import { build } from "esbuild";
import { copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const blob = join(dist, "sea-prep.blob");
const exe = join(dist, "devdeck.exe");

console.log("[1/5] 生成 CJS bundle …");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
await build({
  entryPoints: [join(root, "src", "cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: join(dist, "sea.cjs"),
  loader: { ".html": "text" },
  sourcemap: false,
  define: { __DEVDECK_VERSION__: JSON.stringify(pkg.version) },
  logLevel: "warning",
});

console.log("[2/5] 写入 SEA 配置 …");
const cfg = join(root, "sea-config.json");
writeFileSync(
  cfg,
  JSON.stringify(
    { main: "dist/sea.cjs", output: "dist/sea-prep.blob", disableExperimentalSEAWarning: true },
    null,
    2,
  ) + "\n",
);

console.log("[3/5] 生成 SEA blob …");
execFileSync(process.execPath, ["--experimental-sea-config", cfg], { cwd: root, stdio: "inherit" });

console.log("[4/5] 复制 Node 运行时 …");
try {
  copyFileSync(process.execPath, exe);
} catch (err) {
  if (err && err.code === "EBUSY") {
    console.error("目标 exe 正在运行，请先关闭 devdeck.exe 后重试");
    process.exit(1);
  }
  throw err;
}

console.log("[5/5] 注入 blob …");
// postject 解析 87MB 的 node.exe 需要大堆，默认 heap 会报 Array buffer allocation failed
execSync(
  `npx postject "${exe}" NODE_SEA_BLOB "${blob}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: root, stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" } },
);

console.log("\n✓ 单文件 exe 已生成: " + exe);
