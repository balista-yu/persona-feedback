#!/usr/bin/env node
/**
 * list-personas.mjs
 *
 * プラグイン同梱のペルソナと、ユーザー作業ディレクトリ (cwd) 配下の
 * personas/*.yaml を読み、主要フィールドの表を標準出力に印字する。
 *
 * Usage:
 *   node list-personas.mjs          # 表形式
 *   node list-personas.mjs --json   # JSON 配列で出力
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

function findPersonaDirs() {
  const dirs = [];
  // 同梱ペルソナ
  const bundled = join(PLUGIN_ROOT, 'personas');
  if (existsSync(bundled) && statSync(bundled).isDirectory()) {
    dirs.push({ source: 'bundled', dir: bundled });
  }
  // cwd 配下のユーザーペルソナ
  const userDir = join(process.cwd(), 'personas');
  if (existsSync(userDir) && statSync(userDir).isDirectory() && userDir !== bundled) {
    dirs.push({ source: 'user', dir: userDir });
  }
  return dirs;
}

function loadPersonas() {
  const out = [];
  for (const { source, dir } of findPersonaDirs()) {
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
    for (const f of files) {
      try {
        const data = parseYaml(readFileSync(join(dir, f), 'utf8'));
        out.push({
          source,
          file: f,
          id: data.id || '',
          name: data.name || '',
          age: data.demographics?.age ?? '',
          tech_literacy: data.demographics?.tech_literacy || '',
          device: data.context?.device || '',
          tone: data.vocabulary?.tone || '',
          goal: data.context?.goal || '',
        });
      } catch (e) {
        out.push({ source, file: f, id: '', name: `(parse error: ${e.message})` });
      }
    }
  }
  return out;
}

function pad(s, n) {
  s = String(s);
  // 日本語幅は厳密ではないので緩めにそろえる
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 127 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
}

function renderTable(rows) {
  if (rows.length === 0) {
    return '(no personas found)\n';
  }
  const headers = ['SRC', 'ID', 'NAME', 'AGE', 'TECH', 'DEVICE', 'TONE', 'GOAL'];
  const widths = [9, 16, 28, 5, 7, 8, 12, 40];
  const lines = [];
  lines.push(headers.map((h, i) => pad(h, widths[i])).join(' '));
  lines.push(widths.map(w => '-'.repeat(w)).join(' '));
  for (const r of rows) {
    lines.push([
      pad(r.source, widths[0]),
      pad(r.id, widths[1]),
      pad(r.name, widths[2]),
      pad(r.age, widths[3]),
      pad(r.tech_literacy, widths[4]),
      pad(r.device, widths[5]),
      pad(r.tone, widths[6]),
      pad(r.goal, widths[7]),
    ].join(' '));
  }
  return lines.join('\n') + '\n';
}

function main() {
  const wantJson = process.argv.includes('--json');
  const rows = loadPersonas();
  if (wantJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    process.stdout.write(renderTable(rows));
  }
}

main();
