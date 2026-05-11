# persona-feedback

合成ユーザー（ペルソナ）をサブエージェントとして並列起動し、Playwright MCP を介して
実際の Web アプリを操作させ、構造化されたフィードバックを集約する Claude Code プラグイン。

> **English summary:** A Claude Code plugin that spawns synthetic user personas
> as sub-agents to test your web app via Playwright MCP and returns structured,
> aggregated UX feedback that highlights cross-persona disagreement. Install via
> `/plugin marketplace add github:balista-yu/persona-feedback`.

[![status: v0.1 / WIP](https://img.shields.io/badge/status-v0.1%20WIP-orange)](./CHANGELOG.md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

---

## なぜ作るか

実ユーザーテストは高コスト・低速。一方で「LLM にユーザーを演じさせる」だけだと、
LLM は本質的に「賢く・協調的・推論で突破する」ため、初心者ユーザーの *困惑* を
再現できない。本プラグインは:

- ペルソナ YAML の `behavior_rules` でLLMの能力を意図的に制限
- 各ペルソナを **独立したサブエージェント** として並列実行（コンテキスト汚染を防止）
- 結果をマージし **不一致点をハイライト**（全員「いい感じ」は信用しない）

これにより、実ユーザーテスト前の高速フィードバックループを実現する。

## 必要要件

- [Claude Code](https://code.claude.com/) v2 以降
- **Node.js 18+**（Playwright MCP が `npx @playwright/mcp` で起動するため）
- 初回起動時、Playwright のブラウザバイナリ取得に数十秒〜数分かかることがある

## インストール

```bash
# Claude Code 内で
/plugin marketplace add github:balista-yu/persona-feedback
/plugin install persona-feedback@persona-feedback
```

インストール直後、Playwright MCP サーバーが自動で起動する。

## 使い方

### 1. ペルソナを作る（任意）

組み込みペルソナ（`tanaka-60s`, `gal-20s`, `dev-engineer`）でよければスキップ可。
独自ペルソナを作りたい場合:

```
/skill persona-feedback:persona-builder
「ECサイト向けに、節約志向の主婦と、ガジェット好きの大学生の2人を作って」
```

`personas/` 配下に YAML が生成される。

### 2. ペルソナにテストさせる

```
/skill persona-feedback:persona-tester
「http://localhost:3000 を tanaka-60s, gal-20s, dev-engineer の3人で
 新規登録タスクをテストして、accessibility と usability 観点でレポート」
```

並列でサブエージェントが立ち上がり、各ペルソナが実際にブラウザを操作する。
完了後、`reports/<timestamp>-report.md` に統合レポートが出力される。

### 出力レポートの構成

```
全員指摘（critical）
  - 文字が小さすぎて読めない
セグメント特有
  - tanaka-60s だけが「カタカナ用語が分からない」と離脱
  - gal-20s だけが「モバイル表示崩れ」を指摘
評価分裂（controversial）
  - エンジニアは高評価、初心者は低評価のUI要素
```

## ドキュメント

- [Getting Started](./docs/getting-started.md)
- [Persona Spec](./docs/persona-spec.md)
- [Feedback Spec](./docs/feedback-spec.md)
- [Architecture](./docs/architecture.md)
- 開発計画書: [persona-feedback-plan.html](./docs/persona-feedback-plan.html)

## 制約 (v0.1)

- Web アプリ専用（CLI / API は v0.2 以降）
- ペルソナの永続メモリなし（実行ごとに毎回フレッシュ）
- 並列ペルソナ上限は 5（コスト警告あり）
- 実ユーザーテストの **代替ではない**（あくまで補助・前段）

## ライセンス

[MIT](./LICENSE) © balista-yu
