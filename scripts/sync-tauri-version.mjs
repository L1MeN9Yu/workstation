#!/usr/bin/env node
// 版本同步脚本：以 package.json 的 version 为唯一来源，写回 tauri.conf.json。
//   node scripts/sync-tauri-version.mjs           常规构建：写入 X.Y.Z
//   node scripts/sync-tauri-version.mjs --release 发布构建：写入 X.Y.Z+build.<n>（n 取 GITHUB_RUN_NUMBER，否则 git 提交计数）
//   node scripts/sync-tauri-version.mjs --check   CI 校验：仅比较主 semver 部分 X.Y.Z，不一致 exit 1（不写文件）
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const confPath = resolve(root, "src-tauri/tauri.conf.json");

const args = new Set(process.argv.slice(2));
const isRelease = args.has("--release");
const isCheck = args.has("--check");

function fail(msg) {
  console.error(`sync-tauri-version: ${msg}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`无法读取 ${path}: ${e.message}`);
  }
}

const pkg = readJson(pkgPath);
const conf = readJson(confPath);
const baseVersion = String(pkg.version);

function mainSemver(version) {
  return String(version).split("+")[0];
}

if (isCheck && mainSemver(baseVersion) !== mainSemver(conf.version)) {
  fail(`版本不一致：package.json=${baseVersion}，tauri.conf.json=${conf.version}`);
}

if (isCheck) {
  console.log(`sync-tauri-version: OK（package.json=${baseVersion}，tauri.conf.json=${conf.version}）`);
  process.exit(0);
}

let target = baseVersion;
if (isRelease) {
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  let build;
  if (runNumber) {
    build = runNumber;
  } else {
    try {
      build = execFileSync("git", ["rev-list", "--count", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim();
    } catch {
      fail("无法获取 git 提交计数（--release 模式需要 git 仓库）");
    }
  }
  target = `${baseVersion}+build.${build}`;
}

if (!isRelease && mainSemver(conf.version) === mainSemver(baseVersion)) {
  const hasBuild = String(conf.version).includes("+build.");
  // 常规模式：主版本一致。无 build 段不动；有 build 段时——RELEASE_BUILD=1（release 构建中）保留，
  // 否则清除（本地构建不携带 build 号，防止 release 残留）。
  if (!hasBuild || process.env.RELEASE_BUILD === "1") {
    console.log(`sync-tauri-version: 已同步（${conf.version}）`);
    process.exit(0);
  }
}

conf.version = target;
try {
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`, "utf8");
} catch (e) {
  fail(`写入 ${confPath} 失败: ${e.message}`);
}
console.log(`sync-tauri-version: tauri.conf.json version -> ${target}`);
