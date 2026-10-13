<script lang="ts">
  /**
   * A consumer of the published entry, as `A-ε-C18` needs one: a provider with
   * relays and a signer and nothing else — so the verifier is the one the
   * library supplies — and, under it, a request and a send handed to the test.
   */
  import { NostrApp, type NostrSigner, type ReqPlan } from '$lib/v1/index.js';

  import Probe, { type Held } from './Probe.svelte';

  interface Props {
    relays: readonly string[];
    signer: NostrSigner;
    plan: () => ReqPlan;
    expose: (held: Held) => void;
  }

  let { relays, signer, plan, expose }: Props = $props();
</script>

<NostrApp {relays} {signer}>
  <Probe {plan} {expose} />
</NostrApp>
