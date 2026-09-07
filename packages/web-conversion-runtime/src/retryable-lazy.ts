export function retryableLazy<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (pending) return pending;
    const attempt = Promise.resolve().then(factory);
    pending = attempt;
    void attempt.catch(() => {
      if (pending === attempt) pending = undefined;
    });
    return attempt;
  };
}
