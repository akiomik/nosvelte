<script>
  import { page } from '$app/stores';
</script>

<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/water.css@2/out/light.min.css" />
</svelte:head>

<main>
  <slot />
</main>

{#if $page.url.pathname !== '/'}
  <footer>
    <a href="/">Back to top</a>
  </footer>
{/if}
