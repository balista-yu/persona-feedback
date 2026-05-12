#!/usr/bin/env node
/**
 * clean.mjs
 *
 * persona-feedback の実行成果物を整理・削除するユーティリティ。
 *
 * 対象:
 *   1. ./.persona-feedback/<timestamp>/  (中間物: raw / screenshots)
 *   2. ./reports/<timestamp>-report.{md,json}  (最終レポート、--include-reports 時のみ)
 *
 * Usage:
 *   node clean.mjs --dry-run                # 何が消えるか確認のみ
 *   node clean.mjs                          # 中間物を全削除（要 --yes か対話確認なし版は実装してない）
 *   node clean.mjs --keep-last 3            # 最新3 run 分の中間物だけ残して残りを削除
 *   node clean.mjs --include-reports        # reports/<ts>-report.* も対象に
 *   node clean.mjs --timestamp 20260511-100000  # 特定 run だけ削除
 *
 * Exit codes:
 *   0 — 成功（dry-run 含む）
 *   1 — 引数エラー
 */

import { readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { dryRun: false, keepLast: null, includeReports: false, timestamp: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep-last') args.keepLast = parseInt(argv[++i], 10);
    else if (a === '--include-reports') args.includeReports = true;
    else if (a === '--timestamp') args.timestamp = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    `Usage: clean.mjs [--dry-run] [--keep-last <N>] [--include-reports] [--timestamp <ts>]\n` +
    `\n` +
    `--dry-run         消える対象だけ表示\n` +
    `--keep-last <N>   最新 N run 分の中間物を残し、それ以外を削除\n` +
    `--include-reports reports/<ts>-report.* も同時に削除する\n` +
    `--timestamp <ts>  特定 timestamp のみ削除（--keep-last と排他）\n`
  );
}

const TS_PATTERN = /^\d{8}-\d{6}$/;

function listIntermediateRuns(cwd) {
  const dir = resolve(cwd, '.persona-feedback');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => TS_PATTERN.test(name))
    .filter(name => {
      try { return statSync(join(dir, name)).isDirectory(); }
      catch { return false; }
    })
    .sort();
}

function listReportFiles(cwd, timestamp) {
  const dir = resolve(cwd, 'reports');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.startsWith(`${timestamp}-report.`));
}

function pickVictims(allRuns, { keepLast, timestamp }) {
  if (timestamp) {
    return allRuns.filter(r => r === timestamp);
  }
  if (keepLast !== null && Number.isFinite(keepLast) && keepLast >= 0) {
    // 後ろほど新しい（昇順 sort 済み）
    return allRuns.slice(0, Math.max(0, allRuns.length - keepLast));
  }
  return allRuns.slice();
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); process.exit(0); }
  if (args.keepLast !== null && args.timestamp) {
    console.error('--keep-last and --timestamp are mutually exclusive.');
    process.exit(1);
  }

  const cwd = process.cwd();
  const runs = listIntermediateRuns(cwd);
  const victims = pickVictims(runs, args);

  if (victims.length === 0) {
    console.log('Nothing to clean.');
    if (runs.length > 0) {
      console.log(`(found ${runs.length} run(s) but they are kept by your flags.)`);
    }
    return;
  }

  // 表示
  const targets = [];
  for (const ts of victims) {
    targets.push({ kind: 'intermediate', path: resolve(cwd, '.persona-feedback', ts) });
    if (args.includeReports) {
      for (const f of listReportFiles(cwd, ts)) {
        targets.push({ kind: 'report', path: resolve(cwd, 'reports', f) });
      }
    }
  }

  const verb = args.dryRun ? '[dry-run] would remove' : 'removing';
  for (const t of targets) {
    console.log(`${verb}  ${t.kind.padEnd(13)} ${t.path}`);
  }

  if (args.dryRun) {
    console.log(`\n${targets.length} item(s).`);
    return;
  }
  for (const t of targets) {
    rmSync(t.path, { recursive: true, force: true });
  }
  console.log(`\nremoved ${targets.length} item(s).`);
}

main();
