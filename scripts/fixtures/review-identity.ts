// Imported only by scripts/foundation-review.mjs through its explicit Vite alias.
let signedIn = true
export const getUser = async () =>
  signedIn ? { id: '00000000-0000-4000-8000-000000000001' } : null
export const handleAuthCallback = async () => null
export const logout = async () => {
  signedIn = false
}
export const login = async () => {
  signedIn = true
}
export const acceptInvite = async () => {
  throw Error('Unavailable in synthetic review')
}
export const requestPasswordRecovery = async () => {
  throw Error('Unavailable in synthetic review')
}
export const updateUser = async () => {
  throw Error('Unavailable in synthetic review')
}
