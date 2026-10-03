/**
 * A reactive value the test can set, so a plan that reads it is evaluated again
 * when the test says — the way a consumer's own `$state` moves a plan.
 */
export function cell<T>(initial: T): { value: T } {
  let value = $state(initial);
  return {
    get value() {
      return value;
    },
    set value(next: T) {
      value = next;
    }
  };
}
