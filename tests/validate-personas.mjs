#!/usr/bin/env node
/**
 * 同梱ペルソナ YAML が persona.schema.json に準拠していること、および
 * sample-run の feedback サンプルが feedback.schema.json に準拠していることを検証する。
 *
 * Usage:
 *   npm install   # ajv / ajv-formats / yaml を入れる
 *   node tests/validate-personas.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PERSONA_SCHEMA = JSON.parse(readFileSync(
  join(ROOT, 'plugins/persona-feedback/skills/persona-tester/schemas/persona.schema.json'),
  'utf8'
));
const FEEDBACK_SCHEMA = JSON.parse(readFileSync(
  join(ROOT, 'plugins/persona-feedback/skills/persona-tester/schemas/feedback.schema.json'),
  'utf8'
));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validatePersona = ajv.compile(PERSONA_SCHEMA);
const validateFeedback = ajv.compile(FEEDBACK_SCHEMA);

let failed = 0;

function check(label, ok, errors) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
    for (const e of errors || []) {
      console.error(`     - ${e.instancePath} ${e.message}`);
    }
  }
}

console.log('## Persona YAMLs');
const personasDir = join(ROOT, 'plugins/persona-feedback/personas');
for (const f of readdirSync(personasDir).filter(x => x.endsWith('.yaml')).sort()) {
  const data = parseYaml(readFileSync(join(personasDir, f), 'utf8'));
  const ok = validatePersona(data);
  check(f, ok, validatePersona.errors);
}

console.log('## Feedback samples');
const sampleDirs = [
  'examples/runs/sample-run/raw',
  'examples/runs/sample-run-recommend-split/raw',
];
for (const rel of sampleDirs) {
  const dir = join(ROOT, rel);
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const ok = validateFeedback(data);
    check(`${rel}/${f}`, ok, validateFeedback.errors);
  }
}

if (failed > 0) {
  console.error(`\n${failed} schema violation(s).`);
  process.exit(1);
}
console.log('\nAll schemas pass.');
