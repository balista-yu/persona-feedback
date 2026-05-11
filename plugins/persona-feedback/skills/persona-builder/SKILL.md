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

例:

- 技術リテラシー low: 「専門用語が出たら推論せず『分からない』と判断」
- せっかちなペルソナ: 「3秒以上の待機で離脱を検討」
- 不安症ペルソナ: 「個人情報入力フォームで一度操作を停止し、安全性を確認」
- 慎重派ペルソナ: 「エラーメッセージは読まず戻るボタンを優先」
- モバイルユーザー: 「PC向けレイアウトのままモバイル表示されていたら即離脱」

これらは「能力の制限」であり、ペルソナの忠実度を担保する核心部分。
ペルソナごとに最低3つは具体的な制約ルールを書くこと。

## 同梱ペルソナ

`personas/` 配下に3体のサンプルがある:

- `tanaka-60s.yaml` — 60代、技術リテラシー低、慎重派
- `gal-20s.yaml` — 20代、モバイル中心、せっかち、視覚重視
- `dev-engineer.yaml` — 30代、高リテラシー、批判的、効率重視

新規生成時はこれらを参照すると、`behavior_rules` の書き方が掴みやすい。

## 確認すべき事項

ユーザーの入力が不足している場合、以下を質問する:

- ターゲットアプリのドメイン（EC / SaaS / メディア / 金融 等）
- 想定ユーザー層の年齢 / 職業 / 技術リテラシーの幅
- 何人のペルソナを作るか（既定 3）
- 特にテストしたい評価軸（usability / accessibility / conversion 等）
