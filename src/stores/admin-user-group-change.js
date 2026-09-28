import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { changeAdminUserGroup } from '../api/admin-user-entitlements.js'
import { loadAdminGroupChoices } from '../api/admin-groups.js'
import { canOpenGroupChange, createDirectEntitlementCoordinator } from './admin-user-entitlements.js'

const initial=()=>({open:false,dialogRevision:0,target:null,state:'idle',user:null,failureCode:null,requiresTargetRefresh:false,groups:[],groupsLoading:false,groupsError:false})
export function createGroupChangeCoordinator({state=initial(),api=changeAdminUserGroup,loadGroups=(permissions,options)=>loadAdminGroupChoices(permissions,{options})}={}){
  const direct=createDirectEntitlementCoordinator({state,canOpen:canOpenGroupChange,execute:api})
  let abort=null,revision=0,capabilities=[]
  const load=token=>{if(!direct.owns(token))return false;state.groups=[];state.groupsLoading=true;state.groupsError=false;const current=++revision;abort?.abort();abort=new AbortController();void Promise.resolve(loadGroups(capabilities,{signal:abort.signal})).then(groups=>{if(direct.owns(token)&&current===revision){state.groups=Object.freeze([...groups]);state.groupsError=groups.length===0}}).catch(error=>{if(direct.owns(token)&&current===revision&&error?.name!=='AbortError')state.groupsError=true}).finally(()=>{if(direct.owns(token)&&current===revision)state.groupsLoading=false});return true}
  const open=input=>{const token=direct.open(input);if(!token)return null;capabilities=Object.freeze([...input.capabilities]);load(token);return token}
  const retryGroups=token=>!state.groupsLoading&&load(token)
  const close=token=>{revision++;abort?.abort();abort=null;return direct.close(token)}
  return {state,open,close,dispose:close,owns:direct.owns,updateContext:direct.updateContext,submit:direct.submit,reset:direct.reset,refreshConflict:direct.refreshConflict,retryGroups}
}
export const useAdminUserGroupChangeStore=defineStore('adminUserGroupChange',()=>{const state=reactive(initial()),refs=toRefs(state),c=createGroupChangeCoordinator({state});return{isOpen:refs.open,dialogRevision:refs.dialogRevision,target:refs.target,state:refs.state,user:refs.user,failureCode:refs.failureCode,requiresTargetRefresh:refs.requiresTargetRefresh,groups:refs.groups,groupsLoading:refs.groupsLoading,groupsError:refs.groupsError,open:c.open,close:c.close,dispose:c.dispose,owns:c.owns,updateContext:c.updateContext,submit:c.submit,reset:c.reset,refreshConflict:c.refreshConflict,retryGroups:c.retryGroups}})
