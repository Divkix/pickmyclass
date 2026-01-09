# Contributing to PickMyClass

Thank you for your interest in contributing to PickMyClass! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive. We welcome contributors of all experience levels.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- [Node.js](https://nodejs.org/) >= 20 (for some tooling)
- Git

### Development Setup

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/yourusername/pickmyclass.git
   cd pickmyclass
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

4. **Start the development server**
   ```bash
   bun run dev
   ```

## Development Workflow

### Branch Naming

Use descriptive branch names:
- `feature/add-user-settings` - New features
- `fix/notification-duplicate` - Bug fixes
- `docs/update-readme` - Documentation changes
- `refactor/extract-email-service` - Code refactoring

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Code style (formatting, semicolons, etc.)
- `refactor` - Code refactoring (no feature/fix)
- `test` - Adding or updating tests
- `chore` - Maintenance tasks

**Examples:**
```bash
git commit -m "feat(dashboard): add real-time seat count updates"
git commit -m "fix(notifications): prevent duplicate emails on race condition"
git commit -m "docs: update self-hosting guide with queue setup"
```

### Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting:

```bash
# Check for issues
bun run lint

# Auto-fix issues
bun run lint:fix

# Format code
bun run format
```

**Key Style Guidelines:**
- Use spaces, not tabs (2 spaces)
- No semicolons
- Single quotes for strings
- TypeScript strict mode enabled

### Testing Changes

Before submitting a PR:

1. **Run the linter**
   ```bash
   bun run lint
   ```

2. **Check for unused exports**
   ```bash
   bun run knip
   ```

3. **Build the project**
   ```bash
   bun run build
   ```

4. **Test with Cloudflare Workers locally**
   ```bash
   bun run preview
   ```

## Pull Request Process

### Before Submitting

- [ ] Code follows the project's style guidelines
- [ ] Self-review completed
- [ ] Changes are documented (if applicable)
- [ ] No console.log debugging statements left behind
- [ ] No hardcoded secrets or URLs

### PR Description Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2

## Testing
How did you test these changes?

## Screenshots (if applicable)
```

### Review Process

1. Submit your PR against the `main` branch
2. Ensure CI checks pass
3. Request review from maintainers
4. Address feedback
5. Squash and merge once approved

## Architecture Guidelines

### Database Changes

1. Create migrations using Supabase CLI:
   ```bash
   bunx supabase migration new <migration-name>
   ```

2. Test migrations locally before pushing:
   ```bash
   bunx supabase db reset
   ```

3. Use Row Level Security (RLS) for all new tables

4. Generate types after schema changes:
   ```bash
   bunx supabase gen types typescript --linked > lib/supabase/database.types.ts
   ```

### API Routes

- Place API routes in `app/api/`
- Use the service role client for operations that bypass RLS
- Validate all input parameters
- Return consistent JSON responses:
  ```typescript
  // Success
  return Response.json({ success: true, data: result })

  // Error
  return Response.json({ success: false, error: message }, { status: 400 })
  ```

### Cloudflare Workers Considerations

- **No global state**: Workers are stateless; use Durable Objects for shared state
- **Memory limits**: Workers have 128MB memory limit
- **Execution time**: 30 seconds for HTTP, 15 minutes for cron
- **Test with preview**: Always test with `bun run preview` before deploying

### Email Templates

- Email templates are in `lib/email/templates/`
- Use inline styles (many email clients don't support `<style>` tags)
- Test with different email clients

## Areas for Contribution

### Good First Issues

- Documentation improvements
- UI/UX enhancements
- Test coverage
- Accessibility improvements

### Feature Ideas

- Support for additional universities
- SMS notifications
- Mobile app
- Browser extension

### Bug Fixes

Check the [Issues](https://github.com/yourusername/pickmyclass/issues) page for bugs labeled `good first issue` or `help wanted`.

## Questions?

- Open a [Discussion](https://github.com/yourusername/pickmyclass/discussions)
- Check existing issues and discussions first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
