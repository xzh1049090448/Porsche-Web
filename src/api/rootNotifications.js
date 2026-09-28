const GUID=/^[1-9]\d{0,18}$/,MAX_GUID='9223372036854775807'
const TYPES=new Set(['published_price_below_upstream','upstream_missing','automatic_inactivation','upstream_reappearance','catalog_sync_failure','price_not_comparable','renderer_failure'])
const STATES=new Set(['active','resolved'])
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)!==null&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key))
const positive=value=>Number.isSafeInteger(value)&&value>=1
const validGuid=value=>typeof value==='string'&&GUID.test(value)&&(value.length<MAX_GUID.length||value.length===MAX_GUID.length&&value<=MAX_GUID)
const header=(headers,name)=>{const value=typeof headers?.get==='function'?headers.get(name):headers?.[name]??headers?.[name.toLowerCase()];return typeof value==='string'?value:null}
const requestError=()=>{throw new Error('invalid_root_notifications_request')}
class InvalidRootNotificationsResponse extends Error{constructor(){super('invalid_root_notifications_response')}}
const invalid=()=>{throw new InvalidRootNotificationsResponse()}
function metadata(result,status=200){if(!exact(result,['data','status','headers'])||result.status!==status||header(result.headers,'Cache-Control')!=='no-store'||!header(result.headers,'X-Request-ID')?.trim())invalid();return result.data}
function guid(value){value=String(value);if(!validGuid(value))requestError();return encodeURIComponent(value)}
function notification(raw){
  const keys=['guid','type','state','read','acknowledged','created_at','updated_at']
  if(!exact(raw,keys)||!validGuid(raw.guid)||!TYPES.has(raw.type)||!STATES.has(raw.state)||typeof raw.read!=='boolean'||typeof raw.acknowledged!=='boolean'||!positive(raw.created_at)||!positive(raw.updated_at)||raw.updated_at<raw.created_at)invalid()
  return Object.freeze({guid:raw.guid,type:raw.type,state:raw.state,read:raw.read,acknowledged:raw.acknowledged,createdAt:raw.created_at,updatedAt:raw.updated_at})
}
export class RootNotificationsError extends Error{constructor(code,status=null,requestId=null){super(code);this.name='RootNotificationsError';Object.assign(this,{code,status,requestId})}}
function mapError(error){
  if(error?.name==='AbortError')return error
  const status=Number.isInteger(error?.response?.status)?error.response.status:null,raw=error?.response?.data,requestId=header(error?.response?.headers,'X-Request-ID')
  const expected=({400:'invalid_request',401:'authentication_required',403:'root_role_required',404:'not_found',503:'unavailable'})[status]
  const valid=expected&&header(error?.response?.headers,'Cache-Control')==='no-store'&&requestId?.trim()&&exact(raw,['error'])&&exact(raw.error,['code','message','request_id'])&&raw.error.code===expected&&raw.error.request_id===requestId&&typeof raw.error.message==='string'
  if(!valid)return new RootNotificationsError(status?'request_failed':'network_error',status)
  return new RootNotificationsError(status===403?'root_required':expected,status,requestId)
}
export function rootNotificationListResource(filters={}){
  if(!filters||typeof filters!=='object'||Object.keys(filters).some(key=>!['state','page','pageSize'].includes(key)))requestError()
  const state=filters.state,page=filters.page??1,pageSize=filters.pageSize??20
  if(state!==undefined&&!STATES.has(state)||!positive(page)||![20,50,100].includes(pageSize))requestError()
  const query=new URLSearchParams();if(state)query.set('state',state);query.set('page',String(page));query.set('page_size',String(pageSize))
  return `/admin/v2/notifications?${query}`
}
export function createRootNotificationsProductionRequest({get,post}={}){return input=>input.method==='GET'?get(input.path,{signal:input.signal}):input.method==='POST'?post(input.path,{signal:input.signal}):requestError()}
async function productionRequest(input){
  const {authenticatedFetch,getAuthToken}=await import('./request.js'),base=import.meta.env?.VITE_API_BASE??''
  const parse=async response=>{let data;try{data=await response.json()}catch{data=null}const result={data,status:response.status,headers:response.headers};if(!response.ok)throw{response:result};return result}
  return createRootNotificationsProductionRequest({
    get:async(path,{signal})=>parse(await authenticatedFetch(base+path,{method:'GET',signal})),
    post:async(path,{signal})=>{const headers={},token=getAuthToken();if(token)headers.Authorization=`Bearer ${token}`;return parse(await fetch(base+path,{method:'POST',headers,credentials:'include',signal}))},
  })(input)
}
export function createRootNotificationsApi({request=productionRequest}={}){
  const run=async(input,mapper)=>{try{return mapper(metadata(await request(input)))}catch(error){if(error instanceof InvalidRootNotificationsResponse)throw error;throw mapError(error)}}
  return Object.freeze({
    list:(filters={},options={})=>run({method:'GET',path:rootNotificationListResource(filters),signal:options.signal},raw=>{if(!exact(raw,['items','page','page_size','total'])||!Array.isArray(raw.items)||!positive(raw.page)||![20,50,100].includes(raw.page_size)||!Number.isSafeInteger(raw.total)||raw.total<0)invalid();return Object.freeze({items:Object.freeze(raw.items.map(notification)),page:raw.page,pageSize:raw.page_size,total:raw.total})}),
    unreadCount:(options={})=>run({method:'GET',path:'/admin/v2/notifications/unread-count',signal:options.signal},raw=>{if(!exact(raw,['unread_count'])||!Number.isSafeInteger(raw.unread_count)||raw.unread_count<0)invalid();return raw.unread_count}),
    markRead:(id,options={})=>run({method:'POST',path:`/admin/v2/notifications/${guid(id)}/read`,signal:options.signal},notification),
    acknowledge:(id,options={})=>run({method:'POST',path:`/admin/v2/notifications/${guid(id)}/acknowledge`,signal:options.signal},notification),
  })
}
export const rootNotificationsApi=createRootNotificationsApi()
