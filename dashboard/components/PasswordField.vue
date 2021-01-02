<template>
  <div class="password-field">
    <input
      v-if="value !== undefined"
      :name="name"
      :value="value"
      :type="passwordVisible ? 'text' : 'password'"
      placeholder="password"
      minlength="8"
      maxlength="100"
      :disabled="disabled"
      :required="required"
      :autocomplete="autocomplete"
      @input="(e) => $emit('update:value', e.target.value)"
    />
    <input
      v-else
      :name="name"
      :type="passwordVisible ? 'text' : 'password'"
      placeholder="password"
      minlength="8"
      maxlength="100"
      :disabled="disabled"
      :required="required"
      :autocomplete="autocomplete"
    />
    <span
      @mousedown="passwordVisible = true"
      @mouseup="passwordVisible = false"
    >
      <EyeIcon view-box="0 0 8 8" height="24" width="24" />
    </span>
  </div>
</template>

<script lang="ts">
export default {
  props: {
    name: {
      type: String,
    },
    value: {
      type: String,
    },
    disabled: {
      type: Boolean,
    },
    required: {
      type: Boolean,
    },
    autocomplete: {
      type: String,
    },
  },
  data() {
    return {
      passwordVisible: false,
    }
  },
}
</script>

<style scoped>
.password-field {
  width: 300px;
  position: relative;
}

.password-field span {
  position: absolute;
  top: 0;
  right: 0px;
  z-index: 2;
  top: 2.5px;
  cursor: pointer;
}
</style>
