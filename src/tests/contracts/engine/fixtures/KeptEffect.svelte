<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * No library at all: a `$derived` of the component, read by an `$effect` in a
   * root of the consumer's own, which the component going does not end.
   */
  interface Props {
    read: () => unknown;
    rooted: (stop: () => void) => void;
  }

  let { read, rooted }: Props = $props();

  const asked = $derived(read());

  // svelte-ignore state_referenced_locally
  rooted(
    $effect.root(() => {
      $effect(() => {
        void asked;
      });
    })
  );
</script>
