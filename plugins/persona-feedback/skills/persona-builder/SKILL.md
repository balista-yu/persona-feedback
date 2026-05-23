---
name: persona-builder
description: Use when the user wants to define, generate, or refine a synthetic
  user persona for testing. Triggers include "create a persona", "ペルソナ作って",
  "test user profile", or when the user describes a target user demographic.
  Outputs a YAML file conforming to the persona schema.
---

# persona-builder

ユーザーが提供するコンテキスト（業種・サービス・ターゲットユーザー像など）から、
テスト用ペルソナの YAML ファイルを生成する。生成されたファイルは `persona-tester`
スキルでそのまま消費できる。

## 入力

ユーザーから以下のいずれかを受け取る:

- 自由記述のコンテキスト（例: 「ECサイト向けに3人のペルソナを」）
- 既存ペルソナ YAML への修正指示
- ターゲットアプリの URL（任意 — Playwright MCP で実物を見て調整可能）

## 出力

`personas/<persona-id>.yaml` を作成する。スキーマは
`skills/persona-tester/schemas/persona.schema.json` に準拠すること。
複数ペルソナを依頼された場合は1ファイル1ペルソナで複数作る。

## 生成手順

1. ユーザーのコンテキストを読み取り、必要なペルソナ数と目的を確認
2. 各ペルソナについて以下を確定:
   - **id**: kebab-case で一意（例: `tanaka-60s`, `student-25s`）
   - **demographics**: 年齢、職業、技術リテラシー（low / medium / high）
   - **context**: 利用デバイス、環境、達成したい目的
   - **personality**: 3〜5個の性格特性
   - **behavior_rules**: LLM の「賢すぎ問題」を抑制する明示ルール（**最低1つは必須**）
   - **evaluation_focus**: そのペルソナが重視する評価軸
   - **vocabulary**: トーンと避ける用語
3. `templates/persona.template.yaml` を雛形として使用
4. 生成後、ユーザーに確認を求め、調整があれば再生成
5. ファイルは `personas/<id>.yaml` に Write tool で保存

## behavior_rules の設計指針 (CRITICAL)

LLM は本質的に「賢く・協調的に・推論で突破する」傾向がある。
リアルなユーザーをシミュレートするには、これを明示的に殺すルールが必要。
**ここを手抜きすると、ペルソナは全員「優秀な評価者」になってしまい意味がない。**

`behavior_rules` には2つの書き方がある:

### A. legacy: 自由文の配列

```yaml
behavior_rules:
  - "カタカナの技術用語が出たら『分からない』と判断"
  - "エラーメッセージは読まず戻るボタンを優先"
  - "3秒以上の待機で離脱を検討"
```

書き手が自分で文章を組む。柔軟だが品質が書き手依存。

### B. 構造化 DSL: 能力減算プリミティブ（推奨）

```yaml
behavior_rules:
  give_up_after: 2_retries        # 何回失敗で諦めるか（0 は不可）
  panic_on:                       # 何があったらパニックになるか
    - english_in_error
    - modal_dialog_unexpected
    - credit_card_request
  lexical:                        # 「何を理解できないか」。トップレベル vocabulary（どう話すか）とは別軸
    block_jargon: true            # 専門用語の意味推測を禁止
    confused_by: ["カート", "チェックアウト"]
  attention_span: 2min            # 集中力の限界（0 は不可）
  reading_speed: slow             # 読書速度
  on_ambiguous_button: ask_or_skip # 曖昧なボタンへの態度
  custom:                         # プリミティブに収まらないルール
    - "送料が確定するまで注文確定ボタンを押さない"
```

#### `lexical` と top-level `vocabulary` の使い分け

両方とも「語」を扱うキーで名前が紛らわしいので、役割を明確にする:

| キー | 場所 | 役割 |
|---|---|---|
| `vocabulary.tone` / `vocabulary.avoid_terms` | persona のトップレベル | **どう話すか** — narrative / quote の口調を決める |
| `behavior_rules.lexical.block_jargon` / `lexical.confused_by` | 構造化 DSL 内 | **何を理解できないか** — runner の認知能力を抑制する |

例えば「丁寧語で話すが、技術用語の意味は推測しない」なら
`vocabulary.tone: formal` + `lexical.block_jargon: true` のように併用する。

各プリミティブは `behavior-rules.mjs render` で自然文制約のリストに展開され、
persona-runner にそのまま渡される。語彙が標準化されるので「能力を引く」という
方法論を再利用可能なボキャブラリで表現できる。

利用可能なプリミティブと値域は
[`schemas/persona.schema.json`](../persona-tester/schemas/persona.schema.json)
の `behavior_rules` 定義（構造化 DSL 形式の方）を参照。
`panic_on` の enum や `on_ambiguous_button` の enum は意図的に絞ってある
（追加したい場合は `custom` に書くか、スキーマ側で追加する）。

### どちらを使うか

- 既存ペルソナの修正 → そのフォーマットを踏襲
- 新規ペルソナ → 構造化 DSL を推奨
- 構造化 DSL に収まらない癖は `custom: []` で逃がす

これらは「能力の制限」であり、ペルソナの忠実度を担保する核心部分。
ペルソナごとに最低3つは具体的な制約ルールを書くこと。

## 同梱ペルソナ

`personas/` 配下にサンプルがある:

- `tanaka-60s.yaml` — 60代、技術リテラシー低、慎重派（**legacy 形式**）
- `gal-20s.yaml` — 20代、モバイル中心、せっかち、視覚重視（**legacy 形式**）
- `dev-engineer.yaml` — 30代、高リテラシー、批判的、効率重視（**legacy 形式**）
- `yamada-50s-dsl.yaml` — 50代、初めてのオンラインショップ（**構造化 DSL 形式**）

新規生成時はこれらを参照すると、`behavior_rules` の書き方が掴みやすい。
構造化 DSL の例が必要なら `yamada-50s-dsl.yaml` を見ること。

## 確認すべき事項

ユーザーの入力が不足している場合、以下を質問する:

- ターゲットアプリのドメイン（EC / SaaS / メディア / 金融 等）
- 想定ユーザー層の年齢 / 職業 / 技術リテラシーの幅
- 何人のペルソナを作るか（既定 3）
- 特にテストしたい評価軸（usability / accessibility / conversion 等）
