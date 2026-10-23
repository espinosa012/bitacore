# bitacore – contributor guidelines

## Testing (required)

All code you implement or modify **must be covered by automated tests** in the same change.

- New feature → add tests for its behavior, including error and edge cases.
- Bug fix → add a regression test that fails without the fix.
- Refactor → existing tests must keep passing; add tests if the touched code was uncovered.
- Do not mark a task as done (or archive an OpenSpec change) with failing or missing tests.

How to run:

```bash
npm test                 # run the whole suite (node:test, no extra dependencies)
npm run test:coverage    # same, with a coverage report
```

Conventions:

- Tests live in `test/*.test.js` and use the built-in `node:test` + `node:assert/strict`.
- Browser modules in `js/` (IIFEs on `window.VG`) are loaded in Node with `loadBrowserModules()` from `test/helpers.js`; keep logic that can be tested free of DOM access.
- Server tests start `createServer()` on port `0`; never depend on a real MongoDB or fixed ports.
- Tests must be deterministic and independent of each other.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs `npm test` on every push to `main` and every pull request. Tests must pass before anything is published or merged.
