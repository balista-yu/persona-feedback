#!/usr/bin/env node
/**
 * behavior-metrics.mjs
 *
 * persona-runner が記録した feedback.action_log から、ペルソナの「言語化以前の
 * 戸惑い」を擬似計測する。LLM は何でも言葉にしてしまうため、score / narrative が
 * 「分かりやすかった」と言いつつ実際は迷っていたケースを検出できない構造的限界が
 * ある。行動メトリクスはその欠落を埋めるための補助シグナル。
 *
 * 計測項目（issue #13 の仕様を Playwright MCP の制約に合わせて解釈）:
 *   - hesitation_seconds_mean: 同一画面で snapshot → 次の意味ある操作までの平均秒数
 *     （LLM が「次にどれを押すか」考えた時間の代理指標）
 *   - scroll_back_and_forth: 同一画面でのスクロール往復回数
 *   - back_or_cancel_count: 戻る／キャンセル操作の総数
 *   - time_on_screen_seconds: location ごとの滞在時間
 *
 * Hover 滞留時間は現行 Playwright MCP ツール群（browser_click / browser_snapshot 等）
 * では取れないため計測対象外。将来 Playwright トレース統合で対応する余地あり。
 *
 * 言語フィードバックとの食い違い検出ヒューリスティクス:
 *   - score.overall >= 7（好評価）かつ 以下のいずれか → "言葉と行動の食い違い" 赤フラグ
 *     - hesitation_seconds_mean >= 5
 *     - back_or_cancel_count >= 3
 *     - scroll_back_and_forth >= 4
 *   - outcome=completed でも上記の行動シグナルが出ていれば flag
 *
 * Module exports: computeMetrics(feedback), detectMismatch(feedback, metrics)
 */

const HESITATION_TRIGGERS = new Set(['snapshot']);
const MEANINGFUL_ACTIONS = new Set([
  'click', 'type', 'select', 'press_key', 'scroll', 'back', 'cancel'
]);
const BACK_OR_CANCEL = new Set(['back', 'cancel']);

/**
 * action_log の整合性を軽くチェックして、不正なエントリは捨てる。
 * 厳密検証はスキーマ側に任せ、ここは計算時の堅牢性のための fallback。
 */
function sanitizeLog(log) {
  if (!Array.isArray(log)) return [];
  return log
    .filter(e => e && typeof e === 'object' && typeof e.at_seconds === 'number' && typeof e.action === 'string')
    .sort((a, b) => a.at_seconds - b.at_seconds);
}

/**
 * Hesitation = snapshot 後、次に意味ある操作（click / type / select 等）が
 * 起きるまでの秒数。LLM が画面を読んで判断する時間の代理。
 * 連続 snapshot は最新だけ採用（リトライ snapshot で時間が膨らむのを避ける）。
 */
function computeHesitations(log) {
  const out = [];
  let pendingSnapshotAt = null;
  for (const e of log) {
    if (HESITATION_TRIGGERS.has(e.action)) {
      pendingSnapshotAt = e.at_seconds;
      continue;
    }
    if (pendingSnapshotAt !== null && MEANINGFUL_ACTIONS.has(e.action)) {
      out.push(Math.max(0, e.at_seconds - pendingSnapshotAt));
      pendingSnapshotAt = null;
    }
  }
  return out;
}

/**
 * スクロール往復回数 = 同一画面で連続する scroll の数 - 1 を画面ごとに合算。
 * location が欠けている場合は単一バケットで集計。
 */
function computeScrollBackAndForth(log) {
  let total = 0;
  let runLength = 0;
  let prevLocation = null;
  for (const e of log) {
    if (e.action === 'scroll' && e.location === prevLocation) {
      runLength++;
    } else {
      if (runLength >= 2) total += (runLength - 1);
      runLength = e.action === 'scroll' ? 1 : 0;
      prevLocation = e.location;
    }
  }
  if (runLength >= 2) total += (runLength - 1);
  return total;
}

function computeBackOrCancelCount(log) {
  return log.reduce((n, e) => n + (BACK_OR_CANCEL.has(e.action) ? 1 : 0), 0);
}

/**
 * 画面ごとの滞在時間。location 遷移までの差分を集計。
 * 最後の画面は action_log 末尾の at_seconds が終了時刻と仮定。
 */
function computeTimeOnScreen(log) {
  const totals = new Map();
  if (log.length === 0) return {};
  let currentLoc = log[0].location || '(unknown)';
  let segmentStart = log[0].at_seconds;
  for (let i = 1; i < log.length; i++) {
    const loc = log[i].location || currentLoc;
    if (loc !== currentLoc) {
      totals.set(currentLoc, (totals.get(currentLoc) || 0) + (log[i].at_seconds - segmentStart));
      currentLoc = loc;
      segmentStart = log[i].at_seconds;
    }
  }
  totals.set(currentLoc, (totals.get(currentLoc) || 0) + (log[log.length - 1].at_seconds - segmentStart));
  const out = {};
  for (const [k, v] of totals.entries()) out[k] = Number(v.toFixed(2));
  return out;
}

