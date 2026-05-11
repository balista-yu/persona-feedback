---
name: persona-tester
description: Use when the user wants to test a web app with synthetic personas.
  Triggers include "test my app with personas", "ペルソナにテストさせて",
  "run persona feedback on <url>". Requires Playwright MCP. Spawns one or more
  persona-runner sub-agents, executes a task in a browser, and returns aggregated
  feedback that highlights cross-persona disagreement.
---

# persona-tester

複数の合成ペルソナをサブエージェントとして並列起動し、Web アプリを実際に操作させ、
構造化フィードバックを集約するスキル。

## 入力

ユーザーから以下を取得する（不足あれば質問）:

- **target** (必須): テスト対象 URL（http(s)://...）
- **personas** (必須): ペルソナ ID のリスト or YAML ファイルパスのリスト
  - 例: `["tanaka-60s", "gal-20s", "dev-engineer"]`
  - 同梱ペルソナは `plugins/persona-feedback/personas/<id>.yaml` から読む
  - ユーザーが独自に作ったペルソナは `personas/<id>.yaml`（cwd 配下）も探す
- **task** (必須): 実行させたいタスクの自然言語記述
  - 例: 「新規登録してプロフィール画像をアップロード」
- **feedback_spec** (任意):
  - `focus`: 配列。`["usability", "bug", "accessibility", "copywriting", "performance", "trust"]` から選択（既定: 全部）
  - `severity_threshold`: `low` | `medium` | `high` | `critical`（既定: `low` — 全て報告）
  - `output_format`: `markdown` | `json` | `both`（既定: `both`）
- **parallel** (任意): boolean（既定: `true`）
- **max_parallel** (任意): 整数（既定: `5`）

## 実行フロー

### 1. 検証フェーズ

- 各ペルソナ YAML をロードし、`schemas/persona.schema.json` でスキーマ検証する
- 検証失敗のペルソナはエラーを表示し、ユーザーに修正を促す
- target URL に Playwright で先にアクセスし、到達可能か確認
- ペルソナ数が `max_parallel` を超える場合、コスト警告を出してユーザーに確認

### 2. 起動フェーズ

ペルソナごとに **Task tool** を呼び出してサブエージェントを起動する。
サブエージェント定義は `agents/persona-runner.md`。

Task 呼び出しのプロンプトには以下をインラインで埋め込む:

```
あなたは persona-runner サブエージェントです。

# あなたのペルソナ（このまま内面化すること）
<persona YAML の全文>

# テスト対象
target: <URL>

# 実行するタスク
<task>

# レポート方針
focus: <focus list>
severity_threshold: <threshold>

# 出力先
screenshots を保存する場合のファイル名プレフィクスは <persona_id>- にしてください。
最終的にfeedback.schema.json 準拠の JSON のみを返してください。
```

`parallel: true` の場合、**同一メッセージ内で複数の Task 呼び出しを並列に発行する**。

### 3. 実行フェーズ（サブエージェント側）

各サブエージェントは `agents/persona-runner.md` の指示に従い:

- `browser_resize` でデバイスに応じたビューポート設定
- `browser_navigate` で target にアクセス
- ペルソナとして「自然に」タスクを試みる
- 行動ログ・スクリーンショット・違和感を記録
- タスク完了 or 諦めポイントで終了
- feedback.schema.json 準拠の JSON を返す

### 4. 集約フェーズ

全サブエージェントの JSON 出力を回収し、`scripts/aggregate.mjs` に渡す。
スクリプトは以下のカテゴリに分類した統合レポートを返す:

- **all-agreement (critical)**: 全員が指摘した問題
- **segment-specific**: 特定ペルソナだけが詰まった箇所
- **controversial**: ペルソナ間で評価が割れた要素

`output_format` に従って Markdown / JSON を生成する。

## 集約スクリプトの呼び出し

```
node plugins/persona-feedback/skills/persona-tester/scripts/aggregate.mjs \
  --feedbacks reports/<timestamp>/raw/*.json \
  --output reports/<timestamp>-report.md \
  --format markdown
```

`--format json` で JSON 出力。`--format both` で両方を生成する。

## 出力先

すべて **ユーザーの cwd 配下** に保存する（プラグインキャッシュではない）:

- Markdown: `reports/<timestamp>-report.md`
- JSON: `reports/<timestamp>-report.json`
- 生フィードバック: `reports/<timestamp>/raw/<persona_id>.json`
- スクリーンショット: `reports/<timestamp>/screenshots/<persona_id>-*.png`

`<timestamp>` は `YYYYMMDD-HHmmss` 形式。

## エラーハンドリング (D-08: partial success)

- 1ペルソナのセッション失敗で全体は止めない
- 失敗ペルソナの理由（タイムアウト / MCP接続失敗 / スキーマ検証失敗 等）を
  レポートの `## Failed Personas` セクションに含める
- 全ペルソナが失敗した場合のみ全体失敗とする

## コスト警告

ペルソナ数 × おおよそのトークン消費を事前に提示する。
`max_parallel` を超える要求があれば、シリアル実行を提案する。

## ユーザーへの確認事項

入力が不足している場合に質問する:

- target URL
- 使うペルソナ（同梱3体でよいか、追加したいか）
- 具体的なタスク（曖昧な「テストして」では実行しない）
- focus 観点
