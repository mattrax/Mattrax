<template>
  <div v-if="loading" class="loading">Loading Devices...</div>
  <div v-else>
    <PageHead>
      <ul class="breadcrumb">
        <li><NuxtLink to="/">Dashboard</NuxtLink></li>
      </ul>
      <h1>Devices</h1>
    </PageHead>
    <PageNav>
      <button @click="$router.push('/enroll')">Enroll Device</button>
      <input type="text" placeholder="Search..." disabled />
    </PageNav>
    <TableView :headings="['', 'Name', 'Owner', 'Model', 'Groups']">
      <tr v-for="device in devices" :key="device.id">
        <td>
          <span><DeviceIcon :protocol="device.protocol" width="30" /></span>
        </td>
        <td>
          <NuxtLink :to="'/devices/' + device.id" exact>{{
            device.name
          }}</NuxtLink>
        </td>
        <td>
          <NuxtLink :to="'/users/' + device.owner" exact>{{
            device.owner
          }}</NuxtLink>
        </td>
        <td>{{ device.model }}</td>
        <td>
          <NuxtLink
            v-for="group in device.groups"
            :key="group.id"
            :to="'/groups/' + group.id"
            class="group-list"
            >{{ group.name }}</NuxtLink
          >
        </td>
      </tr>
    </TableView>
  </div>
</template>

<script lang="ts">
import Vue from 'vue'

export default Vue.extend({
  layout: 'dashboard',
  data() {
    return {
      loading: true,
      devices: [],
    }
  },
  created() {
    this.$store
      .dispatch('devices/getAll')
      .then((devices) => {
        this.devices = devices
        this.loading = false
      })
      .catch((err) => this.$store.commit('dashboard/setError', err))
  },
})
</script>

<style scoped></style>
