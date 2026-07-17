import type { PersistenceExecutor, SqlStatement } from "./write-queue.js";

/** Compatible with pg PoolClient and intentionally keeps the pg package optional. */
export interface PostgresQueryClient {
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}

export interface PostgresConnectionPool extends PostgresQueryClient {
  connect(): Promise<PostgresQueryClient & { release(destroy?: boolean): void }>;
}

export class PostgresPersistenceExecutor implements PersistenceExecutor {
  constructor(private readonly pool: PostgresConnectionPool) {}

  async execute(statements: readonly SqlStatement[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      try {
        for (const statement of statements) await client.query(statement.text, statement.values);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    } finally {
      client.release();
    }
  }

  async query<T extends object>(statement: SqlStatement): Promise<readonly T[]> {
    const result = await this.pool.query(statement.text, statement.values);
    if (typeof result !== "object" || result === null || !("rows" in result) || !Array.isArray(result.rows)) {
      throw new Error("postgres query did not return rows");
    }
    return result.rows as T[];
  }
}
