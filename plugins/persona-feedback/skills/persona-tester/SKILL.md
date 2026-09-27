---
name: persona-tester
description: Use when the user wants to test a web app with synthetic personas.
  Triggers include "test my app with personas", "ペルソナにテストさせて",
  "run persona feedback on <url>". Also invokable as
  /persona-feedback:persona-tester <personas> <url> <task>. Uses Playwright CLI
  (via npx) with one isolated browser session per persona. Spawns one or more
  persona-runner sub-agents, executes a task in a browser, and returns
  aggregated feedback that highlights cross-persona disagreement.
---

# persona-tester

複数の合成ペルソナをサブエージェントとして並列起動し、Web アプリを実際に操作させ、
構造化フィードバックを集約するスキル。

## ブラウザ操作の前提

ブラウザは Playwright CLI の名前付きセッションで動かす。以降 `<cli>` と書いたら
次のコマンドを指す（バージョン固定。runner にも同じ文字列を渡す）:

```
npx -y @playwright/cli@0.1.21
```

- セッション名は `<timestamp>-<persona_id>`。セッションごとに別プロセス・別ブラウザ
  （Cookie / Storage / タブが独立）なので、並列に走らせても干渉しない
- セッションの `open` / `resize` / `close` はメインエージェントだけが行う。
  runner は開いたセッションを操作するだけ
- Playwright MCP はサブエージェントと接続を共有するため、ペルソナごとに分離できない。
  そのためこのスキルでは使わない

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
- `bundled` → `${CLAUDE_PLUGIN_ROOT}/personas/` 配下の同梱ペルソナすべて
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

実測値（Opus 4.7 + Playwright MCP + 中規模 Next.js サインアップフロー）。
Playwright CLI に移行してからは未計測なので、目安として扱う:

| 指標 | ペルソナ1体あたり |
|---|---|
| トークン消費 | 約 40k〜60k tokens |
| 実時間 | 2〜4 分 |
| ブラウザ操作 | 30〜50 回 |

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
  `node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/behavior-rules.mjs" render <persona.yaml>`
  で自然文制約のリストに展開しておく。
  legacy の配列型はそのまま使う。
- ブラウザが使えるか確かめる。`<cli> -s=persona-feedback-check open <target> --browser=chromium`
  を実行し、到達できたら `<cli> -s=persona-feedback-check close` で閉じる
  - `is not installed` を含むエラーなら、ブラウザが未インストール。エラーに書かれた
    `install-browser` コマンドをユーザーに案内し、承認を得てから実行する
  - `### Error` で到達できなければ target の URL をユーザーに確認する
- ペルソナ数が `max_parallel` を超える場合、コスト警告を出してユーザーに確認

### 2. 起動フェーズ

ペルソナごとに **Task tool** を呼び出してサブエージェントを起動する。
サブエージェント定義は `agents/persona-runner.md`。

起動前にメインエージェントは **run timestamp** を1つ確定する（例:
`20260511-100000`）。これは全ペルソナで共有し、`.persona-feedback/<timestamp>/...` の
中間物ディレクトリと `reports/<timestamp>-report.{md,json}` の最終レポート
ファイル名を一致させる。

runner を起動する前に、ペルソナごとにブラウザセッションを開く:

```
PLAYWRIGHT_MCP_OUTPUT_DIR=.persona-feedback/<timestamp>/cli/<persona_id> \
  <cli> -s=<timestamp>-<persona_id> open <target> --browser=chromium
<cli> -s=<timestamp>-<persona_id> resize <width> <height>
<cli> -s=<timestamp>-<persona_id> tracing-start
```

- `PLAYWRIGHT_MCP_OUTPUT_DIR` は `open` のときに一度渡せば、そのセッションが書く
  スナップショットファイルの置き場所になる。渡さないと cwd に `.playwright-cli/` ができる
- ビューポートは `context.device` に合わせる: mobile 375x812 / tablet 768x1024 /
  desktop 1280x800
- `tracing-start` は action_log に実測の時刻を入れるためのトレース記録。runner は現在時刻を
  取れないので秒数を書かせず、回収時にトレースから書き込む（4. 回収フェーズ）
- `open` に失敗したペルソナは runner を起動せず、失敗ペルソナとして扱う

Task 呼び出しのプロンプトには以下をインラインで埋め込む:

