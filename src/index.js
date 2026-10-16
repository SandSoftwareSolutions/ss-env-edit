const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function unescapeDouble(inner) {
  return inner.replace(/\\(.)/gs, (_, c) => ({ n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\", $: "$" })[c] ?? `\\${c}`);
}

/**
 * Reads the text of a `.env` file into entries, keeping every line exactly as written so that editing one variable leaves
 * everything else (comments, blank lines, order, quotes) untouched. An entry is `{ type: "var" | "comment" | "blank", raw, key, value,
 * exported, quote, line }`. Values: `KEY=bare # comment`, `KEY="double \n quoted"` (escapes read, may span lines), `KEY='single'`
 * (literal). `export KEY=value` is understood. Variables are not expanded. A line that is not valid is kept as a `comment`-like
 * `"other"` entry and reported in `problems`; nothing is thrown or dropped.
 */
export function parseEnv(text) {
  if (typeof text !== "string") throw new TypeError("env-edit: text must be a string");
  const eol = (text.match(/\r\n/g) ?? []).length > (text.match(/(?<!\r)\n/g) ?? []).length ? "\r\n" : "\n";
  const rawLines = text === "" ? [] : text.split(/\r\n|\n/);
  const trailingNewline = rawLines.length > 1 && rawLines[rawLines.length - 1] === "";
  if (trailingNewline) rawLines.pop();
  const entries = [];
  const problems = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      entries.push({ type: "blank", raw: line, line: i + 1 });
      continue;
    }
    if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw: line, line: i + 1 });
      continue;
    }
    const m = /^(\s*)(export\s+)?([^=\s]+)\s*=(.*)$/s.exec(line);
    if (!m || !KEY.test(m[3])) {
      entries.push({ type: "other", raw: line, line: i + 1 });
      problems.push({ line: i + 1, message: "not a KEY=value line" });
      continue;
    }
    let rest = m[4].replace(/^\s+/, "");
    let raw = line;
    let value;
    let quote = null;
    if (rest.startsWith('"') || rest.startsWith("'")) {
      quote = rest[0];
      let body = rest.slice(1);
      let end = findClosing(body, quote);
      let last = i;
      while (end === -1 && last + 1 < rawLines.length) {
        last++;
        body += `\n${rawLines[last]}`;
        end = findClosing(body, quote);
      }
      if (end === -1) {
        problems.push({ line: i + 1, message: `unclosed ${quote} quote` });
        value = body;
        last = rawLines.length - 1;
      } else value = quote === '"' ? unescapeDouble(body.slice(0, end)) : body.slice(0, end);
      raw = rawLines.slice(i, last + 1).join("\n");
      i = last;
    } else {
      const hash = rest.search(/\s#/);
      value = (hash === -1 ? rest : rest.slice(0, hash)).trim();
    }
    entries.push({ type: "var", raw, key: m[3], value, exported: Boolean(m[2]), quote, line: entries.length + 1 });
  }
  return { entries, problems, eol, trailingNewline, get: (key) => lastVar(entries, key)?.value, toObject: () => toObject(entries) };
}

function findClosing(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\") i++;
    else if (body[i] === quote) return i;
  }
  return -1;
}

const lastVar = (entries, key) => [...entries].reverse().find((e) => e.type === "var" && e.key === key);
const toObject = (entries) => Object.fromEntries(entries.filter((e) => e.type === "var").map((e) => [e.key, e.value]));

/** The variables of a `.env` text as an object (the last one wins when a key appears twice, as in dotenv). */
export function readEnv(text) {
  return parseEnv(text).toObject();
}

/** How a value is written: bare when that is safe, otherwise in double quotes with `\\`, `\"` and `\n` escaped. */
export function formatValue(value) {
  const text = String(value);
  if (text === "") return "";
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(text) && !/^[=]/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\$/g, "\\$")}"`;
}

function emit(parsed) {
  return parsed.entries.map((e) => e.raw).join(parsed.eol) + (parsed.trailingNewline && parsed.entries.length > 0 ? parsed.eol : "");
}

function checkKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw new TypeError(`env-edit: "${key}" is not a valid variable name`);
}

/**
 * Sets a variable and returns the new text. An existing variable is changed in place: its position, its `export` prefix and its
 * inline comment stay. A new one is added at the end (after a blank line if the file does not end with one when `section` is given).
 * Everything else is byte-for-byte what it was. A value with a newline, quote, space or `#` is quoted for you.
 */
export function setValue(text, key, value, { comment } = {}) {
  checkKey(key);
  const parsed = parseEnv(text);
  const existing = lastVar(parsed.entries, key);
  const formatted = formatValue(value);
  if (existing) {
    const inline = /\s(#.*)$/.exec(existing.quote ? existing.raw.slice(existing.raw.lastIndexOf(existing.quote) + 1) : existing.raw.replace(/^[^=]*=\s*/, "").replace(/^[^#]*?(?=\s#)/, ""));
    const prefix = `${/^\s*/.exec(existing.raw)[0]}${existing.exported ? "export " : ""}${key}=`;
    existing.raw = `${prefix}${formatted}${inline ? ` ${inline[1]}` : ""}`;
    existing.value = String(value);
    existing.quote = formatted.startsWith('"') ? '"' : null;
  } else {
    if (comment) parsed.entries.push({ type: "comment", raw: `# ${comment}` });
    parsed.entries.push({ type: "var", raw: `${key}=${formatted}`, key, value: String(value), exported: false, quote: formatted.startsWith('"') ? '"' : null });
    parsed.trailingNewline = true;
  }
  return emit(parsed);
}

/** Sets several variables at once: `setValues(text, { A: "1", B: "two words" })`. */
export function setValues(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) out = setValue(out, key, value);
  return out;
}

/** Removes every line of a variable (the comment above it stays, because it may belong to something else). Returns the new text. */
export function removeKey(text, key) {
  checkKey(key);
  const parsed = parseEnv(text);
  parsed.entries = parsed.entries.filter((e) => !(e.type === "var" && e.key === key));
  return emit(parsed);
}

/**
 * Compares an example file (the list of what the app needs) with a real one: `{ missing, extra, empty }` where `missing` are keys in
 * the example but not in the real file, `extra` the other way round, and `empty` keys that are present but have no value.
 */
export function compareEnv(exampleText, actualText) {
  const example = parseEnv(exampleText).toObject();
  const actual = parseEnv(actualText).toObject();
  return {
    missing: Object.keys(example).filter((k) => !(k in actual)),
    extra: Object.keys(actual).filter((k) => !(k in example)),
    empty: Object.keys(actual).filter((k) => k in example && actual[k] === "")
  };
}
