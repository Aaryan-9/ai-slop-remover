# How ai-slop-remover works

This is the technical write-up of how I built ai-slop-remover: the architecture, every detector's heuristics, the scoring math, and the calibration process that keeps false positives down. The README covers usage; this covers internals.

## Design goals

I set four constraints up front and they shaped every decision:

1. **Deterministic.** Same code in, same score out. No LLM anywhere in the scan path. If a tool that judges AI slop needs an AI to run, it inherits the same trust problem it claims to solve.
2. **Local-first.** No accounts, no server, no telemetry. The scanner reads your code on your machine and writes a report. That's it.
3. **Fast enough to run on a whim.** Scanning should feel like `wc -l`, not like a CI job. It does about 1.1M lines (openai/codex) in 23 seconds and typical repos in 1 to 3 seconds.
4. **A hard line on false positives.** A linter that cries wolf gets uninstalled in a week. Several detectors are deliberately less ambitious than they could be, because precision buys trust and trust buys adoption.

## The pipeline

The whole system is a straight pipeline, one module per stage:

```
crawl  →  parse  →  detect  →  suppress  →  score  →  render
```

- **Crawl** (`src/crawl.ts`): walks the repo with globby, respects `.gitignore`, and skips generated and vendor directories (node_modules, dist, build, coverage, vendor, lockfiles). Only files in supported languages are read.
- **Parse** (`src/parser/`): each file gets a tree-sitter AST via WASM grammars. If a grammar is missing or fails, the file falls back to deterministic text heuristics and the report records a parser note, so degraded coverage is visible instead of silent.
- **Detect** (`src/detectors/`): nine pluggable detectors run over the parsed files and emit `Finding` objects: category, location, severity, confidence, evidence, explanation, and a `fix_hint` written as an imperative instruction.
- **Suppress** (`src/scan.ts`): findings on lines marked `slop-ignore` (or in files marked `slop-ignore-file`) are dropped, then the severity threshold and the baseline filter apply.
- **Score** (`src/score.ts`): the surviving findings become the 0-100 Slop Score.
- **Render** (`src/report/`): pure functions of the scan result produce terminal, Markdown, HTML, and JSON output. `src/fix.ts` renders the same findings as an agent-ready fix plan.

Adding a detector is one file plus one registration line plus one fixture test. That was a deliberate design target.

## Parsing: tree-sitter with honest fallbacks

I use `web-tree-sitter` (the WASM build) rather than native bindings, because it installs cleanly everywhere with no node-gyp compilation step. Grammars ship as optional dependencies for nine languages: JavaScript, TypeScript, Python, Go, Java, C#, Rust, PHP, and Ruby.

Two implementation notes that cost me real debugging time:

- **One parser instance, reused.** The first version created a `new Parser()` per file, which made a 59-file scan take 12 seconds. Reusing a single instance and calling `setLanguage` per file brought the same scan under 2 seconds.
- **ABI versions matter.** tree-sitter grammars compiled with newer CLI versions (ABI 15) won't load in older runtimes. The C# grammar forced an upgrade to web-tree-sitter 0.26, which reads ABI 13 through 15 and changed its API to named exports.

When a grammar can't load, detectors that need an AST degrade per language: some fall back to conservative regex equivalents (for example, empty-catch detection), and some simply skip the file. The scanner never guesses when it can't see structure.

## The universal detectors

These five run on absolute rules: patterns that are slop regardless of what repo they appear in.

### Comment slop

The number one tell of unedited agent output. Four sub-checks:

- **Restating comments.** For each single-line comment, I compare its content words against the identifiers of the next code line (identifiers are split on camelCase and snake_case, with naive singular/plural folding). If 60% or more of the comment's words appear in the code, the comment restates it. `# Fetch the user from the database` above `fetch_user_from_database()` adds nothing.
- **Banner comments.** Lines whose content is 30% or more decoration characters (`====`, `----`) with at least four in a row.
- **Step narration.** Two or more comments in one file matching "Step 1", "First,", "Then,", "Finally,". That is a prompt transcript, not documentation.
- **Emoji** in comments and log strings, reported once per file with a count.

Comments carrying real signal are protected: anything with TODO/FIXME/HACK/NOTE, lint pragmas, URLs, license headers, question marks, or doc-comment status is never flagged.

### Placeholder and fake-done code

