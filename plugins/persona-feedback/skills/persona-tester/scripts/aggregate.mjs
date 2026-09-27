#!/usr/bin/env node
/**
 * aggregate.mjs
 *
 * 複数の persona-runner からの feedback JSON を読み込み、不一致点を抽出して
 * 統合レポート (Markdown / JSON) を生成する。
 *
 * Usage:
 *   node aggregate.mjs --feedbacks <glob-or-dir> --output <file> --format markdown|json|both
 *
 * Examples:
 *   node aggregate.mjs --feedbacks reports/20260511-100000/raw --output reports/20260511-100000-report.md
 *   node aggregate.mjs --feedbacks "reports/20260511-100000/raw/*.json" --output reports/r.md --format both
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { computeMetrics, detectMismatch, renderSectionMarkdown as renderBehaviorMetricsMarkdown } from './behavior-metrics.mjs';
import { diffReports, renderDiffMarkdown, findPreviousReport } from './diff-reports.mjs';
import { locationKey, normalizePage } from './normalize-location.mjs';

function parseArgs(argv) {
  const args = { format: 'markdown', feedbacks: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--feedbacks') {
      // --feedbacks は繰り返し指定可。次の --foo まで全部値として吸う。
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.feedbacks.push(argv[++i]);
      }
    }
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--auto-baseline-dir') args.autoBaselineDir = argv[++i];
    else if (a === '--severity-threshold') args.severityThreshold = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    `Usage: aggregate.mjs --feedbacks <path> [<path> ...] --output <file> [--format markdown|json|both]\n` +
    `                     [--baseline <prev-report.json>] [--auto-baseline-dir <reports-dir>]\n` +
    `                     [--severity-threshold low|medium|high|critical]\n` +
    `\n` +
    `<path> はいずれでも可:\n` +
    `  - 単一の JSON ファイル\n` +
    `  - ディレクトリ（配下の *.json を全部）\n` +
    `  - "<dir>/*.json" 形式の glob（シェル未展開で渡された場合）\n` +
    `\n` +
    `--feedbacks は複数の値を取れる。例:\n` +
    `  aggregate.mjs --feedbacks raw/tanaka.json raw/gal.json raw/dev.json --output r.md\n` +
    `\n` +
    `--baseline を渡すと「🔁 変更サマリ (UX Regression)」セクションが先頭に挿入される。\n` +
    `--auto-baseline-dir を渡すと、そのディレクトリから --output と同じファイルを除いた最新の\n` +
    `  *-report.json を baseline として自動採用する（無ければ baseline なしで続行）。\n` +
    `--severity-threshold 未満の finding は集約セクションから除外する（既定: low = 全て）。`
  );
}

function collectOnePath(arg) {
  const p = resolve(arg);
  let stat;
  try { stat = statSync(p); } catch { stat = null; }
  if (stat && stat.isDirectory()) {
    return readdirSync(p)
      .filter(f => extname(f) === '.json')
      .sort()
      .map(f => join(p, f));
  }
  // 簡易 glob: 「ディレクトリ/*.json」だけサポート。前置パターン等はエラー。
  if (arg.includes('*')) {
    if (arg.endsWith('/*.json')) {
      const dir = dirname(p);
      return readdirSync(dir)
        .filter(f => extname(f) === '.json')
        .sort()
        .map(f => join(dir, f));
    }
    throw new Error(
      `Unsupported glob pattern: ${arg}\n` +
      `Only "<dir>/*.json" or a plain directory/file path is supported.`
    );
  }
  if (stat && stat.isFile()) return [p];
  throw new Error(`feedbacks not found: ${arg}`);
}

function collectFeedbackFiles(feedbackArgs) {
  const out = [];
  const seen = new Set();
  for (const a of feedbackArgs) {
    for (const f of collectOnePath(a)) {
      if (!seen.has(f)) {
        seen.add(f);
        out.push(f);
      }
    }
  }
  return out;
}

function loadFeedback(file) {
  const raw = readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  // 最低限の必須フィールド検証
  for (const k of ['persona_id', 'target', 'task', 'outcome', 'findings']) {
    if (!(k in data)) {
      throw new Error(`Invalid feedback (${file}): missing field "${k}"`);
    }
  }
  if (!Array.isArray(data.findings)) data.findings = [];
  return data;
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };

function maxSeverityRank(items) {
  return items.reduce((m, i) => Math.max(m, SEVERITY_RANK[i.severity] || 0), 0);
}

/**
 * 不一致分析:
 * - all-agreement: 全ペルソナが同じ問題を指摘
 *   - primary: category + 場所キー（page + element、無ければ正規化 location）が一致
 *   - page-match: element の呼び方が揺れていても、category + page が一致し
 *     全員が指摘していれば拾う。severity はペルソナごとに感じ方が違うので条件にしない
 *   - category-only: page を持たない旧形式の finding 向けの救済。category 単独で
 *     全員が severity >= high の finding を持っていれば拾う
 * - segment-specific: 1〜(N-1)体だけが指摘。ペルソナ1体のときは全指摘
 * - controversial: スコアの分散が大きい / 推薦意向が割れた
 *
 * minSeverityRank 未満の finding は集約前に除外する（--severity-threshold）。
 */
