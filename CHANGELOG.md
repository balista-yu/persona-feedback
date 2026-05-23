# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

実運用フィードバック (issue #5) 反映 + 0.1.0 marketplace 版に残っていた
MCP ツール名バグの修正。リリース版に切るタイミングで [0.1.x] セクションに移行する。

### Added (issue #9: UX Regression diff)
- **`scripts/diff-reports.mjs`**: 2つの aggregate レポート JSON を比較し
  ペルソナ別スコア差分 / outcome 変化 / findings 追加・消失 / 行動メトリクス変化
  を抽出する module + CLI。`diffReports` / `renderDiffMarkdown` /
  `findPreviousReport` をエクスポート。findings マッチは
  `category + 正規化 location` で誤マージを防ぐ。
- **aggregate.mjs に `--baseline` / `--auto-baseline-dir` フラグ**: 渡したときに
  レポート先頭へ `🔁 変更サマリ (UX Regression)` セクションを挿入する。
  `--auto-baseline-dir ./reports` は同 target / task の繰り返し評価で
  最新の1つ前を自動採用する推奨運用。
- **新スキル `diff`**: `/persona-feedback:diff` で任意の2 run を比較。引数なしで
  `./reports/` 配下の最新2件を自動採用。Markdown / JSON 出力。
- **persona-tester SKILL の集約フェーズ**: 例示コマンドを
  `--format both --auto-baseline-dir ./reports` に更新し、Lint としての位置付けを明文化。
- **`tests/test-diff-reports.mjs`**: 14 件のユニットテスト
  （スコア / outcome / 追加・消失・継続 / location 表記揺れ / target・task mismatch /
  metrics / Markdown / findPreviousReport）。
- **`npm run diff <args>`**: CLI ショートカット。

#### レビュー反映 (PR #17 → 反映)
- **`scripts/normalize-location.mjs` を共通モジュール化**: aggregate.mjs と
  diff-reports.mjs で重複していた `normalizeLocation` を抽出。
  カバレッジを拡大し、**全角・半角括弧** (`（）` / `()` / `[]` / `【】`)、
  **中黒** (`・` / `･`)、**ハイフン類** (半角 / en/em dash / 長音符 `ー`) を新たに strip 対象に。
- **target / task mismatch ガード**: `diffReports` の戻り値に `warnings` フィールドを追加し、
  違う URL / タスクを baseline に指定したら `target_mismatch` / `task_mismatch` を出す。
  `renderDiffMarkdown` でレポート冒頭に `### ⚠️ 警告` セクションとして表示。
  `--auto-baseline-dir` 自動採用時に誤った baseline を silent で使う事故を防ぐ。
- **`--reports-dir` モードで 2 件未満なら warn skip (exit 0)**: 初回実行直後に
  `/persona-feedback:diff` を呼んでも CI を落とさない。`--auto-baseline-dir`
  （null returned → silent skip）と挙動を揃える。
- **`synthCurrent` round-trip 解消**: `buildReportObject()` を切り出し、
  diff 用の擬似 report を JSON.stringify → parse せず直接構築。
  `computeMetrics` の二重計算もなくなる。
- **`tests/test-normalize-location.mjs`**: 共通モジュールの 9 件ユニットテスト。

### Added (issue #13: behavior_metrics)
- **`action_log` フィールド**: feedback.schema.json に追加。persona-runner が
  各 MCP ツール呼び出し（navigate / snapshot / click / type / select / press_key /
  scroll / back / cancel / screenshot / give_up / wait）の前後で時刻付きエントリ
  を記録する。
- **`scripts/behavior-metrics.mjs`**: action_log から hesitation_seconds (snapshot →
  次の意味ある操作までの秒数) / scroll_back_and_forth / back_or_cancel_count /
  time_on_screen_seconds を計算する module。`computeMetrics` / `detectMismatch` /
  `renderSectionMarkdown` をエクスポート。
- **言葉と行動の食い違い検出**: overall ≥ 7 または outcome=completed のときに
  hesitation_mean ≥ 5s / back_or_cancel ≥ 3 / scroll_back_and_forth ≥ 4 のいずれかが
  成立すると赤フラグ。AI ペルソナが「分かりやすかった」と言いつつ実は迷っていた
  ケースを拾う。
- **aggregate.mjs 拡張**: 統合レポートに `## 🧭 行動メトリクス` セクションを追加。
  Markdown では表 + 食い違いフラグ + 折りたたみで時刻別滞在時間、JSON では
  `behavior_metrics[]` キーで永続化。
- **persona-runner.md 更新**: action_log 記録を必須責務として明文化。出力 JSON 例
  にも action_log を含めた。
- **`examples/runs/sample-run-behavior-metrics/`**: 「完走したのに迷ってる」
  ケースを示すサンプル。tanaka-60s が overall=8 で食い違いフラグが立つ。
- **`tests/test-behavior-metrics.mjs`**: hesitation / scroll / back・cancel /
  time_on_screen / mismatch 検出 / Markdown レンダリングのユニットテスト 16 件。

#### レビュー反映 (PR #16 → 反映)
- **PR #15 と `package.json` の test 行を統合**: `test-behavior-rules.mjs` →
  `test-behavior-metrics.mjs` → `validate-personas.mjs` の順でチェーン。
- **mismatch メッセージを `positive` / `completed` で分岐**: `outcome=completed && overall<7`
  のケースで「好評価」と誤表示する齟齬を解消。「言葉では好評価」「言葉では好評価かつ完走」
  「完走したのに」の3パターンを出し分け。
- **mismatch しきい値を const 化**: `MISMATCH_OVERALL_POSITIVE=7` /
  `MISMATCH_HESITATION_SECONDS=5` / `MISMATCH_BACK_OR_CANCEL=3` /
  `MISMATCH_SCROLL_BACK=4` を module top に集約。将来 ENV/設定で上書きしやすい構造に。
- **`time_on_screen` 最終画面の終了時刻に `feedback.duration_seconds` を採用**:
  完走後に結果ページを眺めている時間が0扱いになる問題を解消。`duration_seconds` が
  末尾 entry より小さい場合は無視（fallback）。
- **`navigate` を `MEANINGFUL_ACTIONS` に追加**: `snapshot → URL ジャンプ`時に
  pendingSnapshotAt がリセットされず後続 click まで hesitation が膨らむ問題を回避。
  `wait` / `screenshot` / `give_up` は意図的に除外（コメント明記）。
- **`UNKNOWN_LOCATION` を module-level const に**: マジック文字列を排除。

### Added (issue #11: structured behavior_rules DSL)
- **構造化 DSL の `behavior_rules` をスキーマで受理**: 既存の配列（自由文）
  形式に加え、`give_up_after` / `panic_on` / `lexical.{block_jargon,confused_by}` /
  `attention_span` / `reading_speed` / `on_ambiguous_button` / `custom` の
  能力減算プリミティブをオブジェクト形式で書ける。`persona.schema.json` を
  `oneOf` 対応に拡張。
- **`scripts/behavior-rules.mjs`**: 構造化 DSL を自然文制約のリストに
  展開する renderer。CLI として `node behavior-rules.mjs render <persona.yaml>`
  でも、モジュール `renderBehaviorRules` / `expandStructured` でも呼べる。
- **同梱ペルソナ `yamada-50s-dsl.yaml`**: 構造化 DSL の使用例。
  50代・はじめてのオンラインショップ・慎重派。
- **`persona-tester` SKILL 更新**: 構造化 DSL の場合は `behavior-rules.mjs render`
  の出力を「守るべき制約」セクションとして runner プロンプトに inject する手順を
  明文化。runner 側は legacy/DSL のどちらも自然文リストとして受け取り、扱いが
  分岐しない。**YAML 内の `behavior_rules:` ブロックは展開済みリストで置換**して
  渡し、DSL の生形式は runner に見せない（独自解釈の余地を残さない）。
- **`persona-builder` SKILL / persona.template.yaml 更新**: 構造化 DSL の
  雛形とプリミティブ一覧、および `lexical` と top-level `vocabulary` の役割分担を反映。
- **`docs/persona-spec.md`**: プリミティブ一覧表、両形式のサンプル、
  「ペルソナ＝制約セット」という再定義を追記。
- **`tests/test-behavior-rules.mjs`**: legacy/DSL 双方の renderer ユニット
  テスト 19 件 + スキーマ拒否ケース 8 件。`npm test` で validate-personas と合わせて走る。
- **`npm run render-rules <persona.yaml>`**: CLI ショートカット。

#### レビュー反映 (PR #15 → 反映)
- **DSL 内 `vocabulary` を `lexical` にリネーム**: トップレベル `vocabulary`
  (tone / avoid_terms = 「どう話すか」) と DSL 内のキー
  (block_jargon / confused_by = 「何を理解できないか」) の衝突を解消。
  公開前の破壊変更として吸収。
- **スキーマで 0 を拒否**: `give_up_after` / `attention_span` のパターンを
  `[1-9]\d*` ベースに変更。`0_retries` / `0s` などの no-op 値を弾く。
- **配列プリミティブに `minItems: 1`**: `panic_on` / `lexical.confused_by` /
  `custom` で空配列の silent no-op を防ぐ。
- **runner プロンプトの inject ルール明文化**: DSL 形式は YAML から
  `behavior_rules:` を削除し、展開済みリストで置換する手順を SKILL.md に追記。

### Added (this iteration)
- **出力構造の二段分離**: 中間物（スクリーンショット / 生 JSON）を
  隠しディレクトリ `./.persona-feedback/<timestamp>/` に隔離し、最終
  レポート（Markdown / JSON）だけ `./reports/<timestamp>-report.*` に
  残す方式に変更。`.mcp.json` の `--output-dir` を `./reports` →
  `./.persona-feedback` に変更。`.gitignore` も更新。「PJ ルート直下
  に png が散乱する」問題への対処。
- **新スキル `clean`**: `/persona-feedback:clean` で中間物の一括削除。
  `--keep-last <N>` で最新 N run 分のみ保持、`--include-reports` で
  最終レポートも対象、`--dry-run` で削除対象を事前確認可。
- **`scripts/clean.mjs`**: 上記 clean スキルの実体ユーティリティ。
  YYYYMMDD-HHmmss 形式の timestamp ディレクトリのみを対象にし、
  意図しないディレクトリ削除を防ぐ。
- **新スキル `personas-list`**: 同梱+ユーザー定義のペルソナを表で一覧
  表示する。自然言語（「ペルソナ一覧」等）でも
  `/persona-feedback:personas-list` でも起動可。
- **`scripts/list-personas.mjs`**: id / name / age / tech_literacy /
  device / tone / goal を抜き出した表または JSON を出力する Node 製
  ユーティリティ。
- **`persona-tester` の $ARGUMENTS 対応**:
  `/persona-feedback:persona-tester <personas> <url> <task>` 形式の
  スラッシュ呼び出しをサポート。`personas` にカンマ区切り ID と特別
  キーワード `all` / `bundled` / `user` を受け付ける。
- **persona-tester の対話モード**: ペルソナ未指定で呼ばれた場合、
  list-personas.mjs で一覧を提示し AskUserQuestion で複数選択させて
  起動する fallback を SKILL.md に明文化。

### Fixed
- **MCP ツール名**: プラグイン経由公開時の名前空間
  `mcp__plugin_persona-feedback_playwright__*` に persona-runner の
  `tools:` を一致させた。これまでブラウザツールが一切見えず
  3 ペルソナとも `outcome: blocked` で終わっていた問題を解消 (#4)。
- **並列実行でのブラウザ共有**: `.mcp.json` に `--isolated` を追加し、
  ペルソナごとに別ブラウザコンテキストを割り当て。「他人の入力が
  自分のフォームに見える」偽陽性 critical が発生しなくなった (#5 P0-1)。
- **スクリーンショット保存先**: `--output-dir ./reports` で MCP が
  直接 reports 配下に書くようにし、親エージェントが `<timestamp>/screenshots/`
  プレフィクスを inject する仕組みを SKILL.md / persona-runner.md に明記
  (#5 P1-6)。
- **aggregate.mjs の引数**: `--feedbacks` を複数パス受付（可変長）に拡張。
  自然な空白区切り渡しで最初の1つしか拾えない問題を解消 (#5 P1-3)。
- **all-agreement 検出**: location 表現がペルソナ間で揺れても
  `category + severity ≥ high` で全員一致を救う secondary 経路を追加。
  「全員が同じ critical を指摘しても segment-specific に散らばる」
  問題を解消 (#5 P1-4)。
- **/skill 記法廃止**: 自然言語呼び出しに統一 (#3)。
- **`/plugin marketplace add` 記法**: `github:owner/repo` → `owner/repo`
  に修正 (#2)。

### Added
- **`scripts/save-raw.mjs`**: persona-runner の戻り値から JSON 抽出 →
  軽バリ → `reports/<ts>/raw/<persona_id>.json` 保存を1コマンドで
  まとめて行うユーティリティ。SKILL.md の「回収＆永続化フェーズ」を
  このスクリプト呼び出しに簡素化 (#5 P1-5)。
- **コスト目安テーブル**を SKILL.md に追加。`max_parallel` 既定値を
  5 → 3 に下げ、4 体以上は起動前にユーザー確認を取る仕様に (#5 P2-7)。
- **MCP permission allowlist セットアップ手順** を README と
  getting-started に追加。サブエージェントが background なので
  permission prompt を承認できない問題への対処 (#5 P0-2)。
- 検証用サンプル `examples/runs/sample-run-location-varied/` を追加し、
  category-only 経路を CI でも smoke 検証。

### Changed
- `.mcp.json` の Playwright MCP 起動引数に `--isolated` と
  `--output-dir ./reports` を追加。
- `agents/persona-runner.md` の screenshot 保存規約を明文化。
- `tests/validate-personas.mjs` が新サンプルも検証対象に。

## [0.1.0] - 2026-05-11

### Added
- Initial release of `persona-feedback` Claude Code plugin.
- `persona-builder` skill: 自然言語コンテキストからペルソナYAMLを生成。
- `persona-tester` skill: Playwright MCP 経由でペルソナがWebアプリを操作し、
  構造化フィードバックを並列で集約。
- 同梱ペルソナ3体（`tanaka-60s`, `gal-20s`, `dev-engineer`）。
- `persona-runner` サブエージェント定義。
- `persona.schema.json` と `feedback.schema.json`。
- Node.js 製の集約スクリプト `scripts/aggregate.mjs`（不一致点抽出）。
- サンプル静的HTMLアプリ `examples/demo-app/`（意図的なUI課題を内包）。
- GitHub Actions: スキーマ検証 (`validate.yml`) とタグリリース (`release.yml`)。
- ドキュメント: `getting-started`, `persona-spec`, `feedback-spec`, `architecture`。

[Unreleased]: https://github.com/balista-yu/persona-feedback/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/balista-yu/persona-feedback/releases/tag/v0.1.0
