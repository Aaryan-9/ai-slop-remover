import fs from "node:fs";
import path from "node:path";
import type { Detector, DetectorContext, Finding, ParsedFile } from "../types.js";
import { isExampleFile, isTestFile } from "../utils/fileKinds.js";
import { clampSnippet, lineForIndex } from "../utils/text.js";
import { slopFinding } from "./common.js";

const CATEGORY = "phantom_import";

const nodeBuiltins = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "test", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib"
]);

// CPython's sys.stdlib_module_names (union across 3.8-3.13, public names).
const pythonStdlib = new Set([
  "__future__", "abc", "aifc", "argparse", "array", "ast", "asynchat", "asyncio", "asyncore",
  "atexit", "audioop", "base64", "bdb", "binascii", "binhex", "bisect", "builtins", "bz2",
  "cProfile", "calendar", "cgi", "cgitb", "chunk", "cmath", "cmd", "code", "codecs", "codeop",
  "collections", "colorsys", "compileall", "concurrent", "configparser", "contextlib",
  "contextvars", "copy", "copyreg", "crypt", "csv", "ctypes", "curses", "dataclasses", "datetime",
  "dbm", "decimal", "difflib", "dis", "distutils", "doctest", "email", "encodings", "ensurepip",
  "enum", "errno", "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch", "formatter",
  "fractions", "ftplib", "functools", "gc", "genericpath", "getopt", "getpass", "gettext", "glob",
  "graphlib", "grp", "gzip", "hashlib", "heapq", "hmac", "html", "http", "idlelib", "imaplib",
  "imghdr", "imp", "importlib", "inspect", "io", "ipaddress", "itertools", "json", "keyword",
  "lib2to3", "linecache", "locale", "logging", "lzma", "mailbox", "mailcap", "marshal", "math",
  "mimetypes", "mmap", "modulefinder", "msilib", "msvcrt", "multiprocessing", "netrc", "nis",
  "nntplib", "nt", "ntpath", "nturl2path", "numbers", "opcode", "operator", "optparse", "os",
  "ossaudiodev", "pathlib", "pdb", "pickle", "pickletools", "pipes", "pkgutil", "platform",
  "plistlib", "poplib", "posix", "posixpath", "pprint", "profile", "pstats", "pty", "pwd",
  "py_compile", "pyclbr", "pydoc", "pyexpat", "queue", "quopri", "random", "re", "readline",
  "reprlib", "resource", "rlcompleter", "runpy", "sched", "secrets", "select", "selectors",
  "shelve", "shlex", "shutil", "signal", "site", "smtpd", "smtplib", "sndhdr", "socket",
  "socketserver", "spwd", "sqlite3", "ssl", "stat", "statistics", "string", "stringprep",
  "struct", "subprocess", "sunau", "symtable", "sys", "sysconfig", "syslog", "tabnanny",
  "tarfile", "telnetlib", "tempfile", "termios", "textwrap", "this", "threading", "time",
  "timeit", "tkinter", "token", "tokenize", "tomllib", "trace", "traceback", "tracemalloc",
  "tty", "turtle", "turtledemo", "types", "typing", "unicodedata", "unittest", "urllib", "uu",
  "uuid", "venv", "warnings", "wave", "weakref", "webbrowser", "winreg", "winsound", "wsgiref",
  "xdrlib", "xml", "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib", "zoneinfo"
]);

/** Common import-name → PyPI distribution-name mismatches. */
const pythonImportAliases: Record<string, string[]> = {
  pil: ["pillow"],
  cv2: ["opencv_python", "opencv_python_headless", "opencv_contrib_python"],
  sklearn: ["scikit_learn"],
  skimage: ["scikit_image"],
  yaml: ["pyyaml"],
  bs4: ["beautifulsoup4"],
  dotenv: ["python_dotenv"],
  dateutil: ["python_dateutil"],
  jwt: ["pyjwt"],
  jose: ["python_jose"],
  crypto: ["pycryptodome", "pycrypto"],
  nacl: ["pynacl"],
  openssl: ["pyopenssl"],
  magic: ["python_magic"],
  fitz: ["pymupdf"],
  docx: ["python_docx"],
  pptx: ["python_pptx"],
  slugify: ["python_slugify"],
  multipart: ["python_multipart"],
  serial: ["pyserial"],
  usb: ["pyusb"],
  zmq: ["pyzmq"],
  mysqldb: ["mysqlclient"],
  psycopg2: ["psycopg2_binary"],
  github: ["pygithub"],
  telegram: ["python_telegram_bot"],
  websocket: ["websocket_client"],
  googleapiclient: ["google_api_python_client"],
  attr: ["attrs"],
  uuid_extensions: ["uuid7"]
};

