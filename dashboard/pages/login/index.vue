<template>
  <div class="page-content">
    <div v-if="loading" class="loading">Checking Login...</div>
    <form v-else class="form" @submit.prevent="login">
      <p v-if="errorTxt" class="error-msg">{{ errorTxt }}</p>
      <input
        v-model="user.upn"
        required
        type="email"
        placeholder="chris@mattrax.app"
        maxlength="100"
        autocomplete="username"
        @input="errorTxt = null"
      />
      <input
        v-model="user.password"
        required
        type="password"
        placeholder="password"
        maxlength="100"
        autocomplete="current-password"
        @input="errorTxt = null"
      />
      <button>LOGIN</button>
    </form>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
  data() {
    return {
      loading: false,
      errorTxt: null,
      user: {
        upn: '',
        password: '',
      },
    }
  },
  async created() {
    if (await this.$store.dispatch('authentication/isAuthenticated')) {
      this.$router.push({ path: '/login/tenants', query: this.$route.query })
    }
  },
  methods: {
    login() {
      this.loading = true
      this.$store
        .dispatch('authentication/login', this.user)
        .then((expired) => {
          if (expired) {
            this.$router.push({
              path: '/login/reset-password',
              query: this.$route.query,
            })
            return
          }

          if (this.$store.state.authentication.user.aud === 'dashboard') {
            this.$router.push({
              path: '/login/tenants',
              query: { ...this.$route.query, autologin: true },
            })
          } else if (
            this.$store.state.authentication.user.aud === 'enrollment'
          ) {
            this.$router.push('/enroll')
          } else {
            console.error(new Error('Unknown authentication token audience'))
          }
        })
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
