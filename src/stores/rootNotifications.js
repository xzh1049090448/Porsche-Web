import {defineStore} from 'pinia'
import {reactive,toRefs} from 'vue'
import {authSession} from '../api/request.js'
import {rootNotificationsApi} from '../api/rootNotifications.js'

const blank=()=>({active:[],resolved:[],activeTotal:0,resolvedTotal:0,unreadCount:0,loading:false,error:null,mutationError:null,pendingReceipts:{}})
const safeError=error=>Object.freeze({code:typeof error?.code==='string'&&/^[a-z_]{1,64}$/.test(error.code)?error.code:'request_failed',requestId:typeof error?.requestId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(error.requestId)?error.requestId:null})
const isRootSession=snapshot=>snapshot?.state==='authenticated'&&typeof snapshot.accessToken==='string'&&snapshot.accessToken&&snapshot.user?.role==='root'
export function createRootNotificationsCoordinator({api=rootNotificationsApi,auth=authSession,state={},setIntervalFn=setInterval,clearIntervalFn=clearInterval,pollMs=30000}={}){
  Object.assign(state,blank(),state);let generation=0,timer=null,loadPromise=Promise.resolve(),unsub=null;const controllers=new Set()
  const clear=()=>{generation++;for(const controller of controllers)controller.abort();controllers.clear();if(timer!==null){clearIntervalFn(timer);timer=null}Object.assign(state,blank())}
  const current=()=>({state:auth.state?.(),accessToken:auth.accessToken?.(),user:auth.user?.()})
  const run=async work=>{const own=generation,controller=new AbortController();controllers.add(controller);try{const value=await work(controller.signal);return own===generation?value:null}catch(error){if(own===generation&&error?.name!=='AbortError')state.error=safeError(error);return null}finally{controllers.delete(controller)}}
  const refreshUnread=async()=>{const count=await run(signal=>api.unreadCount({signal}));if(count!==null)state.unreadCount=count;return count}
  const refresh=()=>{state.loading=true;state.error=null;loadPromise=Promise.all([run(signal=>api.list({state:'active'},{signal})),run(signal=>api.list({state:'resolved'},{signal})),refreshUnread()]).then(([active,resolved])=>{if(active){state.active=active.items;state.activeTotal=active.total}if(resolved){state.resolved=resolved.items;state.resolvedTotal=resolved.total}}).finally(()=>{state.loading=false});return loadPromise}
  const start=snapshot=>{if(!isRootSession(snapshot)){clear();return}if(timer!==null)return;void refresh();timer=setIntervalFn(()=>{void refreshUnread()},pollMs)}
  const replace=item=>{for(const key of ['active','resolved']){const index=state[key].findIndex(value=>value.guid===item.guid);if(index>=0){const previous=state[key][index],merged=Object.freeze({...item,read:previous.read||item.read,acknowledged:previous.acknowledged||item.acknowledged});state[key]=[...state[key].slice(0,index),merged,...state[key].slice(index+1)];return{previous,merged}}}return null}
  const mutate=async(kind,id)=>{if(state.pendingReceipts[id]?.[kind])return state.pendingReceipts[id][kind];const controller=new AbortController(),own=generation;controllers.add(controller);state.mutationError=null;const pending=(async()=>{try{const item=await api[kind](id,{signal:controller.signal});if(own!==generation)return null;const applied=replace(item);if(applied&&!applied.previous.read&&applied.merged.read)state.unreadCount=Math.max(0,state.unreadCount-1);return applied?.merged??item}catch(error){if(own===generation&&error?.name!=='AbortError')state.mutationError=safeError(error);return null}finally{controllers.delete(controller);if(state.pendingReceipts[id]){delete state.pendingReceipts[id][kind];if(!Object.keys(state.pendingReceipts[id]).length)delete state.pendingReceipts[id]}}})();state.pendingReceipts[id]??={};state.pendingReceipts[id][kind]=pending;return pending}
  const listener=snapshot=>start(snapshot);unsub=auth.subscribe(listener);const initial=current();if(initial.state!==undefined)start(initial)
  return{state,refresh,refreshUnread,markRead:id=>mutate('markRead',id),acknowledge:id=>mutate('acknowledge',id),ready:()=>loadPromise,clear,dispose(){clear();unsub?.();unsub=null}}
}
export const useRootNotificationsStore=defineStore('rootNotifications',()=>{const state=reactive(blank()),coordinator=createRootNotificationsCoordinator({state});return{...toRefs(state),refresh:coordinator.refresh,refreshUnread:coordinator.refreshUnread,markRead:coordinator.markRead,acknowledge:coordinator.acknowledge,clear:coordinator.clear}})