Three sub-checks: placeholder phrases ("in a real implementation", "for now, we", "your logic here", and about a dozen more), stub functions (bodies that are only `pass`, only a not-implemented throw such as `todo!()` or `NotImplementedException`, or entirely empty despite a substantive name), and mock data in application code (John Doe, lorem ipsum, test@test.com).

### Commented-out code

Runs of three or more consecutive comment lines where 60% or more parse like code (statement endings, assignments, call syntax, keywords with code punctuation). Prose is vetoed by common English words, so an explanation that happens to start with "if" doesn't get flagged.

### Phantom imports

The highest-severity detector, because a hallucinated dependency is a security problem (slopsquatting), not just a style problem. It resolves every import against ground truth:

- **JS/TS:** bare imports against every `package.json` walking up from the file (monorepo-aware), Node builtins, and `node_modules` presence. Relative imports must resolve to a real file, including NodeNext `.js` to `.ts` remapping. Bundler aliases (`@/`, `~/`, `#`) are skipped rather than guessed.
- **Python:** top-level imports against `requirements*.txt` and `pyproject.toml` (PEP 621 and Poetry), the full stdlib module list, local modules, and a map of import-name aliases (`PIL` is `pillow`, `cv2` is `opencv-python`, `uuid_extensions` is `uuid7`). Indented imports are never flagged: they sit under TYPE_CHECKING or try/except guards, which are deliberate.
- **Go:** import paths against `go.mod`. The classification rule is clean: a stdlib path has no dot in its first segment; anything domain-based must be the module itself or a declared require.
- **Rust:** `use` paths against `Cargo.toml` dependency tables and local modules. Bare `use Foo;` without `::` is skipped (2015-edition local re-imports).

Java, C#, and PHP skip this check entirely. Maven, NuGet, and Composer manifests don't map cleanly to import statements, and guessing would produce noise.

### Swallowed errors

