/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A watch on the console, for the rows that say nothing is written.
 *
 * **Put on through `vi.hoisted`**, before the file's imports run: a module can
 * bind a method as it loads, or write as it loads, and a watch installed after
 * that is not what the binding calls.
 *
 * **The methods are six named here and every function the object lists**, and
 * `reading()` asks the console again what is watched at the moment it answers,
 * so a watch that shrank, or that was restored early, cannot answer for itself.
 * A list compared with its own length could not say that. Each method still
 * watched is then written through once, with a value `String()` refuses, as the
 * control.
 *
 * It watches the console's methods and nothing beneath them: a write straight
 * to a stream is not read, and neither is one made after the last reading.
 */
import { vi } from 'vitest';

const WRITERS: readonly (keyof Console)[] = ['debug', 'error', 'info', 'log', 'trace', 'warn'];

const methodsOfConsole = (): (keyof Console)[] => [
  ...new Set([
    ...WRITERS,
    ...(Object.keys(console) as (keyof Console)[]).filter(
      (name) => typeof console[name] === 'function'
    )
  ])
];

/** A foreign value goes to a console as readily as a text does. */
const UNPRINTABLE: unknown = Object.create(null);

const textOf = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return 'a value with no text';
  }
};

export interface ConsoleReading {
  /** What was written, oldest first, as `method: text`. */
  readonly written: readonly string[];
  /** The methods that are not spies now. */
  readonly unwatched: readonly string[];
  /** The methods a write of the watch's own went through unrecorded. */
  readonly silent: readonly string[];
}

export const NOTHING_WRITTEN: ConsoleReading = { written: [], unwatched: [], silent: [] };

export interface ConsoleWatch {
  /** Everything written since the watch went on, which the reading leaves in place. */
  reading(): ConsoleReading;
  release(): void;
}

export function watchConsole(): ConsoleWatch {
  const written: string[] = [];
  const spies = methodsOfConsole().map((method) =>
    vi.spyOn(console, method as 'log').mockImplementation((...args: unknown[]) => {
      written.push(`${String(method)}: ${args.map(textOf).join(' ')}`);
    })
  );
  return {
    reading: () => {
      const before = [...written];
      const methods = methodsOfConsole();
      const watched = methods.filter((name) => vi.isMockFunction(console[name]));
      const unwatched = methods.filter((name) => !watched.includes(name));
      const silent = watched.filter((method) => {
        const recorded = written.length;
        (console[method] as (...args: unknown[]) => void)('the control', UNPRINTABLE);
        return written.length === recorded;
      });
      written.length = before.length;
      return { written: before, unwatched, silent };
    },
    release: () => {
      for (const spy of spies) spy.mockRestore();
    }
  };
}
