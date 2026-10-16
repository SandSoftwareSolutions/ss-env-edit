import assert from "node:assert/strict";
import { test } from "node:test";

import { compareEnv, formatValue, parseEnv, readEnv, removeKey, setValue, setValues } from "./src/index.js";

const sample = `# Database
DB_URL=postgres://u:p@localhost/app  # local only
export PORT=3000

# Secrets
SECRET="line one\\nline two"
SINGLE='no $expansion \\n here'
EMPTY=
SPACED = spaced value
`;

test("reads bare, quoted, single-quoted, exported, empty and inline-commented values", () => {
  const env = readEnv(sample);
  assert.equal(env.DB_URL, "postgres://u:p@localhost/app");
  assert.equal(env.PORT, "3000");
  assert.equal(env.SECRET, "line one\nline two");
  assert.equal(env.SINGLE, "no $expansion \\n here");
  assert.equal(env.EMPTY, "");
  assert.equal(env.SPACED, "spaced value");
  const parsed = parseEnv(sample);
  assert.equal(parsed.get("PORT"), "3000");
  assert.equal(parsed.entries.find((e) => e.key === "PORT").exported, true);
  assert.deepEqual(parsed.problems, []);
});

test("a # without a space before it is part of the value", () => {
  assert.equal(readEnv("COLOR=#ff0000\nURL=http://x/#anchor").COLOR, "#ff0000");
  assert.equal(readEnv("URL=http://x/#anchor").URL, "http://x/#anchor");
  assert.equal(readEnv("A=1 # comment").A, "1");
});

test("multi-line double-quoted values", () => {
  const env = readEnv('KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nNEXT=1\n');
  assert.equal(env.KEY, "-----BEGIN KEY-----\nabc\n-----END KEY-----");
  assert.equal(env.NEXT, "1");
});

test("the last occurrence of a key wins", () => {
  assert.equal(readEnv("A=1\nA=2").A, "2");
});

test("setValue changes one variable and leaves every other byte alone", () => {
  const out = setValue(sample, "PORT", "8080");
  assert.equal(out, sample.replace("export PORT=3000", "export PORT=8080"));
  const out2 = setValue(sample, "DB_URL", "postgres://other/db");
  assert.equal(out2, sample.replace("DB_URL=postgres://u:p@localhost/app  # local only", "DB_URL=postgres://other/db # local only"));
});

test("setValue adds new variables at the end, with an optional comment", () => {
  const out = setValue(sample, "NEW_KEY", "value", { comment: "added by the installer" });
  assert.ok(out.endsWith("SPACED = spaced value\n# added by the installer\nNEW_KEY=value\n"));
  assert.equal(setValue("", "A", "1"), "A=1\n");
  assert.equal(setValue("A=1", "B", "2"), "A=1\nB=2\n");
});

test("values are quoted when needed and read back exactly", () => {
  const nasty = ["plain", "with space", "has # hash", 'say "hi"', "back\\slash", "line\nbreak", " lead", "trail ", "$HOME", "a=b", "", "ünï ✓", "tab\there"];
  for (const value of nasty) {
    const text = setValue("", "K", value);
    assert.equal(readEnv(text).K, value, JSON.stringify(value));
  }
  assert.equal(formatValue("simple-value_1.2"), "simple-value_1.2");
  assert.equal(formatValue("two words"), '"two words"');
  assert.equal(formatValue(42), "42");
});

test("removeKey removes all lines of that key", () => {
  assert.equal(removeKey("A=1\nB=2\nA=3\n", "A"), "B=2\n");
  assert.equal(removeKey("A=1\n", "Z"), "A=1\n");
  assert.equal(removeKey('M="a\nb"\nX=1\n', "M"), "X=1\n");
});

test("Windows line endings and a missing final newline are kept", () => {
  assert.equal(setValue("A=1\r\nB=2\r\n", "A", "9"), "A=9\r\nB=2\r\n");
  assert.equal(setValue("A=1\r\nB=2", "A", "9"), "A=9\r\nB=2");
  assert.equal(setValue("A=1\r\nB=2\r\n", "C", "3"), "A=1\r\nB=2\r\nC=3\r\n");
});

test("setValues sets several", () => {
  assert.equal(setValues("A=1\n", { A: "2", B: "x y" }), 'A=2\nB="x y"\n');
});

test("lines that are not valid are kept and reported, never dropped", () => {
  const text = "GOOD=1\nthis is not valid\n1BAD=2\nUNCLOSED=\"abc\nGOOD2=2\n";
  const parsed = parseEnv(text);
  assert.ok(parsed.problems.length >= 2);
  assert.equal(setValue("GOOD=1\nthis is not valid\n", "GOOD", "2"), "GOOD=2\nthis is not valid\n");
  assert.equal(parsed.get("GOOD"), "1");
});

test("compareEnv between an example and the real file", () => {
  const example = "A=\nB=\nC=default\n";
  const actual = "A=1\nC=\nD=extra\n";
  assert.deepEqual(compareEnv(example, actual), { missing: ["B"], extra: ["D"], empty: ["C"] });
});

test("bad input", () => {
  assert.throws(() => setValue("", "bad key", "x"), TypeError);
  assert.throws(() => setValue("", "1ABC", "x"), TypeError);
  assert.throws(() => parseEnv(5), TypeError);
  assert.throws(() => removeKey("", ""), TypeError);
});
