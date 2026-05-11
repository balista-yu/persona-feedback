#!/usr/bin/env node
/**
 * save-raw.mjs
 *
 * persona-runner サブエージェントの戻り値（最終メッセージ全文）から JSON 本体を
 * 抽出し、feedback.schema.json で軽くバリデーションした上で
 * reports/<timestamp>/raw/<persona_id>.json に保存する。
 *
 * メインエージェント（persona-tester スキル）から1ペルソナごとに呼ぶ。
 *
 * Usage:
 *   node save-raw.mjs \
 *     --persona-id tanaka-60s \
 *     --timestamp 20260511-100000 \
 *     --raw-file /tmp/runner-output.txt \
 *     [--reports-dir ./reports]
 *
 * --raw-file は persona-runner の戻り値をそのまま書き出した一時ファイル。
 * stdin 経由で渡したい場合は --raw-file - を指定する。
 *
 * Exit codes:
 *   0 — 保存成功
 *   2 — JSON 抽出失敗（戻り値に JSON ブロックが見当たらない）
 *   3 — スキーマ必須欠落
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

function parseArgs(argv) {
  const args = { reportsDir: './reports' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--persona-id') args.personaId = argv[++i];
    else if (a === '--timestamp') args.timestamp = argv[++i];
    else if (a === '--raw-file') args.rawFile = argv[++i];
    else if (a === '--reports-dir') args.reportsDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    `Usage: save-raw.mjs --persona-id <id> --timestamp <ts> --raw-file <path|-> [--reports-dir <dir>]`
  );
}

function readRaw(path) {
  if (path === '-') {
    return readFileSync(0, 'utf8');
  }
  return readFileSync(path, 'utf8');
}

/**
 * 戻り値文字列から JSON オブジェクトを抽出する。
 * 1. ```json ... ``` コードフェンスがあればその中身
 * 2. なければ最初の `{` から対応する最後の `}` まで
 */
function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    return text.slice(first, last + 1);
  }
  return null;
}

const REQUIRED_FIELDS = ['persona_id', 'target', 'task', 'outcome', 'findings'];

function softValidate(data) {
  const missing = REQUIRED_FIELDS.filter(k => !(k in data));
  if (missing.length > 0) {
    return { ok: false, reason: `missing required fields: ${missing.join(', ')}` };
  }
  if (!Array.isArray(data.findings)) {
    return { ok: false, reason: '`findings` must be an array' };
  }
  return { ok: true };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.personaId || !args.timestamp || !args.rawFile) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const raw = readRaw(args.rawFile);
  const jsonStr = extractJson(raw);
  if (!jsonStr) {
    console.error(`No JSON block found in raw output for persona ${args.personaId}.`);
    process.exit(2);
  }

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Failed to parse JSON for persona ${args.personaId}: ${e.message}`);
    process.exit(2);
  }

  const v = softValidate(data);
  if (!v.ok) {
    console.error(`Schema check failed for persona ${args.personaId}: ${v.reason}`);
    process.exit(3);
  }

  // persona_id がプロンプトの指定と食い違っている場合は警告して上書きせず保持
  if (data.persona_id !== args.personaId) {
    console.error(
      `[warn] persona_id mismatch: argv=${args.personaId} payload=${data.persona_id}. Saving as ${args.personaId}.`
    );
  }

  const outPath = resolve(args.reportsDir, args.timestamp, 'raw', `${args.personaId}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`saved: ${outPath}`);
}

main();
