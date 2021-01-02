<template>
  <div ref="page" class="page-body">
    <h2>User Details</h2>
    <p class="field-title">Full Name:</p>
    <input
      name="fullname"
      :value="user_settings.fullname"
      type="text"
      :disabled="!$store.state.dashboard.editting"
    />

    <p class="field-title">Email:</p>
    <input name="upn" :value="user_settings.upn" type="email" disabled />

    <p class="field-title">Password:</p>
    <PasswordField
      name="password"
      :value="user_settings.password"
      :disabled="!$store.state.dashboard.editting"
    />

    <!-- -->
    <!-- autocomplete="new-password" -->

    <p class="field-title">Azure AD OID:</p>
    <input :value="user_settings.azuread_oid" type="azuread_oid" disabled />
  </div>
</template>

<script lang="ts">
import Vue from 'vue'
import resource from '@/mixins/resource'

export default Vue.extend({
  mixins: [resource],
  data() {
    return {
      user_settings: {},
    }
  },
  created() {
    this.$store
      .dispatch('settings/getUser')
      .then((settings) => {
        this.user_settings = settings
        this.loading = false
      })
      .catch((err) => this.$store.commit('dashboard/setError', err))
  },
  methods: {
    async save(patch: object) {
      await this.$store.dispatch('settings/updateUser', {
        id: this.$route.params.id,
        patch,
      })

      Object.keys(patch).forEach(
        (key) => (this.user_settings[key] = patch[key])
      )
      this.user_settings.password = undefined

      // TODO: Update auth token
    },
  },
})
</script>

<style scoped></style>
