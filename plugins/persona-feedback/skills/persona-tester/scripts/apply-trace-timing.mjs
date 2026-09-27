#!/usr/bin/env node
/**
 * apply-trace-timing.mjs
 *
 * persona-runner は現在時刻を取得する手段を持たないため、action_log の秒数を
 * 自分では書けない（書かせると推測値になる。issue #27）。代わりに親エージェントが
 * Playwright CLI のトレース記録（tracing-start / tracing-stop）を取り、この
 * スクリプトで実際の操作時刻を raw feedback に書き込む。
 *
 * トレースの読み方:
 *   - context-options の wallTime / monotonicTime を基準に、各 before イベントの
 *     startTime を実時刻に変換する
 *   - CLI は 1 コマンドごとに Page.pageErrors の取得で終わるので、そこでコマンドを区切る
 *   - 区切った中で最初に現れた操作（goto / click / fill ...）をそのコマンドの種類とする。
 *     操作が無く ariaSnapshot だけなら snapshot（snapshot / find コマンド）
 *   - エラーになったコマンドはトレースに残らない
 *
 * action_log との突き合わせ:
 *   - runner の記録順に、種類が合うトレース上のコマンドを先頭から探して割り当てる
 *     （runner が snapshot の記録を省くことがあるので、LOOKAHEAD 個までは読み飛ばす）
 *   - 対応が取れなかった CLI 操作は秒数なしのまま残す（推測で埋めない）
 *   - wait / give_up など CLI を伴わない操作は直前の操作の時刻にそろえる
 *   - 最初のコマンドを 0 秒とし、started_at / duration_seconds も実測で上書きする
 *
 * 測れるのはコマンド間の実時間で、大半はモデルの思考時間。人のためらいそのものではない。
 *
 * Usage:
 *   node apply-trace-timing.mjs \
 *     --feedback .persona-feedback/<timestamp>/raw/<persona_id>.json \
 *     --trace-dir .persona-feedback/<timestamp>/cli/<persona_id>/traces
 *
 * Exit codes:
 *   0 — 書き込み成功（トレースが無い場合も timing.source=none を書いて 0）
 *   1 — 引数不正 / feedback が読めない
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TRACE_METHOD_TO_ACTION = {
  goto: 'navigate',
  goForward: 'navigate',
  reload: 'navigate',
  goBack: 'back',
  click: 'click',
  dblclick: 'click',
  check: 'click',
  uncheck: 'click',
  fill: 'type',
  type: 'type',
  keyboardType: 'type',
  selectOption: 'select',
  keyboardPress: 'press_key',
  mouseWheel: 'scroll',
  screenshot: 'screenshot',
};
const COMMAND_END_METHOD = 'pageErrors';

// cancel は画面上のキャンセルボタンのクリック、back は「戻る」リンクのクリックでもありうる。
const COMPATIBLE = {
  navigate: ['navigate'],
  snapshot: ['snapshot'],
  click: ['click'],
  type: ['type'],
  select: ['select'],
  press_key: ['press_key'],
  scroll: ['scroll'],
  back: ['back', 'click'],
  cancel: ['click', 'back'],
  screenshot: ['screenshot'],
};
const LOOKAHEAD = 3;

export function parseTraceCommands(text) {
  const commands = [];
  let wallBase = null;
  let monoBase = null;
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === 'context-options') {
      wallBase = e.wallTime;
      monoBase = e.monotonicTime;
      continue;
    }
    if (e.type !== 'before' || wallBase === null) continue;
    const wallMs = wallBase + (e.startTime - monoBase);
    if (!current) current = { action: null, snapshot: false, wallMs };
    const mapped = TRACE_METHOD_TO_ACTION[e.method];
    if (mapped && !current.action) {
      current.action = mapped;
      current.wallMs = wallMs;
    } else if (e.method === 'ariaSnapshot' && !current.action && !current.snapshot) {
      current.snapshot = true;
      current.wallMs = wallMs;
    }
    if (e.method === COMMAND_END_METHOD) {
      const action = current.action ?? (current.snapshot ? 'snapshot' : null);
      if (action) commands.push({ action, wallMs: current.wallMs });
      current = null;
    }
  }
  return commands;
}

export function readTraceDir(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.trace'))
    .sort()
    .flatMap(f => parseTraceCommands(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => a.wallMs - b.wallMs);
}

export function applyTiming(feedback, commands) {
  const log = Array.isArray(feedback.action_log) ? feedback.action_log : [];
  const cliTotal = log.filter(e => COMPATIBLE[e?.action]).length;
  // runner が秒数を書いてきても推測値なので捨てる
  const stripped = log.map(e => {
    if (!e || typeof e !== 'object') return e;
    const { at_seconds, ...rest } = e;
    return rest;
  });
  const { started_at, duration_seconds, ...base } = feedback;

  if (commands.length === 0) {
    return { ...base, action_log: stripped, timing: { source: 'none', matched: 0, cli_actions: cliTotal } };
  }

  const origin = commands[0].wallMs;
  const seconds = ms => Number(((ms - origin) / 1000).toFixed(2));
  let next = 0;
  let matched = 0;
  const timed = stripped.map(e => {
    const compat = COMPATIBLE[e?.action];
    if (!compat) return e;
    const limit = Math.min(commands.length, next + LOOKAHEAD + 1);
    for (let k = next; k < limit; k++) {
      if (compat.includes(commands[k].action)) {
        next = k + 1;
        matched++;
        return { ...e, at_seconds: seconds(commands[k].wallMs) };
      }
    }
    return e;
  });

  let last = null;
  const filled = timed.map(e => {
    if (!e || typeof e !== 'object') return e;
    if (typeof e.at_seconds === 'number') { last = e.at_seconds; return e; }
    if (!COMPATIBLE[e.action] && last !== null) return { ...e, at_seconds: last };
    return e;
  });

  const lastMs = commands[commands.length - 1].wallMs;
  return {
    ...base,
    started_at: new Date(origin).toISOString(),
    duration_seconds: seconds(lastMs),
    action_log: filled,
    timing: { source: 'trace', matched, cli_actions: cliTotal },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--feedback') args.feedback = argv[++i];
    else if (a === '--trace-dir') args.traceDir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.feedback || !args.traceDir) {
    console.log('Usage: apply-trace-timing.mjs --feedback <raw.json> --trace-dir <dir>');
    process.exit(args.help ? 0 : 1);
  }
  let feedback;
  try {
    feedback = JSON.parse(readFileSync(args.feedback, 'utf8'));
  } catch (e) {
    console.error(`Failed to read feedback ${args.feedback}: ${e.message}`);
    process.exit(1);
  }
  const out = applyTiming(feedback, readTraceDir(args.traceDir));
  writeFileSync(args.feedback, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const t = out.timing;
  if (t.source === 'none') {
    console.error(`[warn] no trace commands found in ${args.traceDir}; timing left empty.`);
  }
  console.log(`timing: ${t.source} (matched ${t.matched}/${t.cli_actions} CLI actions)`);
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) main();
