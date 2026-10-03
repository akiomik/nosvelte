<script lang="ts">
  import { type Send, useSend } from '$lib/v1/index.js';

  interface Props {
    seen: (send: Send) => void;
  }

  let { seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  seen(useSend());
</script>
