#!/usr/bin/env node
/**
 * behavior-rules.mjs
 *
 * persona.behavior_rules の構造化 DSL（能力減算プリミティブ）を、
 * persona-runner サブエージェントが従う自然文の制約リストに展開する。
 *
 * 入力形式は2通り (persona.schema.json の oneOf):
 *   1. legacy: string[] — そのまま返す
 *   2. structured DSL: object — 各キーを自然文に展開
 *
 * Usage:
 *   - CLI:   node behavior-rules.mjs render <persona.yaml>
 *            → 展開後の自然文制約を1行1ルールで stdout に出す
 *   - module: import { renderBehaviorRules, expandStructured } from '...';
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const PANIC_ON_TEMPLATES = {
  english_in_error: '英語のエラーメッセージが出たらパニックになり、操作を止めて離脱を検討する',
  modal_dialog_unexpected: '予期せぬモーダル・ポップアップが出たら「広告かも」と疑い即座に閉じる',
  permission_request: 'ブラウザの権限要求（通知・位置情報など）が出たら警戒して拒否する',
  credit_card_request: 'クレジットカード情報の入力欄が出たら一旦立ち止まり、運営者情報や安全性を確認する',
  password_request: 'パスワード入力欄が出たら慎重になり、サイトの信頼性を確認するまで入力しない',
  popup_ad: '広告らしきポップアップが出たら反射的に閉じる',
  unexpected_redirect: '予期せぬ外部サイトへのリダイレクトが起きたら不審に思い戻る',
};

const READING_SPEED_TEMPLATES = {
  slow: 'テキストを読むのが遅い。長文は最初の数語だけ拾って判断する',
  normal: 'テキストは普通の速度で読むが、長すぎる説明文は飛ばす',
  fast: 'テキストはざっと斜め読みする。詳細は把握しない',
};

const ON_AMBIGUOUS_BUTTON_TEMPLATES = {
  ask_or_skip: '意味が不明なボタンは賢く推測せず、スキップするか「分からない」と表明する',
  infer_safely: '意味が不明なボタンでも安全そうなら試すが、破壊的操作は避ける',
  tap_anyway: '意味が不明なボタンでもとりあえずタップして様子を見る',
};

/**
 * "2_retries" / "30s" / "1min" のような give_up_after 値を自然文に変換する。
 */
function renderGiveUpAfter(value) {
  const v = String(value).trim();
  let m;
  if ((m = v.match(/^(\d+)_(retries|attempts|errors)$/))) {
    const count = m[1];
    const kindMap = { retries: '回リトライ', attempts: '回試行', errors: '回エラー' };
    return `同じ操作で${count}${kindMap[m[2]]}したら諦めてタスクを中断する`;
  }
  if ((m = v.match(/^(\d+)(ms|s|min)$/))) {
    const num = m[1];
    const unitMap = { ms: 'ミリ秒', s: '秒', min: '分' };
    return `画面の応答や読み込みに${num}${unitMap[m[2]]}以上かかったら諦めて離脱を検討する`;
  }
  return `次の条件で諦める: ${v}`;
}

function renderAttentionSpan(value) {
  const v = String(value).trim();
  const m = v.match(/^(\d+)(ms|s|min)$/);
  if (m) {
    const unitMap = { ms: 'ミリ秒', s: '秒', min: '分' };
    return `集中力が続くのは最大${m[1]}${unitMap[m[2]]}。それを超える操作になると注意が散漫になり、確認をスキップし始める`;
  }
  return `集中力の限界: ${v}`;
}

function renderLexicalConstraint(lex) {
  const out = [];
  if (lex.block_jargon === true) {
    out.push('専門用語・カタカナ語に遭遇したら推測せず「分からない」と表明する。賢く意味を補完してはいけない');
  }
  if (Array.isArray(lex.confused_by) && lex.confused_by.length > 0) {
    out.push(
      `次の語に遭遇したら混乱・困惑する（意味を推測しない）: ${lex.confused_by.join(' / ')}`
    );
  }
  return out;
}

/**
 * 構造化 DSL（オブジェクト）を自然文制約の配列に展開する。
 * キーの順序は出力でも保たれる（出力順 = give_up_after → panic_on → lexical →
 * attention_span → reading_speed → on_ambiguous_button → custom）。
 */
export function expandStructured(dsl) {
  if (!dsl || typeof dsl !== 'object' || Array.isArray(dsl)) {
    throw new TypeError('expandStructured: expected a non-null object');
  }
  const lines = [];

  if ('give_up_after' in dsl) {
    lines.push(renderGiveUpAfter(dsl.give_up_after));
  }

  if (Array.isArray(dsl.panic_on)) {
    for (const key of dsl.panic_on) {
      const tmpl = PANIC_ON_TEMPLATES[key];
      if (tmpl) {
        lines.push(tmpl);
      } else {
        lines.push(`次の事象に遭遇したらパニックになる: ${key}`);
      }
    }
  }

  if (dsl.lexical && typeof dsl.lexical === 'object') {
    lines.push(...renderLexicalConstraint(dsl.lexical));
  }

  if ('attention_span' in dsl) {
    lines.push(renderAttentionSpan(dsl.attention_span));
  }

  if ('reading_speed' in dsl) {
    const tmpl = READING_SPEED_TEMPLATES[dsl.reading_speed];
    if (tmpl) {
      lines.push(tmpl);
    } else {
      lines.push(`読書速度: ${dsl.reading_speed}`);
    }
  }

  if ('on_ambiguous_button' in dsl) {
    const tmpl = ON_AMBIGUOUS_BUTTON_TEMPLATES[dsl.on_ambiguous_button];
    if (tmpl) {
      lines.push(tmpl);
    } else {
      lines.push(`曖昧なボタンへの態度: ${dsl.on_ambiguous_button}`);
    }
  }

  if (Array.isArray(dsl.custom)) {
    for (const rule of dsl.custom) {
      if (typeof rule === 'string' && rule.trim()) lines.push(rule.trim());
    }
  }

  return lines;
}

/**
 * persona.behavior_rules を自然文制約のフラットな配列に正規化する。
 *
 * - legacy 配列形式 → そのまま
 * - 構造化 DSL → expandStructured で展開
 * - undefined / null → 例外
 */
export function renderBehaviorRules(behaviorRules) {
  if (behaviorRules == null) {
    throw new TypeError('renderBehaviorRules: behavior_rules is required');
  }
  if (Array.isArray(behaviorRules)) {
    return behaviorRules.map(r => String(r));
  }
  if (typeof behaviorRules === 'object') {
    return expandStructured(behaviorRules);
  }
  throw new TypeError(
    `renderBehaviorRules: unsupported behavior_rules type: ${typeof behaviorRules}`
  );
}

function cliMain(argv) {
  const cmd = argv[2];
  if (!cmd || cmd === '-h' || cmd === '--help') {
    console.log('Usage: behavior-rules.mjs render <persona.yaml>');
    process.exit(cmd ? 0 : 1);
  }
  if (cmd !== 'render') {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
  const personaPath = argv[3];
  if (!personaPath) {
    console.error('render requires a persona YAML path');
    process.exit(1);
  }
  const persona = parseYaml(readFileSync(resolve(personaPath), 'utf8'));
  const lines = renderBehaviorRules(persona.behavior_rules);
  for (const line of lines) process.stdout.write(`- ${line}\n`);
}

const isCli = import.meta.url === `file://${process.argv[1]}`;
if (isCli) cliMain(process.argv);
