---
name: clean
description: Use when the user wants to remove past persona-feedback run
  artifacts (screenshots, raw feedback JSONs, optionally reports). Triggers
  include "テスト結果を消して", "中間ファイル掃除", "clean persona-feedback",
  "remove old runs". Also invokable as /persona-feedback:clean [--keep-last N]
  [--include-reports] [--timestamp <ts>] [--dry-run].
---

# clean

`persona-feedback` の実行成果物を整理・削除するスキル。

## 削除対象の前提

| 種類 | 場所 | デフォルトで削除？ |
|---|---|---|
| 中間物（生 JSON / スクリーンショット） | `./.persona-feedback/<ts>/` | **はい** |
| 最終レポート（Markdown / JSON） | `./reports/<ts>-report.{md,json}` | いいえ（`--include-reports` で対象に） |

「最終レポートは振り返り用に残しておく」運用が既定。中間物は基本捨てて良い。

## 引数（$ARGUMENTS）

```
[--keep-last <N>] [--timestamp <ts>] [--include-reports] [--dry-run]
```

| フラグ | 効果 |
|---|---|
| `--dry-run` | 何が消えるかだけ表示。実削除はしない |
| `--keep-last <N>` | 最新 N run 分の中間物を残し、それ以前を削除 |
| `--timestamp <ts>` | 特定 timestamp の run だけ削除 |
| `--include-reports` | `reports/<ts>-report.*` も同時に削除 |

`--keep-last` と `--timestamp` は排他。

## 実行手順

1. ユーザーの引数を解釈する。引数が無い場合は `--dry-run` を先にかけて
   全件リストを見せ、ユーザーに確認を取ってから本削除に進む。
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/clean.mjs" $ARGUMENTS` を実行する
3. 結果を要約してユーザーに見せる

## 使用例

### 全中間物を削除（レポートは残す）

```
/persona-feedback:clean
```

→ まず一覧を出して、ユーザーが OK と言ったら全削除。

### 最新 3 run だけ残す

```
/persona-feedback:clean --keep-last 3
```

### 特定 run を中間物＋レポート両方削除

```
/persona-feedback:clean --timestamp 20260511-100000 --include-reports
```

### 何が消えるか先に確認

```
/persona-feedback:clean --dry-run --keep-last 1
```

## 注意

- 削除は `rm -rf` 相当で復元不可。`--dry-run` で確認するのが安全。
- `.persona-feedback/` ディレクトリ自体は残し、中の `<timestamp>` ディレクトリのみを削除する。
- `--include-reports` を指定しない限り `reports/` 配下は触らない。
