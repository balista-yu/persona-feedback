#!/usr/bin/env node
/**
 * diff-reports.mjs
 *
 * 2つの aggregate レポート JSON (./reports/<timestamp>-report.json) を比較し、
 * UX Regression（前回実行との差分）として
 *   - ペルソナ別 overall スコア差分
 *   - outcome 変化
 *   - findings の追加 / 消失 / 維持（category × 正規化 location キーでマッチ）
 *   - behavior_metrics の差分（hesitation_mean / back_or_cancel）
 * を抽出する。
 *
 * 役割:
 *   - module: diffReports(from, to) → 構造化 diff オブジェクト
 *             renderDiffMarkdown(diff) → 「変更サマリ」セクションの Markdown
 *             findPreviousReport(reportsDir, currentPath?) → 1つ前の report.json
 *   - CLI:    node diff-reports.mjs --from <a.json> --to <b.json> [--format markdown|json]
 *             node diff-reports.mjs --reports-dir ./reports     (最新2つを自動選択)
 *
 * これがあると persona-feedback は「単発の評価ツール」から「UX における Lint」
 * （ESLint や Visual Regression Testing と同じレイヤー）に昇格する。
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';

function normalizeLocation(loc) {
  if (!loc) return '';
  return String(loc)
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/["'`「」『』]/g, '')
    .replace(/[、。,;.!?！？:：]/g, '');
}

function findingKey(persona_id, find) {
  return `${persona_id}::${find.category}::${normalizeLocation(find.location)}`;
}

function indexFindings(report) {
  const out = new Map();
  for (const fb of report.raw_feedbacks || []) {
    for (const find of fb.findings || []) {
      const key = findingKey(fb.persona_id, find);
      out.set(key, { persona_id: fb.persona_id, ...find });
    }
  }
  return out;
}

function indexFeedbacksByPersona(report) {
  const out = new Map();
  for (const fb of report.raw_feedbacks || []) out.set(fb.persona_id, fb);
  return out;
}

function indexBehaviorMetrics(report) {
  const out = new Map();
  for (const entry of report.behavior_metrics || []) {
    out.set(entry.persona_id, entry.metrics);
  }
  return out;
}

/**
 * 2レポートを比較する。
 * from / to は aggregate.mjs が出力する report.json の構造。
 */
export function diffReports(from, to) {
  const fromFeedbacks = indexFeedbacksByPersona(from);
  const toFeedbacks = indexFeedbacksByPersona(to);
  const allPersonas = new Set([...fromFeedbacks.keys(), ...toFeedbacks.keys()]);

  const personaDeltas = [];
  for (const id of [...allPersonas].sort()) {
    const a = fromFeedbacks.get(id);
    const b = toFeedbacks.get(id);
    const fromScore = a?.score?.overall ?? null;
    const toScore = b?.score?.overall ?? null;
    const fromOutcome = a?.outcome ?? null;
    const toOutcome = b?.outcome ?? null;
    let scoreDelta = null;
    if (typeof fromScore === 'number' && typeof toScore === 'number') {
      scoreDelta = Number((toScore - fromScore).toFixed(2));
    }
    personaDeltas.push({
      persona_id: id,
      added: !a && !!b,
      removed: !!a && !b,
      score_from: fromScore,
      score_to: toScore,
      score_delta: scoreDelta,
      outcome_from: fromOutcome,
      outcome_to: toOutcome,
      outcome_changed: fromOutcome !== toOutcome,
    });
  }

  // findings の追加 / 消失
  const fromFindings = indexFindings(from);
  const toFindings = indexFindings(to);
  const fromKeys = new Set(fromFindings.keys());
  const toKeys = new Set(toFindings.keys());

  const addedFindings = [];
  for (const k of toKeys) if (!fromKeys.has(k)) addedFindings.push(toFindings.get(k));
  const removedFindings = [];
  for (const k of fromKeys) if (!toKeys.has(k)) removedFindings.push(fromFindings.get(k));
  const persistedFindings = [];
  for (const k of fromKeys) if (toKeys.has(k)) persistedFindings.push(toFindings.get(k));

  // behavior_metrics の差分
  const fromMetrics = indexBehaviorMetrics(from);
  const toMetrics = indexBehaviorMetrics(to);
  const metricDeltas = [];
  for (const id of [...allPersonas].sort()) {
    const a = fromMetrics.get(id);
    const b = toMetrics.get(id);
    if (!a && !b) continue;
    metricDeltas.push({
      persona_id: id,
      hesitation_from: a?.hesitation_seconds_mean ?? null,
      hesitation_to: b?.hesitation_seconds_mean ?? null,
      back_or_cancel_from: a?.back_or_cancel_count ?? null,
      back_or_cancel_to: b?.back_or_cancel_count ?? null,
    });
  }

  return {
    from: {
      target: from.target,
      task: from.task,
      generated_at: from.generated_at,
    },
    to: {
      target: to.target,
      task: to.task,
      generated_at: to.generated_at,
    },
    persona_deltas: personaDeltas,
    findings: {
      added: addedFindings,
      removed: removedFindings,
      persisted_count: persistedFindings.length,
    },
    metric_deltas: metricDeltas,
  };
}

const SEVERITY_BADGE = { low: '⚪', medium: '🟡', high: '🟠', critical: '🔴' };

function fmtDelta(d) {
  if (d === null || d === undefined) return '-';
  if (d > 0) return `+${d}`;
  if (d < 0) return `${d}`;
  return '±0';
}

/**
 * 変更サマリの Markdown。レポート先頭に挿入する想定。
 */