```
あなたは persona-runner サブエージェントです。

# あなたのペルソナ（このまま内面化すること）
<persona YAML の全文。ただし behavior_rules は下記の展開済み制約に置換すること>

# 守るべき制約（behavior_rules の展開結果。これは絶対）
<behavior-rules.mjs render の出力をそのまま貼り付け>

# テスト対象
target: <URL>

# 実行するタスク
<task>

# レポート方針
focus: <focus list>
severity_threshold: <threshold>

# ブラウザ（target を開いた状態で用意済み）
cli: npx -y @playwright/cli@0.1.21
session: <timestamp>-<persona_id>
操作は `<cli> -s=<session> <command>` の形だけで行うこと。open / close / resize はしない。

# スクリーンショット保存先（cwd 基準のパス）
screenshot_dir: .persona-feedback/<timestamp>/screenshots/
ファイル名は <persona_id>-<連番>-<短い説明>.png 形式で
`screenshot --filename=<screenshot_dir + ファイル名>` を実行してください。

# 出力契約
findings の screenshot フィールドには上記の相対パスをそのまま記録すること。
最終メッセージは feedback.schema.json 準拠の JSON のみを返してください。
```

#### `behavior_rules` の inject ルール（重要）

runner が DSL を独自解釈し直す誘惑を残さないため、**YAML 内の `behavior_rules`
は展開済みの自然文リストで置換して** 貼り付ける。具体的には:

- **legacy 配列型**: 配列要素をそのまま `- ` 付きで貼る。YAML をそのまま渡してもよい
- **構造化 DSL（オブジェクト型）**: YAML から `behavior_rules:` ブロックを削除し、
  代わりに `behavior-rules.mjs render` の出力（既に `- ` 付きの自然文リスト）を
  `behavior_rules:` の位置に貼る。DSL の生形式は runner に見せない

これにより persona-runner は legacy/DSL のどちらでも同じ形式の制約リストを
受け取ることになり、内部の扱いが分岐しない。runner 側に DSL 解釈ロジックを
持たせない設計（責務は親エージェント側に閉じる）。

`parallel: true` の場合、**同一メッセージ内で複数の Task 呼び出しを並列に発行する**。
ペルソナごとに別セッション（別プロセス・別ブラウザ）を割り当てているので、
入力が他人に書き換わるような干渉は発生しない。

### 3. 実行フェーズ（サブエージェント側）

各サブエージェントは `agents/persona-runner.md` の指示に従い:

- 渡されたセッション（target を開いた状態）を `snapshot` で把握
- ペルソナとして「自然に」タスクを試みる
- **操作のたびに `action_log` に実行順でエントリを追加**。迷った操作には `hesitated` を付け、
  秒数は書かない（行動メトリクス計算のため必須。これがないと「言葉と行動の食い違い」検出が
  無効化される）
- スクリーンショット・違和感を記録
- タスク完了 or 諦めポイントで終了
- feedback.schema.json 準拠の JSON を返す

### 4. 回収＆永続化フェーズ（責務はメインエージェント）

各 Task 呼び出しの戻り値は persona-runner が返した「最終メッセージ全文」である。
**メインエージェント（このスキルを実行している側）は同梱の `save-raw.mjs` を
ペルソナごとに1回呼ぶだけ**でよい:

```
node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/save-raw.mjs" \
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

persona-runner 側には **Write / Edit を渡さない**。ブラウザ操作のために Bash は渡すが、
実行してよいのは `<cli> -s=<session> <command>` の形だけと指示している。
ユーザーには `Bash(npx -y @playwright/cli@0.1.21:*)` を許可リストに入れる運用を案内し、
サブエージェントは確認プロンプトを承認できないので、それ以外の Bash は拒否される。
責務は「JSON を返すだけ」に閉じる。

全ペルソナの戻り値を回収したら、runner の成否にかかわらず、ペルソナごとにトレースを止めて
実測の時刻を raw に書き込み、セッションを閉じる:

```
<cli> -s=<timestamp>-<persona_id> tracing-stop
node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/apply-trace-timing.mjs" \
  --feedback .persona-feedback/<timestamp>/raw/<persona_id>.json \
  --trace-dir .persona-feedback/<timestamp>/cli/<persona_id>/traces
