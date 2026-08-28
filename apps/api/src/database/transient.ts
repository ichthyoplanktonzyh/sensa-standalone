type DatabaseErrorLike = Readonly<{
  code?: unknown;
  sqlState?: unknown;
  errorCode?: unknown;
  databaseErrorClass?: unknown;
  databaseErrorMessage?: unknown;
}>;

export type DatabaseErrorFields = Readonly<{
  sqlState: string | null;
  errorCode: string | null;
  errorClass: string;
  errorMessage: string;
}>;

function asRecord(error: unknown): DatabaseErrorLike {
  return typeof error === "object" && error !== null
    ? error as DatabaseErrorLike
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function getDatabaseErrorFields(error: unknown): DatabaseErrorFields {
  const value = asRecord(error);
  const errorCode = readString(value.errorCode) ?? readString(value.code);
  const sqlState = readString(value.sqlState)
    ?? (errorCode !== null && /^[0-9A-Z]{5}$/u.test(errorCode) ? errorCode : null);
  return {
    sqlState,
    errorCode,
    errorClass: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}
