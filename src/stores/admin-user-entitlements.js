const GUID=/^[1-9]\d{0,18}$/;const MAX='9223372036854775807'
const validGuid=value=>typeof value==='string'&&GUID.test(value)&&(value.length<19||value<=MAX)
export function canManageUserEntitlement({actorRole,actorGuid,target}={}){
  if(!validGuid(actorGuid)||!target||!validGuid(target.guid)||target.guid===actorGuid||!['active','disabled'].includes(target.status)||!Number.isInteger(target.authVersion)||target.authVersion<1)return false
  return actorRole==='admin'?target.role==='user':actorRole==='root'?(target.role==='user'||target.role==='admin'):false
}
const can=(capability,input)=>Array.isArray(input?.capabilities)&&input.capabilities.includes(capability)&&canManageUserEntitlement(input)
export const canOpenPasswordReset=input=>can('users.reset_password',input)
export const canOpenPlanChange=input=>can('users.plan.change',input)
export const canOpenGroupChange=input=>can('users.group.change',input)&&input.capabilities.includes('groups.read')

export function createDirectEntitlementCoordinator({state,canOpen,createWorkflow,execute,onSucceeded=()=>{}}={}){
  if(!state||typeof canOpen!=='function'||typeof createWorkflow!=='function'&&typeof execute!=='function')throw new TypeError('invalid_entitlement_coordinator')
  let owner=null,context=null,workflow=null,unsubscribe=null,active=null,sequence=0
  const initial=()=>({open:false,dialogRevision:state.dialogRevision??0,target:null,state:'idle',user:null,failureCode:null,requiresTargetRefresh:false})
  const owns=token=>token!=null&&token===owner&&workflow!=null
  const current=token=>owns(token)&&context&&state.routeGuid===context.target.guid&&state.identityEpoch===context.identityEpoch&&state.permissionVersion===context.permissionVersion
  const destroy=()=>{unsubscribe?.();unsubscribe=null;workflow?.dispose();workflow=null;owner=null;context=null;active=null}
  const close=(token=owner)=>{if(!owns(token))return false;const revision=state.dialogRevision;destroy();Object.assign(state,initial(),{dialogRevision:revision});return true}
  const open=input=>{if(!canOpen(input)||input.routeGuid!==input.target.guid||typeof input.identityEpoch!=='string'||!Number.isSafeInteger(input.permissionVersion))return null;destroy();owner=Object.freeze({entitlementDialog:++sequence});context=Object.freeze({...input,target:Object.freeze({...input.target}),capabilities:Object.freeze([...input.capabilities])});Object.assign(state,initial(),{open:true,dialogRevision:(state.dialogRevision??0)+1,target:context.target,routeGuid:input.routeGuid,identityEpoch:input.identityEpoch,permissionVersion:input.permissionVersion});workflow=createWorkflow?createWorkflow():createDirectEntitlementWorkflow({execute});unsubscribe=workflow.subscribe(snapshot=>{if(!current(owner))return;Object.assign(state,snapshot,{requiresTargetRefresh:snapshot.state==='conflict'})});return owner}
  const updateContext=(token,next)=>{if(!owns(token))return false;const drift=(Object.hasOwn(next,'routeGuid')&&next.routeGuid!==context.routeGuid)||(Object.hasOwn(next,'identityEpoch')&&next.identityEpoch!==context.identityEpoch)||(Object.hasOwn(next,'permissionVersion')&&next.permissionVersion!==context.permissionVersion)||(Object.hasOwn(next,'target')&&(next.target?.guid!==context.target.guid||next.target?.authVersion!==context.target.authVersion));if(drift){close(token);return false}return true}
  const submit=(token,input)=>{if(!current(token))return null;if(active)return active;const owned=workflow;active=owned.start({...input,targetGuid:context.target.guid,expectedAuthVersion:context.target.authVersion}).then(async result=>{if(current(token)&&result.state==='succeeded'){await onSucceeded(result.user,token)}return result}).finally(()=>{if(workflow===owned)active=null});return active}
  const reset=token=>current(token)&&!active?workflow.reset():false
  const refreshConflict=async(token,load)=>{if(!current(token)||state.state!=='conflict'||typeof load!=='function')return false;let target;try{target=await load(context.target.guid)}catch{return false}if(!current(token)||!canOpen({...context,target})||target.guid!==context.target.guid)return false;context=Object.freeze({...context,target:Object.freeze({...target})});state.target=context.target;state.requiresTargetRefresh=false;workflow.reset();return true}
  return {open,close,dispose:close,owns,updateContext,submit,reset,refreshConflict}
}
import { createDirectEntitlementWorkflow } from '../api/admin-user-entitlements-state.js'
