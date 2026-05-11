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
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    `Usage: aggregate.mjs --feedbacks <path> [<path> ...] --output <file> [--format markdown|json|both]\n` +
    `\n` +
    `<path> はいずれでも可:\n` +
    `  - 単一の JSON ファイル\n` +
    `  - ディレクトリ（配下の *.json を全部）\n` +
    `  - "<dir>/*.json" 形式の glob（シェル未展開で渡された場合）\n` +
    `\n` +
    `--feedbacks は複数の値を取れる。例:\n` +
    `  aggregate.mjs --feedbacks raw/tanaka.json raw/gal.json raw/dev.json --output r.md`
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

/**
 * location を粗く正規化する。日本語/英語混在、表記揺れに弱いので
 * 完全一致を諦め、目立つ語だけ拾える形にする。
 */
function normalizeLocation(loc) {
  if (!loc) return '';
  return String(loc)
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/["'`「」『』]/g, '')
    .replace(/[、。,;.!?！？:：]/g, '');
}

/**
 * 不一致分析:
 * - all-agreement: 全ペルソナが同じ問題を指摘
 *   - primary: category + 正規化 location が一致
 *   - secondary: location が表現揺れで一致しない場合でも、
 *     category 単独で全員が severity >= high の finding を持っていれば拾う
 * - segment-specific: 1〜(N-1)体だけが指摘（medium 以上）
 * - controversial: スコアの分散が大きい / 推薦意向が割れた
 */
function analyze(feedbacks) {
  const personaIds = feedbacks.map(f => f.persona_id);
  const N = personaIds.length;

  // primary: category × 正規化 location でまとめる
  const groups = new Map();
  for (const fb of feedbacks) {
    for (const find of fb.findings) {
      const key = `${find.category}::${normalizeLocation(find.location)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ persona_id: fb.persona_id, ...find });
    }
  }

  const allAgreement = [];
  const segmentSpecific = [];
  const claimedFindings = new Set(); // primary で all-agreement 入りした finding を覚える

  for (const [key, items] of groups.entries()) {
    const personas = new Set(items.map(i => i.persona_id));
    const maxSev = items.reduce((m, i) => Math.max(m, SEVERITY_RANK[i.severity] || 0), 0);
    if (personas.size >= N && N >= 2) {
      allAgreement.push({ key, items, max_severity_rank: maxSev, source: 'location-match' });
      for (const it of items) claimedFindings.add(it);
    } else if (personas.size >= 1 && personas.size < N) {
      if (maxSev >= 2) segmentSpecific.push({ key, items, max_severity_rank: maxSev });
    }
  }

  // secondary: location 表現揺れ救済。
  // category 単独で「全ペルソナが severity >= high の finding を持っている」場合は
  // 別グループとして all-agreement に加える（location は混合表示）。
  if (N >= 2) {
    const byCategory = new Map();
    for (const fb of feedbacks) {
      for (const find of fb.findings) {
        if ((SEVERITY_RANK[find.severity] || 0) < 3) continue; // high 以上のみ
        if (!byCategory.has(find.category)) byCategory.set(find.category, []);
        byCategory.get(find.category).push({ persona_id: fb.persona_id, ...find });
      }
    }
    for (const [category, items] of byCategory.entries()) {
      const personas = new Set(items.map(i => i.persona_id));
      if (personas.size < N) continue;
      // primary で同じ items を既に all-agreement 入りさせていたらスキップ
      const allClaimed = items.every(it => claimedFindings.has(it));
      if (allClaimed) continue;
      const maxSev = items.reduce((m, i) => Math.max(m, SEVERITY_RANK[i.severity] || 0), 0);
      allAgreement.push({
        key: `${category}::*location-varied*`,
        items,
        max_severity_rank: maxSev,
        source: 'category-only',
      });
      // location 表現揺れで segment-specific に重複登録されているグループを整理
      for (let i = segmentSpecific.length - 1; i >= 0; i--) {
        const seg = segmentSpecific[i];
        const [segCat] = seg.key.split('::');
        if (segCat === category && seg.items.every(it => items.includes(it))) {
          segmentSpecific.splice(i, 1);
        }
      }
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
  if (item.location) lines.push(`  - location: ${item.location}`);
  if (item.suggestion) lines.push(`  - 💡 ${item.suggestion}`);
  if (item.screenshot) lines.push(`  - 📸 ${item.screenshot}`);
  return lines.join('\n');
}

function toMarkdown(feedbacks, analysis) {
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

  out.push(`## Outcome 集計`);
  for (const [k, v] of Object.entries(outcomeCounts)) {
    out.push(`- ${k}: ${v}`);
  }
  out.push('');

  out.push(`## 🚨 全員指摘 (all-agreement)`);
  if (allAgreement.length === 0) {
    out.push('該当なし（または検出可能なペルソナが1体）。');
  } else {
    for (const g of allAgreement) {
      const [cat] = g.key.split('::');
      const suffix = g.source === 'category-only'
        ? ' _(高重要度のカテゴリ一致。location 表現がペルソナ間で揺れている)_'
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

function toJson(feedbacks, analysis) {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    target: feedbacks[0]?.target,
    task: feedbacks[0]?.task,
    personas: analysis.personaIds,
    outcome_counts: analysis.outcomeCounts,
    all_agreement: analysis.allAgreement,
    segment_specific: analysis.segmentSpecific,
    controversial: analysis.controversial,
    raw_feedbacks: feedbacks
  }, null, 2);
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.feedbacks.length === 0 || !args.output) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const files = collectFeedbackFiles(args.feedbacks);
  if (files.length === 0) {
    console.error('No feedback JSON files found.');
    process.exit(1);
  }
  const feedbacks = files.map(loadFeedback);
  const analysis = analyze(feedbacks);

  if (args.format === 'markdown' || args.format === 'both') {
    const md = toMarkdown(feedbacks, analysis);
    ensureDir(args.output);
    writeFileSync(args.output, md, 'utf8');
    console.log(`wrote markdown: ${args.output}`);
  }
  if (args.format === 'json' || args.format === 'both') {
    const jsonOut = args.format === 'both'
      ? args.output.replace(/\.md$/, '.json')
      : args.output;
    const j = toJson(feedbacks, analysis);
    ensureDir(jsonOut);
    writeFileSync(jsonOut, j, 'utf8');
    console.log(`wrote json: ${jsonOut}`);
  }
}

main();
