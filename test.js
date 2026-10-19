import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnv as nodeParseEnv } from "node:util";

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

// Changed expectation (it said that COLOR=#ff0000 reads as "#ff0000" and that the # of a URL stays in the value). dotenv 17.4.1 and
// Node 24's util.parseEnv both read an unquoted value only up to the first #, with or without a space before it.
test("in an unquoted value a # starts a comment, as in dotenv and Node", () => {
  assert.equal(readEnv("COLOR=#ff0000").COLOR, "");
  assert.equal(readEnv("URL=http://x/#anchor").URL, "http://x/");
  assert.equal(readEnv("A=1 # comment").A, "1");
  assert.equal(readEnv("A= # comment").A, "");
  assert.equal(readEnv("A='#ff0000'\nB=\"x # y\" # z").A, "#ff0000");
  for (const text of ["COLOR=#ff0000", "URL=http://x/#anchor", "A=1 # comment", "A= # c", "A=b#c", "A='q' # c", "A=\"q\"#c"]) {
    assert.deepEqual(readEnv(text), { ...nodeParseEnv(text) }, text);
  }
});

test("a comment that contains the quote character of the value is kept when the value changes", () => {
  assert.equal(setValue('A="x" # say "hi"\nB=1\n', "A", "y"), 'A=y # say "hi"\nB=1\n');
  assert.equal(setValue("A='x' # it's here\n", "A", "y"), "A=y # it's here\n");
  assert.equal(setValue("A=old#note\n", "A", "new"), "A=new #note\n");
  assert.equal(setValue("A= # only a comment\n", "A", "v"), "A=v # only a comment\n");
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

test("what we write is read back exactly, by us AND by Node's own parser", () => {
  const nasty = [
    "plain", "with space", "has # hash", 'say "hi"', "back\\slash", "a\\nb", "line\nbreak", "multi\nline\nvalue", " lead", "trail ", "$HOME", "${HOME}", "a=b", "=starts",
    "", "ünï ✓", "tab\there", "it's", "it's \"quoted\"", "back`tick", "mix \"q\" and $x and \\n", "C:\\Users\\kaj", "\\", "'", "-----BEGIN KEY-----\nabc\n-----END KEY-----"
  ];
  for (const value of nasty) {
    const text = setValue("", "K", value);
    assert.equal(readEnv(text).K, value, `ours: ${JSON.stringify(value)} written as ${JSON.stringify(text)}`);
    assert.equal(nodeParseEnv(text).K ?? "", value, `node: ${JSON.stringify(value)} written as ${JSON.stringify(text)}`);
    const second = setValue("A=1\n# note\nexport K=old # c\nZ=2\n", "K", value);
    assert.equal(nodeParseEnv(second).K ?? "", value, `node (edit in place): ${JSON.stringify(value)}`);
    assert.equal(nodeParseEnv(second).Z, "2");
  }
});

test("values that no reader can agree on are refused instead of written wrongly", () => {
  assert.throws(() => formatValue("both ' and ` and \" here"), RangeError);
  assert.throws(() => formatValue("carriage\rreturn"), RangeError);
  assert.equal(formatValue("both ' and ` only"), '"both \' and ` only"');
  assert.equal(nodeParseEnv(`K=${formatValue("both ' and ` and\nnewline")}\n`).K, "both ' and ` and\nnewline");
  assert.equal(formatValue("simple-value_1.2"), "simple-value_1.2");
  assert.equal(formatValue(42), "42");
});

test("we read files the way dotenv and Node do", () => {
  const text = [
    "A=\"line1\\nline2\"", "B='literal \\n stays'", "C=`both ' and \"`", 'D="has \\"escaped\\" quotes"', "E=\"back\\\\slash\"", "F=plain # comment", "G='single' # comment"
  ].join("\n") + "\n";
  const ours = readEnv(text);
  assert.equal(ours.A, "line1\nline2");
  assert.equal(ours.B, "literal \\n stays");
  assert.equal(ours.C, "both ' and \"");
  assert.equal(ours.D, 'has \\"escaped\\" quotes'); // dotenv keeps the backslashes; only \n and \r are expanded
  assert.equal(ours.E, "back\\\\slash");
  assert.equal(ours.F, "plain");
  assert.equal(ours.G, "single");
  const node = nodeParseEnv(text);
  for (const key of ["A", "B", "C", "F", "G"]) assert.equal(ours[key], node[key], key);
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
  assert.equal(setValues("A=1\n", { A: "2", B: "x y" }), "A=2\nB='x y'\n");
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

test("editing one variable leaves every other byte alone, also line breaks inside quoted values and mixed line breaks", () => {
  const crlfValue = "A='x\r\ny'\r\nB=2\r\n";
  assert.equal(setValue(crlfValue, "B", "3"), "A='x\r\ny'\r\nB=3\r\n");
  assert.equal(removeKey(crlfValue, "B"), "A='x\r\ny'\r\n");
  const mixed = "# one\nA=1\r\nB=2\nC=3\r\n";
  assert.equal(setValue(mixed, "B", "9"), "# one\nA=1\r\nB=9\nC=3\r\n");
  assert.equal(removeKey(mixed, "A"), "# one\nB=2\nC=3\r\n");
  assert.equal(setValue("A=1\r\nB=2", "C", "3"), "A=1\r\nB=2\r\nC=3\r\n", "a file without a final line break gets one before the new line");
  assert.equal(removeKey("A=1\nB=2", "B"), "A=1", "no final line break stays that way");
  assert.equal(removeKey("A=1\nB=2\n", "B"), "A=1\n");
});

test("entries know the line where they start", () => {
  const { entries } = parseEnv("A='x\ny'\n# c\n\nB=2\nnot valid\nC=3");
  assert.deepEqual(entries.map((e) => [e.type, e.line]), [["var", 1], ["comment", 3], ["blank", 4], ["var", 5], ["other", 6], ["var", 7]]);
});

test("compareEnv does not mistake names that every object has for variables", () => {
  assert.deepEqual(compareEnv("constructor=1\ntoString=2\n", "A=1"), { missing: ["constructor", "toString"], extra: ["A"], empty: [] });
  assert.deepEqual(compareEnv("A=1", "constructor=1\nhasOwnProperty="), { missing: ["A"], extra: ["constructor", "hasOwnProperty"], empty: [] });
  assert.deepEqual(compareEnv("valueOf=1", "valueOf="), { missing: [], extra: [], empty: ["valueOf"] });
});
