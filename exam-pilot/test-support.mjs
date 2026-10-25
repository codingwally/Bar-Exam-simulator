import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

// A real SQLite adapter exposing the D1 interface, for local synthetic tests only.
// It is never imported by the deployed Worker.
export function createTestDatabase({ filename = ":memory:", clock } = {}) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const normalize = (sql) =>
    clock
      ? sql.replaceAll(
          "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)",
          String(Math.trunc(clock())),
        )
      : sql;
  class Statement {
    constructor(sql, values = []) {
      this.sql = sql;
      this.values = values;
    }
    bind(...values) {
      return new Statement(this.sql, values);
    }
    async first(column) {
      const row = sqlite.prepare(normalize(this.sql)).get(...this.values);
      return column ? (row?.[column] ?? null) : (row ?? null);
    }
    async all() {
      return {
        results: sqlite.prepare(normalize(this.sql)).all(...this.values),
        success: true,
      };
    }
    async run() {
      const result = sqlite.prepare(normalize(this.sql)).run(...this.values);
      return {
        meta: {
          changes: Number(result.changes),
          last_row_id: Number(result.lastInsertRowid),
        },
        success: true,
      };
    }
  }
  return {
    sqlite,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => {
          const result = sqlite
            .prepare(normalize(statement.sql))
            .run(...statement.values);
          return { meta: { changes: Number(result.changes) }, success: true };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { success: true };
    },
    close: () => sqlite.close(),
  };
}
