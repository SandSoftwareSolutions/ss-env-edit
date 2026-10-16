# @sandsoftwaresolutions/env-edit

[![CI](https://github.com/SandSoftwareSolutions/ss-env-edit/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-env-edit/actions/workflows/ci.yml)

Change a `.env` file from code without wrecking it: comments, order, blank lines and quotes stay exactly as they were. For installers, setup scripts and "generate a secret and put it in .env". No dependencies. Pairs with [`env-guard`](https://github.com/SandSoftwareSolutions/ss-env-guard), which *checks* the environment at startup.

## Install

```bash
npm install @sandsoftwaresolutions/env-edit
```

## Usage

```js
import { readFileSync, writeFileSync } from "node:fs";
import { readEnv, setValue, setValues, removeKey, compareEnv } from "@sandsoftwaresolutions/env-edit";

let text = readFileSync(".env", "utf8");

readEnv(text);                                   // { DB_URL: "...", PORT: "3000" }
text = setValue(text, "PORT", "8080");           // changes that one line, nothing else
text = setValue(text, "SESSION_SECRET", secret, { comment: "made by setup" });   // new variable at the end
text = setValues(text, { A: "1", B: "two words" });
text = removeKey(text, "OLD_KEY");
writeFileSync(".env", text);

compareEnv(readFileSync(".env.example", "utf8"), text);
// { missing: ["API_KEY"], extra: ["OLD"], empty: ["DB_PASSWORD"] }
```

## What it keeps

`setValue` changes the one variable and leaves every other byte alone:

- comments and blank lines, and the order of variables
- the `export ` prefix and the indentation of the line you change
- an inline comment (`PORT=3000  # dev only`) stays after the new value
- Windows (`\r\n`) or Unix line endings, and whether the file ended with a newline

## What it understands (and how it writes)

It reads and writes the way the real readers do (dotenv, Node's `util.parseEnv`, Next.js), because a `.env` file is only as good as what *they* make of it. The round trip is tested against Node's own parser.

- **Bare values:** `KEY=value`; ` #` starts a comment after them, but a `#` without a space before it is part of the value (`COLOR=#ff0000`).
- **Single quotes** `KEY='as is'`: completely literal. Quotes, backslashes, `$`, `#` and even line breaks stay exactly as written. **This is what `setValue` writes** when a value needs quoting.
- **Backticks** `` KEY=`it's` ``: literal too; used for a value that contains a single quote.
- **Double quotes** `KEY="line one\nline two"`: only `\n` (and `\r`) become a line break; every other backslash stays as it is, and `\"` does not end the value (as in dotenv). Used only for the rare value that contains both `'` and a backtick.
- A value that no reader can agree on (a carriage return, or both quote kinds plus a quote, backslash or `$`) is **refused with an error** instead of being written wrong.
- `export KEY=value` is understood and kept. When a key appears twice the last one wins, like in dotenv. Variables are **not expanded** (`$HOME` stays text).
- A line that is not valid is kept as it is and listed in `parseEnv(text).problems`; nothing is thrown away.

`parseEnv(text)` gives you the full list of entries (with their raw text) if you need more than the values.
