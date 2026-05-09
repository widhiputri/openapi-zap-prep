# openapi-zap-prep

Validates and sanitises OpenAPI specs before OWASP ZAP scanning. Detects issues that reduce scan coverage or cause ZAP import failures, and auto-fixes them into a clean `.tmp.json` copy. Your original spec is never modified.

## Why

ZAP relies on your spec to know what endpoints to scan and what values to send. A spec with missing examples, duplicate path keys, or bad schema names causes ZAP to:

- Send literal `{userId}` strings in URLs → every request returns 404
- Skip endpoints entirely due to import errors
- Send empty request bodies to POST/PUT endpoints → unreliable test results

This tool catches those problems before ZAP runs and compensates for them automatically.

## What it checks

| Check | Type | Description |
|---|---|---|
| `duplicate-paths` | Structural | Duplicate path keys (case-insensitive): breaks JSON parsers |
| `duplicate-keys` | Structural | Duplicate JSON keys within the same object scope |
| `bad-schema-refs` | Structural | `$ref` names with spaces or special chars: causes ZAP import errors |
| `missing-param-examples` | Coverage | Path params with no `example` field: ZAP sends the param name literally |
| `missing-body-examples` | Coverage | POST/PUT/PATCH with no request body example: ZAP sends empty body |
| `prefix-mismatch` | Coverage | Paths not starting with the expected prefix: requests hit wrong URLs |
| `missing-security` | ZAP-specific | Endpoints with no security scheme: ZAP skips authentication for these |
| `nullable-no-example` | ZAP-specific | Nullable path params without an example: ZAP may send `null` causing 400s |
| `array-no-maxitems` | ZAP-specific | Array params without `maxItems`: ZAP may generate oversized payloads |

## What it fixes

When issues are found, a sanitised copy is written to `*.tmp.json`. Point ZAP at the `.tmp.json` instead of the original.

| Fix | What it does |
|---|---|
| `renameSchemaKeys` | Renames schema component keys with spaces/special chars (e.g. `"Not Found"` → `"NotFound"`) and updates all `$ref` usages |
| `normalizePathPrefixes` | Adds missing path prefixes (e.g. `/accounts` → `/api/v1/accounts`) |
| `removeDuplicatePaths` | Removes duplicate path blocks, keeps first occurrence |
| `repairMissingResponses` | Adds a stub `200` response to write methods that have `requestBody` but no `responses` |
| `injectPathParamExamples` | Fills empty path param `example` fields from your `examples` map |

## Install

```bash
npm install -g openapi-zap-prep
```

Or as a dev dependency:

```bash
npm install --save-dev openapi-zap-prep
```

## Quick Start

**Step 1:** Create a config file `prep.config.yml`:

```yaml
specs:
  - path: specs/public-api.json
    label: public-api
    expectedPrefix: /api/v1

fixes:
  renameSchemaKeys: true
  normalizePathPrefixes: true
  removeDuplicatePaths: true
  repairMissingResponses: true
  injectPathParamExamples: true

examples:
  userId:    "usr_01HXYZ1234567890"
  productId: "prod_abc123"
  orderId:   "ord_20240501_001"
```

**Step 2:** Run it before your ZAP scan:

```bash
openapi-zap-prep --config prep.config.yml
```

**Step 3:** Point ZAP at the sanitised spec (`specs/public-api.tmp.json`) instead of the original.

## CLI Options

```
openapi-zap-prep --config <file> [options]

Options:
  --config,   -c <file>    Path to prep config file (YAML or JSON)
  --fail-on      <list>    Comma-separated check types that cause non-zero exit
  --no-sanitise            Validate only, skip writing .tmp.json files
  --output,   -o <file>    Write results to a JSON file
  --help,     -h           Show this help
```

## Config Reference

### `specs`

List of specs to process. Each entry supports:

| Field | Required | Description |
|---|---|---|
| `path` | Yes | Path to the spec file. Supports `.json` and `.yaml`/`.yml` |
| `label` | No | Display name in output. Defaults to the filename |
| `expectedPrefix` | No | All paths should start with this prefix. Used for `prefix-mismatch` check and `normalizePathPrefixes` fix |

### `fixes`

All fixes are enabled by default. Set any to `false` to disable:

```yaml
fixes:
  renameSchemaKeys: true
  normalizePathPrefixes: true
  removeDuplicatePaths: true
  repairMissingResponses: true
  injectPathParamExamples: true
```

### `examples`

Map of path parameter names (as they appear in the spec) to real example values from your test environment. Used by `injectPathParamExamples`.

```yaml
examples:
  userId:    "usr_01HXYZ1234567890"
  productId: "prod_abc123"
```

Without these, ZAP sends the literal `{userId}` string in URLs, which returns 404 on every request.

## Coverage Score

After validation, a coverage score is printed for each spec:

```
Coverage:  38/42 endpoints with examples (90%)
```

An endpoint is counted as covered when all its path params have `example` values and its request body (for write methods) has an `example`.

## CI Integration

Use `--fail-on` to block the pipeline if specific issues exist:

```bash
openapi-zap-prep --config prep.config.yml \
  --fail-on duplicate-paths,missing-param-examples
```

The process exits with code `1` only for the check types listed. All other issues are reported as warnings but do not block.

```yaml
# GitHub Actions example
- name: Validate and sanitise OpenAPI specs
  run: |
    npx openapi-zap-prep --config prep.config.yml \
      --fail-on duplicate-paths,bad-schema-refs \
      --output prep-results.json
```

## Output

```
openapi-zap-prep v0.1.0

● public-api  specs/public-api.json
  ⚠  [missing-param-examples] Path param "{userId}" has no "example": GET /api/v1/users/{userId}
  ⚠  [missing-body-examples] Request body example missing: POST /api/v1/orders
  ⚠  [missing-security] No security scheme: GET /api/v1/health: ZAP will not send auth headers

  Coverage:  18/20 endpoints with examples (90%)
  Sanitised: specs/public-api.tmp.json (fixes applied: injectPathParamExamples)

──────────────────────────────────────────────────
WARNED  1 spec(s)  |  3 warning(s)
```

Pass `--output results.json` to also write a machine-readable JSON file.

## License

MIT
