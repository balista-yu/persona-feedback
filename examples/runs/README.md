# examples/runs

`persona-feedback` を実行したときの出力サンプル。実際の MCP/Playwright を
動かさずに、aggregate スクリプトの出力例を確認するために用意した。

## sample-run/

3ペルソナで `examples/demo-app` をテストしたときの想定出力。

- `raw/<persona_id>.json` — 各 persona-runner からの生フィードバック
- `report.md` — Markdown 統合レポート
- `report.json` — JSON 統合レポート

自分でも生成したい場合は:

```bash
node plugins/persona-feedback/skills/persona-tester/scripts/aggregate.mjs \
  --feedbacks examples/runs/sample-run/raw \
  --output /tmp/regen.md \
  --format both
```
