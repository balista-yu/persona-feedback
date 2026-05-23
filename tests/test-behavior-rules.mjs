#!/usr/bin/env node
/**
 * behavior-rules.mjs の構造化 DSL 展開のユニットテスト。
 *
 * Usage:
 *   node tests/test-behavior-rules.mjs
 */

import assert from 'node:assert/strict';
import {
  renderBehaviorRules,
  expandStructured,
} from '../plugins/persona-feedback/skills/persona-tester/scripts/behavior-rules.mjs';

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

console.log('## renderBehaviorRules (legacy array)');

test('legacy array はそのまま返る', () => {
  const out = renderBehaviorRules([
    'カタカナ用語は分からないと判断する',
    'エラーは読まずに戻る',
  ]);
  assert.deepEqual(out, [
    'カタカナ用語は分からないと判断する',
    'エラーは読まずに戻る',
  ]);
});

test('legacy 配列に数値が混ざっていても文字列化される', () => {
  const out = renderBehaviorRules(['ルール1', 42]);
  assert.deepEqual(out, ['ルール1', '42']);
});

test('null/undefined は例外', () => {
  assert.throws(() => renderBehaviorRules(null), TypeError);
  assert.throws(() => renderBehaviorRules(undefined), TypeError);
});

console.log('## expandStructured (DSL primitives)');

test('give_up_after: 2_retries', () => {
  const out = expandStructured({ give_up_after: '2_retries' });
  assert.equal(out.length, 1);
  assert.match(out[0], /2回リトライ.*諦め/);
});

test('give_up_after: 30s', () => {
  const out = expandStructured({ give_up_after: '30s' });
  assert.equal(out.length, 1);
  assert.match(out[0], /30秒以上.*諦め/);
});

test('panic_on: 既知のキーをテンプレート展開', () => {
  const out = expandStructured({
    panic_on: ['english_in_error', 'modal_dialog_unexpected'],
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /英語のエラーメッセージ/);
  assert.match(out[1], /モーダル|ポップアップ/);
});

test('panic_on: 未知キーはフォールバック展開', () => {
  const out = expandStructured({ panic_on: ['hypothetical_future_key'] });
  assert.equal(out.length, 1);
  assert.match(out[0], /hypothetical_future_key/);
});

test('vocabulary.block_jargon と confused_by の両方', () => {
  const out = expandStructured({
    vocabulary: {
      block_jargon: true,
      confused_by: ['ログイン', '認証'],
    },
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /専門用語.*分からない/);
  assert.match(out[1], /ログイン.*認証/);
});

test('attention_span: 30s', () => {
  const out = expandStructured({ attention_span: '30s' });
  assert.equal(out.length, 1);
  assert.match(out[0], /30秒/);
});

test('reading_speed: slow', () => {
  const out = expandStructured({ reading_speed: 'slow' });
  assert.equal(out.length, 1);
  assert.match(out[0], /読むのが遅い/);
});

test('on_ambiguous_button: ask_or_skip は LLM 推論を明示的に殺す', () => {
  const out = expandStructured({ on_ambiguous_button: 'ask_or_skip' });
  assert.equal(out.length, 1);
  assert.match(out[0], /推測せず|スキップ/);
});

test('custom: 自由文ルールはそのまま追加', () => {
  const out = expandStructured({
    custom: ['送料が確定するまで注文しない', '  '], // 空白だけは無視
  });
  assert.deepEqual(out, ['送料が確定するまで注文しない']);
});

test('複数プリミティブの組み合わせ順序', () => {
  const out = expandStructured({
    give_up_after: '2_retries',
    panic_on: ['english_in_error'],
    vocabulary: { block_jargon: true },
    attention_span: '1min',
    reading_speed: 'slow',
    on_ambiguous_button: 'ask_or_skip',
    custom: ['カスタムルール'],
  });
  // 出力順 = give_up_after → panic_on → vocabulary → attention_span
  //        → reading_speed → on_ambiguous_button → custom
  assert.equal(out.length, 7);
  assert.match(out[0], /リトライ/);
  assert.match(out[1], /英語のエラー/);
  assert.match(out[2], /専門用語/);
  assert.match(out[3], /1分/);
  assert.match(out[4], /遅い/);
  assert.match(out[5], /推測せず|スキップ/);
  assert.equal(out[6], 'カスタムルール');
});

test('expandStructured: 配列入力は例外', () => {
  assert.throws(() => expandStructured(['x']), TypeError);
});

test('expandStructured: null は例外', () => {
  assert.throws(() => expandStructured(null), TypeError);
});

console.log('## renderBehaviorRules (structured passthrough)');

test('renderBehaviorRules は object を expandStructured に委譲する', () => {
  const out = renderBehaviorRules({
    give_up_after: '3_retries',
    custom: ['追加ルール'],
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /3回リトライ/);
  assert.equal(out[1], '追加ルール');
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll behavior-rules tests pass.');
