import request, { authSession } from './request'
import { sessionRows } from './auth-session'

const PREFIX = '/api/v1/auth'

/** Registers a username without establishing a browser session. */
export const register = ({ username, password, nickname }) => request.post(`${PREFIX}/register`, { username, password, nickname })

/** Logs in with the only supported username/password credential pair. */
export async function login({ username, password }) {
  const response = await request.post(`${PREFIX}/login`, { username, password })
  authSession.setSession({ accessToken: response.access_token, user: response.user })
  return response
}

/** Restores a page-refresh session through the browser-managed Refresh cookie. */
export async function refreshSession() {
  const response = await request.post(`${PREFIX}/refresh`)
  authSession.setSession({ accessToken: response.access_token, user: response.user })
  return response
}

/** Revokes the current server session and clears only in-memory Access state. */
export async function logout() {
  try { await request.post(`${PREFIX}/logout`) } finally { authSession.clearSession() }
}

export async function listSessions() { return sessionRows((await request.get(`${PREFIX}/sessions`))?.data) }
export const revokeSession = (guid) => request.delete(`${PREFIX}/sessions/${encodeURIComponent(guid)}`)
export const revokeOtherSessions = () => request.post(`${PREFIX}/sessions/revoke-others`)
