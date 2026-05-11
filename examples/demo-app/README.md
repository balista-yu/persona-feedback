# demo-app

`persona-feedback` のスモークテスト用に、**意図的に UX 課題を仕込んだ** 静的サンプルアプリ。

## 起動

```bash
cd examples/demo-app
python3 -m http.server 8000
# → http://localhost:8000/
```

依存なし。Python 3 だけあれば動く。

## 仕込んだ課題（伏せて読んでも良いし、答え合わせ用に読んでも良い）

| # | 課題 | 反応してほしいペルソナ |
|---|------|--------------------|
| 1 | 全体的に文字が小さく低コントラスト | tanaka-60s（accessibility） |
| 2 | viewport meta なし＋固定幅 1024px | gal-20s（mobile_optimization） |
| 3 | アイコンのみのナビボタン（aria-label 空） | tanaka-60s、dev-engineer（accessibility） |
| 4 | 専門用語 (OAuth, アセット, レコメンデーション) | tanaka-60s（copywriting） |
| 5 | 登録フォームの入力項目が多すぎる（クレカまで） | gal-20s（usability）、dev-engineer（trust） |
| 6 | プライバシーポリシーへのリンクが極小・色も薄い | dev-engineer（trust） |
| 7 | エラーメッセージが `ERR_PW_001: input invalid` | 共通（copywriting / error_recovery） |
| 8 | 「Get Started」が英語のまま | tanaka-60s（copywriting） |

すべて発見されればスキルの品質OK、というスモークテストの教材。
