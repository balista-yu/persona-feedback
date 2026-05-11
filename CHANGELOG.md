# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
