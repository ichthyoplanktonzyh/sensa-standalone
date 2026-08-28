import pg from "pg";
import { readSensaApiEnvironment } from "../server/environment.js";

export type SqlValue =
  | string
  | number
  | boolean
  | Date
  | null
  | ReadonlyArray<string>
  | ReadonlyArray<number>
  | ReadonlyArray<unknown>;

export type DatabaseExecutor = Readonly<{
  query<Row extends pg.QueryResultRow>(
    text: string,
    params?: ReadonlyArray<SqlValue>,
  ): Promise<pg.QueryResult<Row>>;
}>;

export type UserDatabaseScope = Readonly<{ userId: string }>;
export type WorkspaceDatabaseScope = Readonly<{
  userId: string;
  workspaceId: string;
}>;

let pool: pg.Pool | undefined;

function databaseUrl(): string {
  const value = readSensaApiEnvironment().DATABASE_URL;
  if (value === undefined || value === "") {
    throw new Error("DATABASE_URL is required");
  }
  return value;
}

function getPool(): pg.Pool {
  if (pool === undefined) {
    const environment = readSensaApiEnvironment();
    pool = new pg.Pool({
      connectionString: databaseUrl(),
      max: environment.DATABASE_POOL_MAX,
    });
    pool.on("error", (error: Error) => {
      console.error(JSON.stringify({
        domain: "sensa-api",
        action: "database_pool_error",
        message: error.message,
      }));
    });
  }
  return pool;
}

async function runQuery<Row extends pg.QueryResultRow>(
  executor: pg.Pool | pg.PoolClient,
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return executor.query<Row>(text, params as unknown[]);
}

async function withTransaction<Result>(
  beginStatement: string,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  const client = await getPool().connect();
  const executor: DatabaseExecutor = {
    query: <Row extends pg.QueryResultRow>(
      text: string,
      params: ReadonlyArray<SqlValue> = [],
    ) => runQuery<Row>(client, text, params),
  };

  try {
    await client.query(beginStatement);
    const result = await callback(executor);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error(JSON.stringify({
        domain: "sensa-api",
        action: "database_rollback_failed",
        message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      }));
    }
    throw error;
  } finally {
    client.release();
  }
}

async function applyScope(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  await executor.query(
    "SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)",
    [userId, workspaceId ?? ""],
  );
}

export async function applyUserDatabaseScopeInExecutor(
  executor: DatabaseExecutor,
  scope: UserDatabaseScope,
): Promise<void> {
  await applyScope(executor, scope.userId, null);
}

export async function applyWorkspaceDatabaseScopeInExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
): Promise<void> {
  await applyScope(executor, scope.userId, scope.workspaceId);
}

export async function unsafeQuery<Row extends pg.QueryResultRow>(
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return runQuery<Row>(getPool(), text, params);
}

export async function unsafeTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return withTransaction("BEGIN", callback);
}

export async function unsafeRepeatableReadTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return withTransaction("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ", callback);
}

export async function unsafeRepeatableReadReadOnlyTransaction<Result>(
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return withTransaction(
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    callback,
  );
}

export async function transactionWithUserScope<Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeTransaction(async (executor) => {
    await applyUserDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithWorkspaceScope<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithUserScopeReadOnly<Result>(
  scope: UserDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => {
    await applyUserDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function transactionWithWorkspaceScopeReadOnly<Result>(
  scope: WorkspaceDatabaseScope,
  callback: (executor: DatabaseExecutor) => Promise<Result>,
): Promise<Result> {
  return unsafeRepeatableReadReadOnlyTransaction(async (executor) => {
    await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
    return callback(executor);
  });
}

export async function queryWithUserScope<Row extends pg.QueryResultRow>(
  scope: UserDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return transactionWithUserScope(scope, (executor) => executor.query<Row>(text, params));
}

export async function queryWithWorkspaceScope<Row extends pg.QueryResultRow>(
  scope: WorkspaceDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return transactionWithWorkspaceScope(scope, (executor) => executor.query<Row>(text, params));
}

export async function queryWithUserScopeReadOnly<Row extends pg.QueryResultRow>(
  scope: UserDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return transactionWithUserScopeReadOnly(scope, (executor) => executor.query<Row>(text, params));
}

export async function queryWithWorkspaceScopeReadOnly<Row extends pg.QueryResultRow>(
  scope: WorkspaceDatabaseScope,
  text: string,
  params: ReadonlyArray<SqlValue> = [],
): Promise<pg.QueryResult<Row>> {
  return transactionWithWorkspaceScopeReadOnly(scope, (executor) => executor.query<Row>(text, params));
}
