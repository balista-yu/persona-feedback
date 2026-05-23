#!/usr/bin/env node
/**
 * diff-reports.mjs のユニットテスト。
 *
 * Usage:
 *   node tests/test-diff-reports.mjs
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diffReports,
  renderDiffMarkdown,
  findPreviousReport,
} from '../plugins/persona-feedback/skills/persona-tester/scripts/diff-reports.mjs';

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

function makeReport({ generated_at, target = 'http://x.test', task = 'signup', feedbacks = [], metrics = [] } = {}) {
  return {
    generated_at,
    target,
    task,
    personas: feedbacks.map(f => f.persona_id),
    raw_feedbacks: feedbacks,
    behavior_metrics: metrics,
  };
}

console.log('## diffReports');

test('スコア変化 / outcome 変化を拾う', () => {
  const a = makeReport({
    generated_at: '2026-05-20T00:00:00Z',
    feedbacks: [
      { persona_id: 'tanaka', outcome: 'completed', findings: [], score: { overall: 7 } },
      { persona_id: 'dev',    outcome: 'completed', findings: [], score: { overall: 8 } },
    ],
  });
  const b = makeReport({
    generated_at: '2026-05-23T00:00:00Z',
    feedbacks: [
      { persona_id: 'tanaka', outcome: 'abandoned', findings: [], score: { overall: 5 } },
      { persona_id: 'dev',    outcome: 'completed', findings: [], score: { overall: 8.5 } },
    ],
  });
  const d = diffReports(a, b);
  const t = d.persona_deltas.find(p => p.persona_id === 'tanaka');
  assert.equal(t.score_delta, -2);
  assert.equal(t.outcome_from, 'completed');
  assert.equal(t.outcome_to, 'abandoned');
  assert.equal(t.outcome_changed, true);
  const dev = d.persona_deltas.find(p => p.persona_id === 'dev');
  assert.equal(dev.score_delta, 0.5);
  assert.equal(dev.outcome_changed, false);
});

test('ペルソナの追加 / 削除を added / removed フラグで記録', () => {
  const a = makeReport({ feedbacks: [
    { persona_id: 'tanaka', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const b = makeReport({ feedbacks: [
    { persona_id: 'tanaka', outcome: 'completed', findings: [], score: { overall: 7 } },
    { persona_id: 'gal',    outcome: 'completed', findings: [], score: { overall: 6 } },
  ]});
  const d = diffReports(a, b);
  const gal = d.persona_deltas.find(p => p.persona_id === 'gal');
  assert.equal(gal.added, true);
  assert.equal(gal.removed, false);
});

test('findings の追加 / 消失 / 継続を category + 正規化 location でマッチ', () => {
  const a = makeReport({ feedbacks: [
    {
      persona_id: 'tanaka',
      outcome: 'completed',
      score: { overall: 7 },
      findings: [
        { category: 'copywriting', severity: 'high', location: 'CTAボタン', description: 'カタカナ用語' },
        { category: 'usability',   severity: 'medium', location: '入力欄',  description: 'ラベル小さい' },
      ],
    },
  ]});
  const b = makeReport({ feedbacks: [
    {
      persona_id: 'tanaka',
      outcome: 'completed',
      score: { overall: 7 },
      findings: [
        // copywriting / CTAボタン は継続
        { category: 'copywriting', severity: 'high', location: 'CTAボタン', description: 'カタカナ用語（言い回し変更）' },
        // 新規 finding
        { category: 'trust',       severity: 'critical', location: '注文確定', description: '送料が確定前' },
      ],
    },
  ]});
  const d = diffReports(a, b);
  assert.equal(d.findings.added.length, 1);
  assert.equal(d.findings.added[0].category, 'trust');
  assert.equal(d.findings.removed.length, 1);
  assert.equal(d.findings.removed[0].category, 'usability');
  assert.equal(d.findings.persisted_count, 1);
});

test('正規化により location 表記揺れ（半角全角 / 句読点）を吸収', () => {
  const a = makeReport({ feedbacks: [
    {
      persona_id: 'tanaka',
      outcome: 'completed',
      score: { overall: 7 },
      findings: [
        { category: 'usability', severity: 'medium', location: '送信ボタン', description: 'x' },
      ],
    },
  ]});
  const b = makeReport({ feedbacks: [
    {
      persona_id: 'tanaka',
      outcome: 'completed',
      score: { overall: 7 },
      findings: [
        { category: 'usability', severity: 'medium', location: '「送信」ボタン　', description: 'x' },
      ],
    },
  ]});
  const d = diffReports(a, b);
  assert.equal(d.findings.added.length, 0);
  assert.equal(d.findings.removed.length, 0);
  assert.equal(d.findings.persisted_count, 1);
});

test('target mismatch を warnings に入れる（PR #17 レビュー指摘）', () => {
  const a = makeReport({ target: 'http://a.test', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const b = makeReport({ target: 'http://b.test', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const d = diffReports(a, b);
  assert.equal(d.warnings.length, 1);
  assert.equal(d.warnings[0].type, 'target_mismatch');
  assert.equal(d.warnings[0].from, 'http://a.test');
  assert.equal(d.warnings[0].to, 'http://b.test');
});

test('task mismatch を warnings に入れる', () => {
  const a = makeReport({ task: 'signup', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const b = makeReport({ task: 'checkout', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const d = diffReports(a, b);
  assert.equal(d.warnings.length, 1);
  assert.equal(d.warnings[0].type, 'task_mismatch');
});

test('target / task が一致すれば warnings は空配列', () => {
  const a = makeReport({ feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const b = makeReport({ feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 8 } },
  ]});
  const d = diffReports(a, b);
  assert.deepEqual(d.warnings, []);
});

test('warnings は renderDiffMarkdown でレポート冒頭に出る', () => {
  const a = makeReport({ target: 'http://a.test', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const b = makeReport({ target: 'http://b.test', feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } },
  ]});
  const md = renderDiffMarkdown(diffReports(a, b));
  assert.match(md, /⚠️ 警告/);
  assert.match(md, /target_mismatch/);
});

test('behavior_metrics の差分を拾う', () => {
  const a = makeReport({
    feedbacks: [{ persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } }],
    metrics: [{ persona_id: 't', metrics: { hesitation_seconds_mean: 3, back_or_cancel_count: 1 } }],
  });
  const b = makeReport({
    feedbacks: [{ persona_id: 't', outcome: 'completed', findings: [], score: { overall: 7 } }],
    metrics: [{ persona_id: 't', metrics: { hesitation_seconds_mean: 9, back_or_cancel_count: 5 } }],
  });
  const d = diffReports(a, b);
  const m = d.metric_deltas.find(x => x.persona_id === 't');
  assert.equal(m.hesitation_from, 3);
  assert.equal(m.hesitation_to, 9);
  assert.equal(m.back_or_cancel_from, 1);
  assert.equal(m.back_or_cancel_to, 5);
});

console.log('## renderDiffMarkdown');

test('Markdown 出力に必要な見出しが揃う', () => {
  const a = makeReport({ feedbacks: [
    { persona_id: 'tanaka', outcome: 'completed', findings: [
      { category: 'usability', severity: 'medium', location: 'x', description: 'x' },
    ], score: { overall: 7 } },
  ]});
  const b = makeReport({ feedbacks: [
    { persona_id: 'tanaka', outcome: 'abandoned', findings: [
      { category: 'trust', severity: 'critical', location: 'y', description: 'y' },
    ], score: { overall: 4 } },
  ]});
  const md = renderDiffMarkdown(diffReports(a, b));
  assert.match(md, /変更サマリ \(UX Regression\)/);
  assert.match(md, /ペルソナ別スコア/);
  assert.match(md, /Findings 差分/);
  assert.match(md, /追加された findings/);
  assert.match(md, /消失した findings/);
});

test('Findings の変化がない場合は plain メッセージ', () => {
  const a = makeReport({ feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [
      { category: 'usability', severity: 'low', location: 'x', description: 'x' },
    ], score: { overall: 7 } },
  ]});
  const b = makeReport({ feedbacks: [
    { persona_id: 't', outcome: 'completed', findings: [
      { category: 'usability', severity: 'low', location: 'x', description: 'x' },
    ], score: { overall: 7 } },
  ]});
  const md = renderDiffMarkdown(diffReports(a, b));
  assert.match(md, /追加・消失なし/);
});

console.log('## findPreviousReport');

test('reports ディレクトリから timestamp 順で1つ前を返す', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-diff-'));
  try {
    writeFileSync(join(dir, '20260520-100000-report.json'), '{}');
    writeFileSync(join(dir, '20260521-100000-report.json'), '{}');
    writeFileSync(join(dir, '20260522-100000-report.json'), '{}');
    const prev = findPreviousReport(dir, join(dir, '20260522-100000-report.json'));
    assert.equal(prev, join(dir, '20260521-100000-report.json'));
    // current 指定なしなら「最新2件のうち古い方」
    const prev2 = findPreviousReport(dir);
    assert.equal(prev2, join(dir, '20260521-100000-report.json'));
    // current がディレクトリにない場合は最新を返す
    const prev3 = findPreviousReport(dir, join(dir, '20260523-100000-report.json'));
    assert.equal(prev3, join(dir, '20260522-100000-report.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports ディレクトリにファイル1個だけなら null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pf-diff-'));
  try {
    writeFileSync(join(dir, '20260520-100000-report.json'), '{}');
    assert.equal(findPreviousReport(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports ディレクトリ自体が存在しなくても null（throw しない）', () => {
  assert.equal(findPreviousReport('/nonexistent-dir-pf-diff-test'), null);
});

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll diff-reports tests pass.');
