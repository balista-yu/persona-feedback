# persona-feedback

合成ペルソナをサブエージェントとして並列起動し、Playwright MCP 経由で
Web アプリを操作させて構造化フィードバックを集約する Claude Code プラグイン。

LLM は本質的に「賢く・協調的・推論で突破する」ので、そのままだと初心者ユーザーの
*困惑* を再現できない。ペルソナ YAML の `behavior_rules` で LLM の能力を意図的に
制限し、複数ペルソナの不一致点をハイライトすることで、実ユーザーテスト前の
高速フィードバックループを作る。

## 必要要件

- Claude Code v2 以降
- Node.js 24（Active LTS。`@playwright/mcp` および aggregate スクリプトで使う ESM API がこの世代で安定動作する想定。20 LTS でも動くはずだが検証は 24 のみ）
- 初回起動時にブラウザバイナリの DL が走る（数十秒〜数分）

## インストール

Claude Code 内で:

```
/plugin marketplace add balista-yu/persona-feedback
/plugin install persona-feedback@persona-feedback
```

## 使い方

スキルは **自然言語で頼むと Claude が自動で起動** する（SKILL.md の `description` がトリガー）。
明示的に呼びたいときはスキル名をプロンプトに含める。

### ペルソナを作る（任意）

組み込み 3 体（`tanaka-60s`, `gal-20s`, `dev-engineer`）で足りればスキップ。
自前で作る場合は `persona-builder` を起動させる:

```
persona-builder を使って、ECサイト向けに、節約志向の主婦と、
ガジェット好きの大学生の2人ペルソナを作って
```

`personas/` 配下に YAML が生成される。

### ペルソナにテストさせる

```
persona-tester で http://localhost:3000 を
tanaka-60s, gal-20s, dev-engineer の3人で、
新規登録タスクをテスト。accessibility と usability 観点で
```

3 つのサブエージェントが並列で立ち上がり、各ペルソナがブラウザを操作する。
完了後、`reports/<timestamp>-report.md` に統合レポートが出力される。

出力サンプルは [`examples/runs/sample-run/report.md`](./examples/runs/sample-run/report.md) を参照。

## 注意

- ペルソナは実ブラウザで本当に操作する。本番環境や個人情報を含む環境には気軽に走らせない。
- 並列ペルソナ数 × LLM コスト × Playwright セッションが発生する。3〜5 体で十分。
- 実行ごとに結果は揺れる（非決定的）。実ユーザーテストの代替ではない。

## ドキュメント

- [Getting Started](./docs/getting-started.md)
- [Persona Spec](./docs/persona-spec.md)
- [Feedback Spec](./docs/feedback-spec.md)
- [Architecture](./docs/architecture.md)
- 計画書: [persona-feedback-plan.html](./docs/persona-feedback-plan.html)

## ライセンス

[MIT](./LICENSE)