interface ImportUse {
  spec: string;
  line: number;
  evidence: string;
}

export const phantomImportsDetector: Detector = {
  id: "phantom_import",
  displayName: "Phantom imports",
  async run({ rootPath, files }: DetectorContext) {
    const findings: Finding[] = [];
    const packageJsonCache = new Map<string, Set<string> | undefined>();
    const pythonDeps = loadPythonDependencies(rootPath);
    const pythonLocalModules = collectPythonLocalModules(files);
    const goModule = loadGoModule(rootPath);
    const cargoDeps = loadCargoDependencies(rootPath);
    const rustLocalModules = collectRustLocalModules(files);

    for (const file of files) {
      // Test files import real packages or the test run itself would fail,
      // and example/demo code imports packages users are expected to install
      // themselves — both only add noise here.
      if (isTestFile(file.relativePath) || isExampleFile(file.relativePath)) continue;
      if (file.language === "javascript" || file.language === "typescript") {
        findings.push(...jsFindings(file, rootPath, packageJsonCache));
      } else if (file.language === "python" && pythonDeps) {
        findings.push(...pythonFindings(file, pythonDeps, pythonLocalModules));
      } else if (file.language === "go" && goModule) {
        findings.push(...goImportFindings(file, goModule));
      } else if (file.language === "rust" && cargoDeps) {
        findings.push(...rustImportFindings(file, cargoDeps, rustLocalModules));
      }
    }
    return findings;
  }
};

interface GoModule {
  modulePath: string;
  declared: string[];
}

function loadGoModule(rootPath: string): GoModule | undefined {
  const goModPath = path.join(rootPath, "go.mod");
  if (!fs.existsSync(goModPath)) return undefined;
  const content = fs.readFileSync(goModPath, "utf8");
  const modulePath = content.match(/^module\s+(\S+)/m)?.[1];
  if (!modulePath) return undefined;

  const declared: string[] = [];
  for (const match of content.matchAll(/^require\s+([^\s(]+)\s+v/gm)) declared.push(match[1]!);
  for (const block of content.matchAll(/require\s*\(([\s\S]*?)\)/g)) {
    for (const line of block[1]!.split(/\r\n|\r|\n/)) {
      const name = line.trim().match(/^([\w./~-]+)\s+v/)?.[1];
      if (name) declared.push(name);
    }
  }
  // Replaced modules are still imported under their original path.
  for (const match of content.matchAll(/^replace\s+([^\s=]+)/gm)) declared.push(match[1]!);
  return { modulePath, declared };
}

function goImportFindings(file: ParsedFile, goModule: GoModule): Finding[] {
  const findings: Finding[] = [];
  const covered = (importPath: string): boolean =>
    [goModule.modulePath, ...goModule.declared].some(
      (declared) => importPath === declared || importPath.startsWith(`${declared}/`)
    );

  for (const use of goImportUses(file)) {
    // Go stdlib packages have no dot in the first path segment;
    // anything domain-based must be the module itself or a declared require.
    const firstSegment = use.spec.split("/")[0] ?? "";
    if (!firstSegment.includes(".")) continue;
    if (covered(use.spec)) continue;

    findings.push(phantomFinding(file, use, "undeclared module import",
      `"${use.spec}" is imported but is neither this module nor declared in go.mod — a hallucinated or missing dependency.`,
      `Verify "${use.spec}" is a real, intended module. If yes, add it to go.mod (go get); if not, remove or replace this import.`,
      0.85));
  }
  return findings;
}

function goImportUses(file: ParsedFile): ImportUse[] {
  const uses: ImportUse[] = [];
  const record = (spec: string, index: number, evidence: string) => {
    uses.push({ spec, line: lineForIndex(file.source, index), evidence: clampSnippet(evidence.trim(), 120) });
  };
  for (const match of file.source.matchAll(/^import\s+(?:[\w.]+\s+)?"([^"]+)"/gm)) {
    if (match[1] && match.index !== undefined) record(match[1], match.index, match[0]);
  }
  for (const block of file.source.matchAll(/^import\s*\(([\s\S]*?)\)/gm)) {
    if (block.index === undefined) continue;
    const inner = block[1]!;
    const innerOffset = block[0].indexOf("(") + 1;
    for (const entry of inner.matchAll(/(?:^|\n)\s*(?:[\w.]+\s+)?"([^"]+)"/g)) {
      if (entry[1] && entry.index !== undefined) record(entry[1], block.index + innerOffset + entry.index, entry[0]);
    }
  }
  return uses;
}

