import request from './request'

const PREFIX = '/api/v1/tokens'

export const listGatewayTokens = () => request.get(PREFIX)
export const getGatewayToken = (id) => request.get(`${PREFIX}/${id}`)
export const createGatewayToken = (body) => request.post(PREFIX, body)
export const updateGatewayToken = (id, body) => request.patch(`${PREFIX}/${id}`, body)
export const revokeGatewayToken = (id) => request.post(`${PREFIX}/${id}/revoke`)
