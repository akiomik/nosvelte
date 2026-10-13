<script lang="ts">
  /**
   * A consumer of the published entry, as `A-ε-C18` needs one: a provider with
   * relays and a signer and nothing else — so the verifier is the one the
   * library supplies — and, under it, one probe per plan, each handing the test
   * a request and a send. Several plans are several requests under one
   * provider, which is what every application with more than one component is.
   */
  import { NostrApp, type NostrSigner, type ReqPlan } from '$lib/v1/index.js';

  import Probe, { type Held } from './Probe.svelte';

  interface Props {
    relays: readonly string[];
    signer: NostrSigner;
    plans: readonly (() => ReqPlan)[];
    expose: (held: Held, index: number) => void;
  }

  let { relays, signer, plans, expose }: Props = $props();
</script>

<NostrApp {relays} {signer}>
  {#each plans as plan, index (index)}
    <Probe {plan} expose={(held: Held) => expose(held, index)} />
  {/each}
</NostrApp>
