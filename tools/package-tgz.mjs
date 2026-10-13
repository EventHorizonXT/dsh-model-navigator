#!/usr/bin/env node
/**
 * 生成可分发的 npm-pack 布局安装包：dist/dsh-model-navigator-<version>.tgz + dist/SHA256SUMS。
 *
 * 不依赖任何第三方包：先用 Node 复制文件做暂存目录，再用系统 tar 打包，最后用 node:crypto 计算校验值。
 * 目的：让「预构建包 + 校验值」可以用一条命令复现（计划 §16/§17 的交付物要求）。
 *
 * 用法：
 *   node tools/package-tgz.mjs            # 校验源文件后打包
 *   node tools/package-tgz.mjs --skip-tests   # 跳过测试（仅在已有测试证据时使用）
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const distDir = path.join(root, "dist");
const stageDir = path.join(distDir, "stage");
const packRoot = path.join(stageDir, "package");

// 进入包的条目（顺序固定，便于人工核对）
const ENTRIES = [
  "package.json",
  "cordis.patch.yml",
  "icon.svg",
  "README.md",
  "README.en.md",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "LICENSE",
  "lib",
  "locale",
  "src",
  "tools",
  "tests",
  "docs"
];

// 绝不进入包的条目（防止把构建中间物或自身打进去）
const DENY = [/^dist$/, /^node_modules$/, /^\./, /^package-lock\.json$/, /\.log$/];

function copyInto(from, to) {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(from).sort()) {
      if (DENY.some((re) => re.test(name))) continue;
      copyInto(path.join(from, name), path.join(to, name));
    }
    return;
  }
  fs.copyFileSync(from, to);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, { stdio: "inherit", ...options });
}

// 先重建产物、再跑测试：保证「测的正是将要打包的那份产物」（否则改了 src 忘了构建时，
// 测试会对着旧产物全绿，而包里带的是新源码编译出来的东西）。
console.log("→ 重建 lib/client.js 与测试用探针包（确保包内产物来自当前源码）");
run("node", ["tools/build-client.mjs", "--with-embeds"], { cwd: root });

if (!process.argv.includes("--skip-tests")) {
  console.log("→ 运行离线测试（node --test）");
  run("node", ["--test", "tests/*.test.mjs"], { cwd: root });
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tgzName = `${pkg.name}-${pkg.version}.tgz`;
const tgzPath = path.join(distDir, tgzName);

// 固定时间戳与权限位：让同一份源码每次都产出逐字节相同的 .tgz（校验值才有意义）
const SOURCE_DATE_EPOCH = 946684800; // 2000-01-01T00:00:00Z，整数秒，避免 pax 扩展头

function freezeStamps(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    const mode = stat.isDirectory() ? 0o755 : stat.mode & 0o111 ? 0o755 : 0o644;
    fs.chmodSync(full, mode);
    fs.utimesSync(full, SOURCE_DATE_EPOCH, SOURCE_DATE_EPOCH);
    if (stat.isDirectory()) freezeStamps(full);
  }
}

/** 连目录本身一起固定：tar 会记录 `package/` 这一条目录头，漏掉它哈希就会随打包时刻变化。 */
function freezeTree(dir) {
  freezeStamps(dir);
  fs.chmodSync(dir, 0o755);
  fs.utimesSync(dir, SOURCE_DATE_EPOCH, SOURCE_DATE_EPOCH);
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(packRoot, { recursive: true });

for (const entry of ENTRIES) {
  const from = path.join(root, entry);
  if (!fs.existsSync(from)) throw new Error(`缺少要打包的条目：${entry}`);
  copyInto(from, path.join(packRoot, entry));
}

// 包内一致性检查：manifest 里的每个 exports 目标都必须真实存在
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  if (key.includes("*")) continue;
  const target = path.join(packRoot, value.replace(/^\.\//, ""));
  if (!fs.existsSync(target)) throw new Error(`exports["${key}"] 指向的文件不在包内：${value}`);
}
for (const key of ["meta", "icon", "dsh"]) {
  if (!pkg[key]) throw new Error(`package.json 缺少 "${key}"（宿主需要）`);
}
if (!fs.existsSync(path.join(packRoot, pkg.icon.replace(/^\.\//, "")))) {
  throw new Error(`icon 不在包内：${pkg.icon}`);
}

console.log(`→ 打包 ${tgzName}`);
fs.rmSync(tgzPath, { force: true });
freezeTree(packRoot);
// 两步走：先用 ustar 格式产出未压缩 tar（固定 mtime/权限位），再用 node:zlib 压缩。
// 直接 `tar -czf` 会把当前时间写进 gzip 头，导致同一份源码每次哈希都不同。
const tarPath = path.join(distDir, ".package.tar");
run("tar", ["--no-xattrs", "--format", "ustar", "-cf", tarPath, "package"], {
  cwd: stageDir,
  env: { ...process.env, COPYFILE_DISABLE: "1" }
});
const gzipped = zlib.gzipSync(fs.readFileSync(tarPath), { level: 9 });
fs.writeFileSync(tgzPath, gzipped);
fs.rmSync(tarPath, { force: true });
fs.rmSync(stageDir, { recursive: true, force: true });

const digest = createHash("sha256").update(fs.readFileSync(tgzPath)).digest("hex");
const sums = `${digest}  ${tgzName}\n`;
fs.writeFileSync(path.join(distDir, "SHA256SUMS"), sums, "utf8");

const entries = run("tar", ["-tzf", tgzPath], { stdio: ["ignore", "pipe", "inherit"] })
  .toString("utf8").trim().split("\n").length;

console.log("");
console.log(`包：      ${tgzPath}`);
console.log(`大小：    ${fs.statSync(tgzPath).size} bytes`);
console.log(`条目数：  ${entries}`);
console.log(`SHA-256： ${digest}`);
console.log(`校验文件：${path.join(distDir, "SHA256SUMS")}`);
