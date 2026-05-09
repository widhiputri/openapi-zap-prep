'use strict';

const fs   = require('fs');
const path = require('path');
const { loadSpec }                    = require('./loader');
const { validateSpec, computeCoverage } = require('./validate');
const { sanitiseSpec, writeSanitised }  = require('./sanitise');

function runPrep(config, opts = {}) {
  const results = [];

  for (const specConfig of (config.specs || [])) {
    const specPath       = specConfig.path;
    const label          = specConfig.label || path.basename(specPath);
    const expectedPrefix = specConfig.expectedPrefix || '';

    if (!fs.existsSync(specPath)) {
      results.push({ label, specPath, issues: [{ type: 'error', message: `File not found: ${specPath}` }], coverage: null, outputPath: null, applied: [] });
      continue;
    }

    const { json, parsed } = loadSpec(specPath);
    const issues   = validateSpec(json, parsed, { expectedPrefix });
    const coverage = computeCoverage(parsed);

    let outputPath = null;
    let applied    = [];

    if (opts.sanitise !== false) {
      const result = sanitiseSpec(json, {
        fixes:          config.fixes   || {},
        examples:       config.examples || {},
        expectedPrefix,
      });
      applied    = result.applied;
      outputPath = writeSanitised(specPath, result.content);
    }

    results.push({ label, specPath, issues, coverage, outputPath, applied });
  }

  return results;
}

module.exports = { runPrep };
