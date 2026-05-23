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
  },
  "action_log": [
    {
      "at_seconds": 0.0,
      "action": "navigate | snapshot | click | type | select | press_key | scroll | wait | back | cancel | screenshot | give_up",
      "target_desc": "操作対象の人間可読な説明（例: メアド欄）",
      "location": "現在の URL or 論理画面名",
      "note": "任意。『迷った』等の自己観察"
    }
  ]
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

## 🧭 行動メトリクス (behavior_metrics)
   - 各 persona の action_log から計算した hesitation / scroll_back / back_or_cancel /
     time_on_screen。
   - 🚩 言葉と行動の食い違い: overall ≥ 7（好評価）または outcome=completed のとき
     hesitation_mean ≥ 5s / back_or_cancel ≥ 3 / scroll_back_and_forth ≥ 4 のいずれかが
     成立すると赤フラグ。「分かりやすかった」と言いつつ実は迷っていたケースを拾う。

## 🗣 各ペルソナのナレーション
   - 一人称の生の声を全文表示。
```

## quote フィールドが大事

統合レポートで一番効くのが `quote` の生の声。
"アップロードって何？" のような短く具体的な発話があると、
チームに直接刺さるフィードバックになる。

## なぜ action_log を取るのか

LLM ペルソナは何でも言語化してしまうため、本物の「言いよどみ」「沈黙」は
再現できない構造的限界がある。`narrative` と `score` だけでは「分かりやすかった」
と言いつつ実は迷っていたケースを検出できない。

`action_log` は Playwright MCP の操作トレースを構造化して残し、aggregate 側で
hesitation / scroll / back・cancel 等のメトリクスを計算する。これにより
**言葉と行動の食い違い** を赤フラグで提示できる。AI ペルソナの構造的弱点を
行動シグナルで補強するのが狙い。
