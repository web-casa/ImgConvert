type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers?: <T>() => {
    promise: Promise<T>;
    reject: (reason?: unknown) => void;
    resolve: (value: PromiseLike<T> | T) => void;
  };
};

export function installPromiseWithResolvers(): void {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === "function") return;
  Object.defineProperty(promiseConstructor, "withResolvers", {
    configurable: true,
    value: <T>() => {
      let reject!: (reason?: unknown) => void;
      let resolve!: (value: PromiseLike<T> | T) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, reject, resolve };
    },
    writable: true,
  });
}

installPromiseWithResolvers();
