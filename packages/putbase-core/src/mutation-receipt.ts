export type MutationStatus = "pending" | "settled" | "failed";

export interface MutationReceipt<TValue = void> {
  readonly value: TValue;
  readonly settled: Promise<TValue>;
  readonly status: MutationStatus;
  readonly error: unknown;
}

export interface MutableMutationReceipt<TValue = void> extends MutationReceipt<TValue> {
  resolve(value?: TValue): void;
  reject(error: unknown): void;
}

export function createMutationReceipt<TValue>(value: TValue): MutableMutationReceipt<TValue> {
  let status: MutationStatus = "pending";
  let error: unknown = undefined;
  let resolvePromise: (value: TValue) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;

  const settled = new Promise<TValue>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    value,
    settled,
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    resolve(next = value) {
      if (status !== "pending") {
        return;
      }
      status = "settled";
      resolvePromise(next);
    },
    reject(nextError: unknown) {
      if (status !== "pending") {
        return;
      }
      status = "failed";
      error = nextError;
      rejectPromise(nextError);
    },
  };
}
