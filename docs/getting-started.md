# Getting Started

## 1. インストール

Claude Code 内で以下を実行:

```
/plugin marketplace add balista-yu/persona-feedback
/plugin install persona-feedback@persona-feedback
```

インストール時に Playwright MCP サーバーが起動する。
Node.js 24 が必要。

### 初回のみ: permission allowlist 追加

サブエージェントはバックグラウンドで動くため permission prompt を承認できない。
プロジェクトの `.claude/settings.local.json` に以下を追加してから使う:

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

## 2. 最小サンプル（5分でフィードバックを得る）

### a. デモアプリを起動

```bash
git clone https://github.com/balista-yu/persona-feedback.git
cd persona-feedback/examples/demo-app
python3 -m http.server 8000
```

`http://localhost:8000` で意図的に課題を仕込んだ静的アプリが立つ。

### b. Claude Code で persona-tester を呼ぶ

```
http://localhost:8000 を tanaka-60s, gal-20s, dev-engineer の3人で
「サインアップしてみる」というタスクでテストして
```

3つのサブエージェントが並列で立ち上がり、それぞれが Playwright 経由で
ブラウザを操作してフィードバックを返す。

### c. レポートを見る

```
reports/<timestamp>-report.md
```

「全員指摘」「セグメント特有」「評価分裂」の3カテゴリに分かれて出力される。

## 3. 自前のペルソナを作る

```
ECサイト向けに、節約志向の主婦と、ガジェット好きの大学生の2人ペルソナを作って
```

`persona-builder` スキルが起動し、`personas/<id>.yaml` が生成される。
内容を確認・微調整して、`persona-tester` で使う。

## 4. 自前のアプリをテスト

```
https://staging.example.com を tanaka-60s と shufuf-30s の2人で、
購入導線をテストして、accessibility と copywriting を中心に見てほしい
```

複数 URL に対しても繰り返し実行可能。
