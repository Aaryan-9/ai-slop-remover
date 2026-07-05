# ai-slop-remover

A free, local-first CLI that finds the slop AI coding tools leave behind: narrative comments, swallowed errors, fake-done stubs, phantom imports, convention drift. It scores your repo 0-100 and hands your coding agent a plan to remove it.

No accounts. No server. No telemetry. No LLM at scan time: deterministic static analysis that runs in seconds on your machine.

**Live demo & case study:** we scanned [browser-use](https://github.com/browser-use/browser-use) (60k+ stars): **74/100**, with 819 findings. Mature repos calibrate to A: express 97, openai/codex 96 (1.1M lines in 23s), gson 95, ollama 92. See the website in `docs/` for the full interactive reports.

## Quick start

```bash
# from inside the repo you want to scan
npx ai-slop-remover scan .

# or point it at any repo from anywhere
npx ai-slop-remover scan ~/work/my-repo
```

You get a colored scorecard: the Slop Score (0-100 plus a grade), per-category penalties, and every finding with its location, evidence, and a concrete fix instruction.

```text
  ai-slop-remover · scanned my-app (184 files, 24.1k lines) in 2.3s

  Slop Score  81 / 100  (B)

  Swallowed Errors     ████░░░░░░    5 finding(s)  −9.5 pts
  Comment Slop         ██░░░░░░░░   12 finding(s)  −5.2 pts

  Swallowed Errors (5)
    ▲ med  src/jobs/nightly.ts:14  Error swallowed silently
      The catch block is empty: the error disappears and callers see success.
      fix: Handle the error: rethrow it, return an error result, or justify ignoring it.
```

## The main event: hand the fixes to your agent

`fix` turns the findings into a prioritized, per-file plan (`SLOP-FIXES.md`) written for a coding agent, with guardrails baked in: don't change behavior, run tests after each file, skip anything that looks wrong in context.

```bash
# from the repo root
npx ai-slop-remover fix --output SLOP-FIXES.md

# from anywhere
npx ai-slop-remover fix ~/work/my-repo --output ~/work/my-repo/SLOP-FIXES.md
```

Then hand it over:

```bash
claude "Apply the fix plan in SLOP-FIXES.md"   # or open it in Cursor / Codex
```

The scanner finds it, your agent fixes it, the rescan proves it. This repo cleaned its own findings this way and now scans 100/100.

## The HTML report

A single self-contained file: score hero, per-category charts, and every finding as a filterable card (search + severity + category filters, evidence blocks, fix hints). Ideal for sharing with the team.

```bash
# from the repo root
npx ai-slop-remover scan . --format html --output slop-report.html

# from anywhere
npx ai-slop-remover scan ~/work/my-repo --format html --output slop-report.html
```

Open `slop-report.html` in a browser. Markdown (`--format md`) and machine-readable JSON (`--format json`, stable schema with per-finding fingerprints) are also available; `--format both` writes md + html together.

## CI usage

```bash
# fail the build on any finding at or above a threshold
npx ai-slop-remover scan . --check --severity-threshold medium

# or gate on the score
npx ai-slop-remover scan . --min-score 85
```

Exit codes: `0` pass, `1` gate failed, `2` error.

### Adopting on an existing repo

Baseline what's already there; from then on only *new* slop is reported:

```bash
npx ai-slop-remover baseline            # writes .ai-slop-baseline.json
npx ai-slop-remover scan . --baseline   # reports only new findings
```

Fingerprints are line-number independent, so the baseline survives unrelated edits.

### Suppressing a finding

```ts
// slop-ignore -- this empty catch is safe: cleanup of a temp file that may not exist
```

`slop-ignore` on (or directly above) the flagged line suppresses it; `slop-ignore-file` near the top of a file suppresses the whole file.

## What it detects

**Universal slop:** comments that restate the code, banner/step-narration comments, placeholder and fake-done code, commented-out code blocks, imports of packages that don't exist (slopsquatting risk), silently swallowed errors.

**Convention drift (our specialty):** the scanner statistically infers how *your* repo handles errors, accesses data, and names things, then flags the AI-generated code that silently diverges. A drift finding means "this differs from how 86% of comparable code in this repo does it," not "this is universally wrong."

Test files, configs, scripts, examples, and migrations are excluded automatically. Established idioms (Java constructor guards, `@Override` delegation, Rust `lock().unwrap()`, TYPE_CHECKING imports, comment-justified empty catches) are recognized as intentional.

## Languages

JavaScript, TypeScript, Python, Go, Java, C#, Rust, PHP, and Ruby, parsed with tree-sitter. Phantom-import checking covers JS/TS (`package.json`), Python (`requirements.txt`/`pyproject.toml`), Go (`go.mod`), and Rust (`Cargo.toml`); Maven/NuGet/Composer manifests don't map cleanly to import statements, so Java/C#/PHP skip that one check rather than guess.

## CLI reference

```text
ai-slop-remover scan [path]        scan a repo (default: current directory)
  -f, --format <format>            terminal (default), md, html, json, both
  -o, --output <path>              output file or directory
  --severity-threshold <level>     low (default), medium, high
  --check                          exit 1 when the gate fails
  --min-score <n>                  with --check: fail only below this score
  --baseline                       suppress findings recorded in the baseline
  --exclude <glob>                 extra ignore pattern (repeatable)

ai-slop-remover fix [path]         emit an agent-ready fix plan (md or json)
ai-slop-remover baseline [path]    record current findings as the baseline
```

## How it works

Deterministic AST analysis, a transparent scoring formula, and a hard line on false positives. The full write-up (architecture, every detector's heuristics, the drift engine, the score math, and how it was calibrated against real repos) is in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## License

[MIT](LICENSE)
