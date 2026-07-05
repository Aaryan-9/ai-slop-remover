import path from "node:path";
import type { ScanResult } from "../types.js";
import { categoryLabel, escapeHtml } from "../utils/text.js";

export function renderHtmlReport(result: ScanResult): string {
  const payload = JSON.stringify(result.findings).replace(/</g, "\\u003c");
  const durationSeconds = ((result.completedAt.getTime() - result.startedAt.getTime()) / 1000).toFixed(1);
  const repoName = escapeHtml(path.basename(result.rootPath) || result.rootPath);
  const score = result.score;
  const scoreClass = score.score >= 90 ? "s-good" : score.score >= 70 ? "s-warn" : "s-bad";
  const warnings = result.parseWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");

  const categoryBars = score.categories
    .map((category) => {
      const width = Math.max(4, Math.min(100, (category.penalty / 25) * 100));
      return `<div class="cat-row">
        <span class="cat-name">${escapeHtml(categoryLabel(category.category))}</span>
        <div class="cat-track"><div class="cat-fill" style="width:${width.toFixed(1)}%"></div></div>
        <span class="cat-count">${category.findingCount}</span>
        <span class="cat-pts">−${category.penalty.toFixed(1)}</span>
      </div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Slop report — ${repoName}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='6' fill='%233987e5'/><g fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' transform='translate(4.2 4.2) scale(0.65)'><path d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'/><path d='M22 21H7'/><path d='m5 11 9 9'/></g></svg>">
  <style>
    :root {
      color-scheme: dark;
      --page: #0d0d0d;
      --panel: #151517;
      --panel-2: #111113;
      --ink: #ffffff;
      --ink-2: #b8b7ae;
      --muted: #898781;
      --line: rgba(255,255,255,0.09);
      --accent: #3987e5;
      --accent-soft: rgba(57,135,229,0.14);
      --good: #35b135;
      --warn: #dca11f;
      --bad: #e57a4d;
      --high: #e66767;
      --mono: ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace;
      --sans: system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--page); color: var(--ink); font: 15px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
    .wrap { max-width: 1020px; margin: 0 auto; padding-inline: 20px; }
    a { color: var(--accent); text-decoration: none; }

    header { border-bottom: 1px solid var(--line); background: var(--panel-2); padding-block: 30px 34px; }
    .brand { display: flex; align-items: center; gap: 10px; color: var(--muted); font-size: 13px; margin-bottom: 24px; }
    .brand .mark { width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, var(--accent), #1c5cab); display: grid; place-items: center; }
    .brand .mark svg { width: 13px; height: 13px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .brand b { color: var(--ink-2); font-weight: 600; }

    .head-grid { display: grid; grid-template-columns: auto 1fr; gap: 40px; align-items: start; }
    h1 { font-size: 22px; letter-spacing: -0.01em; }
    .score { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; }
    .score .num { font-size: 64px; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }
    .score .den { color: var(--muted); font-weight: 600; }
    .grade { display: inline-block; margin-top: 10px; font: 800 13px var(--sans); border: 1.5px solid currentColor; border-radius: 7px; padding: 2.5px 9px; }
    .s-good .num, .s-good .grade { color: var(--good); }
    .s-warn .num, .s-warn .grade { color: var(--warn); }
    .s-bad .num, .s-bad .grade { color: var(--bad); }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .chip { font-size: 12px; color: var(--ink-2); border: 1px solid var(--line); background: var(--panel); border-radius: 999px; padding: 4px 11px; }

    .cats { align-self: center; display: grid; gap: 7px; min-width: 0; }
    .cat-row { display: grid; grid-template-columns: minmax(120px, 170px) 1fr 40px 52px; gap: 10px; align-items: center; font-size: 13px; }
    .cat-name { color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cat-track { height: 16px; background: rgba(255,255,255,0.05); border-radius: 4px; }
    .cat-fill { height: 100%; border-radius: 3px; background: var(--accent); min-width: 3px; }
    .cat-count { text-align: right; font: 600 12px var(--mono); color: var(--ink-2); }
    .cat-pts { text-align: right; font: 12px var(--mono); color: var(--muted); }

    main { padding-block: 26px 60px; }
    .toolbar {
      position: sticky; top: 0; z-index: 10;
      display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; gap: 10px;
      padding-block: 14px; background: rgba(13,13,13,0.92); backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--line); margin-bottom: 22px;
    }
    input, select {
      min-height: 38px; border: 1px solid var(--line); border-radius: 8px;
      padding: 8px 12px; background: var(--panel); color: var(--ink); font: inherit;
    }
    input:focus, select:focus { outline: 1.5px solid var(--accent); border-color: transparent; }
    input::placeholder { color: var(--muted); }

    details.section { margin-bottom: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); overflow: hidden; }
    details.section > summary {
      cursor: pointer; list-style: none; display: flex; align-items: center; gap: 10px;
      padding: 14px 18px; font-weight: 700; font-size: 14.5px; background: var(--panel-2);
    }
    details.section > summary::before { content: "▸"; color: var(--muted); transition: transform .15s; }
    details.section[open] > summary::before { transform: rotate(90deg); }
    summary .n { color: var(--muted); font-weight: 600; font-size: 13px; }

    .finding { border-top: 1px solid var(--line); padding: 15px 18px; }
    .fhead { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .sev { font: 700 10.5px var(--sans); letter-spacing: .06em; text-transform: uppercase; border-radius: 5px; padding: 2.5px 7px; }
    .sev.high { color: var(--high); background: rgba(230,103,103,0.13); }
    .sev.medium { color: var(--warn); background: rgba(220,161,31,0.12); }
    .sev.low { color: var(--muted); background: rgba(255,255,255,0.07); }
    .conf { font: 11px var(--mono); color: var(--muted); }
    .loc { font: 12px var(--mono); color: var(--accent); overflow-wrap: anywhere; }
    .ftitle { font-weight: 600; font-size: 14px; }
    .why { color: var(--ink-2); font-size: 13.5px; margin-top: 6px; max-width: 860px; }
    .why .obs { color: var(--muted); }
    .evidence {
      margin-top: 9px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px;
      padding: 9px 12px; overflow-x: auto; font: 12px/1.6 var(--mono); color: var(--ink-2); white-space: pre;
    }
    .fix { margin-top: 9px; font-size: 13px; color: var(--good); }
    .fix b { font-weight: 700; }

    .empty { padding: 40px; text-align: center; color: var(--muted); border: 1px dashed var(--line); border-radius: 12px; }
    .warnings { margin: 0 0 20px 18px; color: var(--muted); font-size: 13px; }
    .baseline-note { margin-bottom: 20px; color: var(--muted); font-size: 13px; }
    footer { border-top: 1px solid var(--line); padding-block: 22px 40px; color: var(--muted); font-size: 12.5px; }

    @media (max-width: 760px) {
      .head-grid { grid-template-columns: 1fr; gap: 24px; }
      .toolbar { grid-template-columns: 1fr 1fr; }
      .toolbar input { grid-column: 1 / -1; }
      .cat-row { grid-template-columns: minmax(90px, 120px) 1fr 34px 46px; font-size: 12px; }
      .score .num { font-size: 52px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="brand">
        <span class="mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg></span>
        <span><b>ai-slop-remover</b> · scan report</span>
      </div>
      <div class="head-grid">
        <div class="${scoreClass}">
          <h1>${repoName}</h1>
          <div class="score"><span class="num">${score.score}</span><span class="den">/ 100</span></div>
          <span class="grade">GRADE ${score.grade}</span>
          <div class="meta">
            <span class="chip">${result.files.length} files</span>
            <span class="chip">${formatLines(result.totalLines)} lines</span>
            <span class="chip">${result.findings.length} findings</span>
            <span class="chip">${durationSeconds}s</span>
          </div>
        </div>
        <div class="cats">${categoryBars || '<span style="color:var(--muted);font-size:13px">No findings — nothing to chart.</span>'}</div>
      </div>
    </div>
  </header>

  <main class="wrap">
    ${result.baselinedCount > 0 ? `<p class="baseline-note">${result.baselinedCount} known finding(s) suppressed by baseline.</p>` : ""}
    ${warnings ? `<ul class="warnings">${warnings}</ul>` : ""}
    <div class="toolbar">
      <input id="search" type="search" placeholder="Filter by file, pattern, or explanation…" aria-label="Filter findings">
      <select id="severity" aria-label="Filter by severity">
        <option value="">All severities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>
      <select id="category" aria-label="Filter by category">
        <option value="">All categories</option>
      </select>
    </div>
    <div id="report"></div>
  </main>

  <footer>
    <div class="wrap">Generated by ai-slop-remover · deterministic static analysis, no LLM · findings are heuristics with evidence, not verdicts.</div>
  </footer>

  <script>
    const findings = ${payload};
    const report = document.getElementById("report");
    const search = document.getElementById("search");
    const severity = document.getElementById("severity");
    const category = document.getElementById("category");

    for (const value of [...new Set(findings.map((finding) => finding.category))].sort()) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label(value);
      category.appendChild(option);
    }

    for (const input of [search, severity, category]) input.addEventListener("input", render);
    render();

    function render() {
      const term = search.value.trim().toLowerCase();
      const selectedSeverity = severity.value;
      const selectedCategory = category.value;
      const visible = findings.filter((finding) => {
        if (selectedSeverity && finding.severity !== selectedSeverity) return false;
        if (selectedCategory && finding.category !== selectedCategory) return false;
        if (!term) return true;
        return JSON.stringify(finding).toLowerCase().includes(term);
      });

      if (visible.length === 0) {
        report.innerHTML = '<div class="empty">No findings match the current filters.</div>';
        return;
      }

      const groups = groupBy(visible, (finding) => finding.category);
      report.innerHTML = [...groups.entries()].map(([cat, rows]) => section(cat, rows)).join("");
    }

    function section(cat, rows) {
      return '<details class="section" open><summary>' + esc(label(cat)) +
        ' <span class="n">· ' + rows.length + ' finding(s)</span></summary>' +
        rows.map(finding).join("") + '</details>';
    }

    function finding(f) {
      return '<article class="finding">' +
        '<div class="fhead">' +
          '<span class="sev ' + f.severity + '">' + f.severity + '</span>' +
          '<span class="conf">' + Math.round(f.confidence * 100) + '%</span>' +
          '<a class="loc" href="' + encodeURI(f.file) + '">' + esc(f.file + ':' + f.line_start) + '</a>' +
          '<span class="ftitle">' + esc(f.title) + '</span>' +
        '</div>' +
        '<p class="why">' + esc(f.explanation) +
          ' <span class="obs">(observed: ' + esc(f.pattern_observed) + ' · expected: ' + esc(f.dominant_pattern) + ')</span></p>' +
        (f.evidence ? '<pre class="evidence">' + esc(f.evidence) + '</pre>' : '') +
        (f.fix_hint ? '<p class="fix"><b>fix:</b> ' + esc(f.fix_hint) + '</p>' : '') +
      '</article>';
    }

    function label(value) {
      return value.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
    }

    function groupBy(items, keyFn) {
      const groups = new Map();
      for (const item of items) {
        const key = keyFn(item);
        const group = groups.get(key) || [];
        group.push(item);
        groups.set(key, group);
      }
      return groups;
    }

    function esc(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }
  </script>
</body>
</html>`;
}

function formatLines(totalLines: number): string {
  return totalLines >= 1000 ? `${(totalLines / 1000).toFixed(1)}k` : String(totalLines);
}