function mean(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function computeMetrics(feedback) {
  const log = sanitizeLog(feedback.action_log);
  const hesitations = computeHesitations(log);
  const meanH = mean(hesitations);
  return {
    sample_count: log.length,
    hesitation_seconds_mean: meanH === null ? null : Number(meanH.toFixed(2)),
    hesitation_seconds_max: hesitations.length > 0 ? Number(Math.max(...hesitations).toFixed(2)) : null,
    scroll_back_and_forth: computeScrollBackAndForth(log),
    back_or_cancel_count: computeBackOrCancelCount(log),
    time_on_screen_seconds: computeTimeOnScreen(log),
  };
}

/**
 * 言語フィードバックと行動メトリクスの食い違いを検出する。
 * 「好評価なのに迷ってる」「諦めてないのに頻繁に戻ってる」を赤フラグにする。
 * 食い違いが無い場合は null を返す。
 */
export function detectMismatch(feedback, metrics) {
  const reasons = [];
  const overall = feedback.score?.overall;
  const positive = typeof overall === 'number' && overall >= 7;
  const completed = feedback.outcome === 'completed';

  if ((positive || completed) && metrics.hesitation_seconds_mean !== null && metrics.hesitation_seconds_mean >= 5) {
    reasons.push(`hesitation_seconds_mean=${metrics.hesitation_seconds_mean}s (>= 5s): 言葉では好評価／完走だが、画面を読んで次の操作を決めるまでに時間がかかっている`);
  }
  if ((positive || completed) && metrics.back_or_cancel_count >= 3) {
    reasons.push(`back_or_cancel_count=${metrics.back_or_cancel_count} (>= 3): 言葉では好評価／完走だが、戻る/キャンセル操作が多い`);
  }
  if ((positive || completed) && metrics.scroll_back_and_forth >= 4) {
    reasons.push(`scroll_back_and_forth=${metrics.scroll_back_and_forth} (>= 4): 言葉では好評価／完走だが、画面内でスクロールを往復している`);
  }

  if (reasons.length === 0) return null;
  return {
    persona_id: feedback.persona_id,
    overall: overall ?? null,
    outcome: feedback.outcome,
    reasons,
  };
}

/**
 * Markdown セクション断片を生成する。aggregate.mjs から呼ばれる前提。
 */
export function renderSectionMarkdown(feedbacks) {
  const lines = ['## 🧭 行動メトリクス (behavior_metrics)'];
  const enriched = feedbacks.map(fb => ({ fb, metrics: computeMetrics(fb) }));
  const hasAny = enriched.some(({ metrics }) => metrics.sample_count > 0);
  if (!hasAny) {
    lines.push('action_log が記録されていない（または空）。persona-runner 側で記録を有効にすると、言語化以前の戸惑いを擬似計測できる。');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('| persona | hesitation_mean (s) | hesitation_max (s) | scroll_back_and_forth | back_or_cancel | sample |');
  lines.push('|---|---|---|---|---|---|');
  for (const { fb, metrics } of enriched) {
    lines.push(
      `| ${fb.persona_id}` +
      ` | ${metrics.hesitation_seconds_mean ?? '-'}` +
      ` | ${metrics.hesitation_seconds_max ?? '-'}` +
      ` | ${metrics.scroll_back_and_forth}` +
      ` | ${metrics.back_or_cancel_count}` +
      ` | ${metrics.sample_count} |`
    );
  }
  lines.push('');

  const mismatches = enriched
    .map(({ fb, metrics }) => detectMismatch(fb, metrics))
    .filter(x => x !== null);

  lines.push('### 🚩 言葉と行動の食い違い');
  if (mismatches.length === 0) {
    lines.push('該当なし。言語フィードバックと行動シグナルは整合している。');
  } else {
    for (const m of mismatches) {
      lines.push(`- **${m.persona_id}** (overall=${m.overall ?? '-'}, outcome=${m.outcome})`);
      for (const r of m.reasons) lines.push(`  - ${r}`);
    }
  }
  lines.push('');

  // time_on_screen は冗長なので折りたたみ
  lines.push('<details><summary>画面ごとの滞在時間</summary>');
  lines.push('');
  for (const { fb, metrics } of enriched) {
    if (metrics.sample_count === 0) continue;
    lines.push(`#### ${fb.persona_id}`);
    const entries = Object.entries(metrics.time_on_screen_seconds);
    if (entries.length === 0) {
      lines.push('(画面遷移なし)');
    } else {
      for (const [loc, sec] of entries) lines.push(`- ${loc || '(unknown)'}: ${sec}s`);
    }
    lines.push('');
  }
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}
