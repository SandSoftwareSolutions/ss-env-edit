export interface EnvEntry {
  type: "var" | "comment" | "blank" | "other";
  /** The line(s) exactly as written. */
  raw: string;
  key?: string;
  value?: string;
  exported?: boolean;
  quote?: '"' | "'" | null;
  line: number;
}

export interface ParsedEnv {
  entries: EnvEntry[];
  problems: { line: number; message: string }[];
  eol: "\n" | "\r\n";
  trailingNewline: boolean;
  get(key: string): string | undefined;
  toObject(): Record<string, string>;
}

export function parseEnv(text: string): ParsedEnv;
export function readEnv(text: string): Record<string, string>;
export function formatValue(value: unknown): string;
export function setValue(text: string, key: string, value: unknown, options?: { comment?: string }): string;
export function setValues(text: string, values: Record<string, unknown>): string;
export function removeKey(text: string, key: string): string;
export function compareEnv(exampleText: string, actualText: string): { missing: string[]; extra: string[]; empty: string[] };
