#!/usr/bin/env node
/**
 * normalize-location.mjs のユニットテスト。
 * aggregate.mjs と diff-reports.mjs の両方が依存する共通モジュール。
 */

import assert from 'node:assert/strict';
import { normalizeLocation, normalizePage, locationKey } from '../plugins/persona-feedback/skills/persona-tester/scripts/normalize-location.mjs';

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n     ${e.message}`); }
}

console.log('## normalizeLocation');

test('null / undefined / 空文字は空文字に', () => {
  assert.equal(normalizeLocation(null), '');
  assert.equal(normalizeLocation(undefined), '');
  assert.equal(normalizeLocation(''), '');
});

test('大文字小文字を吸収', () => {
  assert.equal(normalizeLocation('Login'), normalizeLocation('LOGIN'));
});

test('半角・全角空白を strip', () => {
  assert.equal(normalizeLocation('送信 ボタン'), normalizeLocation('送信　ボタン'));
  assert.equal(normalizeLocation('送信 ボタン'), '送信ボタン');
});

test('引用符（半角・全角・コードフェンス）を strip', () => {
  assert.equal(normalizeLocation('「送信」ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('"送信"ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('`送信`ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('『送信』ボタン'), '送信ボタン');
});

test('句読点（半角・全角）を strip', () => {
  assert.equal(normalizeLocation('送信、ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('送信。'), '送信');
  assert.equal(normalizeLocation('Send, button.'), 'sendbutton');
});

test('全角・半角括弧を strip （PR #17 レビュー指摘）', () => {
  assert.equal(normalizeLocation('（送信）ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('(送信)ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('[送信]ボタン'), '送信ボタン');
  assert.equal(normalizeLocation('【送信】ボタン'), '送信ボタン');
});

test('中黒を strip （PR #17 レビュー指摘）', () => {
  assert.equal(normalizeLocation('ID・パスワード'), normalizeLocation('IDパスワード'));
  // 長音「ー」も同時に strip されるので、両方とも同じになる
  assert.equal(normalizeLocation('ID･パスワード'), 'idパスワド');
});

test('ハイフン類（半角・各種ダッシュ・長音）を strip （PR #17 レビュー指摘）', () => {
  assert.equal(normalizeLocation('Edge-ブラウザ'), normalizeLocation('Edgeブラウザ'));
  assert.equal(normalizeLocation('top-page'), 'toppage');
  assert.equal(normalizeLocation('A‐B'), 'ab');     // U+2010
  assert.equal(normalizeLocation('A–B'), 'ab');     // en dash
  assert.equal(normalizeLocation('A—B'), 'ab');     // em dash
  assert.equal(normalizeLocation('A−B'), 'ab');     // minus
});

test('組み合わせ: 引用符 + 全角空白 + 句読点 + 括弧', () => {
  const a = normalizeLocation('「送信」ボタン　（フォーム下部）');
  const b = normalizeLocation('送信ボタン フォーム下部');
  assert.equal(a, b);
});

console.log('## normalizePage');

test('null / undefined / 空文字は空文字に', () => {
  assert.equal(normalizePage(null), '');
  assert.equal(normalizePage(''), '');
});

test('オリジン・クエリ・フラグメント・末尾スラッシュを落とす', () => {
  assert.equal(normalizePage('http://localhost:3000/products/new/?tab=1#top'), '/products/new');
  assert.equal(normalizePage('https://example.com/a/b#x'), '/a/b');
});

test('URL とパスの書き方の違いを吸収する', () => {
  assert.equal(normalizePage('http://x.test/Products/New/'), normalizePage('/products/new'));
  assert.equal(normalizePage('products/new'), '/products/new');
});

test('ルートは "/" 相当にそろう', () => {
  assert.equal(normalizePage('http://x.test/'), normalizePage('http://x.test'));
});

console.log('## locationKey');

test('page があれば page + element をキーにする', () => {
  const a = locationKey({ page: 'http://x.test/new/', element: '「スキップ」ボタン', location: '保存後のダイアログ' });
  const b = locationKey({ page: '/new', element: 'スキップ ボタン', location: '完了ダイアログ' });
  assert.equal(a, b);
});

test('page が無ければ正規化した location をキーにする（後方互換）', () => {
  assert.equal(locationKey({ location: '「送信」ボタン' }), '送信ボタン');
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll normalize-location tests pass.');
