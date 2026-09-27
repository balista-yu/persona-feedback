# persona-feedback

合成ペルソナをサブエージェントとして並列起動し、Playwright CLI 経由で
Web アプリを操作させて構造化フィードバックを集約する Claude Code プラグイン。

LLM は本質的に「賢く・協調的・推論で突破する」ので、そのままだと初心者ユーザーの
*困惑* を再現できない。ペルソナ YAML の `behavior_rules` で LLM の能力を意図的に
制限し、複数ペルソナの不一致点をハイライトすることで、実ユーザーテスト前の
高速フィードバックループを作る。

## 必要要件

- Claude Code v2 以降
- Node.js 24（Active LTS。`@playwright/cli` および aggregate スクリプトで使う ESM API がこの世代で安定動作する想定。20 LTS でも動くはずだが検証は 24 のみ）
- Playwright CLI（`@playwright/cli@0.1.21`）を `npx` で呼ぶので事前インストールは不要
- Playwright がバージョン管理する Chromium を使う（約 170MB）。未インストールなら実行前の検証で案内が出る。事前に入れる場合:

  ```bash
  npx -y @playwright/cli@0.1.21 install-browser chromium
  ```

  `npx playwright install chromium` だと別バージョンの Playwright の Chromium が入り、見つからないことがある

## インストール

Claude Code 内で:

```
/plugin marketplace add balista-yu/persona-feedback
/plugin install persona-feedback@persona-feedback
```

### permission 設定（初回必須）

サブエージェントはバックグラウンド実行されるため対話的な permission prompt を承認できない。
インストール後、プロジェクトの `.claude/settings.local.json` に以下を追加してください
（ファイルが無ければ新規作成）:

```json
{
  "permissions": {
    "allow": [
      "Bash(npx -y @playwright/cli@0.1.21:*)"
    ]
  }
}
```

サブエージェントはこの形のコマンドでブラウザを操作する。許可が無いとブラウザ操作が
`permission denied` になり、`outcome: error` で終了する。
これ以外の Bash は許可していないので、サブエージェントが別のコマンドを実行しようとしても拒否される。

### 0.1.x から更新する

1. プラグインを更新する。Claude Code 内で `/plugin marketplace update persona-feedback` を
   実行してから、`/plugin` の Installed タブで persona-feedback を選んで Update now。
   シェルからなら `claude plugin update persona-feedback@persona-feedback`
2. Claude Code のセッションを開き直す（今のセッションで反映するなら `/reload-plugins`）。
   開いたままのセッションは古い版で動き続ける。0.1.x の Playwright MCP サーバーもここで外れる
3. 上の「必要要件」にある `install-browser` で Chromium を入れる
4. 上の「permission 設定」の許可を追加する。0.1.x で入れた
   `mcp__plugin_persona-feedback_playwright__*` の許可は不要になったので消してよい

自作のペルソナ YAML はそのまま使える。前回との差分レポートでは行動メトリクスの比較が
「迷った申告の回数」に変わったため、0.1.x で作ったレポートとの比較ではその列が `-` になる。

### 並列実行の仕組み

ペルソナごとに Playwright CLI の名前付きセッション（別プロセス・別ブラウザ）を割り当てるので、
並列に走らせても入力や画面遷移が混ざらない。Playwright MCP はサブエージェントと接続を
共有してしまいペルソナごとに分離できないため、使っていない。

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
| `bundled` | 同梱ペルソナのみ |
| `user` | cwd 配下のユーザー定義のみ |

**C. ペルソナ未指定（一覧から複数選択）**

```
persona-tester で http://localhost:3000 をテスト
```

ペルソナ ID を指定しないと、利用可能ペルソナの一覧が出て複数選択 UI に進む。

実行後は `reports/<timestamp>-report.md` に統合レポートが出力される。
出力サンプル: [`examples/runs/sample-run/report.md`](./examples/runs/sample-run/report.md)

### 中間物のクリーンアップ

スクリーンショットと生 JSON は `./.persona-feedback/<timestamp>/` 配下（隠しディレクトリ）に保存される。
最終レポート `./reports/<timestamp>-report.*` だけ残せば良いので、中間物は定期的に掃除すると吉:

```
/persona-feedback:clean --keep-last 3
```

最新 3 run の中間物だけ残して残りを削除。詳しい引数は `clean` スキル参照。

## 出力構造

```
<project>/
├── reports/                       # 最終レポート（残す）
│   ├── 20260512-100000-report.md
│   └── 20260512-100000-report.json
└── .persona-feedback/             # 中間物（隠し・clean 対象）
    └── 20260512-100000/
        ├── raw/                   # ペルソナ別生フィードバック
        │   ├── tanaka-60s.json
        │   ├── gal-20s.json
        │   └── dev-engineer.json
        └── screenshots/           # Playwright が撮ったキャプチャ
            ├── tanaka-60s-01-top.png
            └── ...
```

プラグインは利用側リポジトリの `.gitignore` を変更しない。コミットしたくなければ自分で追加する

```gitignore
/.persona-feedback/
/reports/
```

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
