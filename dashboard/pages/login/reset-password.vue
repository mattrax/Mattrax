<template>
  <div class="page-content">
    <p class="title">Set New Password:</p>
    <p>Your password has expired and must be changed!</p>
    <form class="form" @submit.prevent="submit">
      <p v-if="errorTxt" class="error-msg">{{ errorTxt }}</p>

      <PasswordField
        name="password"
        required
        autocomplete="new-password"
        @input="errorTxt = null"
      />
      <button>CHANGE PASSWORD</button>
    </form>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
  data() {
    return {
      errorTxt: null,
    }
  },
  // async created() {
  //   if (await this.$store.dispatch('authentication/isAuthenticated')) {
  //     this.$router.push({ path: '/login/tenants', query: this.$route.query })
  //   }
  // },
  methods: {
    async submit(e: any) {
      await this.$store.dispatch('settings/updateUser', {
        id: this.$route.params.id,
        patch: {
          password: e.srcElement.elements.namedItem('password').value,
        },
      })

      // TODO: Handle directly going to dashboard if only has one tenant.
      this.$router.push({
        path: '/login/tenants',
        query: this.$route.query,
      })
    },
  },
})
</script>

<style scoped>
/deep/ .form input {
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
.title {
  font-size: 1.5em;
}
.tenant-list button {
  margin: 5px;
}
.tenant-list .create-btn {
  background-color: #353435;
}
.logout {
  float: left;
}
.logout:hover {
  border-bottom: 1px solid black;
}
.logout-btn {
  position: absolute;
  top: 15px;
  right: 10px;
}
</style>
