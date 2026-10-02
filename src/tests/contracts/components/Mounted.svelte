<script lang="ts">
  /**
   * One request component under a provider, with every outlet written out:
   * each outlet records the request it was handed and shows what it was given.
   */
  import { NostrApp, type ReqHandle } from '$lib/v1/index.js';

  import Keys from './Keys.svelte';
  import type { RequestComponent } from './types.js';

  interface Props {
    relays: readonly string[];
    which: RequestComponent;
    given: Record<string, unknown>;
    seen?: (outlet: string, request: ReqHandle) => void;
    expose?: (keys: () => string[]) => void;
  }

  let { relays, which: Request, given, seen = () => {}, expose = () => {} }: Props = $props();
</script>

<NostrApp {relays}>
  <Keys {expose} />
  <Request {...given}>
    {#snippet children(argument: Record<string, unknown> & { request: ReqHandle })}
      {seen('default', argument.request)}
      <p data-testid="outlet">default</p>
      <p data-testid="argument">{Object.keys(argument).sort().join(',')}</p>
      <p data-testid="shown">
        {'events' in argument
          ? `events:${(argument['events'] as { id: string }[]).map((event) => event.id).join(',')}`
          : `event:${(argument['event'] as { id: string } | undefined)?.id ?? 'undefined'}`}
      </p>
    {/snippet}
    {#snippet loading({ request }: { request: ReqHandle })}
      {seen('loading', request)}
      <p data-testid="outlet">loading</p>
      <p data-testid="activity">{request.activity}</p>
    {/snippet}
    {#snippet nodata({ request }: { request: ReqHandle })}
      {seen('nodata', request)}
      <p data-testid="outlet">nodata</p>
      <p data-testid="shown">
        {request.state.status === 'settled'
          ? `settled:${request.state.events.length}:${String(request.state.hasMatchEvidence)}`
          : request.state.status}
      </p>
    {/snippet}
    {#snippet error({ request, error }: { request: ReqHandle; error: { code: string } })}
      {seen('error', request)}
      <p data-testid="outlet">error</p>
      <p data-testid="shown">
        {`${error.code}:${error === ('error' in request.state ? request.state.error : undefined) ? 'same' : 'copy'}`}
      </p>
    {/snippet}
  </Request>
</NostrApp>
