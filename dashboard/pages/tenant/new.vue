<template>
  <div v-if="loading" class="loading">Creating Tenant...</div>
  <div v-else class="page-content">
    <p class="title">Create New Tenant:</p>
    <form class="form" @submit.prevent="createTenant">
      <p v-if="errorTxt" class="error-msg">{{ errorTxt }}</p>
      <p class="field-title">Tenant Name:</p>
      <input
        v-model="tenant.display_name"
        required
        type="text"
        placeholder="Acme School Inc"
        @input="errorTxt = null"
      />
      <p class="field-title">Tenant Primary Domain:</p>
      <input
        v-model="tenant.primary_domain"
        required
        type="text"
        pattern="(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]"
        placeholder="acme.mattrax.app"
        @input="errorTxt = null"
      />
      <button>CREATE TENANT</button>
    </form>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

// TODO: auth

export default Vue.extend({
  middleware: ['auth'],
  data() {
    return {
      loading: false,
      errorTxt: null,
      tenant: {
        display_name: '',
        primary_domain: '',
      },
    }
  },
  methods: {
    createTenant() {
      this.loading = true
      this.$store
        .dispatch('tenants/create', this.tenant)
        .then(() =>
          this.$router.push({
            path: '/login/tenants',
            query: { ...this.$route.query, autologin: true },
          })
        )
        .catch((err) => {
          this.loading = false
          this.errorTxt = err
        })
    },
  },
})
</script>

<style scoped>
.form input {
  outline: 0;
  background: #f2f2f2;
  width: 100%;
  border: 0;
  margin: 0 0 15px;
  padding: 15px;
  box-sizing: border-box;
  font-size: 14px;
}
.form .error-msg {
  margin-bottom: 5px;
  color: red;
  font-size: 13px;
}
.field-title {
  float: left;
  font-size: 0.9em;
}
.title {
  font-size: 1.5em;
}
</style>
