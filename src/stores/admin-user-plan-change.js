import { defineStore } from 'pinia'
import { reactive, toRefs } from 'vue'
import { changeAdminUserPlan } from '../api/admin-user-entitlements.js'
import { canOpenPlanChange, createDirectEntitlementCoordinator } from './admin-user-entitlements.js'
export const ADMIN_USER_PLAN_OPTIONS=Object.freeze([{value:'free',label:'免费版'},{value:'professional',label:'专业版'},{value:'enterprise',label:'企业版'}])
const initial=()=>({open:false,dialogRevision:0,target:null,state:'idle',user:null,failureCode:null,requiresTargetRefresh:false})
export function createPlanChangeCoordinator({state=initial(),api=changeAdminUserPlan}={}){const c=createDirectEntitlementCoordinator({state,canOpen:canOpenPlanChange,execute:api});return{state,...c}}
export const useAdminUserPlanChangeStore=defineStore('adminUserPlanChange',()=>{const state=reactive(initial()),refs=toRefs(state),c=createPlanChangeCoordinator({state});return{isOpen:refs.open,dialogRevision:refs.dialogRevision,target:refs.target,state:refs.state,user:refs.user,failureCode:refs.failureCode,requiresTargetRefresh:refs.requiresTargetRefresh,open:c.open,close:c.close,dispose:c.dispose,owns:c.owns,updateContext:c.updateContext,submit:c.submit,reset:c.reset,refreshConflict:c.refreshConflict}})
