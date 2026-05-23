#!/usr/bin/env node
/**
 * behavior-metrics.mjs のユニットテスト。
 *
 * Usage:
 *   node tests/test-behavior-metrics.mjs
 */

import assert from 'node:assert/strict';
import {
  computeMetrics,
  detectMismatch,
  renderSectionMarkdown,
} from '../plugins/persona-feedback/skills/persona-tester/scripts/behavior-metrics.mjs';

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

const emptyFeedback = {
  persona_id: 'noop',
  target: 'http://x.test',
  task: 't',
  outcome: 'completed',
  findings: [],
};

console.log('## computeMetrics');

test('action_log なしでも安全に空メトリクスを返す', () => {
  const m = computeMetrics(emptyFeedback);
  assert.equal(m.sample_count, 0);
  assert.equal(m.hesitation_seconds_mean, null);
  assert.equal(m.hesitation_seconds_max, null);
  assert.equal(m.scroll_back_and_forth, 0);
  assert.equal(m.back_or_cancel_count, 0);
  assert.deepEqual(m.time_on_screen_seconds, {});
});

test('hesitation: snapshot → 次の meaningful action までの平均秒数', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0,   action: 'navigate', location: '/login' },
      { at_seconds: 1,   action: 'snapshot', location: '/login' },
      { at_seconds: 4,   action: 'click',    location: '/login', target_desc: 'メアド欄' }, // 3s
      { at_seconds: 5,   action: 'type',     location: '/login' },                          // hesitation 対象外（snapshot 後でない）
      { at_seconds: 6,   action: 'snapshot', location: '/login' },
      { at_seconds: 13,  action: 'click',    location: '/login', target_desc: '送信' },     // 7s
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.hesitation_seconds_mean, 5);   // (3 + 7) / 2
  assert.equal(m.hesitation_seconds_max, 7);
});

test('hesitation: snapshot → navigate も hesitation 終端として扱う', () => {
  // PR #16 レビュー指摘 🟡-5: snapshot → URL ジャンプ時の膨らみ防止
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0, action: 'snapshot', location: '/x' },
      { at_seconds: 4, action: 'navigate', location: '/y' },  // hesitation = 4s でここで終わる
      { at_seconds: 20, action: 'click', location: '/y' },    // 別 hesitation 対象外
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.hesitation_seconds_mean, 4);
});

test('連続 snapshot は最新だけ採用される', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0,  action: 'snapshot', location: '/x' },
      { at_seconds: 10, action: 'snapshot', location: '/x' }, // 最新だけ採用
      { at_seconds: 12, action: 'click',    location: '/x' }, // hesitation = 2s
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.hesitation_seconds_mean, 2);
});

test('scroll_back_and_forth: 同一画面で連続 scroll', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0, action: 'navigate', location: '/x' },
      { at_seconds: 1, action: 'scroll',   location: '/x' },
      { at_seconds: 2, action: 'scroll',   location: '/x' },
      { at_seconds: 3, action: 'scroll',   location: '/x' },  // run-length 3 → +2
      { at_seconds: 4, action: 'click',    location: '/x' },
      { at_seconds: 5, action: 'scroll',   location: '/x' },
      { at_seconds: 6, action: 'scroll',   location: '/x' },  // run-length 2 → +1
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.scroll_back_and_forth, 3);
});

test('back / cancel カウント', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0, action: 'click' },
      { at_seconds: 1, action: 'back' },
      { at_seconds: 2, action: 'click' },
      { at_seconds: 3, action: 'cancel' },
      { at_seconds: 4, action: 'back' },
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.back_or_cancel_count, 3);
});

test('time_on_screen: duration_seconds で最終画面を延長', () => {
  // PR #16 レビュー指摘 🟡-4: 完走後に結果ページを眺めている時間を計上
  const fb = {
    ...emptyFeedback,
    duration_seconds: 30,
    action_log: [
      { at_seconds: 0,  action: 'navigate', location: '/a' },
      { at_seconds: 5,  action: 'navigate', location: '/b' },
      { at_seconds: 10, action: 'click',    location: '/b' }, // 最終 entry at_seconds=10
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.time_on_screen_seconds['/a'], 5);
  // duration_seconds=30 が最終画面 /b の終了時刻として使われる → 30 - 5 = 25
  assert.equal(m.time_on_screen_seconds['/b'], 25);
});

test('time_on_screen: duration_seconds が末尾 entry より小さければ無視', () => {
  const fb = {
    ...emptyFeedback,
    duration_seconds: 2,  // 末尾 entry の 5s より小さい
    action_log: [
      { at_seconds: 0, action: 'navigate', location: '/a' },
      { at_seconds: 5, action: 'click',    location: '/a' },
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.time_on_screen_seconds['/a'], 5);  // 末尾 entry の at_seconds が使われる
});

test('time_on_screen: location 遷移ごとに合算', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      { at_seconds: 0,  action: 'navigate', location: '/a' },
      { at_seconds: 3,  action: 'click',    location: '/a' },
      { at_seconds: 5,  action: 'navigate', location: '/b' },
      { at_seconds: 9,  action: 'click',    location: '/b' },
      { at_seconds: 10, action: 'navigate', location: '/a' },
      { at_seconds: 12, action: 'click',    location: '/a' },
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.time_on_screen_seconds['/a'], 7);  // 5 + 2
  assert.equal(m.time_on_screen_seconds['/b'], 5);
});

