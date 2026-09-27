#!/usr/bin/env node
/**
 * apply-trace-timing.mjs のユニットテスト。
 *
 * Usage:
 *   node tests/test-apply-trace-timing.mjs
 */

import assert from 'node:assert/strict';
import {
  parseTraceCommands,
  applyTiming,
} from '../plugins/persona-feedback/skills/persona-tester/scripts/apply-trace-timing.mjs';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`     ${e.message}`);
  }
}

// Playwright CLI のトレースを模した JSONL。wallTime は 2026-01-01T00:00:00Z、
// monotonicTime は 1000ms を基準にする。CLI は 1 コマンドごとに
// title → consoleMessages → pageErrors で終わる。
const WALL = Date.parse('2026-01-01T00:00:00Z');
function trace(commands) {
  const lines = [{ type: 'context-options', wallTime: WALL, monotonicTime: 1000 }];
  for (const { at, methods } of commands) {
    for (const [i, method] of methods.entries()) {
      lines.push({ type: 'before', method, startTime: 1000 + at * 1000 + i });
    }
    lines.push({ type: 'before', method: 'title', startTime: 1000 + at * 1000 + 50 });
    lines.push({ type: 'before', method: 'consoleMessages', startTime: 1000 + at * 1000 + 51 });
    lines.push({ type: 'before', method: 'pageErrors', startTime: 1000 + at * 1000 + 52 });
  }
  return lines.map(l => JSON.stringify(l)).join('\n');
}

console.log('## parseTraceCommands');

test('コマンドごとに種類と開始時刻を取り出す', () => {
  const cmds = parseTraceCommands(trace([
    { at: 0, methods: [] },                                              // tracing-start 自身
    { at: 1, methods: ['evaluateExpression', 'ariaSnapshot'] },          // snapshot
    { at: 5, methods: ['click', 'evaluateExpression', 'ariaSnapshot'] }, // click
    { at: 9, methods: ['goBack', 'ariaSnapshot'] },                      // go-back
  ]));
  assert.deepEqual(cmds.map(c => c.action), ['snapshot', 'click', 'back']);
  assert.equal(cmds[1].wallMs - cmds[0].wallMs, 4000 - 1);
});

test('fill / selectOption / keyboardPress / mouseWheel / screenshot / goto を対応づける', () => {
  const cmds = parseTraceCommands(trace([
    { at: 1, methods: ['fill'] },
    { at: 2, methods: ['selectOption'] },
    { at: 3, methods: ['keyboardPress'] },
    { at: 4, methods: ['mouseWheel'] },
    { at: 5, methods: ['screenshot'] },
    { at: 6, methods: ['goto', 'ariaSnapshot'] },
  ]));
  assert.deepEqual(cmds.map(c => c.action), ['type', 'select', 'press_key', 'scroll', 'screenshot', 'navigate']);
});

test('context-options より前のイベントや壊れた行は無視する', () => {
  const text = [
    JSON.stringify({ type: 'before', method: 'click', startTime: 1 }),
    '{not json',
    trace([{ at: 1, methods: ['click'] }]),
  ].join('\n');
  assert.deepEqual(parseTraceCommands(text).map(c => c.action), ['click']);
});

console.log('## applyTiming');

const baseFeedback = {
  persona_id: 'p',
  target: 'http://x.test',
  task: 't',
  outcome: 'completed',
  findings: [],
};
const cmds = parseTraceCommands(trace([
  { at: 10, methods: ['ariaSnapshot'] },
  { at: 18, methods: ['click'] },
  { at: 20, methods: ['ariaSnapshot'] },
  { at: 31, methods: ['fill'] },
]));

test('記録順に種類を突き合わせて実測の秒数を書き、推測値は捨てる', () => {
  const out = applyTiming({
    ...baseFeedback,
    started_at: '2099-01-01T00:00:00Z',
    duration_seconds: 999,
    action_log: [
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 8, action: 'click', hesitated: true },
      { at_seconds: 16, action: 'snapshot' },
      { at_seconds: 24, action: 'type' },
    ],
  }, cmds);
  assert.deepEqual(out.action_log.map(e => e.at_seconds), [0, 8, 10, 21]);
  assert.equal(out.action_log[1].hesitated, true);
  assert.equal(out.started_at, '2026-01-01T00:00:10.000Z');
  assert.equal(out.duration_seconds, 21);
  assert.deepEqual(out.timing, { source: 'trace', matched: 4, cli_actions: 4 });
});

test('runner が記録を省いたコマンドは読み飛ばす', () => {
  const out = applyTiming({
    ...baseFeedback,
    action_log: [
      { action: 'click' },  // 先頭の snapshot の記録が無い
      { action: 'type' },   // 2 回目の snapshot の記録も無い
    ],
  }, cmds);
  assert.deepEqual(out.action_log.map(e => e.at_seconds), [8, 21]);
  assert.equal(out.timing.matched, 2);
});

test('対応が取れない操作は秒数なしで残し、wait / give_up は直前の時刻にそろえる', () => {
  const out = applyTiming({
    ...baseFeedback,
    action_log: [
      { action: 'snapshot' },
      { action: 'wait' },
      { action: 'select' },   // トレースに select は無い
      { action: 'click' },
      { action: 'give_up' },
    ],
  }, cmds);
  assert.deepEqual(out.action_log.map(e => e.at_seconds), [0, 0, undefined, 8, 8]);
  assert.deepEqual(out.timing, { source: 'trace', matched: 2, cli_actions: 3 });
});

test('cancel は画面上のボタンのクリックと対応づける', () => {
  const out = applyTiming({
    ...baseFeedback,
    action_log: [{ action: 'snapshot' }, { action: 'cancel' }],
  }, cmds);
  assert.deepEqual(out.action_log.map(e => e.at_seconds), [0, 8]);
});

test('トレースが空なら秒数を消して timing.source=none にする', () => {
  const out = applyTiming({
    ...baseFeedback,
    started_at: '2099-01-01T00:00:00Z',
    action_log: [{ at_seconds: 3, action: 'click' }, { action: 'give_up' }],
  }, []);
  assert.equal(out.started_at, undefined);
  assert.deepEqual(out.action_log, [{ action: 'click' }, { action: 'give_up' }]);
  assert.deepEqual(out.timing, { source: 'none', matched: 0, cli_actions: 1 });
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll apply-trace-timing tests pass.');
