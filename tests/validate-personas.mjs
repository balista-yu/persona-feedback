#!/usr/bin/env node
/**
 * 同梱ペルソナYAMLが persona.schema.json に準拠していること、および
 * feedback サンプルが feedback.schema.json に準拠していることを検証する。
 *
 * 依存: ajv (npm i -g ajv yaml) を CI 側で入れる。
 *
 * Usage:
 *   node tests/validate-personas.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

let Ajv2020, parseYaml, addFormats;
try {
  const ajvMod = await import('ajv/dist/2020.js');
  Ajv2020 = ajvMod.default || ajvMod.Ajv2020;
  const formatsMod = await import('ajv-formats');
  addFormats = formatsMod.default || formatsMod;
  const yamlMod = await import('yaml');
  parseYaml = yamlMod.parse;
} catch (e) {
  console.error('Missing deps. Install: npm i ajv ajv-formats yaml');
  console.error(e.message);
  process.exit(2);
}

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
for (const f of readdirSync(personasDir).filter(x => x.endsWith('.yaml'))) {
  const data = parseYaml(readFileSync(join(personasDir, f), 'utf8'));
  const ok = validatePersona(data);
  check(f, ok, validatePersona.errors);
}

console.log('## Feedback samples');
const rawDir = join(ROOT, 'examples/runs/sample-run/raw');
for (const f of readdirSync(rawDir).filter(x => x.endsWith('.json'))) {
  const data = JSON.parse(readFileSync(join(rawDir, f), 'utf8'));
  const ok = validateFeedback(data);
  check(`sample-run/raw/${f}`, ok, validateFeedback.errors);
}

if (failed > 0) {
  console.error(`\n${failed} schema violation(s).`);
  process.exit(1);
}
console.log('\nAll schemas pass.');
