/**
 * normalize-location.mjs
 *
 * persona feedback の `location`（自由文の DOM 説明 / URL / 画面名）を粗く正規化する。
 * 完全一致は諦め、目立つ語だけ拾える形にする。aggregate.mjs と diff-reports.mjs の
 * findings マッチで同じ規則を使うため共通モジュールに切り出す（PR #17 レビュー指摘）。
 *
 * Strip 対象:
 *   - 全角／半角の空白
 *   - 各種引用符（半角・全角・コードフェンス）
 *   - 句読点（半角・全角）
 *   - 括弧（半角・全角）
 *   - 中黒
 *   - ハイフン類（半角ハイフン / マイナス符号 / 長音符）
 *
 * 例:
 *   "送信ボタン" と "「送信」ボタン　" → 同じ
 *   "送信ボタン" と "（送信）ボタン" → 同じ
 *   "ID・パスワード" と "ID パスワード" → 同じ
 */

export function normalizeLocation(loc) {
  if (!loc) return '';
  return String(loc)
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/["'`「」『』]/g, '')
    .replace(/[、。,;.!?！？:：]/g, '')
    .replace(/[()（）\[\]【】]/g, '')
    .replace(/[・･]/g, '')
    .replace(/[-‐–—−ー]/g, '');
}

/**
 * finding の `page`（URL またはパス）を画面単位のキーに正規化する。
 * オリジン・クエリ・フラグメント・末尾スラッシュを落とし、小文字化する。
 *
 * 例:
 *   "http://localhost:3000/products/new/?tab=1#top" → "/products/new"
 *   "/Products/New/" → "/products/new"
 */
export function normalizePage(page) {
  if (!page) return '';
  let p = String(page).trim();
  const m = p.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i);
  if (m) p = m[1];
  p = p.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

/**
 * finding の場所キー。`page` があれば「page + element」、無ければ自由文の
 * `location` を使う（page 導入前のフィードバックとの後方互換）。
 */
export function locationKey(find) {
  if (find && find.page) {
    return `${normalizePage(find.page)}#${normalizeLocation(find.element)}`;
  }
  return normalizeLocation(find?.location);
}
