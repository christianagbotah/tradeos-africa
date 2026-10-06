import pg from "pg";

const { Pool } = pg;

export type DbPool = InstanceType<typeof Pool>;
export type DbClient = pg.PoolClient;

export function createPool(connectionString: string): DbPool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function withTransaction<T>(pool: DbPool, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