<cli> -s=<timestamp>-<persona_id> close
```

- `apply-trace-timing.mjs` は save-raw に成功したペルソナだけ呼ぶ。トレースのコマンドと
  runner の action_log を種類と順番で突き合わせ、秒数・`started_at`・`duration_seconds` を
  実測で上書きし、どこまで対応が取れたかを `timing` に記録する
- 対応が取れなかった操作は秒数なしで残る。トレースが見つからなければ `timing.source` が
  `none` になり、時間の指標だけが空になる（回数の指標と赤フラグは出る）
- 実測の秒数はコマンド間の実時間で、大半はモデルの思考時間。レポートでは参考値として出す

### 5. 集約フェーズ

`scripts/aggregate.mjs` に raw ディレクトリを渡して統合レポートを生成する:

- **🔁 変更サマリ (UX Regression)**: `--auto-baseline-dir ./reports` を渡したときに
  `./reports/` 配下の最新の1つ前の `*-report.json` を baseline として自動採用し、
  ペルソナ別スコア変化 / outcome 変化 / findings 追加・消失 / 行動メトリクス変化を
  レポート先頭に挿入。`persona-feedback` を「UX における Lint」として継続観測する
  ための核心セクション。同じ target / task を繰り返し評価する運用で効く。
- **all-agreement (critical)**: 全員が指摘した問題
- **segment-specific**: 特定ペルソナだけが詰まった箇所
- **controversial**: ペルソナ間で評価が割れた要素
- **行動メトリクス (behavior_metrics)**: 各 persona の `action_log` から計算した
  迷った自己申告の回数 / スクロール往復 / back・cancel 頻度。赤フラグはこの回数で判定し、
  **言葉と行動の食い違い**（好評価／完走なのに行動が迷っているケース）を出す。
  トレースから測った逡巡時間と画面ごとの滞在時間は、モデルの思考時間を含む参考値として並べる。
  AI ペルソナの構造的限界（何でも言語化してしまい、本当の沈黙を再現できない）を
  Playwright メトリクスで部分的に補う仕組み。詳細は `scripts/behavior-metrics.mjs`。

`output_format` に従って Markdown / JSON を生成する。

## 集約スクリプトの呼び出し

```
node "${CLAUDE_PLUGIN_ROOT}/skills/persona-tester/scripts/aggregate.mjs" \
  --feedbacks .persona-feedback/<timestamp>/raw \
  --output reports/<timestamp>-report.md \
  --format both \
  --auto-baseline-dir ./reports \
  --severity-threshold <severity_threshold>
```

`--severity-threshold` には入力の `severity_threshold` をそのまま渡す（既定 `low`）。
しきい値未満の finding は集約セクションから外れる（JSON の `raw_feedbacks` には残る）。
同じ問題かどうかは finding の `page`（画面）と `element`（要素名）で判定し、要素の
呼び方が揺れていても同じ画面・同じ category を全員が指摘していれば全員指摘にまとめる。

入力（中間物）は隠しディレクトリ `.persona-feedback/`、
出力（最終レポート）は可視ディレクトリ `reports/` という分離。

`--format json` で JSON 出力。`--format both` で両方を生成する。

`--auto-baseline-dir ./reports` は変更サマリ自動挿入の推奨設定。明示的に
baseline を指定したいときは `--baseline <path>` を使う。任意の2 run を比較
するだけなら独立スキル `/persona-feedback:diff` で `diff-reports.mjs` を直接
呼ぶこともできる。

## 出力先

すべて **ユーザーの cwd 配下** に保存する（プラグインキャッシュではない）。
**最終レポートと中間物を分離**するのがこのプラグインの規約:

### 最終レポート（可視・残す）— `reports/`

- Markdown: `reports/<timestamp>-report.md`
- JSON: `reports/<timestamp>-report.json`

### 中間物（隠し・捨てる前提）— `.persona-feedback/`

- 生フィードバック: `.persona-feedback/<timestamp>/raw/<persona_id>.json`
- CLI のスナップショットとトレース: `.persona-feedback/<timestamp>/cli/<persona_id>/`
- スクリーンショット: `.persona-feedback/<timestamp>/screenshots/<persona_id>-*.png`

プラグインは利用側リポジトリの `.gitignore` を変更しない。`.persona-feedback/` が
未追跡ファイルとして出ていたら、`.gitignore` への追加をユーザーに案内する。
`/persona-feedback:clean` スキルで一括削除可能。`<timestamp>` は `YYYYMMDD-HHmmss` 形式で、最終レポートと
中間物で同じ値を使い対応付ける。

## エラーハンドリング (D-08: partial success)

- 1ペルソナのセッション失敗で全体は止めない
- 失敗ペルソナの理由（タイムアウト / ブラウザセッション起動失敗 / スキーマ検証失敗 等）を
  レポートの `## Failed Personas` セクションに含める
- 全ペルソナが失敗した場合のみ全体失敗とする

## コスト警告

ペルソナ数 × おおよそのトークン消費を事前に提示する。
`max_parallel` を超える要求があれば、シリアル実行を提案する。

## ユーザーへの確認事項

入力が不足している場合に質問する:

- target URL
- 使うペルソナ（同梱ペルソナでよいか、追加したいか）
- 具体的なタスク（曖昧な「テストして」では実行しない）
- focus 観点