function loadCargoDependencies(rootPath: string): Set<string> | undefined {
  const cargoPath = path.join(rootPath, "Cargo.toml");
  if (!fs.existsSync(cargoPath)) return undefined;
  const content = fs.readFileSync(cargoPath, "utf8");
  const deps = new Set<string>();

  const packageName = content.match(/\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m)?.[1];
  if (packageName) deps.add(normalizeRustName(packageName));

  const sectionHeader = /^\[(?:target\.[^\]]+\.)?(?:workspace\.)?((?:dev-|build-)?dependencies)(?:\.([A-Za-z0-9_-]+))?\]/;
  let inDependencySection = false;
  for (const line of content.split(/\r\n|\r|\n/)) {
    const header = line.trim().match(/^\[.*\]$/) ? line.trim().match(sectionHeader) : undefined;
    if (line.trim().startsWith("[")) {
      inDependencySection = Boolean(header);
      // [dependencies.serde] style declares the crate in the header itself.
      if (header?.[2]) deps.add(normalizeRustName(header[2]));
      continue;
    }
    if (!inDependencySection) continue;
    const name = line.match(/^\s*([A-Za-z0-9_-]+)\s*=/)?.[1];
    if (name) deps.add(normalizeRustName(name));
  }
  return deps;
}

function rustImportFindings(file: ParsedFile, cargoDeps: Set<string>, localModules: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const builtin = new Set(["crate", "self", "super", "std", "core", "alloc", "test", "proc_macro"]);
  const seen = new Set<string>();
  // `use` must have a `::` path: bare `use Foo;` re-imports local items
  // (2015-edition style) and never names an external crate in practice.
  const patterns = [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+(?:::)?([A-Za-z_]\w*)\s*::/gm,
    /^\s*extern\s+crate\s+([A-Za-z_]\w*)/gm
  ];

  for (const pattern of patterns) {
    for (const match of file.source.matchAll(pattern)) {
      const top = normalizeRustName(match[1] ?? "");
      if (!top || match.index === undefined) continue;
      if (builtin.has(top) || seen.has(top)) continue;
      seen.add(top);
      if (cargoDeps.has(top) || localModules.has(top)) continue;

      findings.push(phantomFinding(file, {
        spec: match[1]!,
        line: lineForIndex(file.source, match.index),
        evidence: clampSnippet(match[0].trim(), 120)
      }, "undeclared crate import",
        `"${match[1]}" is used but is not declared in Cargo.toml and is not a local module — a hallucinated or missing dependency.`,
        `Verify "${match[1]}" is a real, intended crate. If yes, add it to Cargo.toml (cargo add); if not, remove or replace this use.`,
        0.8));
    }
  }
  return findings;
}

function normalizeRustName(name: string): string {
  return name.toLowerCase().replaceAll("-", "_");
}

function collectRustLocalModules(files: ParsedFile[]): Set<string> {
  const modules = new Set<string>();
  for (const file of files) {
    if (file.language !== "rust") continue;
    const parts = file.relativePath.split("/");
    modules.add(normalizeRustName(parts[parts.length - 1]!.replace(/\.rs$/, "")));
    for (const dir of parts.slice(0, -1)) modules.add(normalizeRustName(dir));
    // Inline `mod name { ... }` and `mod name;` declarations.
    for (const match of file.source.matchAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)/gm)) {
      modules.add(normalizeRustName(match[1]!));
    }
  }
  return modules;
}

function jsFindings(file: ParsedFile, rootPath: string, cache: Map<string, Set<string> | undefined>): Finding[] {
  const findings: Finding[] = [];
  for (const use of jsImportUses(file)) {
    const spec = use.spec;
    if (spec.startsWith("node:")) continue;

    if (spec.startsWith("./") || spec.startsWith("../")) {
      if (!resolvesOnDisk(path.dirname(file.absolutePath), spec)) {
        findings.push(phantomFinding(file, use, "unresolved relative import",
          `The import target "${spec}" does not exist on disk relative to this file.`,
          `Fix or remove this import: "${spec}" resolves to no file. It may reference a module the generator imagined.`,
          0.85));
      }
      continue;
    }

    if (!isBarePackageSpec(spec)) continue;
    const packageName = packageNameOf(spec);
    if (nodeBuiltins.has(packageName)) continue;
    if (declaredInPackageJson(path.dirname(file.absolutePath), rootPath, packageName, cache)) continue;
    if (existsInNodeModules(path.dirname(file.absolutePath), rootPath, packageName)) continue;

    findings.push(phantomFinding(file, use, "undeclared package import",
      `"${packageName}" is imported but not declared in any package.json and not present in node_modules — a hallucinated or missing dependency (slopsquatting risk).`,
      `Verify "${packageName}" is a real, intended package. If yes, add it to package.json; if not, remove or replace this import.`,
      0.85));
  }
  return findings;
}

