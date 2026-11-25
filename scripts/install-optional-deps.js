#!/usr/bin/env node
'use strict';

/**
 * Install optional SDKs on demand (see src/utils/optional-deps.js).
 *
 *   node scripts/install-optional-deps.js              # auto-detect from .env + process env
 *   node scripts/install-optional-deps.js s3 meili     # explicit features
 *   node scripts/install-optional-deps.js --list       # show features and status
 *   add --save to record them in package.json instead of --no-save
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { FEATURES, enabledFeatures, isInstalled } = require('../src/utils/optional-deps');

const root = path.resolve(__dirname, '..');

// Minimal .env reader (single-line KEY=VALUE only; enough for feature flags).
function readDotEnv() {
  const file = path.join(root, '.env');
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const args = process.argv.slice(2);
const save = args.includes('--save');
const names = args.filter((a) => !a.startsWith('--'));
const env = { ...readDotEnv(), ...process.env };

if (args.includes('--list')) {
  const on = new Set(enabledFeatures(env));
  for (const [name, f] of Object.entries(FEATURES)) {
    const pkgs = Object.keys(f.packages);
    const installed = pkgs.every(isInstalled);
    console.log(`${name.padEnd(6)} ${on.has(name) ? 'enabled ' : 'disabled'}  ${installed ? 'installed' : 'missing  '}  ${f.description}`);
  }
  process.exit(0);
}

const unknown = names.filter((n) => !FEATURES[n]);
if (unknown.length) {
  console.error(`Unknown feature(s): ${unknown.join(', ')}. Known: ${Object.keys(FEATURES).join(', ')}`);
  process.exit(1);
}

const features = names.length ? names : enabledFeatures(env);
if (!features.length) {
  console.log('No optional features enabled — nothing to install (local media library, memory/DB sessions).');
  process.exit(0);
}

const specs = [];
for (const f of features) {
  for (const [pkg, version] of Object.entries(FEATURES[f].packages)) {
    if (!isInstalled(pkg)) specs.push(`${pkg}@${version}`);
  }
}

if (!specs.length) {
  console.log(`Already installed for: ${features.join(', ')}`);
  process.exit(0);
}

console.log(`Installing for [${features.join(', ')}]: ${specs.join(' ')}`);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const res = spawnSync(npm, ['install', save ? '--save' : '--no-save', ...specs], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(res.status ?? 1);
