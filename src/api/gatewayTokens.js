import request from './request'
import { requiredGuid } from './guid'

const PREFIX = '/api/v1/tokens'

export const listGatewayTokens = () => request.get(PREFIX)
export const getGatewayToken = (guid) => request.get(`${PREFIX}/${encodeURIComponent(requiredGuid(guid, 'token GUID'))}`)
export const createGatewayToken = (body) => request.post(PREFIX, body)
export const updateGatewayToken = (guid, body) => request.patch(`${PREFIX}/${encodeURIComponent(requiredGuid(guid, 'token GUID'))}`, body)
export const revokeGatewayToken = (guid) => request.post(`${PREFIX}/${encodeURIComponent(requiredGuid(guid, 'token GUID'))}/revoke`)
