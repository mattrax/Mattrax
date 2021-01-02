// function JSONPath(obj: any, path: string): any {
//   let node = obj
//   for (const n of path.split('.')) {
//     if (node[n] === undefined) {
//       node = undefined
//       break
//     }

//     node = node[n]
//   }
//   return node
// }

function SetJSONPath(obj: any, path: string, newValue: any) {
  let node = obj
  const pathSegments = path.split('.')
  for (const [i, n] of pathSegments.entries()) {
    if (i === pathSegments.length - 1) {
      node[n] = newValue
      break
    }

    if (node[n] === undefined) {
      node[n] = {}
    }

    node = node[n]
  }
}

function generateFormPatch(el: any) {
  let patch: any = null
  el.querySelectorAll('input, select, checkbox, textarea').forEach(
    (node: HTMLInputElement) => {
      if (node.disabled) return
      if (
        node.value !== node.defaultValue ||
        node.checked !== node.defaultChecked
      ) {
        if (patch === null) patch = {}
        SetJSONPath(
          patch,
          node.name,
          node.type === 'checkbox' ? node.checked : node.value
        )
      }
    }
  )
  return patch
}

export default {
  created() {
    if (this.save === undefined) {
      console.error(
        "Error mounting resource mixin without 'save' function defined!"
      )
      return
    }

    this.$store.commit('dashboard/setEditting', false)
  },
  destroyed() {
    this.$store.commit('dashboard/setEditting', null)
    this.$store.commit('dashboard/setDeletable', false)
  },
  mounted() {
    this.storeDefaultValues()

    this._keyListener = function (e: any) {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (this.$store.state.dashboard.editting !== true) return
        this.savebtn()
      } else if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (this.$store.state.dashboard.editting === null) return
        this.$store.commit('dashboard/setEditting', true)
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        if (this.$store.state.dashboard.editting === null) return
        if (confirm('Are you sure you want to delete this resource?')) {
          this.deletebtn()
        }
      }
    }

    document.addEventListener('keydown', this._keyListener.bind(this))
  },
  updated() {
    this.storeDefaultValues()
  },
  beforeDestroy() {
    document.removeEventListener('keydown', this._keyListener)
  },
  methods: {
    storeDefaultValues() {
      this.$el
        .querySelectorAll('input, select, checkbox, textarea')
        .forEach((node: any) => {
          if (node.type === 'checkbox') {
            node.defaultChecked = node.checked
          } else if (node.nodeName === 'SELECT') {
            node.defaultValue = node.options[node.selectedIndex].value
          } else {
            node.defaultValue = node.value
          }
        })
    },
    savebtn() {
      const patch = generateFormPatch(this.$el)
      if (patch === null) {
        this.$store.commit('dashboard/setEditting', false)
        return
      }

      this.save(patch)
        .then(() => {
          this.storeDefaultValues()
          this.$store.commit('dashboard/setEditting', false)
        })
        .catch((err: Error) => this.$store.commit('dashboard/setError', err)) // TODO: Warning that saving failed
    },
    deletebtn() {
      ;(this.delete !== undefined ? this.delete : this.$parent.delete)()
        .then((dest: string) => {
          this.$store.commit('dashboard/setEditting', false)
          this.$router.push(dest)
        })
        .catch((err: Error) => this.$store.commit('dashboard/setError', err)) // TODO: Warning that saving failed
    },
    titleCaseStr(str: string): string {
      if (str === '') return ''
      if (str === null) return ''
      return str.charAt(0).toUpperCase() + str.slice(1)
    },
  },
  beforeRouteLeave(_to: any, _from: any, next: any) {
    if (this.$store.state.dashboard.editting === false) {
      next()
      return
    } else if (generateFormPatch(this.$el) === null) {
      next()
      return
    }
    const answer = window.confirm(
      'Do you really want to leave? you have unsaved changes!'
    )
    if (answer) {
      next()
    } else {
      next(false)
    }
  },
}