AST-driven, per language: empty catch blocks, catches that only log and continue (JS `console.log`, Java `printStackTrace`, C# `Console.Write`, PHP `error_log`), Python bare `except:` and `except: pass`, Go's empty `if err != nil {}` block and `_ = err`. A comment inside the catch marks it as justified and suppresses the finding, which is exactly what the fix hint asks you to add. Rethrow, logger-plus-throw, transaction rollback, and HTTP error responses all count as real handling.

## The drift engine

This is the part no other slop scanner does. The premise: the worst AI-introduced damage is not universally bad code, it is locally inconsistent code. Each drift detector works the same way:

1. Extract **observations** from the AST (for example: this function's error style is "Result return").
2. Group them (usually by directory bucket, sometimes by concept).
3. In each group of at least N observations, find the **dominant pattern**. If it holds 75-80% or more of the group, every deviating observation becomes a finding.

The finding says: "this function throws, while 86% of comparable code in src/api returns Result." That is a statement about your codebase, not about a style guide.

Confidence scales with evidence: `confidence = frequency × (0.5 + 0.5 × min(1, groupSize/10))`, capped at 0.95. A pattern that dominates a group of 20 is trusted more than one that dominates a group of 4.

The four drift detectors: **error handling** (exceptions vs Result/Either vs error-first callbacks vs Go error returns vs Rust `?` propagation against `.unwrap()`), **data access** (DB clients used outside the repository/service layer, where client identifiers are traced from actual imports of known DB libraries, not name-matching), **naming** (CRUD verb conventions within a directory), and **utility duplication** (small functions with identical identifier-normalized bodies across files: strings normalized, identifiers renamed consistently, numeric literals kept verbatim so that a round-to-1-decimal and a round-to-2-decimals helper don't collide).

## The false-positive discipline

This got more engineering time than any single detector, because calibration runs against real repos kept teaching the same lesson: idioms look like slop until you know the language.

Things the scanner explicitly recognizes as intentional:

- Java utility-class constructor guards (`private Gson() { throw new UnsupportedOperationException(); }`) and bare `UnsupportedOperationException` as API contract. Only a "not implemented" message marks unfinished work.
- `@Override` delegation one-liners (`hashCode`, `toString`, `size`). Interface contracts can't be extracted into shared utilities, so they are not duplication.
- Rust `lock().unwrap()`, `recv().unwrap()`, and friends. Mutex poisoning panics are the idiom. A function that also propagates with `?` made a considered choice and is never classified as panic-style.
- Framework handler signatures (`(req, res, next)`) excluded from utility duplication.
- Test files, config files, scripts, migrations, and examples excluded per detector, with layout awareness (`src/test/java`, `*Test.java`, `*Tests.cs`, `conftest.py`, `__tests__`, fixtures).
- Imports quoted inside comments and JSDoc examples ignored; a package importing its own name (Node self-reference) allowed.

The calibration loop that produced these rules: scan a mature, human-written repo; inspect every finding; every false positive becomes either an idiom rule or a threshold change; rescan. The results after calibration: express 97/A, gson 95/A (was 78/C before the Java idiom rules), click 96/A, fd 90/A, ollama 92/A, openai/codex 96/A. Against that baseline, browser-use scoring 74/C with 819 findings is a signal, not noise.

The tool also scans itself in CI fashion: its own repo must score 100/100, and its own test suite includes a clean-code fixture that must produce zero findings.

## The Slop Score

```
score = 100 − Σ over categories of min(25, 3 × weighted / KLOC)
weighted = Σ severityWeight × confidence     (low 1, medium 3, high 7)
```

Three properties I wanted: severity and confidence both matter (a high-severity 0.9-confidence finding costs 21 times a low-severity guess), size normalization keeps a 500-line repo comparable to a 500k-line one, and the per-category cap of 25 points means one noisy detector can never zero a score by itself. Grades: A at 90+, B at 80+, C at 70+, D at 60+, F below.

## Baselines and suppression

`ai-slop-remover baseline` writes fingerprints of all current findings to `.ai-slop-baseline.json`. A fingerprint is a hash of category, file, observed pattern, and whitespace-normalized evidence. Line numbers are deliberately excluded, so the baseline survives unrelated edits above a finding. Scans with `--baseline` then report only new slop, which is what makes adoption on a brownfield repo realistic.

Inline suppression is a post-filter in the scan stage, not per-detector logic: `slop-ignore` on or directly above the flagged line, `slop-ignore-file` in the first five lines of a file.

## The fix plan

I decided against mechanical autofix on purpose. Deleting comments and dead code by machine sounds safe until it mangles the one case that mattered, and trust is the whole product. Instead, `fix` renders the findings as a Markdown plan ordered by file weight, each item carrying the location, the explanation, and the imperative fix hint the detector wrote. The header addresses the executing agent directly: work one file at a time, never change behavior unless the fix says to implement missing behavior, run the tests after each file, skip anything that looks wrong and say why.

This matches how teams actually work now: the deterministic tool finds and prioritizes, the coding agent (Claude Code, Cursor, Codex) applies, and the deterministic rescan verifies. Each tool does the part it is good at.

## Testing

Vitest, with fixture repos as the unit of testing. Each detector has a small fixture repo under `test/fixtures/` containing realistic slop, and a test asserting the exact findings, plus negative assertions that the legitimate code in the same fixture stays quiet. One special fixture, `clean/`, contains well-written code and asserts zero findings across all detectors: the false-positive regression guard. There are also unit tests for the score math and the baseline fingerprints. 27 tests across 11 files at the time of writing.

## Repository layout

```
src/
  cli.ts               command-line layer only
  scan.ts              pipeline orchestration + suppression
  crawl.ts             file discovery
  score.ts             Slop Score
  baseline.ts          fingerprints
  fix.ts               agent fix plan renderer
  comments.ts          comment extraction (AST + fallback)
  ast.ts               function extraction helpers
  parser/              tree-sitter loading, language configs
  detectors/           nine detectors + shared drift engine (common.ts)
  report/              terminal, markdown, html, json renderers
  utils/               fileKinds, collections, text, paths, severity
test/
  fixtures/            one small repo per detector + clean/ FP guard
docs/
  index.html           landing page (GitHub Pages)
  reports/             generated showcase reports
  TECHNICAL.md         this document
```

## Publishing the site

The landing page is fully static, no build step. Push the repo to GitHub, replace the placeholder repo links in `docs/index.html`, then Settings → Pages → deploy from branch, `main`, `/docs`. For LinkedIn link previews, drop a screenshot at `docs/og.png`; the meta tag already points there.

## What's next

Diff-aware scanning (`--changed <base>`) so PRs only answer for their own slop, a GitHub Action with SARIF output for code-scanning annotations, an MCP server so agents can query findings directly.
