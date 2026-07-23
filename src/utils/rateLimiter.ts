import PQueue from "p-queue";

export interface RateLimiterOptions {
  minDelayMs: number;
  maxDelayMs: number;
}

export interface RateLimiter {
  run<T>(task: () => Promise<T>): Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * p-queue wrapper: concurrency 1, with a randomized delay (jitter) inserted
 * after each task before the next one is allowed to start.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const queue = new PQueue({ concurrency: 1 });

  function jitterDelay(): number {
    const { minDelayMs, maxDelayMs } = options;
    return minDelayMs + Math.random() * (maxDelayMs - minDelayMs);
  }

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return queue.add(async () => {
        const result = await task();
        await sleep(jitterDelay());
        return result;
      }) as Promise<T>;
    },
  };
}
