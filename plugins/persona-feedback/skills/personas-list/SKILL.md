---
name: personas-list
description: Use when the user wants to see which personas are available
  (built-in + project-local). Triggers include "ペルソナ一覧", "どんなペルソナ
  があるか", "list personas", "what personas can I use". Outputs a compact
  table of personas with their key attributes.
---

# personas-list

利用可能なペルソナ（プラグイン同梱 + cwd 配下 `personas/`）の一覧を表示する。

## 実行

このスキルのディレクトリから見て `../../scripts/list-personas.mjs` を実行する:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-personas.mjs"
```

`${CLAUDE_PLUGIN_ROOT}` が展開されない場合は、現在実行中のプラグイン
（`persona-feedback`）のキャッシュパスを find で解決して同じスクリプトを
呼んでよい。出力はそのままユーザーに見せる。

## 引数

スキルは引数を取らない。`--json` で機械可読出力が欲しい場合は
直接スクリプトを呼ぶ:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-personas.mjs" --json
```

## 表示する列

| 列 | 意味 |
|---|---|
| SRC | `bundled` (同梱) または `user` (cwd/personas/) |
| ID | ペルソナ ID（`persona-tester` で指定する識別子） |
| NAME | 表示名 |
| AGE | 年齢 |
| TECH | tech_literacy (low/medium/high) |
| DEVICE | desktop/mobile/tablet |
| TONE | vocabulary.tone |
| GOAL | context.goal の冒頭 |

## 補足

ユーザーが「特定のペルソナの詳細が見たい」と言った場合は、該当 YAML を
Read して `behavior_rules` などを含めて返す。
