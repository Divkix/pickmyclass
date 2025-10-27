# GitHub Actions Workflows

This directory contains CI/CD workflows for PickMyClass.

## Workflows

### 🧪 `test.yml` - Test Suite
**Triggers:** Push to main, Pull Requests
**Purpose:** Simple test runner for quick validation

**Jobs:**
- **test**: Runs unit and integration tests
- **lint**: ESLint code quality checks
- **type-check**: TypeScript type checking
- **build**: Next.js build verification

**Duration:** ~5-10 minutes

---

### 🚀 `ci.yml` - CI/CD Pipeline
**Triggers:** Push to main/develop, Pull Requests
**Purpose:** Comprehensive CI/CD with parallel execution and caching

**Jobs:**
1. **quick-checks** (parallel):
   - Lint check
   - TypeScript type check
   - Duration: ~2 minutes

2. **unit-tests**:
   - Fast unit test suite
   - Runs on every PR
   - Duration: ~2 minutes

3. **integration-tests**:
   - Slower integration tests
   - Skipped for draft PRs
   - Duration: ~5 minutes

4. **coverage**:
   - Coverage report generation
   - Uploads to Codecov
   - Only runs on main branch
   - Duration: ~3 minutes

5. **build**:
   - Next.js build verification
   - Build size check
   - Duration: ~3 minutes

6. **all-checks-passed**:
   - Status aggregation
   - Required for branch protection

**Features:**
- ✅ Parallel execution for speed
- ✅ Dependency caching (Bun cache)
- ✅ Conditional execution (skip draft PRs)
- ✅ Artifact uploads (test results)
- ✅ Codecov integration

**Duration:** ~8-12 minutes total

---

### 🔒 `codeql.yml` - Security Analysis
**Triggers:** Push to main, Pull Requests, Weekly schedule (Mon 2 AM UTC)
**Purpose:** Automated security vulnerability scanning

**Jobs:**
- **analyze**: CodeQL security analysis
  - JavaScript/TypeScript analysis
  - Security-extended queries
  - Security and quality checks

**Features:**
- ✅ Automated security scanning
- ✅ Weekly scheduled scans
- ✅ GitHub Security tab integration

**Duration:** ~10-15 minutes

---

## Dependency Management

### `dependabot.yml`
Automated dependency updates via Dependabot.

**Configuration:**
- **npm packages**: Weekly updates (Monday 2 AM)
- **GitHub Actions**: Weekly updates (Monday)
- **Pull request limit**: 10 concurrent PRs
- **Grouping**:
  - Development dependencies (minor/patch)
  - Production dependencies (minor/patch)
- **Auto-labeling**: `dependencies`, `automated`
- **Conventional commits**: `chore(deps):` or `chore(ci):`

---

## Branch Protection Rules (Recommended)

Configure these in GitHub repository settings:

### Main Branch
- ✅ Require status checks to pass:
  - `All Checks Passed` (from ci.yml)
  - `CodeQL` (from codeql.yml)
- ✅ Require pull request reviews (1+ approvals)
- ✅ Require conversation resolution
- ✅ Require linear history
- ✅ Include administrators

### Develop Branch (if used)
- ✅ Require status checks to pass:
  - `All Checks Passed`
- ✅ Require pull request reviews (1+ approvals)

---

## Secrets Required

Configure these in GitHub repository secrets:

### Optional (but recommended):
- `CODECOV_TOKEN`: For coverage reporting (get from [codecov.io](https://codecov.io))

### Not required in CI:
- Database credentials (tests use mocks)
- API keys (tests use mocks)

---

## Performance Optimization

### Caching Strategy
All workflows cache Bun dependencies:
```yaml
uses: actions/cache@v4
with:
  path: ~/.bun/install/cache
  key: ${{ runner.os }}-bun-${{ hashFiles('**/bun.lockb') }}
```

**Cache hit:** Speeds up install by ~80%
**Cache miss:** Full dependency install (~30 seconds)

### Parallel Execution
Jobs run concurrently where possible:
- Lint + Type Check (parallel)
- Unit Tests + Integration Tests (parallel)
- Independent of build job

**Time saved:** ~5 minutes per run

---

## Monitoring

### GitHub Actions Tab
View workflow runs: `https://github.com/Divkix/pickmyclass/actions`

### Codecov Dashboard
View coverage trends: `https://codecov.io/gh/Divkix/pickmyclass`

### Security Alerts
View security issues: `https://github.com/Divkix/pickmyclass/security`

---

## Troubleshooting

### Tests Failing Locally But Passing in CI
- Check Node.js/Bun version mismatch
- Ensure `bun install` uses frozen lockfile
- Check for environment-specific issues

### Slow CI Runs
- Check if cache is being used (look for "Cache restored" in logs)
- Verify parallel jobs are running
- Check if integration tests are being skipped for draft PRs

### Coverage Not Uploading
- Ensure `CODECOV_TOKEN` secret is set
- Check coverage files are being generated
- Verify network access to Codecov API

---

## Local Testing

Run CI checks locally before pushing:

```bash
# All checks
bun test:unit && bun test:integration && bun run lint && bunx tsc --noEmit && bun run build

# Quick checks only
bun run lint && bunx tsc --noEmit

# With coverage
bun test:coverage
```

---

## Maintenance

### Updating Workflows
1. Edit workflow files in `.github/workflows/`
2. Test changes in a feature branch first
3. Monitor first runs in Actions tab
4. Adjust caching/timeouts as needed

### Dependabot PRs
- Auto-created weekly for dependency updates
- Review breaking changes in changelogs
- Merge after CI passes
- Group updates reduce PR noise

---

## Contributing

When adding new workflows:
1. Test in feature branch first
2. Document purpose and triggers
3. Add to this README
4. Set appropriate timeouts
5. Use caching where possible
6. Add status badges to main README if needed
