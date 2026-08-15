#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DIRECTLY_UNSAFE_KEYWORDS = Object.freeze(new Map([
  ["ATTACH", ["attach", "ATTACH statements are not allowed in automatic migrations"]],
  ["DETACH", ["detach", "DETACH statements are not allowed in automatic migrations"]],
]));
const MIGRATION_NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/u;
export const TRUSTED_POLICY_BASELINE = Object.freeze([
  "0001_initial.sql",
  "0002_backend.sql",
  "0003_payments.sql",
  "0004_commercial_fulfillment.sql",
  "0005_gemini_ai.sql",
  "0006_ai_abuse_controls.sql",
  "0007_decision_compare.sql",
  "0008_payment_state_hardening.sql",
  "0009_decision_selection_lock.sql",
  "0010_family_alignment.sql",
  "0011_archived_project_write_fence.sql",
  "0012_brief_check_revision_history.sql",
]);

export function selectPolicyMigrationNames(migrationNames) {
  assert.ok(Array.isArray(migrationNames) && migrationNames.length > 0, "at least one D1 migration is required");
  const names = [...migrationNames].sort();
  assert.equal(new Set(names).size, names.length, "migration filenames must be unique");
  const trusted = new Set(TRUSTED_POLICY_BASELINE);
  let previousSequence = -1;

  for (const name of names) {
    const match = String(name).match(MIGRATION_NAME_PATTERN);
    assert.ok(match, `Invalid migration filename: ${name}. Expected NNNN_description.sql.`);
    const sequence = Number(match[1]);
    assert.ok(sequence > previousSequence, `Migration sequence is not strictly increasing at ${name}.`);
    assert.ok(sequence > 12 || trusted.has(name), `Unrecognized pre-policy migration: ${name}. New migrations must follow 0012.`);
    previousSequence = sequence;
  }
  for (const name of trusted) {
    assert.ok(names.includes(name), `Trusted migration baseline is incomplete: ${name}.`);
  }
  return names.filter((name) => !trusted.has(name));
}

function isIdentifierStart(character) {
  return /[A-Za-z_]/u.test(character);
}

function isIdentifierPart(character) {
  return /[A-Za-z0-9_$]/u.test(character);
}

function policyError(filename, line, column, message) {
  return new Error(`${filename}:${line}:${column}: ${message}`);
}

/**
 * Tokenize only the SQL structure needed by the automatic-migration policy.
 * Quoted values and identifiers are marked so ordinary policy-looking text is
 * ignored while SQLite's quoted PRAGMA names can still be checked safely.
 */
