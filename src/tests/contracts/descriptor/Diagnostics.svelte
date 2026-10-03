<script lang="ts">
  /** The provider's relay diagnostics, handed to the test as a consumer holds them. */
  import { useRelayDiagnostics } from '$lib/v1/index.js';

  interface Props {
    seen: (diagnostics: ReturnType<typeof useRelayDiagnostics>) => void;
  }

  let { seen }: Props = $props();

  // svelte-ignore state_referenced_locally
  seen(useRelayDiagnostics());
</script>
