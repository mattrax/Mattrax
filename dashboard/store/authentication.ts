import { errorForStatus } from './errors'

export interface LoginRequest {
  upn: string
  password: string
}

interface UserInformation {
  name?: string
  upn?: string
  aud?: string
  exp?: number
}

interface State {
  authToken: string
  user: UserInformation | null
}

export const state = (): State => ({
  authToken: sessionStorage.getItem('authToken') || '',
  user: null,
})

export const mutations = {
  setAuthToken(state: State, authToken: string) {
    state.authToken = authToken
  },

  setUserInformation(state: State, user: UserInformation | null) {
    state.user = user
  },
}

export const actions = {
  isAuthenticated(context: any): boolean {
    return context.state.authToken !== ''
  },

  populateUserInfomation(context: any) {
    if (context.state.authToken === '') {
      return
    }

    try {
      const claims = JSON.parse(
        decodeURIComponent(
          atob(
            context.state.authToken
              .split('.')[1]
              .replace(/-/g, '+')
              .replace(/_/g, '/')
          )
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        )
      )

      const userInfo: UserInformation = {
        name: claims.name,
        upn: claims.sub,
        aud: claims.aud,
        exp: claims.exp,
      }

      context.commit('setUserInformation', userInfo)
    } catch (err) {
      console.error(err)
    }
  },

  login(context: any, user: LoginRequest) {
    return new Promise((resolve, reject) => {
      fetch(process.env.baseUrl + '/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(user),
      })
        .then(async (res) => {
          if (res.status !== 200) {
            reject(
              errorForStatus(context, res, 'The login request was rejected')
            )
            return
          }

          const data = await res.json()
          sessionStorage.setItem('authToken', data.token)
          context.commit('setAuthToken', data.token)
          context.dispatch('populateUserInfomation')
          resolve(data.passwordExpired)
        })
        .catch((err) => {
          console.error(err)
          reject(new Error('An error occurred communicating with the server'))
        })
    })
  },

  logout(context: any) {
    sessionStorage.removeItem('authToken')
    sessionStorage.removeItem('tenant')
    context.commit('setAuthToken', '')
    context.commit('setUserInformation', {})
    context.commit('tenants/set', null, { root: true })
    context.commit('tenants/setTenants', null, { root: true })
  },
}
