/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A watch on every method the console has, for the rows that say nothing is
 * written.
 *
 * The methods are taken off the object rather than listed, and the question of
 * what is watched is asked of the console again when an arm reads the answer:
 * `unwatched` names any method that is not a spy at that moment, so a watch
 * that shrank, or that was restored early, cannot answer for itself. A list
 * compared with its own length could not say that.
 */
import { vi } from 'vitest';

const methodsOfConsole = (): (keyof Console)[] =>
  (Object.keys(console) as (keyof Console)[]).filter((name) => typeof console[name] === 'function');

export interface ConsoleWatch {
  /** What was written, oldest first, as `method: text`. */
  readonly written: string[];
  /** The methods that are not spies now. */
  unwatched(): string[];
  /** Writes once through each method, clears the list, and names any that went unrecorded. */
  control(): string[];
  release(): void;
}

export function watchConsole(): ConsoleWatch {
  const written: string[] = [];
  const spies = methodsOfConsole().map((method) =>
    vi.spyOn(console, method as 'log').mockImplementation((...args: unknown[]) => {
      written.push(`${String(method)}: ${args.map(String).join(' ')}`);
    })
  );
  return {
    written,
    unwatched: () => methodsOfConsole().filter((name) => !vi.isMockFunction(console[name])),
    control: () => {
      const silent = methodsOfConsole().filter((method) => {
        const before = written.length;
        (console[method] as (text: string) => void)('the control');
        return written.length === before;
      });
      written.length = 0;
      return silent;
    },
    release: () => {
      for (const spy of spies) spy.mockRestore();
    }
  };
}
