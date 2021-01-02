import { errorForStatus } from './errors'

export interface CreateTenantRequest {
  display_name: string
  primary_domain: string
}

interface Tenant {
  id: string
  display_name: string
  primary_domain: string
}

interface State {
  tenant: Tenant | null
  tenants: Tenant[] | null
}

export const state = (): State => ({
  tenant:
    sessionStorage.getItem('tenant') !== null
      ? JSON.parse(sessionStorage.getItem('tenant') || '')
      : null,
  tenants: null,
})

export const mutations = {
  set(state: State, tenant: Tenant | null) {
    state.tenant = tenant
    if (tenant !== null) {
      sessionStorage.setItem('tenant', JSON.stringify(tenant))
    }
  },

  setTenants(state: State, tenants: Tenant[]) {
    state.tenants = tenants
  },

  clearTenants(state: State) {
    state.tenants = null
  },
}

export const actions = {
  create(context: any, tenant: CreateTenantRequest) {
    return new Promise((resolve, reject) => {
      fetch(process.env.baseUrl + '/me/tenants', {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + context.rootState.authentication.authToken,
        }),
        body: JSON.stringify(tenant),
      })
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(
                context,
                res,
                'The create tenant request was rejected'
              )
            )
            return
          }

          const data = await res.json()
          const t: Tenant = {
            id: data.tenant_id,
            display_name: tenant.display_name,
            primary_domain: tenant.primary_domain,
          }
          context.commit('set', t)
          resolve()
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  getAll(context: any) {
    return new Promise((resolve, reject) => {
      fetch(process.env.baseUrl + '/me/tenants', {
        headers: new Headers({
          Authorization: 'Bearer ' + context.rootState.authentication.authToken,
        }),
      })
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(
                context,
                res,
                'The get tenants request was rejected'
              )
            )
            return
          }

          const data = await res.json()
          context.commit('setTenants', data)
          resolve()
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  addDomain(context: any, domain: string) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/domain/' +
          encodeURI(domain),
        {
          method: 'POST',
          headers: new Headers({
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(
                context,
                res,
                'The add domain request was rejected'
              )
            )
            return
          }

          resolve(await res.json())
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  verifyDomain(context: any, domain: string) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/domain/' +
          encodeURI(domain),
        {
          method: 'PATCH',
          headers: new Headers({
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(
                context,
                res,
                'The verify domain request was rejected'
              )
            )
            return
          }

          resolve(await res.json())
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  deleteDomain(context: any, domain: string) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/domain/' +
          encodeURI(domain),
        {
          method: 'DELETE',
          headers: new Headers({
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then((res) => {
          if (res.status !== 204) {
            reject(
              errorForStatus(
                context,
                res,
                'The delete domain request was rejected'
              )
            )
            return
          }

          resolve()
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
}
