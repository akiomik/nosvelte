<script lang="ts">
  /**
   * A list component and a consumer's own request under one provider, so
   * whether the two share an entry is visible from outside: one REQ between
   * them, or two.
   */
  import { EventList, NostrApp, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

  import Asker from './Asker.svelte';

  interface Props {
    relays: readonly string[];
    given: Record<string, unknown>;
    plan: () => ReqPlan;
    seen?: (request: ReqHandle) => void;
  }

  let { relays, given, plan, seen = () => {} }: Props = $props();
</script>

<NostrApp {relays}>
  <EventList ids={[]} {...given}><span hidden></span></EventList>
  <Asker {plan} {seen} />
</NostrApp>
