# Persona Spec

ペルソナ YAML のフィールド仕様。
完全なスキーマは [`persona.schema.json`](../plugins/persona-feedback/skills/persona-tester/schemas/persona.schema.json) を参照。

## 必須フィールド

| Field | Type | Note |
|-------|------|------|
| `id` | string | `^[a-z0-9-]+$` のkebab-case |
| `name` | string | 表示名（日本語可） |
| `demographics.tech_literacy` | `low` / `medium` / `high` | LLMの抑制度を決める鍵 |
| `context.device` | `desktop` / `mobile` / `tablet` | viewport設定に使う |
| `context.goal` | string | ユーザーが達成したいこと |
| `behavior_rules` | string[] _or_ object | **最低1つ**。LLM抑制ルール。配列形式 (legacy) または構造化 DSL (object) |

## 任意フィールド

| Field | Type | Note |
|-------|------|------|
| `version` | string | "1.0" 等 |
| `demographics.age` | int | 0〜120 |
| `demographics.occupation` | string | |
| `demographics.language` | string | "ja", "en" 等 |
| `context.environment` | string | 例: "通勤電車、片手操作" |
| `personality` | string[] | 3〜5個推奨 |
| `evaluation_focus` | string[] | 何を重視するか |
| `vocabulary.tone` | string | casual / formal / cautious 等 |
| `vocabulary.avoid_terms` | string[] | このペルソナが知らない/避ける用語 |

## behavior_rules の書き方

LLM が「賢く回避してしまう」のを **明示的に殺す** ルールを書く。
具体的・行動可能であることが重要。

`behavior_rules` には **legacy（配列）形式** と **構造化 DSL（オブジェクト）形式**
の2通りがある。スキーマは両方を受理する（`oneOf`）。

### Legacy 配列形式（書きやすさ重視）

```yaml
behavior_rules:
  - "カタカナの技術用語が出たら『分からない』と判断し離脱を検討する"
  - "エラーメッセージは読まずに戻るボタンを押す"
  - "3秒以上の待機で離脱を検討する"
```

### 構造化 DSL 形式（再利用可能な能力減算プリミティブ）

```yaml
behavior_rules:
  give_up_after: 2_retries
  panic_on:
    - english_in_error
    - modal_dialog_unexpected
    - credit_card_request
  vocabulary:
    block_jargon: true
    confused_by: ["カート", "チェックアウト"]
  attention_span: 2min
  reading_speed: slow
  on_ambiguous_button: ask_or_skip
  custom:
    - "送料が確定するまで注文確定ボタンを押さない"
```

#### プリミティブ一覧

| Key | Type | 例 | 意味 |
|---|---|---|---|
| `give_up_after` | string | `2_retries`, `30s`, `1min` | 諦めるまでの回数/時間 |
| `panic_on` | enum[] | `english_in_error`, `modal_dialog_unexpected`, `permission_request`, `credit_card_request`, `password_request`, `popup_ad`, `unexpected_redirect` | パニックの引き金 |
| `vocabulary.block_jargon` | boolean | `true` | 専門用語の意味推測を禁止 |
| `vocabulary.confused_by` | string[] | `["ログイン"]` | 困惑する語 |
| `attention_span` | string | `30s`, `2min` | 集中力の限界 |
| `reading_speed` | enum | `slow` / `normal` / `fast` | 読書速度 |
| `on_ambiguous_button` | enum | `ask_or_skip` / `infer_safely` / `tap_anyway` | 曖昧なボタンへの態度 |
| `custom` | string[] | `["送料が確定するまで注文しない"]` | プリミティブに収まらない自由文 |

構造化 DSL は `scripts/behavior-rules.mjs render <persona.yaml>` で
自然文制約のリストに展開され、persona-runner にそのまま渡される。

```bash
$ npm run render-rules -- personas/yamada-50s-dsl.yaml
- 同じ操作で2回リトライしたら諦めてタスクを中断する
- 英語のエラーメッセージが出たらパニックになり、操作を止めて離脱を検討する
- ...
```

### Bad（どちらの形式でも避ける）

```yaml
behavior_rules:
  - "初心者として振る舞う"          # 抽象的。LLMは賢く解釈してしまう
  - "ユーザビリティを評価する"       # 行動ではなく評価。LLMの賢さが出てしまう
```

## なぜ behavior_rules が重要か

LLM は本質的に「賢く・協調的に・推論で突破する」傾向がある。
そのまま「60代の初心者として振る舞え」と指示しても、内部では Claude が
全部把握してしまい、リアルな「困惑」を再現できない。

`behavior_rules` は能力の **意図的な制限** であり、忠実度を担保する核心部分。
ここを手抜きすると、全員「優秀な評価者」になってしまい意味がない。

構造化 DSL を導入したのは、この「能力を引く」という方法論を **再利用可能な
ボキャブラリ** として固めるため。ペルソナを「プロフィール（こういう人）」では
なく「制約セット（こういうことができない／しない人）」として捉え直す。
