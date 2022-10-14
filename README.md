# HTML2Component

Render a markup into some JavaScript/TypeScript code, it's fancy!

```html
<div on:click={handleClick}>
  <img {src}>
</div>

<script>
  function handleClick(e: MouseEvent) {
    e.preventDefault()
  }
</script>
```

```ts
export function compile() {
  const el = document.createElement("div");

  const el3 = document.createElement("img");
  el.appendChild(el3);

  function handleClick(e: MouseEvent) {
    e.preventDefault()
  }

  el.addEventListener("click", handleClick)
}
```
