<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import { Codemirror } from 'vue-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { compile } from 'html2component'

export default defineComponent({
  components: {
    Codemirror
  },
  setup() {
    const html = ref(`<div class="wrapper">
  <div>One</div>
  <div>Two</div>
  <div>Three</div>
  <div>Four</div>
  <div>Five</div>
  <svg xmlns="http://www.w3.org/2000/svg"
     width="467" height="462">
  <rect x="80" y="60" width="250" height="250" rx="20"
      style="fill:#ff0000; stroke:#000000;stroke-width:2px;" />

  <rect x="140" y="120" width="250" height="250" rx="40"
      style="fill:#0000ff; stroke:#000000; stroke-width:2px;
      fill-opacity:0.7;" />

  <rect x="140" y="120" width="250" height="250" rx="40"
      style="fill:#00ff00; stroke:#0000cc; stroke-width:5px;
      fill-opacity:1.0;" />
</svg>
</div>`)

    const output = ref(``)

    const extensions = [javascript({ typescript: true }), oneDark]

    function convert() {
      output.value = compile(html.value)
    }

    watch(html, () => {
      try {
        localStorage.setItem('saved-html-code', JSON.stringify(html.value))
      } catch {}

      convert()
    })

    try {
      const saved = localStorage.getItem('saved-html-code')
      if (saved) {
        const htmlSaved = JSON.parse(saved)
        if (htmlSaved) {
          html.value = htmlSaved
        }
      }
    } catch {}

    return {
      html,
      output,
      extensions,
      convert
    }
  }
})
</script>

<template>
  <div class="main-container">
    <div class="form-container">
      <div class="form-group">
        <button @click="convert">Run</button>
      </div>

      <div class="form-group">
        <input type="checkbox" name="" id="typescript" />
        <label for="typescript">Enable Typescript</label>
      </div>
    </div>

    <div class="code-container">
      <div class="code-view">
        <Codemirror v-model="html" :extensions="extensions" :indent-with-tab="true" :tab-size="2" />
      </div>
      <div class="code-view">
        <Codemirror v-model="output" :extensions="extensions" :indent-with-tab="true" :tab-size="2" />
      </div>
    </div>
  </div>
</template>

<style>
.main-container {
  padding: 1rem 2rem;
  display: flex;
  flex-direction: column;
  align-items: start;
}
.form-container {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.form-group {
  display: flex;
  gap: 0.24rem;
}
.form-group > label {
  user-select: none;
}
.code-container {
  padding-top: 1rem;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2rem;
}
.code-view {
  overflow: auto;
}
@media (max-width: 920px) {
  .code-container {
    grid-template-columns: 1fr;
  }
}
</style>
