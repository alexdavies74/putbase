import type { ApiError, ErrorCode } from "./types.js";

const PUTER_SETUP_HINT = "Pass backend to new Vennbase(...), or let Vennbase use the default Puter browser client.";

export class VennbaseError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;

  constructor(apiError: ApiError, status?: number) {
    super(apiError.message);
    this.name = "VennbaseError";
    this.code = apiError.code;
    this.status = status;
  }
}

export class SavedRowCollectionMismatchError extends Error {
  readonly key: string;
  readonly expectedCollection: string;
  readonly actualCollection: string;

  constructor(key: string, expectedCollection: string, actualCollection: string) {
    super(`Saved row "${key}" points to "${actualCollection}", expected "${expectedCollection}".`);
    this.name = "SavedRowCollectionMismatchError";
    this.key = key;
    this.expectedCollection = expectedCollection;
    this.actualCollection = actualCollection;
  }
}

export function signedOutError(message = "Not signed in. Call signIn() first."): VennbaseError {
  return new VennbaseError({
    code: "SIGNED_OUT",
    message,
  });
}

export function missingPuterClientMessage(): string {
  return `No Puter client found. ${PUTER_SETUP_HINT}`;
}

export function missingPuterProvisioningMessage(): string {
  return `Unable to provision the federation worker because no compatible Puter client with workers.create is available. ${PUTER_SETUP_HINT}`;
}

export function toApiError(maybeError: unknown): ApiError {
  if (
    maybeError &&
    typeof maybeError === "object" &&
    "code" in maybeError &&
    "message" in maybeError
  ) {
    return maybeError as ApiError;
  }

  return {
    code: "BAD_REQUEST",
    message: "Unknown API error",
  };
}
