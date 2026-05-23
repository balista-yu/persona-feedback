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

test('lexical.block_jargon と confused_by の両方', () => {
  const out = expandStructured({
    lexical: {
      block_jargon: true,
      confused_by: ['ログイン', '認証'],
    },
  });
  assert.equal(out.length, 2);
  assert.match(out[0], /専門用語.*分からない/);
  assert.match(out[1], /ログイン.*認証/);
});

test('lexical.block_jargon のみ（confused_by なし）', () => {
  const out = expandStructured({
    lexical: { block_jargon: true },
  });
  assert.equal(out.length, 1);
  assert.match(out[0], /専門用語/);
});

test('lexical.confused_by のみ（block_jargon false）', () => {
  const out = expandStructured({
    lexical: { confused_by: ['OAuth'] },
  });
  assert.equal(out.length, 1);
  assert.match(out[0], /OAuth/);
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
    lexical: { block_jargon: true },
    attention_span: '1min',
    reading_speed: 'slow',
    on_ambiguous_button: 'ask_or_skip',
    custom: ['カスタムルール'],
  });
  // 出力順 = give_up_after → panic_on → lexical → attention_span
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

console.log('## persona.schema.json: DSL のスキーマ拒否ケース');

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname as pathDirname, resolve as pathResolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const PERSONA_SCHEMA = JSON.parse(readFileSync(
  pathResolve(__dirname, '../plugins/persona-feedback/skills/persona-tester/schemas/persona.schema.json'),
  'utf8',
));
const ajvDsl = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajvDsl);
const validate = ajvDsl.compile(PERSONA_SCHEMA);

function makePersonaWith(behaviorRules) {
  return {
    id: 'test-persona',
    name: 'テスト',
    demographics: { tech_literacy: 'low' },
    context: { device: 'desktop', goal: 'x' },
    behavior_rules: behaviorRules,
  };
}

test('give_up_after: 0_retries はスキーマで拒否', () => {
  assert.equal(validate(makePersonaWith({ give_up_after: '0_retries' })), false);
});

test('give_up_after: 0s はスキーマで拒否', () => {
  assert.equal(validate(makePersonaWith({ give_up_after: '0s' })), false);
});

test('give_up_after: 2_retries はスキーマで許可', () => {
  assert.equal(validate(makePersonaWith({ give_up_after: '2_retries' })), true);
});

test('attention_span: 0s はスキーマで拒否', () => {
  assert.equal(validate(makePersonaWith({ attention_span: '0s' })), false);
});

test('panic_on: 空配列はスキーマで拒否（minItems: 1）', () => {
  assert.equal(validate(makePersonaWith({ panic_on: [] })), false);
});

test('lexical.confused_by: 空配列はスキーマで拒否', () => {
  assert.equal(validate(makePersonaWith({ lexical: { confused_by: [] } })), false);
});

test('custom: 空配列はスキーマで拒否', () => {
  assert.equal(validate(makePersonaWith({ custom: [] })), false);
});

test('DSL 内の旧キー vocabulary は additionalProperties:false で拒否', () => {
  assert.equal(validate(makePersonaWith({ vocabulary: { block_jargon: true } })), false);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll behavior-rules tests pass.');
