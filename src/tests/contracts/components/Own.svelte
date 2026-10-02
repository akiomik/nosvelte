<script lang="ts">
  /** A consumer's own request, with the descriptor written by hand. */
  import { type ReqDescriptor, useReq } from '$lib/v1/index.js';

  interface Props {
    descriptor: ReqDescriptor;
  }

  let { descriptor }: Props = $props();

  useReq(() => ({ kind: 'request', descriptor }));
</script>
