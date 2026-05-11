# Feedback Spec

各 persona-runner が返す JSON、および aggregate スクリプトが生成する統合レポートの仕様。
完全なスキーマは [`feedback.schema.json`](../plugins/persona-feedback/skills/persona-tester/schemas/feedback.schema.json) を参照。

## persona-runner の出力

```jsonc
{
  "persona_id": "tanaka-60s",
  "target": "http://localhost:8000",
  "task": "新規登録",
  "started_at": "2026-05-11T10:00:00Z",
  "duration_seconds": 123.4,
  "outcome": "completed | abandoned | blocked | error",
  "narrative": "ペルソナ視点の一人称ナレーション（短文OK）",
  "findings": [
    {
      "category": "usability | bug | accessibility | copywriting | performance | trust",
      "severity": "low | medium | high | critical",
      "location": "URL or DOM selector / region description",
      "description": "客観的に何が問題か",
      "quote": "ペルソナの一人称の生の声",
      "screenshot": "01-top.png",
      "suggestion": "改善案（任意）"
    }
  ],
  "score": {
    "overall": 0..10,
    "would_recommend": true | false
  }
}
```

## outcome の意味

| Value | Meaning |
|-------|---------|
| `completed` | タスクをやり遂げた |
| `abandoned` | ペルソナが「もう無理」と諦めた（最も価値ある信号） |
| `blocked` | target に到達できない／致命的不具合 |
| `error` | サブエージェント側で技術的失敗 |

## severity の使い分け

- `critical`: ペルソナがタスクを諦める原因
- `high`: 強い摩擦。実ユーザーなら離脱率が大幅に上がる
- `medium`: 改善望ましい
- `low`: nice-to-have

## 統合レポートの構成（aggregate 後）

```
## 🚨 全員指摘 (all-agreement)
   - 全ペルソナが指摘した同一の問題。最優先で直すべき。

## 🎯 セグメント特有 (segment-specific)
   - 特定ペルソナだけが詰まった箇所。対象ユーザー層に依存する課題。

## ⚖️ 評価分裂 (controversial)
   - overall スコア差 ≥ 3、または would_recommend が割れた要素。
     → 「誰のためのプロダクトか」の整理が必要なシグナル。

## 🗣 各ペルソナのナレーション
   - 一人称の生の声を全文表示。
```

## quote フィールドが大事

統合レポートで一番効くのが `quote` の生の声。
"アップロードって何？" のような短く具体的な発話があると、
チームに直接刺さるフィードバックになる。