function jsImportUses(file: ParsedFile): ImportUse[] {
  const uses: ImportUse[] = [];
  const patterns = [
    /(?:^|\n)\s*(?:import|export)\b[^"'\n;]*?from\s*["']([^"'\n]+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"'\n]+)["']/g,
    /\brequire\s*\(\s*["']([^"'\n]+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g
  ];
  const seen = new Set<string>();
  const lines = file.source.split(/\r\n|\r|\n/);
  for (const pattern of patterns) {
    for (const match of file.source.matchAll(pattern)) {
      const spec = match[1];
      if (!spec || match.index === undefined) continue;
      const line = lineForIndex(file.source, match.index + match[0].indexOf(spec));
      // Imports quoted inside comments (JSDoc @example blocks, prose) are
      // documentation, not resolvable code.
      const lineText = (lines[line - 1] ?? "").trim();
      if (lineText.startsWith("//") || lineText.startsWith("*") || lineText.startsWith("/*") || lineText.startsWith("#")) continue;
      const key = `${spec}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uses.push({ spec, line, evidence: clampSnippet(match[0].trim(), 120) });
    }
  }
  return uses;
}

function isBarePackageSpec(spec: string): boolean {
  // Aliases (@/, ~/, #imports), absolute paths, and URLs are resolved by
  // bundler/tsconfig configuration this scanner does not read, so skip them.
  if (spec.startsWith("@")) return /^@[a-z0-9][\w.-]*\//.test(spec);
  return /^[a-z0-9][\w.-]*(\/|$)/i.test(spec) && !spec.includes(":");
}

function packageNameOf(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

const jsResolveExtensions = ["", ".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".node"];

function resolvesOnDisk(fromDir: string, spec: string): boolean {
  const base = path.resolve(fromDir, spec);
  const candidates = new Set<string>();
  for (const ext of jsResolveExtensions) candidates.add(`${base}${ext}`);
  for (const ext of jsResolveExtensions.slice(1)) candidates.add(path.join(base, `index${ext}`));
  // NodeNext-style: source imports "./x.js" while the file on disk is "./x.ts".
  const remapped = base.replace(/\.(m|c)?js$/, (match) => match.replace("js", "ts"));
  if (remapped !== base) candidates.add(remapped);
  // Imports of assets (styles, images, wasm) with explicit extensions are
  // bundler-resolved; only treat known-code extensions as must-exist.
  const ext = path.extname(spec);
  if (ext && !/^\.(m|c)?(j|t)sx?$|^\.json$|^\.node$/.test(ext)) return true;

  return [...candidates].some((candidate) => fs.existsSync(candidate));
}

function declaredInPackageJson(fromDir: string, rootPath: string, packageName: string, cache: Map<string, Set<string> | undefined>): boolean {
  for (const dir of walkUpDirs(fromDir, rootPath)) {
    let deps = cache.get(dir);
    if (!cache.has(dir)) {
      deps = readPackageJsonDeps(path.join(dir, "package.json"));
      cache.set(dir, deps);
    }
    if (deps?.has(packageName)) return true;
  }
  return false;
}

function readPackageJsonDeps(packageJsonPath: string): Set<string> | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, Record<string, string>> & { name?: string };
    const deps = new Set<string>();
    // A package may legally import its own name (Node self-reference).
    if (typeof parsed.name === "string") deps.add(parsed.name);
    for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const name of Object.keys(parsed[key] ?? {})) deps.add(name);
    }
    return deps;
  } catch {
    // Unparseable package.json: report no declarations rather than aborting the scan.
    return undefined;
  }
}

function existsInNodeModules(fromDir: string, rootPath: string, packageName: string): boolean {
  return [...walkUpDirs(fromDir, rootPath)].some((dir) => fs.existsSync(path.join(dir, "node_modules", packageName)));
}

function* walkUpDirs(fromDir: string, rootPath: string): Generator<string> {
  let current = fromDir;
  const stop = path.resolve(rootPath);
  while (true) {
    yield current;
    if (path.resolve(current) === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function pythonFindings(file: ParsedFile, declaredDeps: Set<string>, localModules: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  // Top-level imports only: indented imports live under TYPE_CHECKING,
  // try/except ImportError, or lazy-loading guards — deliberate patterns
  // with fallbacks, not hallucinations.
  const patterns = [/^import\s+([\w.]+)/gm, /^from\s+([\w.]+)\s+import\b/gm];
  for (const pattern of patterns) {
    for (const match of file.source.matchAll(pattern)) {
      const module = match[1];
      if (!module || match.index === undefined || module.startsWith(".")) continue;
      const top = normalizePythonName(module.split(".")[0]!);
      // Underscore-prefixed modules are CPython internals or local privates;
      // PyPI does not host hallucinatable packages under those names.
      if (top.startsWith("_")) continue;
      if (seen.has(top)) continue;
      seen.add(top);

      if (pythonStdlib.has(top) || localModules.has(top)) continue;
      const aliases = [top, ...(pythonImportAliases[top] ?? [])];
      if (aliases.some((name) => declaredDeps.has(name))) continue;

      findings.push(phantomFinding(file, {
        spec: module,
        line: lineForIndex(file.source, match.index),
        evidence: clampSnippet(match[0].trim(), 120)
      }, "undeclared package import",
        `"${top}" is imported but is not in the standard library, not a local module, and not declared in requirements/pyproject — a hallucinated or missing dependency.`,
        `Verify "${top}" is a real, intended package. If yes, declare it in your dependency manifest; if not, remove or replace this import.`,
        0.75));
    }
  }
  return findings;
}

function normalizePythonName(name: string): string {
  return name.toLowerCase().replaceAll("-", "_");
}

function loadPythonDependencies(rootPath: string): Set<string> | undefined {
  const deps = new Set<string>();
  let foundManifest = false;

  for (const candidate of ["requirements.txt", "requirements-dev.txt", "requirements_dev.txt", "dev-requirements.txt"]) {
    const filePath = path.join(rootPath, candidate);
    if (!fs.existsSync(filePath)) continue;
    foundManifest = true;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r\n|\r|\n/)) {
      const name = line.trim().match(/^([A-Za-z0-9][\w.-]*)/)?.[1];
      if (name) deps.add(normalizePythonName(name));
    }
  }

  const pyprojectPath = path.join(rootPath, "pyproject.toml");
  if (fs.existsSync(pyprojectPath)) {
    foundManifest = true;
    const content = fs.readFileSync(pyprojectPath, "utf8");
    // Dependency specifiers inside any array: "package>=1.0", "package[extra]"...
    for (const match of content.matchAll(/["']([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(?:[><=!~;@ ].*)?["']/g)) {
      deps.add(normalizePythonName(match[1]!));
    }
    // Poetry predates PEP 621, so its dependencies live in TOML tables
    // rather than the string arrays handled above.
    for (const table of content.matchAll(/\[tool\.poetry(?:\.group\.\w+)?\.dependencies\]([\s\S]*?)(?=\n\[|$)/g)) {
      for (const line of table[1]!.split(/\r\n|\r|\n/)) {
        const name = line.match(/^\s*([A-Za-z0-9][\w.-]*)\s*=/)?.[1];
        if (name && name !== "python") deps.add(normalizePythonName(name));
      }
    }
  }

  return foundManifest ? deps : undefined;
}

function collectPythonLocalModules(files: ParsedFile[]): Set<string> {
  const modules = new Set<string>();
  for (const file of files) {
    if (file.language !== "python") continue;
    const parts = file.relativePath.split("/");
    const stem = parts[parts.length - 1]!.replace(/\.pyw?$/, "");
    modules.add(normalizePythonName(stem));
    for (const dir of parts.slice(0, -1)) modules.add(normalizePythonName(dir));
  }
  return modules;
}

function phantomFinding(file: ParsedFile, use: ImportUse, observed: string, explanation: string, fixHint: string, confidence: number): Finding {
  return slopFinding({
    category: CATEGORY,
    title: "Import does not resolve to anything",
    file: file.relativePath,
    lineStart: use.line,
    lineEnd: use.line,
    observed,
    expected: "imports that resolve to declared dependencies or real files",
    severity: "high",
    confidence,
    fixHint,
    evidence: use.evidence,
    explanation
  });
}