export function tokenizeMigrationSql(sql, filename = "<migration>") {
  assert.equal(typeof sql, "string", "migration SQL must be a string");
  assert.ok(!sql.includes("\0"), `${filename}: migration SQL cannot contain NUL bytes`);

  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const advance = () => {
    const character = sql[index];
    index += 1;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return character;
  };

  const readQuoted = (opening, closing = opening) => {
    const quoteLine = line;
    const quoteColumn = column;
    let value = "";
    advance();
    while (index < sql.length) {
      if (sql[index] === closing) {
        advance();
        if (sql[index] === closing) {
          value += closing;
          advance();
          continue;
        }
        return { value: value.toUpperCase(), quoted: true, line: quoteLine, column: quoteColumn };
      }
      value += advance();
    }
    throw policyError(filename, quoteLine, quoteColumn, `unterminated ${opening} quoted SQL token`);
  };

  while (index < sql.length) {
    const character = sql[index];

    if (/\s/u.test(character)) {
      advance();
      continue;
    }

    if (character === "-" && sql[index + 1] === "-") {
      advance();
      advance();
      while (index < sql.length && sql[index] !== "\n") advance();
      continue;
    }

    if (character === "/" && sql[index + 1] === "*") {
      const commentLine = line;
      const commentColumn = column;
      advance();
      advance();
      let terminated = false;
      while (index < sql.length) {
        if (sql[index] === "*" && sql[index + 1] === "/") {
          advance();
          advance();
          terminated = true;
          break;
        }
        advance();
      }
      if (!terminated) {
        throw policyError(filename, commentLine, commentColumn, "unterminated SQL block comment");
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      tokens.push(readQuoted(character));
      continue;
    }

    if (character === "[") {
      tokens.push(readQuoted("[", "]"));
      continue;
    }

    if (character === ";" || character === ".") {
      tokens.push({ value: character, quoted: false, line, column });
      advance();
      continue;
    }

    if (isIdentifierStart(character)) {
      const tokenLine = line;
      const tokenColumn = column;
      let value = "";
      while (index < sql.length && isIdentifierPart(sql[index])) value += advance();
      tokens.push({ value: value.toUpperCase(), quoted: false, line: tokenLine, column: tokenColumn });
      continue;
    }

    advance();
  }

  return tokens;
}

function violation(token, code, message) {
  return { code, message, line: token.line, column: token.column };
}

function scanStatement(tokens) {
  for (const token of tokens) {
    const unsafe = DIRECTLY_UNSAFE_KEYWORDS.get(token.value);
    if (!token.quoted && unsafe) return violation(token, unsafe[0], unsafe[1]);
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.quoted) continue;

    if (token.value === "DROP"
      && ["TABLE", "INDEX", "TRIGGER", "VIEW"].includes(tokens[index + 1]?.value)) {
      return violation(token, "drop", "DROP operations are not allowed in automatic migrations");
    }
    if (token.value === "DELETE" && tokens[index + 1]?.value === "FROM") {
      return violation(token, "delete", "DELETE statements are not allowed in automatic migrations");
    }
    if (token.value === "UPDATE"
      && tokens.slice(index + 1).some((candidate) => !candidate.quoted && candidate.value === "SET")) {
      return violation(token, "update", "UPDATE statements are not allowed in automatic migrations");
    }
    if (token.value === "REPLACE" && tokens[index + 1]?.value === "INTO") {
      return violation(token, "replace", "REPLACE conflict handling is not allowed in automatic migrations");
    }
    if (token.value === "TRUNCATE" && tokens[index + 1]?.value === "TABLE") {
      return violation(token, "truncate", "TRUNCATE statements are not allowed in automatic migrations");
    }
    if (token.value === "PRAGMA") {
      let pragmaNameIndex = index + 1;
      if (tokens[pragmaNameIndex + 1]?.value === ".") pragmaNameIndex += 2;
      if (tokens[pragmaNameIndex]?.value === "WRITABLE_SCHEMA") {
        return violation(token, "writable-schema", "PRAGMA writable_schema is not allowed in automatic migrations");
      }
    }
    if (token.value === "VACUUM"
      && tokens.slice(index + 1).some((candidate) => !candidate.quoted && candidate.value === "INTO")) {
      return violation(token, "vacuum-into", "VACUUM INTO is not allowed in automatic migrations");
    }
    if (token.value === "ALTER" && !tokens[index + 1]?.quoted && tokens[index + 1]?.value === "TABLE") {
      const unsafeAction = tokens.slice(index + 2).find((candidate) => (
        !candidate.quoted && ["DROP", "RENAME"].includes(candidate.value)
      ));
      if (unsafeAction) {
        const code = unsafeAction.value === "DROP" ? "alter-table-drop" : "alter-table-rename";
        return violation(unsafeAction, code, `ALTER TABLE ${unsafeAction.value} is not allowed in automatic migrations`);
      }
    }
  }

  return null;
}

export function scanMigrationSql(sql, filename = "<migration>") {
  const tokens = tokenizeMigrationSql(sql, filename);
  const violations = [];
  let statement = [];

  for (const token of tokens) {
    if (token.value === ";") {
      const found = scanStatement(statement);
      if (found) violations.push({ filename, ...found });
      statement = [];
    } else {
      statement.push(token);
    }
  }

  const found = scanStatement(statement);
  if (found) violations.push({ filename, ...found });
  return violations;
}

export function assertSafeMigrationFiles(filePaths) {
  assert.ok(Array.isArray(filePaths), "migration file paths must be an array");
  const paths = [...new Set(filePaths.map((filePath) => String(filePath)))];
  const violations = [];

  for (const filePath of paths) {
    assert.ok(filePath && !/[\0\r\n]/u.test(filePath), "migration paths must be non-empty single-line strings");
    assert.ok(statSync(filePath).isFile(), `${filePath}: migration path must be a regular file`);
    violations.push(...scanMigrationSql(readFileSync(filePath, "utf8"), filePath));
  }

  if (violations.length > 0) {
    const details = violations
      .map((item) => `${item.filename}:${item.line}:${item.column}: ${item.message} [${item.code}]`)
      .join("\n");
    throw new Error(`Automatic migration policy rejected ${violations.length} statement(s):\n${details}`);
  }

  return { filesChecked: paths.length };
}

function pathsFromArguments(arguments_) {
  const paths = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--files-from") {
      const listPath = arguments_[index + 1];
      assert.ok(listPath, "--files-from requires a newline-delimited file path");
      index += 1;
      paths.push(...readFileSync(listPath, "utf8").split(/\r?\n/u).filter(Boolean));
    } else {
      assert.ok(!argument.startsWith("-"), `unknown migration policy option: ${argument}`);
      paths.push(argument);
    }
  }
  assert.ok(paths.length > 0, "usage: node scripts/check-migration-policy.mjs <migration.sql> [...] [--files-from list.txt]");
  return paths;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = assertSafeMigrationFiles(pathsFromArguments(process.argv.slice(2)));
    process.stdout.write(`Automatic migration policy passed for ${result.filesChecked} file(s).\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "automatic migration policy failed"}\n`);
    process.exitCode = 1;
  }
}
