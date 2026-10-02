<script lang="ts">
  /**
   * @license Apache-2.0
   * @copyright 2023 Akiomi Kamakura
   *
   * The outlets every request component renders through (0004's slot table,
   * C4b, C7): the slot and its argument come from `deriveOutlet`, every outlet
   * is handed the request, and the error outlet is handed the state's own
   * object (C15).
   *
   * The one thing the components differ in here is what the default outlet
   * takes, and a component passes exactly one of `event` and `events`. A list
   * component hands its events as they are and renders `nodata` only when the
   * slot says so — an answer holding entries it can show none of renders
   * `default` over an empty list (C12). A single-event component has no event
   * to hand in that case, so it renders `nodata` instead, with the request still
   * reporting the match (ruling 18, `C12-C8`).
   */
  import type { Snippet } from 'svelte';

  import { deriveOutlet, type ReqHandle } from '../engine.js';
  import type { ReqOutletError } from '../reqerror.js';
  import type { Event, Events, RequestOutletContext } from './outlets.js';

  type Props = {
    request: ReqHandle;
    loading?: Snippet<[RequestOutletContext]> | undefined;
    error?: Snippet<[{ request: ReqHandle; error: ReqOutletError }]> | undefined;
    nodata?: Snippet<[RequestOutletContext]> | undefined;
  } & (
    | { event: Snippet<[Event & RequestOutletContext]>; events?: undefined }
    | { events: Snippet<[Events & RequestOutletContext]>; event?: undefined }
  );

  let { request, event, events, loading, error, nodata }: Props = $props();

  const outlet = $derived(deriveOutlet(request.state));
  const shown = $derived(request.state.status === 'loading' ? [] : request.state.events);
</script>

{#if outlet.slot === 'loading'}
  {@render loading?.({ request })}
{:else if outlet.slot === 'error'}
  {@render error?.({ request, error: outlet.error })}
{:else if events !== undefined}
  {#if outlet.slot === 'nodata'}
    {@render nodata?.({ request })}
  {:else}
    {@render events({ events: shown, request })}
  {/if}
{:else if outlet.slot === 'nodata' || shown[0] === undefined}
  {@render nodata?.({ request })}
{:else}
  {@render event?.({ event: shown[0], request })}
{/if}
