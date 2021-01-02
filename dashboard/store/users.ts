// TODO: Pagination, Filters
import { errorForStatus } from './errors'

export const actions = {
  getAll(context: any) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/users',
        {
          headers: new Headers({
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(context, res, 'Error fetching users from server')
            )
            return
          }

          const users = await res.json()
          resolve(users)
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  getByID(context: any, userID: string) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/user/' +
          encodeURI(userID),
        {
          headers: new Headers({
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(context, res, 'Error fetching user from server')
            )
            return
          }

          const user = await res.json()
          resolve(user)
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  createUser(context: any, createUserRequest: any) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/users',
        {
          method: 'POST',
          headers: new Headers({
            'Content-Type': 'application/json',
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
          body: JSON.stringify(createUserRequest),
        }
      )
        .then((res) => {
          if (res.status !== 200 && res.status !== 204) {
            reject(
              errorForStatus(context, res, 'Error creating new user on server')
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
  patchUser(context: any, params: any) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/user/' +
          encodeURI(params.upn),
        {
          method: 'PATCH',
          headers: new Headers({
            'Content-Type': 'application/json',
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
          body: JSON.stringify(params.patch),
        }
      )
        .then(async (res) => {
          if (res.status !== 200 && res.status !== 204) {
            reject(
              errorForStatus(context, res, 'Error patching user on server')
            )
            return
          }

          const user = await res.json()
          resolve(user.upn)
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },
  deleteUser(context: any, upn: string) {
    return new Promise((resolve, reject) => {
      fetch(
        process.env.baseUrl +
          '/' +
          context.rootState.tenants.tenant.id +
          '/user/' +
          encodeURI(upn),
        {
          method: 'DELETE',
          headers: new Headers({
            'Content-Type': 'application/json',
            Authorization:
              'Bearer ' + context.rootState.authentication.authToken,
          }),
        }
      )
        .then((res) => {
          if (res.status !== 200 && res.status !== 204) {
            reject(
              errorForStatus(context, res, 'Error deleting user on server')
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
