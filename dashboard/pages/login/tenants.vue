<template>
  <div class="page-content">
    <div v-if="loading" class="loading">Loading Tenants...</div>
    <p v-else-if="errorTxt" class="error-msg">{{ errorTxt }}</p>
    <div v-else>
      <span @click="logout()">
        <LogoutIcon
          class="logout-btn"
          view-box="0 0 8 8"
          height="20"
          width="20"
        />
      </span>
      <p class="title">Select Tenant:</p>
      <div class="tenant-list">
        <button
          v-for="tenant in $store.state.tenants.tenants"
          :key="tenant.id"
          @click="setTenant(tenant)"
        >
          {{ tenant.display_name }}
        </button>
        <button
          class="create-btn"
          @click="$router.push({ path: '/tenant/new', query: $route.query })"
        >
          Create New
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
  middleware: ['auth'],
  data() {
    return {
      loading: true,
      errorTxt: null,
    }
  },
  created() {
    this.$store
      .dispatch('tenants/getAll', this.user)
      .then(() => {
        if (
          this.$route.query.autologin === 'true' &&
          this.$store.state.tenants.tenants.length === 1
        ) {
          this.setTenant(this.$store.state.tenants.tenants[0])
          return
        }

        this.loading = false
      })
      .catch((err) => {
        this.loading = false
        this.errorTxt = err
      })
  },
  methods: {
    setTenant(tenant: object) {
      this.$store.commit('tenants/set', tenant)
      this.$router.push(
        this.$route.query?.redirect_to !== undefined
          ? Array.isArray(this.$route.query.redirect_to)
            ? this.$route.query.redirect_to[0] !== null
              ? this.$route.query.redirect_to[0]
              : '/'
            : this.$route.query.redirect_to
          : '/'
      )
    },
    logout() {
      this.phase = 0
      this.$store
        .dispatch('authentication/logout')
        .then(() => this.$router.push('/login'))
        .catch((err) => {
          console.error(err)
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