export function renderDiffMarkdown(diff) {
  const lines = [];
  lines.push('## 🔁 変更サマリ (UX Regression)');
  lines.push('');
  lines.push(`- **前回**: ${diff.from.generated_at ?? '(unknown)'}`);
  lines.push(`- **今回**: ${diff.to.generated_at ?? '(unknown)'}`);
  lines.push('');

  lines.push('### ペルソナ別スコア / outcome 変化');
  lines.push('');
  lines.push('| persona | score (前 → 今) | Δ | outcome (前 → 今) |');
  lines.push('|---|---|---|---|');
  for (const p of diff.persona_deltas) {
    const scoreCell = `${p.score_from ?? '-'} → ${p.score_to ?? '-'}`;
    const outcomeCell = `${p.outcome_from ?? '-'} → ${p.outcome_to ?? '-'}` +
      (p.outcome_changed && p.outcome_from && p.outcome_to ? ' ⚠️' : '');
    const tag = p.added ? ' _(new)_' : p.removed ? ' _(removed)_' : '';
    lines.push(`| ${p.persona_id}${tag} | ${scoreCell} | ${fmtDelta(p.score_delta)} | ${outcomeCell} |`);
  }
  lines.push('');

  lines.push(`### Findings 差分（${diff.findings.added.length} 件追加 / ${diff.findings.removed.length} 件消失 / ${diff.findings.persisted_count} 件継続）`);
  lines.push('');
  if (diff.findings.added.length > 0) {
    lines.push('#### ➕ 追加された findings');
    for (const f of diff.findings.added) {
      lines.push(`- ${SEVERITY_BADGE[f.severity] || ''} **[${f.severity}]** ${f.description} _(by ${f.persona_id}, ${f.category})_`);
      if (f.location) lines.push(`  - location: ${f.location}`);
    }
    lines.push('');
  }
  if (diff.findings.removed.length > 0) {
    lines.push('#### ➖ 消失した findings');
    for (const f of diff.findings.removed) {
      lines.push(`- ${SEVERITY_BADGE[f.severity] || ''} **[${f.severity}]** ${f.description} _(by ${f.persona_id}, ${f.category})_`);
      if (f.location) lines.push(`  - location: ${f.location}`);
    }
    lines.push('');
  }
  if (diff.findings.added.length === 0 && diff.findings.removed.length === 0) {
    lines.push('追加・消失なし。全ての findings は継続している。');
    lines.push('');
  }

  if (diff.metric_deltas.length > 0) {
    lines.push('### 行動メトリクス変化');
    lines.push('');
    lines.push('| persona | hesitation_mean (前→今) | back_or_cancel (前→今) |');
    lines.push('|---|---|---|');
    for (const m of diff.metric_deltas) {
      lines.push(`| ${m.persona_id} | ${m.hesitation_from ?? '-'} → ${m.hesitation_to ?? '-'} | ${m.back_or_cancel_from ?? '-'} → ${m.back_or_cancel_to ?? '-'} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * reports/ 配下から「currentPath 以外で最新の *-report.json」を探す。
 * currentPath を渡さなければ「最新の2件のうち古い方」を返す。
 */
export function findPreviousReport(reportsDir, currentPath) {
  const dir = resolve(reportsDir);
  let entries;
  try { entries = readdirSync(dir); } catch { return null; }
  const files = entries
    .filter(f => /-report\.json$/.test(f))
    .map(f => join(dir, f))
    .filter(f => {
      try { return statSync(f).isFile(); } catch { return false; }
    });
  if (files.length === 0) return null;

  files.sort(); // YYYYMMDD-HHmmss プレフィクスで字句順 == 時間順

  if (currentPath) {
    const target = resolve(currentPath);
    const idx = files.indexOf(target);
    if (idx > 0) return files[idx - 1];
    // current が files に含まれない（まだ書かれてない場合等）→ 末尾を採用
    if (idx === -1 && files.length >= 1) return files[files.length - 1];
    return null;
  }
  if (files.length < 2) return null;
  return files[files.length - 2];
}

function loadReport(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseArgs(argv) {
  const args = { format: 'markdown' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') args.from = argv[++i];
    else if (a === '--to') args.to = argv[++i];
    else if (a === '--reports-dir') args.reportsDir = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    `Usage:\n` +
    `  diff-reports.mjs --from <a-report.json> --to <b-report.json> [--format markdown|json] [--output <file>]\n` +
    `  diff-reports.mjs --reports-dir ./reports [--format markdown|json] [--output <file>]\n` +
    `\n` +
    `--reports-dir モードでは最新2つの *-report.json を自動選択する。`
  );
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); process.exit(0); }

  let fromPath = args.from;
  let toPath = args.to;
  if (!fromPath && args.reportsDir) {
    const dir = resolve(args.reportsDir);
    const files = readdirSync(dir).filter(f => /-report\.json$/.test(f)).sort();
    if (files.length < 2) {
      console.error(`Need at least 2 reports in ${dir}; found ${files.length}.`);
      process.exit(1);
    }
    fromPath = join(dir, files[files.length - 2]);
    toPath = join(dir, files[files.length - 1]);
  }
  if (!fromPath || !toPath) { usage(); process.exit(1); }

  const diff = diffReports(loadReport(fromPath), loadReport(toPath));
  const out = args.format === 'json'
    ? JSON.stringify(diff, null, 2)
    : renderDiffMarkdown(diff);

  if (args.output) {
    mkdirSync(dirname(resolve(args.output)), { recursive: true });
    writeFileSync(args.output, out, 'utf8');
    console.log(`wrote ${args.format}: ${args.output}`);
  } else {
    process.stdout.write(out);
    if (!out.endsWith('\n')) process.stdout.write('\n');
  }
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) main();