test('不正エントリは無視される', () => {
  const fb = {
    ...emptyFeedback,
    action_log: [
      null,
      { at_seconds: 'NaN', action: 'click' },   // 型不正
      { action: 'click' },                       // at_seconds 欠落
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 1, action: 'click' },
    ],
  };
  const m = computeMetrics(fb);
  assert.equal(m.sample_count, 2);
  assert.equal(m.hesitation_seconds_mean, 1);
});

console.log('## detectMismatch');

test('好評価＋高い hesitation → 食い違い検出', () => {
  const fb = {
    ...emptyFeedback,
    score: { overall: 8, would_recommend: true },
    action_log: [
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 10, action: 'click' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.ok(mm !== null);
  assert.match(mm.reasons.join(' '), /hesitation/);
});

test('低評価で hesitation 高くても食い違いではない（言葉と行動が一致）', () => {
  const fb = {
    ...emptyFeedback,
    outcome: 'abandoned',
    score: { overall: 3 },
    action_log: [
      { at_seconds: 0,  action: 'snapshot' },
      { at_seconds: 20, action: 'click' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.equal(mm, null);
});

test('outcome=completed なら好評価でなくても back 多発で食い違い', () => {
  const fb = {
    ...emptyFeedback,
    outcome: 'completed',
    score: { overall: 4 },
    action_log: [
      { at_seconds: 0, action: 'back' },
      { at_seconds: 1, action: 'back' },
      { at_seconds: 2, action: 'cancel' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.ok(mm !== null);
  assert.match(mm.reasons.join(' '), /back_or_cancel/);
});

test('outcome=completed + overall=2 では「好評価」と書かれない', () => {
  // PR #16 レビュー指摘 🟡-2: completed && overall<7 のメッセージ齟齬
  const fb = {
    ...emptyFeedback,
    outcome: 'completed',
    score: { overall: 2 },
    action_log: [
      { at_seconds: 0, action: 'back' },
      { at_seconds: 1, action: 'back' },
      { at_seconds: 2, action: 'cancel' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.ok(mm !== null);
  // 「好評価」表記が含まれてはいけない
  assert.doesNotMatch(mm.reasons.join(' '), /好評価/);
  // 代わりに「完走したのに」が入る
  assert.match(mm.reasons.join(' '), /完走したのに/);
});

test('positive + completed の両方成立で「好評価かつ完走」と表記', () => {
  const fb = {
    ...emptyFeedback,
    outcome: 'completed',
    score: { overall: 9 },
    action_log: [
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 10, action: 'click' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.ok(mm !== null);
  assert.match(mm.reasons.join(' '), /好評価かつ完走/);
});

test('positive のみ（outcome=abandoned）でも食い違いを検出', () => {
  const fb = {
    ...emptyFeedback,
    outcome: 'abandoned',
    score: { overall: 8 },
    action_log: [
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 10, action: 'click' },
    ],
  };
  const m = computeMetrics(fb);
  const mm = detectMismatch(fb, m);
  assert.ok(mm !== null);
  assert.match(mm.reasons.join(' '), /言葉では好評価/);
});

console.log('## renderSectionMarkdown');

test('action_log なしの集合では plain メッセージを出す', () => {
  const md = renderSectionMarkdown([emptyFeedback]);
  assert.match(md, /行動メトリクス/);
  assert.match(md, /action_log が記録されていない/);
});

test('action_log ありの集合では表とフラグセクションを出す', () => {
  const fb = {
    ...emptyFeedback,
    score: { overall: 9 },
    action_log: [
      { at_seconds: 0, action: 'snapshot' },
      { at_seconds: 8, action: 'click' },
    ],
  };
  const md = renderSectionMarkdown([fb]);
  assert.match(md, /persona \| hesitation_mean/);
  assert.match(md, /noop/);
  assert.match(md, /言葉と行動の食い違い/);
  assert.match(md, /画面ごとの滞在時間/);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll behavior-metrics tests pass.');
