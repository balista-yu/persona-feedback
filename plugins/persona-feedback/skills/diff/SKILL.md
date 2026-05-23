---
name: diff
description: Use when the user wants to compare two persona-feedback reports
  to see how UX changed between runs. Triggers include "compare reports",
  "UX regression check", "前回との差分", "レポートの diff". Also invokable as
  /persona-feedback:diff [--from a-report.json] [--to b-report.json]. Reads
  aggregate.mjs 出力 JSON 2 つを比較し、ペルソナ別スコア変化 / findings の
  追加・消失 / 行動メトリクス変化を Markdown または JSON で出力する。
---

# diff

UX における Lint。直前の run との差分を一級の出力として提示するスキル。
`/persona-feedback:persona-tester` の単発実行を「変化を追える継続観測」に
昇格させる。

## 入力

- `--from <a-report.json>` (任意): 比較元レポート
- `--to <b-report.json>` (任意): 比較先レポート
- `--reports-dir <dir>` (任意): 指定すると配下の最新2件を from / to に自動採用
- `--format markdown|json` (任意, 既定: `markdown`)
- `--output <file>` (任意): 指定なければ stdout

スラッシュ呼び出しの `$ARGUMENTS` 解釈:
1. 引数なし → カレントの `./reports/` 配下の最新2件を比較
2. `<file>` 1 つ → カレントの `./reports/` から「その1つ前」を自動探索し from とする
3. `<file>` 2 つ → 1つ目を from、2つ目を to

## 呼び出し方

### A. 自然言語

```
前回との差分を見せて
```

メインエージェントは `./reports/` から最新2件を選び diff を生成する。

### B. スラッシュコマンド

```
/persona-feedback:diff
/persona-feedback:diff reports/20260520-100000-report.json reports/20260523-100000-report.json
```

## 実行

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/diff-reports.mjs" \
  --from <a> --to <b> --format markdown --output reports/<ts>-diff.md
```

または:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/diff-reports.mjs" \
  --reports-dir ./reports --format markdown
```

## 出力

Markdown 形式:

- `🔁 変更サマリ (UX Regression)` を見出しに
- ペルソナ別: `score (前 → 今)`, `Δ`, `outcome (前 → 今)` の表
- findings: 追加 / 消失 / 継続件数。追加 / 消失したものは個別にリストで列挙
- 行動メトリクス変化: hesitation_mean / back_or_cancel の前後比較表

JSON 形式は `diff-reports.mjs` の `diffReports()` 戻り値をそのまま出す。

## persona-tester からの自動連携

`/persona-feedback:persona-tester` 実行時、`aggregate.mjs` に
`--auto-baseline-dir ./reports` を渡すと、最新の1つ前のレポートを
baseline として自動採用し、変更サマリセクションを今回のレポート先頭に挿入する。
このフラグは persona-tester SKILL のデフォルト動作（同じ target / task を
継続的に観測しているケース）。

## 比較の粒度

- **ペルソナ別 overall スコア差分**: 0.1 単位
- **outcome 変化**: completed/abandoned/blocked/error の遷移を ⚠️ フラグ付きで強調
- **findings の追加 / 消失**: `category + 正規化 location` をキーにマッチ。
  category だけ一致しても location が違えば別 finding として扱う（誤マージ防止）
- **behavior_metrics 変化**: hesitation_mean / back_or_cancel の前後値

## 制約事項

- aggregate.mjs が生成した `report.json` 形式に依存（`raw_feedbacks` / `behavior_metrics` フィールドが必須）
- 旧フォーマット（v0.1.0 等）の report.json は behavior_metrics セクションが空表示になる
- ペルソナ構成が変わった run 同士の比較は「ペルソナ追加 / 削除」として可視化されるが、findings 差分の意味は薄くなる（同じペルソナで比較するのが本来の用途）
