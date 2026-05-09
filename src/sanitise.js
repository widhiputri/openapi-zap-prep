'use strict';

const fs   = require('fs');
const path = require('path');

function sanitiseSpec(json, options = {}) {
  const { fixes = {}, examples = {}, expectedPrefix = '' } = options;
  let content = json;
  const applied = [];

  if (fixes.renameSchemaKeys !== false) {
    const before = content;
    // Collect bad names from $ref usage, then rename both definition keys and all $refs
    const badNames = new Set();
    for (const m of content.matchAll(/"#\/components\/([^"]*[ &][^"]*)"/g)) {
      badNames.add(m[1].split('/').pop());
    }
    for (const bad of badNames) {
      const clean = cleanSchemaName(bad);
      // Rename the definition key inside components
      content = content.replace(new RegExp(`"${escapeRegex(bad)}"\\s*:`, 'g'), `"${clean}":`);
      // Rename all $ref usages
      content = content.replace(
        new RegExp(`"(#/components/[^"]*/)${escapeRegex(bad)}"`, 'g'),
        `"$1${clean}"`
      );
    }
    if (content !== before) applied.push('renameSchemaKeys');
  }

  if (fixes.normalizePathPrefixes !== false && expectedPrefix) {
    const before = content;
    content = normalizePrefixes(content, expectedPrefix);
    if (content !== before) applied.push('normalizePathPrefixes');
  }

  if (fixes.removeDuplicatePaths !== false) {
    const before = content;
    content = removeDuplicatePaths(content);
    if (content !== before) applied.push('removeDuplicatePaths');
  }

  if (fixes.repairMissingResponses !== false) {
    const before = content;
    // Add stub 200 response to write methods that have requestBody but no responses
    content = content.replace(
      /("(?:post|put|patch|delete)"\s*:\s*\{(?:(?!"responses")[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)"requestBody"/g,
      '$1"responses":{"200":{"description":"OK"}},"requestBody"'
    );
    if (content !== before) applied.push('repairMissingResponses');
  }

  if (fixes.injectPathParamExamples !== false && Object.keys(examples).length > 0) {
    const before = content;
    for (const [param, val] of Object.entries(examples)) {
      const escaped = escapeRegex(param);
      // Match params with empty example and fill them in
      content = content.replace(
        new RegExp(`("name":\\s*"${escaped}"[\\s\\S]{0,400}?)"example":\\s*""`, 'g'),
        `$1"example": "${val}"`
      );
      // Handle UUID variant: e.g. userId → userUuid
      if (param.endsWith('Id')) {
        const uuidParam = param.slice(0, -2) + 'Uuid';
        content = content.replace(
          new RegExp(`("name":\\s*"${escapeRegex(uuidParam)}"[\\s\\S]{0,400}?)"example":\\s*""`, 'g'),
          `$1"example": "${val}"`
        );
      }
    }
    if (content !== before) applied.push('injectPathParamExamples');
  }

  return { content, applied };
}

function normalizePrefixes(content, expectedPrefix) {
  // Strip trailing slash from prefix for comparison
  const prefix = expectedPrefix.replace(/\/$/, '');
  // Find parent prefix (e.g. /api/v1/admin → /api/v1)
  const lastSlash = prefix.lastIndexOf('/');
  const parent    = lastSlash > 0 ? prefix.slice(0, lastSlash) : '';
  const segment   = prefix.slice(lastSlash + 1); // e.g. "admin"

  if (parent) {
    // Paths starting with parent but missing the next segment: /api/v1/users → /api/v1/admin/users
    content = content.replace(
      new RegExp(`"(${escapeRegex(parent)}/)(?!${escapeRegex(segment)}/)([^"]+)"(\\s*:)`, 'g'),
      `"${prefix}/$2"$3`
    );
  }
  // Paths not starting with any part of the prefix at all → prepend full prefix
  content = content.replace(
    new RegExp(`"(\\/(?!${escapeRegex(prefix.slice(1))})[a-zA-Z{][^"]*)"(\\s*:)`, 'g'),
    `"${prefix}$1"$2`
  );
  return content;
}

function removeDuplicatePaths(content) {
  const lines = content.split('\n');
  const seen  = new Map();
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^\s*"(\/[^"]+)"\s*:/);
    if (m) {
      const key = m[1].toLowerCase();
      if (seen.has(key)) {
        // Balance braces to find end of this path block
        let depth = 0, start = i, end = i;
        for (let j = i; j < lines.length; j++) {
          depth += (lines[j].match(/\{/g) || []).length;
          depth -= (lines[j].match(/\}/g) || []).length;
          if (depth <= 0 && j > start) { end = j; break; }
        }
        // Fix dangling comma on preceding line if block had no trailing comma
        const blockHasTrailingComma = lines[end].match(/,\s*$/);
        if (!blockHasTrailingComma && start > 0 && lines[start - 1].match(/,\s*$/)) {
          lines[start - 1] = lines[start - 1].replace(/,\s*$/, '');
        }
        lines.splice(start, end - start + 1);
        continue;
      }
      seen.set(key, true);
    }
    i++;
  }
  return lines.join('\n');
}

function cleanSchemaName(name) {
  return name
    .replace(/\s+&\s+/g, 'And')
    .replace(/&/g, 'And')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/\s+/g, '');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeSanitised(originalPath, content) {
  const ext     = path.extname(originalPath);
  const base    = originalPath.slice(0, -ext.length);
  const outPath = `${base}.tmp.json`;
  fs.writeFileSync(outPath, content, 'utf8');
  return outPath;
}

module.exports = { sanitiseSpec, writeSanitised };
