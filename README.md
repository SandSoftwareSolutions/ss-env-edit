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

## What it understands

- `KEY=bare value`, `KEY="double quoted with \n escapes"` (also over several lines, for keys and certificates), `KEY='single quoted, literal'`, `export KEY=value`.
- ` #` starts a comment after a bare value; a `#` without a space before it is part of the value (`COLOR=#ff0000`).
- When a key appears twice the last one wins, like in dotenv.
- Variables are **not expanded** (`$HOME` stays text).
- Values that need it (spaces, `#`, quotes, `$`, backslashes, new lines, leading or trailing spaces) are written in double quotes with the right escapes and read back exactly.
- A line that is not valid is kept as it is and listed in `parseEnv(text).problems`; nothing is thrown away.

`parseEnv(text)` gives you the full list of entries (with their raw text) if you need more than the values.
