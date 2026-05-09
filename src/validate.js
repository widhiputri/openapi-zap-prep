'use strict';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

function validateSpec(json, parsed, options = {}) {
  const { expectedPrefix = '' } = options;
  const issues = [];

  checkDuplicatePaths(json, issues);
  checkBadSchemaRefs(json, issues);
  checkDuplicateJsonKeys(json, issues);
  checkMissingBodyExamples(json, issues);

  if (parsed && parsed.paths) {
    if (expectedPrefix) checkPrefixMismatch(parsed, expectedPrefix, issues);
    checkMissingParamExamples(parsed, issues);
    checkMissingSecurity(parsed, issues);
    checkNullableNoExample(parsed, issues);
    checkArrayNoMaxItems(parsed, issues);
  }

  return issues;
}

function checkDuplicatePaths(json, issues) {
  const seen = new Map();
  const lines = json.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/"(\/[^"]+)"\s*:/);
    if (!m) continue;
    const key   = m[1];
    const lower = key.toLowerCase();
    if (seen.has(lower)) {
      issues.push({
        type: 'duplicate-paths',
        message: `Duplicate path key "${key}" (line ${i + 1}, first seen line ${seen.get(lower)})`,
      });
    } else {
      seen.set(lower, i + 1);
    }
  }
}

function checkBadSchemaRefs(json, issues) {
  for (const m of json.matchAll(/"#\/components\/[^"]*[ &][^"]*"/g)) {
    issues.push({
      type: 'bad-schema-refs',
      message: `Schema reference with spaces/special chars: ${m[0]}`,
    });
  }
}

function checkDuplicateJsonKeys(json, issues) {
  const stack = [new Map()];
  const lines = json.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const km = line.match(/^\s*"([^"]+)"\s*:/);
    if (km) {
      const key = km[1];
      if (!key.startsWith('/')) {
        const scope = stack[stack.length - 1];
        const lower = key.toLowerCase();
        if (scope.has(lower)) {
          issues.push({
            type: 'duplicate-keys',
            message: `Duplicate JSON key "${key}" (line ${i + 1}, first seen line ${scope.get(lower)})`,
          });
        } else {
          scope.set(lower, i + 1);
        }
      }
    }
    const opens  = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    for (let o = 0; o < opens;  o++) stack.push(new Map());
    for (let c = 0; c < closes; c++) { if (stack.length > 1) stack.pop(); }
  }
}

function checkMissingBodyExamples(json, issues) {
  const pathMatches = [...json.matchAll(/"(\/[^"]+)"\s*:\s*\{/g)];
  for (let pi = 0; pi < pathMatches.length; pi++) {
    const pathKey    = pathMatches[pi][1];
    const blockStart = pathMatches[pi].index;
    const blockEnd   = pi + 1 < pathMatches.length ? pathMatches[pi + 1].index : json.length;
    const block      = json.slice(blockStart, blockEnd);
    for (const method of ['post', 'put', 'patch']) {
      if (!block.match(new RegExp(`"${method}"\\s*:`))) continue;
      const mMatch = block.match(new RegExp(`"${method}"\\s*:\\s*\\{`));
      if (!mMatch) continue;
      const methodBlock = block.slice(mMatch.index);
      if (!methodBlock.includes('"requestBody"')) continue;
      if (!methodBlock.match(/"example"\s*:/) && !methodBlock.match(/"examples"\s*:/)) {
        issues.push({
          type: 'missing-body-examples',
          message: `Request body example missing: ${method.toUpperCase()} ${pathKey}`,
          path: pathKey,
          method: method.toUpperCase(),
        });
      }
    }
  }
}

function checkPrefixMismatch(parsed, expectedPrefix, issues) {
  for (const pathName of Object.keys(parsed.paths)) {
    if (!pathName.startsWith(expectedPrefix)) {
      issues.push({
        type: 'prefix-mismatch',
        message: `Path missing expected prefix "${expectedPrefix}": ${pathName}`,
        path: pathName,
      });
    }
  }
}

function checkMissingParamExamples(parsed, issues) {
  for (const [pathName, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
      const params = [...(op.parameters || []), ...(pathItem.parameters || [])];
      for (const p of params) {
        if (!p || p.in !== 'path') continue;
        const hasExample = p.example !== undefined || p.schema?.example !== undefined;
        if (!hasExample) {
          issues.push({
            type: 'missing-param-examples',
            message: `Path param "{${p.name}}" has no "example": ${method.toUpperCase()} ${pathName}`,
            path: pathName,
            method: method.toUpperCase(),
            param: p.name,
          });
        }
      }
    }
  }
}

function checkMissingSecurity(parsed, issues) {
  const globalSecurity = parsed.security;
  for (const [pathName, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
      // op.security = [] means explicitly opted out; undefined means inherit global
      const opSecurity = op.security;
      const isUnsecured = Array.isArray(opSecurity)
        ? opSecurity.length === 0
        : globalSecurity === undefined;
      if (isUnsecured) {
        issues.push({
          type: 'missing-security',
          message: `No security scheme: ${method.toUpperCase()} ${pathName} — ZAP will not send auth headers`,
          path: pathName,
          method: method.toUpperCase(),
        });
      }
    }
  }
}

function checkNullableNoExample(parsed, issues) {
  for (const [pathName, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
      const params = [...(op.parameters || []), ...(pathItem.parameters || [])];
      for (const p of params) {
        if (!p || p.in !== 'path') continue;
        const isNullable = p.nullable || p.schema?.nullable;
        const hasExample = p.example !== undefined || p.schema?.example !== undefined;
        if (isNullable && !hasExample) {
          issues.push({
            type: 'nullable-no-example',
            message: `Nullable path param "{${p.name}}" has no "example" — ZAP may send null: ${method.toUpperCase()} ${pathName}`,
            path: pathName,
            method: method.toUpperCase(),
            param: p.name,
          });
        }
      }
    }
  }
}

function checkArrayNoMaxItems(parsed, issues) {
  for (const [pathName, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
      const params = [...(op.parameters || []), ...(pathItem.parameters || [])];
      for (const p of params) {
        if (!p) continue;
        const schema = p.schema || {};
        if (schema.type === 'array' && schema.maxItems === undefined) {
          issues.push({
            type: 'array-no-maxitems',
            message: `Array param "${p.name}" has no "maxItems" — ZAP may generate oversized payloads: ${method.toUpperCase()} ${pathName}`,
            path: pathName,
            method: method.toUpperCase(),
            param: p.name,
          });
        }
      }
    }
  }
}

function computeCoverage(parsed) {
  if (!parsed || !parsed.paths) return null;
  let total = 0, covered = 0;
  for (const [, pathItem] of Object.entries(parsed.paths)) {
    for (const [method, op] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !op || typeof op !== 'object') continue;
      total++;
      const params     = [...(op.parameters || []), ...(pathItem.parameters || [])];
      const pathParams = params.filter(p => p && p.in === 'path');
      const allParamsOk = pathParams.every(p => p.example !== undefined || p.schema?.example !== undefined);
      const needsBody  = ['post', 'put', 'patch'].includes(method);
      const bodyOk     = !needsBody || !op.requestBody ||
        Object.values(op.requestBody.content || {}).some(c => c.example || c.examples || c.schema?.example);
      if (allParamsOk && bodyOk) covered++;
    }
  }
  return { total, covered, rate: total > 0 ? Math.round((covered / total) * 100) : 100 };
}

module.exports = { validateSpec, computeCoverage };
