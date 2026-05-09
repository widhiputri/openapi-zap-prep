'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function loadSpec(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  let parsed = null;
  try {
    parsed = (ext === '.yaml' || ext === '.yml') ? yaml.load(raw) : JSON.parse(raw);
  } catch {}
  // Normalise to JSON string for consistent regex-based checks and sanitisation
  const json = parsed ? JSON.stringify(parsed, null, 2) : raw;
  return { raw, json, parsed };
}

module.exports = { loadSpec };
