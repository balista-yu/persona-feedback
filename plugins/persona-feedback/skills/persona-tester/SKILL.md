---
name: persona-tester
description: Use when the user wants to test a web app with synthetic personas.
  Triggers include "test my app with personas", "ペルソナにテストさせて",
  "run persona feedback on <url>". Also invokable as
  /persona-feedback:persona-tester <personas> <url> <task>. Requires Playwright
  MCP. Spawns one or more persona-runner sub-agents, executes a task in a
  browser, and returns aggregated feedback that highlights cross-persona
  disagreement.
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
- **max_parallel** (任意): 整数（既定: `3`。後述のコスト目安に従う）

## 呼び出し方（3 パターン）

### A. 自然言語（推奨・対話的）

```
http://localhost:3000 を tanaka-60s と gal-20s でテストして
新規登録タスク、accessibility 観点で
```

### B. スラッシュコマンド + $ARGUMENTS（短く明示的）

```
/persona-feedback:persona-tester tanaka-60s,gal-20s http://localhost:3000 新規登録してみて
```

`$ARGUMENTS` の解釈ルール:

1. 最初のトークン（空白で区切られた1単位）が **カンマ区切りのペルソナ ID リスト**
2. 次の URL に見える要素が **target**（`http://` または `https://` を含むトークン）
3. それ以外の残りが **task** の自然言語記述

例:

| $ARGUMENTS | personas | target | task |
|---|---|---|---|
| `tanaka-60s http://x.test 登録` | `[tanaka-60s]` | `http://x.test` | `登録` |
| `tanaka-60s,dev-engineer http://x.test 価格表を見て検討` | `[tanaka-60s, dev-engineer]` | `http://x.test` | `価格表を見て検討` |
| `all http://x.test 探索` | `(personas-list の全 ID)` | `http://x.test` | `探索` |

特別な値:
- `all` → cwd と同梱のすべてのペルソナ
- `bundled` → 同梱 3 体のみ（`tanaka-60s, gal-20s, dev-engineer`）
- `user` → cwd 配下のユーザー定義ペルソナのみ

### C. ペルソナ未指定（対話モード）

ユーザーが target と task だけ伝え、ペルソナを指定しなかった場合:

1. まず `personas-list` スキル相当の処理で利用可能ペルソナ一覧を提示する
   （`node "${CLAUDE_PLUGIN_ROOT}/scripts/list-personas.mjs"` を実行）
2. `AskUserQuestion` で **複数選択可能** なリストを提示
3. 選ばれたペルソナで起動に進む

「とりあえずテストして」のような曖昧な指示でも詰まらないようにする。
ただし target と task は省略不可（不足あれば追加で質問）。


## コスト目安

実測値（Opus 4.7 + Playwright MCP + 中規模 Next.js サインアップフロー）:

| 指標 | ペルソナ1体あたり |
|---|---|
| トークン消費 | 約 40k〜60k tokens |
| 実時間 | 2〜4 分 |
| MCP ツール呼び出し | 30〜50 回 |

スコープが広い（探索的なタスク・複数画面遷移）と倍に振れることがある。
3 ペルソナ並列 ≈ 130k+ tokens / 4 分強 が一つの目安。

`max_parallel` の既定を 3 にしている理由はここ。4 体以上を要求された場合、
**メインエージェントは見積もりトークン数と所要時間をユーザーに提示してから**
起動する。具体的には:

> 4 ペルソナ並列で実行します。概算 ~200k tokens、5 分前後。続行しますか？

を起動前に出す。承認なしには走らせない。

## 実行フロー

### 1. 検証フェーズ

- 各ペルソナ YAML をロードし、`schemas/persona.schema.json` でスキーマ検証する
- 検証失敗のペルソナはエラーを表示し、ユーザーに修正を促す
- `behavior_rules` が構造化 DSL（オブジェクト型）の場合は
  `scripts/behavior-rules.mjs render <persona.yaml>` で自然文制約のリストに展開しておく。
  legacy の配列型はそのまま使う。
- target URL に Playwright で先にアクセスし、到達可能か確認
- ペルソナ数が `max_parallel` を超える場合、コスト警告を出してユーザーに確認

### 2. 起動フェーズ

ペルソナごとに **Task tool** を呼び出してサブエージェントを起動する。
サブエージェント定義は `agents/persona-runner.md`。

起動前にメインエージェントは **run timestamp** を1つ確定する（例:
`20260511-100000`）。これは全ペルソナで共有し、`.persona-feedback/<timestamp>/...` の
中間物ディレクトリと `reports/<timestamp>-report.{md,json}` の最終レポート
ファイル名を一致させる。

Task 呼び出しのプロンプトには以下をインラインで埋め込む:

