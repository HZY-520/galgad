/// <reference types="blue-os" />

type Router = typeof import('@blueos.app.appmanager.router')

declare const global: {
  router: Router
}

declare const markRaw: <T>(value: T) => T