function analyze(feedbacks, { minSeverityRank = 1 } = {}) {
  const personaIds = feedbacks.map(f => f.persona_id);
  const N = personaIds.length;

  const findings = [];
  for (const fb of feedbacks) {
    for (const find of fb.findings) {
      if ((SEVERITY_RANK[find.severity] || 0) < minSeverityRank) continue;
      findings.push({ persona_id: fb.persona_id, ...find });
    }
  }

  // primary: category × 場所キーでまとめる
  const groups = new Map();
  for (const find of findings) {
    const key = `${find.category}::${locationKey(find)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(find);
  }

  const allAgreement = [];
  const segmentSpecific = [];
  const claimedFindings = new Set(); // all-agreement 入りした finding を覚える

  for (const [key, items] of groups.entries()) {
    const personas = new Set(items.map(i => i.persona_id));
    const maxSev = maxSeverityRank(items);
    if (personas.size >= N && N >= 2) {
      allAgreement.push({ key, items, max_severity_rank: maxSev, source: 'location-match' });
      for (const it of items) claimedFindings.add(it);
    } else {
      segmentSpecific.push({ key, items, max_severity_rank: maxSev });
    }
  }

  // 救済で all-agreement に入れたグループと重複する segment-specific を取り除く
  function promote(key, items, source) {
    allAgreement.push({ key, items, max_severity_rank: maxSeverityRank(items), source });
    for (const it of items) claimedFindings.add(it);
    for (let i = segmentSpecific.length - 1; i >= 0; i--) {
      if (segmentSpecific[i].items.every(it => items.includes(it))) segmentSpecific.splice(i, 1);
    }
  }

  if (N >= 2) {
    // page-match: element の表現揺れ救済
    const byPage = new Map();
    for (const find of findings) {
      if (!find.page || claimedFindings.has(find)) continue;
      const key = `${find.category}::${normalizePage(find.page)}`;
      if (!byPage.has(key)) byPage.set(key, []);
      byPage.get(key).push(find);
    }
    for (const [key, items] of byPage.entries()) {
      if (new Set(items.map(i => i.persona_id)).size < N) continue;
      promote(key, items, 'page-match');
    }

    // category-only: page を持たない旧形式 finding の location 表現揺れ救済
    const byCategory = new Map();
    for (const find of findings) {
      if (find.page || claimedFindings.has(find)) continue;
      if ((SEVERITY_RANK[find.severity] || 0) < 3) continue; // high 以上のみ
      if (!byCategory.has(find.category)) byCategory.set(find.category, []);
      byCategory.get(find.category).push(find);
    }
    for (const [category, items] of byCategory.entries()) {
      if (new Set(items.map(i => i.persona_id)).size < N) continue;
      promote(`${category}::*location-varied*`, items, 'category-only');
    }
  }

  allAgreement.sort((a, b) => b.max_severity_rank - a.max_severity_rank);
  segmentSpecific.sort((a, b) => b.max_severity_rank - a.max_severity_rank);

  // controversial: would_recommend が割れた / overall スコア差 >= 3
  const scores = feedbacks
    .map(f => (f.score && typeof f.score.overall === 'number') ? f.score.overall : null)
    .filter(v => v !== null);
  const scoreGap = (scores.length >= 2 && (Math.max(...scores) - Math.min(...scores) >= 3))
    ? { min: Math.min(...scores), max: Math.max(...scores) }
    : null;

  const recos = feedbacks.map(f => f.score?.would_recommend).filter(v => v !== undefined);
  const splitReco = recos.length >= 2 && new Set(recos).size > 1;

  const controversial = (scoreGap || splitReco)
    ? {
        ...(scoreGap ? { score_gap: scoreGap } : {}),
        ...(splitReco ? { recommend_split: true } : {}),
        feedbacks
      }
    : null;

  // outcome の集計
  const outcomeCounts = feedbacks.reduce((acc, f) => {
    acc[f.outcome] = (acc[f.outcome] || 0) + 1;
    return acc;
  }, {});

  return { personaIds, allAgreement, segmentSpecific, controversial, outcomeCounts };
}

function formatFindingMd(item) {
  const lines = [];
  lines.push(`- **[${item.severity}]** ${item.description} _(by ${item.persona_id})_`);
  if (item.quote) lines.push(`  - 💬 "${item.quote}"`);
  if (item.page) lines.push(`  - page: ${item.page}${item.element ? ` / ${item.element}` : ''}`);
  if (item.location) lines.push(`  - location: ${item.location}`);
  if (item.suggestion) lines.push(`  - 💡 ${item.suggestion}`);
  if (item.screenshot) lines.push(`  - 📸 ${item.screenshot}`);
  return lines.join('\n');
}

function toMarkdown(feedbacks, analysis, diffMarkdown) {
  const { personaIds, allAgreement, segmentSpecific, controversial, outcomeCounts } = analysis;
  const target = feedbacks[0]?.target || '(unknown)';
  const task = feedbacks[0]?.task || '(unknown)';
  const now = new Date().toISOString();

  const out = [];
  out.push(`# Persona Feedback Report`);
  out.push('');
  out.push(`- **target**: ${target}`);
  out.push(`- **task**: ${task}`);
  out.push(`- **personas**: ${personaIds.join(', ')}`);
  out.push(`- **generated**: ${now}`);
  out.push('');

  if (diffMarkdown) {
    out.push(diffMarkdown);
    out.push('');
  }

  out.push(`## Outcome 集計`);
  for (const [k, v] of Object.entries(outcomeCounts)) {
    out.push(`- ${k}: ${v}`);
  }
  out.push('');

  out.push(`## 🚨 全員指摘 (all-agreement)`);
  if (allAgreement.length === 0) {
    out.push(personaIds.length < 2
      ? '該当なし（ペルソナが1体なので全指摘をセグメント特有に出している）。'
      : '該当なし。');
  } else {
    for (const g of allAgreement) {
      const [cat] = g.key.split('::');
      const suffix = g.source === 'category-only'
        ? ' _(高重要度のカテゴリ一致。location 表現がペルソナ間で揺れている)_'
        : g.source === 'page-match'
          ? ` _(同じ画面 ${g.key.split('::')[1]} での指摘。要素の呼び方がペルソナ間で揺れている)_`
          : '';
      out.push(`### ${cat}${suffix}`);
      for (const item of g.items) out.push(formatFindingMd(item));
      out.push('');
    }
  }
  out.push('');

  out.push(`## 🎯 セグメント特有 (segment-specific)`);
  if (segmentSpecific.length === 0) {
    out.push('該当なし。');
  } else {
    for (const g of segmentSpecific) {
      const [cat] = g.key.split('::');
      const who = [...new Set(g.items.map(i => i.persona_id))].join(', ');
      out.push(`### ${cat} — _detected by: ${who}_`);
      for (const item of g.items) out.push(formatFindingMd(item));
      out.push('');
    }
  }
  out.push('');

  out.push(`## ⚖️ 評価分裂 (controversial)`);
  if (!controversial) {
    out.push('該当なし。ペルソナ間でスコア・推薦意向に大きな差はない。');
  } else {
    if (controversial.score_gap) {
      out.push(`- overall スコア差: min=${controversial.score_gap.min}, max=${controversial.score_gap.max}`);
    }
    if (controversial.recommend_split) {
      out.push(`- would_recommend がペルソナ間で割れた:`);
      for (const f of feedbacks) {
        if (f.score && f.score.would_recommend !== undefined) {
          out.push(`  - ${f.persona_id}: ${f.score.would_recommend}`);
        }
      }
    }
  }
  out.push('');

  // 行動メトリクス（言語化以前の戸惑いの擬似計測）
  out.push(renderBehaviorMetricsMarkdown(feedbacks));

  out.push(`## 🗣 各ペルソナのナレーション`);
  for (const f of feedbacks) {
    out.push(`### ${f.persona_id} — ${f.outcome}`);
    if (f.narrative) out.push(`> ${f.narrative.replace(/\n/g, '\n> ')}`);
    if (f.score) {
      const reco = f.score.would_recommend === undefined ? '-' : f.score.would_recommend;
      out.push('');
      out.push(`- overall: ${f.score.overall ?? '-'}  /  recommend: ${reco}`);
    }
    out.push('');
  }

  return out.join('\n');
}

/**
 * 統合レポートの構造体を構築する（JSON 文字列化はしない）。
 * diff 計算の input にもなるため、文字列化と分離して round-trip を避ける
 * （PR #17 レビュー指摘 🟡-3）。
 */
function buildReportObject(feedbacks, analysis, diff) {
  const behaviorMetrics = feedbacks.map(fb => {
    const metrics = computeMetrics(fb);
    return {
      persona_id: fb.persona_id,
      metrics,
      mismatch: detectMismatch(fb, metrics),
    };
  });
  return {
    generated_at: new Date().toISOString(),
    target: feedbacks[0]?.target,
    task: feedbacks[0]?.task,
    personas: analysis.personaIds,
    outcome_counts: analysis.outcomeCounts,
    all_agreement: analysis.allAgreement,
    segment_specific: analysis.segmentSpecific,
    controversial: analysis.controversial,
    behavior_metrics: behaviorMetrics,
    ...(diff ? { diff } : {}),
    raw_feedbacks: feedbacks,
  };
}

function toJson(feedbacks, analysis, diff) {
  return JSON.stringify(buildReportObject(feedbacks, analysis, diff), null, 2);
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function resolveBaselinePath(args) {
  if (args.baseline) return resolve(args.baseline);
  if (args.autoBaselineDir) {
    const outputJsonName = args.output
      ? basename(args.output).replace(/\.md$/, '.json')
      : null;
    const currentPath = outputJsonName ? join(resolve(args.autoBaselineDir), outputJsonName) : null;
    const found = findPreviousReport(args.autoBaselineDir, currentPath);
    return found;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.feedbacks.length === 0 || !args.output) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const threshold = args.severityThreshold || 'low';
  if (!(threshold in SEVERITY_RANK)) {
    console.error(`Invalid --severity-threshold: ${threshold} (low|medium|high|critical)`);
    process.exit(1);
  }
  const files = collectFeedbackFiles(args.feedbacks);
  if (files.length === 0) {
    console.error('No feedback JSON files found.');
    process.exit(1);
  }
  const feedbacks = files.map(loadFeedback);
  const analysis = analyze(feedbacks, { minSeverityRank: SEVERITY_RANK[threshold] });

  // baseline 解決 → diff 計算
  let diff = null;
  let diffMarkdown = null;
  const baselinePath = resolveBaselinePath(args);
  if (baselinePath) {
    try {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      // 現行 run の構造体を直接組み立てて diff に渡す（round-trip しない）
      const synthCurrent = buildReportObject(feedbacks, analysis, null);
      diff = diffReports(baseline, synthCurrent);
      diffMarkdown = renderDiffMarkdown(diff);
      console.log(`baseline used: ${baselinePath}`);
    } catch (e) {
      console.error(`[warn] baseline read failed (${baselinePath}): ${e.message}. Continuing without diff.`);
    }
  }

  if (args.format === 'markdown' || args.format === 'both') {
    const md = toMarkdown(feedbacks, analysis, diffMarkdown);
    ensureDir(args.output);
    writeFileSync(args.output, md, 'utf8');
    console.log(`wrote markdown: ${args.output}`);
  }
  if (args.format === 'json' || args.format === 'both') {
    const jsonOut = args.format === 'both'
      ? args.output.replace(/\.md$/, '.json')
      : args.output;
    const j = toJson(feedbacks, analysis, diff);
    ensureDir(jsonOut);
    writeFileSync(jsonOut, j, 'utf8');
    console.log(`wrote json: ${jsonOut}`);
  }
}

main();
