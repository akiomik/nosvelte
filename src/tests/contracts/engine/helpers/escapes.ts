/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A collector for what leaves a test as an uncaught error. It began as `VG2`'s
 * (`gate.test.ts`), and it is shared because a ledger reads only a test's own
 * status: an arm whose clause is "nothing is thrown" has to hear the escape
 * itself.
 */
import { onTestFinished } from 'vitest';

/**
 * What leaves as an uncaught error while it is installed: Node's two process
 * events, with the runner's own listeners taken off for the duration and put
 * back by `restore`.
 *
 * **Those two events are where an error with no handler goes.** A throw in a
 * subscriber's `next` is reported by RxJS on a timer, which throws it again —
 * the application's RxJS and the copy the dependency bundles do the same, which
 * was measured once, before this was written — and a rejection nobody handles
 * is Node's `unhandledRejection`. **An arm that installs this owes a positive
 * control on each channel**, run while it is installed: `VG2`'s throw through
 * the capability the machine subscribes through, whose subscriber is the
 * application's RxJS, and a promise rejected with nothing to handle it.
 *
 * **Put back however the arm ends.** A test the runner times out is abandoned
 * rather than unwound, so its `finally` never runs, and the runner's listeners
 * stayed off for the rest of the worker — measured. So `restore` is also
 * registered with the runner, and running it twice does nothing the second
 * time. The listeners are saved raw, so one registered with `once` goes back
 * as its wrapper and stays once.
 */
export function escapes() {
  const saved = {
    uncaught: process.rawListeners('uncaughtException') as NodeJS.UncaughtExceptionListener[],
    rejection: process.rawListeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[]
  };
  const seen: { channel: string; message: string }[] = [];
  const recorder =
    (channel: string) =>
    (error: unknown): void => {
      seen.push({ channel, message: error instanceof Error ? error.message : String(error) });
    };
  const onUncaught = recorder('uncaughtException');
  const onRejection = recorder('unhandledRejection');
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onRejection);
    for (const listener of saved.uncaught) process.on('uncaughtException', listener);
    for (const listener of saved.rejection) process.on('unhandledRejection', listener);
  };
  onTestFinished(restore);
  return { seen, restore };
}
