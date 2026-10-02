/**
 * A Vitest reporter that writes what this run did with every test, for
 * `checkRun` to judge: the file, the name, where the test was declared, its
 * final state, and whether it was registered to expect failure. Vitest's own
 * JSON report carries no `fails` flag, and a test that expects failure is
 * reported `passed` when its body throws — so this is the record the check
 * reads. It writes to the path in `NOSVELTE_RUN_REPORT`, and only there.
 * Locations need `--includeTaskLocation`.
 */
import { writeFileSync } from 'node:fs';

import type { Reporter, TestModule } from 'vitest/node';

export default class LandingReporter implements Reporter {
  #startTime = Date.now();

  onTestRunStart(): void {
    this.#startTime = Date.now();
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>): void {
    const path = process.env['NOSVELTE_RUN_REPORT'];
    if (path === undefined || path === '') return;
    const tests = modules.flatMap((module) =>
      [...module.children.allTests()].map((test) => ({
        file: module.moduleId,
        name: test.name,
        line: test.location?.line ?? null,
        column: test.location?.column ?? null,
        state: test.result().state,
        fails: test.options.fails === true
      }))
    );
    writeFileSync(path, JSON.stringify({ startTime: this.#startTime, tests }));
  }
}
