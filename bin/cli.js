#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runPrep } = require('../src/prep');

const R    = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM  = '\x1b[2m';
const RED  = '\x1b[31m';
const GRN  = '\x1b[32m';
const YLW  = '\x1b[33m';
const CYN  = '\x1b[36m';

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage:
  openapi-zap-prep --config <file> [options]

Options:
  --config,   -c <file>    Path to prep config file (YAML or JSON)
  --fail-on      <list>    Comma-separated check types that cause non-zero exit
                           Types: duplicate-paths, duplicate-keys, bad-schema-refs,
                                  missing-param-examples, missing-body-examples,
                                  prefix-mismatch, missing-security,
                                  nullable-no-example, array-no-maxitems
  --no-sanitise            Skip writing .tmp.json sanitised files
  --output,   -o <file>    Write results to a JSON file
  --help,     -h           Show this help

Examples:
  openapi-zap-prep --config prep.config.yml
  openapi-zap-prep --config prep.config.yml --fail-on missing-param-examples,duplicate-paths
  openapi-zap-prep --config prep.config.yml --no-sanitise --output results.json
`);
  process.exit(0);
}

let configFile  = null;
let failOn      = [];
let noSanitise  = false;
let outputFile  = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--config'  || args[i] === '-c') && args[i + 1]) configFile = args[++i];
  else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) outputFile = args[++i];
  else if (args[i] === '--fail-on'     && args[i + 1]) failOn = args[++i].split(',').map(s => s.trim());
  else if (args[i] === '--no-sanitise') noSanitise = true;
}

if (!configFile) { console.error('Error: --config is required'); process.exit(1); }
if (!fs.existsSync(configFile)) { console.error(`Error: config file not found: ${configFile}`); process.exit(1); }

let config;
try {
  const raw = fs.readFileSync(configFile, 'utf8');
  config = configFile.match(/\.ya?ml$/i) ? yaml.load(raw) : JSON.parse(raw);
} catch (e) {
  console.error(`Error loading config: ${e.message}`);
  process.exit(1);
}

const pkg = require('../package.json');
console.log(`\n${BOLD}openapi-zap-prep${R} ${DIM}v${pkg.version}${R}\n`);

let results;
try {
  results = runPrep(config, { sanitise: !noSanitise });
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

let totalIssues   = 0;
let totalWarnings = 0;
let exitCode      = 0;

for (const r of results) {
  const hasIssues = r.issues.length > 0;
  console.log(`${BOLD}● ${r.label}${R}  ${DIM}${r.specPath}${R}`);

  if (!hasIssues) {
    console.log(`  ${GRN}✓${R}  No issues found`);
  } else {
    for (const issue of r.issues) {
      const colour = issue.type === 'error' ? RED : YLW;
      console.log(`  ${colour}⚠${R}  ${DIM}[${issue.type}]${R} ${issue.message}`);
      totalWarnings++;
    }
  }
  totalIssues += r.issues.length;

  if (r.coverage) {
    const { total, covered, rate } = r.coverage;
    const colour = rate === 100 ? GRN : rate >= 80 ? YLW : RED;
    console.log(`\n  ${DIM}Coverage:${R}  ${colour}${covered}/${total} endpoints with examples (${rate}%)${R}`);
  }

  if (r.outputPath) {
    const fixMsg = r.applied.length > 0
      ? `fixes applied: ${r.applied.join(', ')}`
      : 'no changes needed';
    console.log(`  ${DIM}Sanitised:${R}  ${CYN}${r.outputPath}${R} ${DIM}(${fixMsg})${R}`);
  }

  if (failOn.length > 0) {
    const blocking = r.issues.filter(i => failOn.includes(i.type));
    if (blocking.length > 0) exitCode = 1;
  }

  console.log('');
}

const line = '─'.repeat(50);
console.log(line);
const specCount = results.length;
const verdict   = exitCode > 0
  ? `${RED}${BOLD}FAILED${R}`
  : totalWarnings === 0 ? `${GRN}${BOLD}PASSED${R}` : `${YLW}${BOLD}WARNED${R}`;
console.log(`${verdict}  ${specCount} spec(s)  |  ${totalWarnings} warning(s)\n`);

if (failOn.length > 0 && exitCode > 0) {
  console.log(`${RED}Failing due to --fail-on: ${failOn.join(', ')}${R}\n`);
}

if (outputFile) {
  fs.writeFileSync(outputFile, JSON.stringify({ specs: results }, null, 2));
  console.log(`Results written to: ${path.resolve(outputFile)}\n`);
}

process.exit(exitCode);