```
あなたは persona-runner サブエージェントです。

# あなたのペルソナ（このまま内面化すること）
<persona YAML の全文>

# 守るべき制約（behavior_rules の展開結果。これは絶対）
<behavior-rules.mjs render の出力をそのまま貼り付け>

# テスト対象
target: <URL>

# 実行するタスク
<task>

# レポート方針
focus: <focus list>
severity_threshold: <threshold>

# スクリーンショット保存先（MCP の --output-dir からの相対パス）
screenshot_dir: <timestamp>/screenshots/
ファイル名は <persona_id>-<連番>-<短い説明>.png 形式で
browser_take_screenshot の filename に「screenshot_dir + ファイル名」を渡してください。

# 出力契約
findings の screenshot フィールドには上記の相対パスをそのまま記録すること。
最終メッセージは feedback.schema.json 準拠の JSON のみを返してください。
```

`behavior_rules` が legacy 配列型なら配列要素をそのまま `- ` 付きで貼る。
構造化 DSL（オブジェクト型）なら `behavior-rules.mjs render` の出力
（既に `- ` 付きの自然文リスト）をそのまま貼る。これにより persona-runner は
DSL/legacy のどちらでも同じ形式の制約リストを受け取ることになり、内部の
扱いが分岐しない。

`parallel: true` の場合、**同一メッセージ内で複数の Task 呼び出しを並列に発行する**。
`.mcp.json` の `--isolated` フラグにより、ペルソナごとに別ブラウザコンテキスト
（別 Cookie/別 localStorage）が割り当てられるため、入力が他人に書き換わる
ような干渉は発生しない。

### 3. 実行フェーズ（サブエージェント側）

各サブエージェントは `agents/persona-runner.md` の指示に従い:

- `browser_resize` でデバイスに応じたビューポート設定
- `browser_navigate` で target にアクセス
- ペルソナとして「自然に」タスクを試みる
- 行動ログ・スクリーンショット・違和感を記録
- タスク完了 or 諦めポイントで終了
- feedback.schema.json 準拠の JSON を返す

### 4. 回収＆永続化フェーズ（責務はメインエージェント）

各 Task 呼び出しの戻り値は persona-runner が返した「最終メッセージ全文」である。
**メインエージェント（このスキルを実行している側）は同梱の `save-raw.mjs` を
ペルソナごとに1回呼ぶだけ**でよい:

```
node plugins/persona-feedback/skills/persona-tester/scripts/save-raw.mjs \
  --persona-id <persona_id> \
  --timestamp <timestamp> \
  --raw-file <persona-runner の戻り値を書き出した一時ファイル> \
  [--reports-dir ./.persona-feedback]
```

stdin から渡したい場合は `--raw-file -` を指定。
`--reports-dir` は既定で `./.persona-feedback` （中間物の隠しディレクトリ）。

このスクリプトは:
1. 戻り値文字列から JSON 本体を抽出（コードフェンス / 裸 JSON どちらにも対応）
2. 必須フィールド (`persona_id` / `target` / `task` / `outcome` / `findings`) の存在確認
3. `.persona-feedback/<timestamp>/raw/<persona_id>.json` に整形して保存

を一度に行う。

終了コード:
- `0` 保存成功
- `2` JSON 抽出失敗 → そのペルソナは「失敗ペルソナ」扱い (partial success)
- `3` 必須フィールド欠落 → 同上

非ゼロ終了したペルソナは集約レポートの「Failed Personas」セクションに
理由付きで記載すること。

persona-runner 側には **Write 権限を渡さない**。サブエージェントが意図せずホスト側
ファイルを書き換えるリスクを抑え、責務を「JSON を返すだけ」に閉じる。

### 5. 集約フェーズ

`scripts/aggregate.mjs` に raw ディレクトリを渡して統合レポートを生成する:

- **all-agreement (critical)**: 全員が指摘した問題
- **segment-specific**: 特定ペルソナだけが詰まった箇所
- **controversial**: ペルソナ間で評価が割れた要素

`output_format` に従って Markdown / JSON を生成する。

## 集約スクリプトの呼び出し

```
node plugins/persona-feedback/skills/persona-tester/scripts/aggregate.mjs \
  --feedbacks .persona-feedback/<timestamp>/raw \
  --output reports/<timestamp>-report.md \
  --format markdown
```

入力（中間物）は隠しディレクトリ `.persona-feedback/`、
出力（最終レポート）は可視ディレクトリ `reports/` という分離。

`--format json` で JSON 出力。`--format both` で両方を生成する。

## 出力先

すべて **ユーザーの cwd 配下** に保存する（プラグインキャッシュではない）。
**最終レポートと中間物を分離**するのがこのプラグインの規約:

### 最終レポート（可視・残す）— `reports/`

- Markdown: `reports/<timestamp>-report.md`
- JSON: `reports/<timestamp>-report.json`

### 中間物（隠し・捨てる前提）— `.persona-feedback/`

- 生フィードバック: `.persona-feedback/<timestamp>/raw/<persona_id>.json`
- スクリーンショット: `.persona-feedback/<timestamp>/screenshots/<persona_id>-*.png`

`.persona-feedback/` は `.gitignore` 済み。`/persona-feedback:clean` スキルで
一括削除可能。`<timestamp>` は `YYYYMMDD-HHmmss` 形式で、最終レポートと
中間物で同じ値を使い対応付ける。

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
