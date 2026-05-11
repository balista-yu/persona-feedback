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
| `behavior_rules` | string[] | **最低1つ**。LLM抑制ルール |

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

### Good

```yaml
behavior_rules:
  - "カタカナの技術用語が出たら『分からない』と判断し離脱を検討する"
  - "エラーメッセージは読まずに戻るボタンを押す"
  - "3秒以上の待機で離脱を検討する"
```

### Bad

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
