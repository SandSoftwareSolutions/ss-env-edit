const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// The real readers (dotenv, Node's util.parseEnv, Next.js) agree on very little inside double quotes: only \n (and \r) become a
// line break; every other backslash stays as it is. Single quotes and backticks are completely literal. So that is what we read.
function unescapeDouble(inner) {
  return inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
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
  // Lines and the line breaks after them, kept apart so that every line keeps its own break (a file may mix \n and \r\n).
  const pieces = text === "" ? [] : text.split(/(\r\n|\n)/);
  const rawLines = [];
  const breaks = [];
  for (let k = 0; k < pieces.length; k += 2) {
    rawLines.push(pieces[k]);
    breaks.push(pieces[k + 1] ?? "");
  }
  const trailingNewline = rawLines.length > 1 && rawLines[rawLines.length - 1] === "";
  if (trailingNewline) {
    rawLines.pop();
    breaks.pop();
  }
  const entries = [];
  const problems = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      entries.push({ type: "blank", raw: line, end: breaks[i], line: i + 1 });
      continue;
    }
    if (trimmed.startsWith("#")) {
      entries.push({ type: "comment", raw: line, end: breaks[i], line: i + 1 });
      continue;
    }
    const m = /^(\s*)(export\s+)?([^=\s]+)\s*=(.*)$/s.exec(line);
    if (!m || !KEY.test(m[3])) {
      entries.push({ type: "other", raw: line, end: breaks[i], line: i + 1 });
      problems.push({ line: i + 1, message: "not a KEY=value line" });
      continue;
    }
    let rest = m[4].replace(/^\s+/, "");
    let raw = line;
    let value;
    const first = i;
    let quote = null;
    let comment = ""; // the inline comment (from the #), kept when the value is changed
    if (rest.startsWith('"') || rest.startsWith("'") || rest.startsWith("`")) {
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
      } else {
        value = quote === '"' ? unescapeDouble(body.slice(0, end)) : body.slice(0, end);
        const after = body.slice(end + 1);
        const hash = /^\s*#/.test(after) ? after.indexOf("#") : -1;
        if (hash !== -1) comment = after.slice(hash);
      }
      raw = rawLines.slice(i, last + 1).map((l, k) => (k < last - i ? l + breaks[i + k] : l)).join("");
      i = last;
    } else {
      // As in dotenv and Node's util.parseEnv, a # anywhere in an unquoted value starts a comment (also `A=b#c` and `A=#c`).
      const hash = rest.indexOf("#");
      const bare = hash === -1 ? rest : rest.slice(0, hash);
      value = bare.trim();
      if (hash !== -1) comment = rest.slice(hash);
    }
    entries.push({ type: "var", raw, end: breaks[i], key: m[3], value, exported: Boolean(m[2]), quote, ...(comment ? { comment } : {}), line: first + 1 });
  }
  return { entries, problems, eol, trailingNewline, get: (key) => lastVar(entries, key)?.value, toObject: () => toObject(entries) };
}

function findClosing(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === "\\" && body[i + 1] === '"') i++; // dotenv: \" does not end a double-quoted value
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

/**
 * How a value is written so that the real readers all agree (dotenv, Node's `util.parseEnv`, Next.js): bare when that is safe,
 * otherwise in **single quotes**, which are literal everywhere (quotes, backslashes, `$`, `#` and even line breaks stay as they are).
 * A value with a single quote goes in backticks. A value with both a `'` and a backtick can only be written with double quotes,
 * where just `\n` is understood, so it is accepted only if that is enough; otherwise a RangeError tells you to avoid it.
 */
export function formatValue(value) {
  const text = String(value);
  if (text === "") return "";
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(text) && !text.startsWith("=")) return text;
  if (/\r/.test(text)) throw new RangeError("env-edit: a value with a carriage return (\\r) cannot be written so that every .env reader agrees");
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes("`")) return `\`${text}\``;
  if (!/["\\$]/.test(text)) return `"${text.replace(/\n/g, "\\n")}"`;
  throw new RangeError("env-edit: a value with both a ' and a backtick (and a quote, backslash or $) cannot be written so that every .env reader agrees; avoid it or write the line by hand");
}

// Every entry brings its own line break (`end`), so what was not edited stays byte for byte what it was. Entries added by
// `setValue` have none yet and get the file's usual one.
function emit(parsed) {
  const { entries } = parsed;
  return entries.map((e, i) => e.raw + (e.end ?? (i < entries.length - 1 || parsed.trailingNewline ? parsed.eol : ""))).join("");
}

function checkKey(key) {
  if (typeof key !== "string" || !KEY.test(key)) throw new TypeError(`env-edit: "${key}" is not a valid variable name`);
}

/**
 * Sets a variable and returns the new text. An existing variable is changed in place: its position, its `export` prefix and its
 * inline comment stay. A new one is added at the end, after the optional `comment` line.
 * Everything else is byte-for-byte what it was. A value with a newline, quote, space or `#` is quoted for you.
 */
export function setValue(text, key, value, { comment } = {}) {
  checkKey(key);
  const parsed = parseEnv(text);
  const existing = lastVar(parsed.entries, key);
  const formatted = formatValue(value);
  if (existing) {
    const prefix = `${/^\s*/.exec(existing.raw)[0]}${existing.exported ? "export " : ""}${key}=`;
    existing.raw = `${prefix}${formatted}${existing.comment ? ` ${existing.comment}` : ""}`;
    existing.value = String(value);
    existing.quote = /^['"`]/.test(formatted) ? formatted[0] : null;
  } else {
    const last = parsed.entries[parsed.entries.length - 1];
    if (last && last.end === "") last.end = parsed.eol; // the file did not end with a line break; the new line needs one before it
    if (comment) parsed.entries.push({ type: "comment", raw: `# ${comment}` });
    parsed.entries.push({ type: "var", raw: `${key}=${formatted}`, key, value: String(value), exported: false, quote: /^['"`]/.test(formatted) ? formatted[0] : null });
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
  const last = parsed.entries[parsed.entries.length - 1];
  parsed.entries = parsed.entries.filter((e) => !(e.type === "var" && e.key === key));
  // Removing the last line of a file that has no final line break: the new last line must not get one either.
  if (last && last.end === "" && parsed.entries.length > 0 && parsed.entries[parsed.entries.length - 1] !== last) parsed.entries[parsed.entries.length - 1].end = "";
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
    // hasOwn: a name such as `constructor` or `toString` exists on every object but is not a variable of the file
    missing: Object.keys(example).filter((k) => !Object.hasOwn(actual, k)),
    extra: Object.keys(actual).filter((k) => !Object.hasOwn(example, k)),
    empty: Object.keys(actual).filter((k) => Object.hasOwn(example, k) && actual[k] === "")
  };
}
