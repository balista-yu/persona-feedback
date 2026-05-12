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

### MCP ツールの permission 設定（初回必須）

サブエージェントはバックグラウンド実行されるため対話的な permission prompt を承認できない。
インストール後、プロジェクトの `.claude/settings.local.json` に以下を追加してください
（ファイルが無ければ新規作成）:

```json
{
  "permissions": {
    "allow": [
      "mcp__plugin_persona-feedback_playwright__browser_navigate",
      "mcp__plugin_persona-feedback_playwright__browser_snapshot",
      "mcp__plugin_persona-feedback_playwright__browser_click",
      "mcp__plugin_persona-feedback_playwright__browser_type",
      "mcp__plugin_persona-feedback_playwright__browser_select_option",
      "mcp__plugin_persona-feedback_playwright__browser_take_screenshot",
      "mcp__plugin_persona-feedback_playwright__browser_wait_for",
      "mcp__plugin_persona-feedback_playwright__browser_press_key",
      "mcp__plugin_persona-feedback_playwright__browser_resize"
    ]
  }
}
```

これを忘れるとサブエージェントが MCP ツール呼び出しで `permission denied` 扱いになり
`outcome: blocked` で終了する。

## 使い方

各スキルは **自然言語で頼むと Claude が自動で起動** する（SKILL.md の `description` がトリガー）。
スラッシュコマンド `/persona-feedback:<skill-name>` でも明示的に呼べる。

### ペルソナ一覧を見る

```
ペルソナの一覧を見せて
```

または:

```
/persona-feedback:personas-list
```

同梱ペルソナ（`tanaka-60s` / `gal-20s` / `dev-engineer`）と cwd 配下
`personas/*.yaml` をまとめて表として表示する。

### ペルソナを作る（任意）

```
persona-builder を使って、ECサイト向けに、節約志向の主婦と、
ガジェット好きの大学生の2人ペルソナを作って
```

`personas/` 配下に YAML が生成される。

### ペルソナにテストさせる

**3 通りの呼び出し方**:

**A. 自然言語（対話的）**

```
persona-tester で http://localhost:3000 を
tanaka-60s と gal-20s でテストして
新規登録タスク、accessibility 観点で
```

**B. スラッシュ + 引数（短く明示的）**

```
/persona-feedback:persona-tester tanaka-60s,gal-20s http://localhost:3000 新規登録
```

引数は `<personas> <url> <task...>` の順。`personas` はカンマ区切り。
`all` / `bundled` / `user` の特別キーワードも使える:

| キーワード | 対象 |
|---|---|
| `all` | 同梱 + cwd の全ペルソナ |
| `bundled` | 同梱 3 体のみ |
| `user` | cwd 配下のユーザー定義のみ |

**C. ペルソナ未指定（一覧から複数選択）**

```
persona-tester で http://localhost:3000 をテスト
```

ペルソナ ID を指定しないと、利用可能ペルソナの一覧が出て複数選択 UI に進む。

実行後は `reports/<timestamp>-report.md` に統合レポートが出力される。
出力サンプル: [`examples/runs/sample-run/report.md`](./examples/runs/sample-run/report.md)

## 注意

- ペルソナは実ブラウザで本当に操作する。本番環境や個人情報を含む環境には気軽に走らせない。
- ペルソナ 1 体あたり実測 ~50k tokens / 2〜4 分（中規模アプリ）。3 体並列 ≈ 150k tokens / 5 分前後が目安。4 体以上を要求すると起動前に確認プロンプトが出る。
- 実行ごとに結果は揺れる（非決定的）。実ユーザーテストの代替ではない。

## ドキュメント

- [Getting Started](./docs/getting-started.md)
- [Persona Spec](./docs/persona-spec.md)
- [Feedback Spec](./docs/feedback-spec.md)
- [Architecture](./docs/architecture.md)
- 計画書: [persona-feedback-plan.html](./docs/persona-feedback-plan.html)

## ライセンス

[MIT](./LICENSE)
