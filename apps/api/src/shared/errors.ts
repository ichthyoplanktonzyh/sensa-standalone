export type ValidationIssueSummary = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export type HttpErrorDetails = Readonly<{
  validationIssues?: ReadonlyArray<ValidationIssueSummary>;
  retryAfterSeconds?: number;
}>;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string | null;
  readonly details: HttpErrorDetails | null;

  constructor(
    statusCode: number,
    message: string,
    code?: string,
    details?: HttpErrorDetails,
  ) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code ?? null;
    this.details = details ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function createPublicHttpErrorMessage(error: HttpError): string {
  return error.message;
}

export function createPublicHttpErrorDetails(
  details: HttpErrorDetails | null,
): HttpErrorDetails | null {
  return details;
}
