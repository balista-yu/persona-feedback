# Architecture

```
USER
 │ /skill persona-feedback:persona-tester
 ▼
Main Claude Agent (orchestrator)
 │  ├─ spawns Task tool × N (parallel)
 │  │                          │
 │  │  ┌───────────────────────┴───────────────────────┐
 │  ▼  ▼                                                ▼
 │  Sub-agent: tanaka-60s   Sub-agent: gal-20s   Sub-agent: dev-engineer
 │   (isolated context)     (isolated context)   (isolated context)
 │           │                       │                    │
 │           └─── Playwright MCP (shared, per-agent context) ───┘
 │                            │
 │                            ▼
 │                     TARGET WEB APP
 │
 │ collect feedbacks JSON
 ▼
aggregate.mjs  →  reports/<ts>-report.md / .json
```

## 主要な性質

### 分離されたコンテキスト

各サブエージェントは独自のシステムプロンプト・履歴を持ち、互いのフィードバックに
汚染されない。「他のペルソナが好評価したから自分も…」という同調が発生しない。

### 並列実行

メインエージェントは Task tool を **同一メッセージ内で複数回呼び出す** ことで
並列起動する。既定の `max_parallel` は 3（実測コスト目安は SKILL.md 参照）。
それを超える要求はメインエージェントが概算コストを提示してユーザー承認を得てから起動。

### 共有 MCP / 分離ブラウザコンテキスト

Playwright MCP サーバーは1つだけ立ち上がるが、各サブエージェントは独立した
ブラウザコンテキスト（Cookie / localStorage が分離された別タブ相当）を使う。
あるペルソナのログイン状態が他に漏れない。

### 構造化出力

各サブエージェントの最終出力は `feedback.schema.json` に準拠した JSON。
これを aggregate.mjs が機械的に集約できるので、ペルソナ数を増やしても
レポート生成は決定的・再現可能。

## ファイル配置と参照関係

```
.claude-plugin/marketplace.json
    └─→ plugins/persona-feedback/.claude-plugin/plugin.json
                                  │
                                  ├─→ .mcp.json (Playwright, --isolated --output-dir ./.persona-feedback)
                                  ├─→ skills/persona-builder/SKILL.md
                                  │      └─ templates/persona.template.yaml
                                  ├─→ skills/persona-tester/SKILL.md
                                  │      ├─ schemas/persona.schema.json
                                  │      ├─ schemas/feedback.schema.json
                                  │      └─ scripts/{aggregate,save-raw}.mjs
                                  ├─→ skills/personas-list/SKILL.md
                                  ├─→ skills/clean/SKILL.md
                                  ├─→ scripts/{list-personas,clean}.mjs
                                  ├─→ agents/persona-runner.md
                                  └─→ personas/{tanaka-60s,gal-20s,dev-engineer}.yaml
```

## 実行成果物の配置（cwd 配下）

```
<cwd>/
├── reports/                          # 最終レポート（残す）
│   └── <timestamp>-report.{md,json}
└── .persona-feedback/                # 中間物（捨てる前提）
    └── <timestamp>/
        ├── raw/<persona_id>.json     # サブエージェントから回収した生 JSON
        └── screenshots/*.png         # Playwright MCP が --output-dir に書く
```

最終レポートは振り返り可能・共有可能な単一ファイルなので可視ディレクトリに、
スクリーンショットや生 JSON は基本捨てる前提なので隠しディレクトリに配置する。
clean スキル (`/persona-feedback:clean`) で中間物の一括削除が可能。

プラグインはユーザーの `~/.claude/plugins/cache/` にコピーされて動作するため、
プラグインディレクトリ外への相対パス参照 (`../shared/`) は機能しない。
必要なファイルはすべて `plugins/persona-feedback/` 配下に置く。

## v0.1 の構造的リスクと対策

LLM サブエージェントは本質的に「賢く・協調的・推論で突破する」傾向があり、
初心者ユーザーの **困惑** を再現できない可能性がある。これは本プラグインの
最大の構造的リスク。

対策:

1. `behavior_rules` に明示的な能力制限を書く（手抜きしない）
2. `agents/persona-runner.md` で「Claudeとしての賢さを使うな」と強調
3. ペルソナ間の不一致を価値情報とする（全員「いい感じ」は信用しない）
4. v0.2 で real user test との相関スタディを行う（ロードマップ）
