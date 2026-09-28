<template>
  <el-dialog :model-value="store.isOpen" title="重置用户密码" width="min(560px, 92vw)" trap-focus :close-on-click-modal="false" @open="onOpen" @open-auto-focus="focusFirst" @close="requestClose" @closed="onClosed" @keydown.esc="requestClose">
    <template v-if="store.target">
      <el-alert v-if="store.state === 'conflict'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" title="用户信息已变化，正在刷新，请重新确认。" />
      <el-alert v-else-if="store.state === 'pending_recovery'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" title="操作结果仍在确认中，请勿再次重置密码。请关闭窗口并联系管理员核对操作结果。" />
      <el-alert v-else-if="store.failureCode" ref="errorAlert" tabindex="-1" type="error" :closable="false" :title="failureMessage" />
      <p>目标：<strong>{{ store.target.username || store.target.guid }}</strong></p>
      <el-alert type="warning" :closable="false" title="重置后旧密码和全部旧会话立即失效；目标用户需要使用新密码重新登录。" />
      <el-form id="admin-user-password-reset-form" ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
        <el-form-item prop="newPassword" label="新密码"><el-input ref="newPasswordInput" v-model="form.newPassword" type="password" show-password autocomplete="new-password" :disabled="locked" /></el-form-item>
        <el-form-item prop="confirmPassword" label="确认新密码"><el-input ref="confirmPasswordInput" v-model="form.confirmPassword" type="password" show-password autocomplete="new-password" :disabled="locked" /></el-form-item>
        <el-form-item prop="reason" label="重置原因"><el-input ref="reasonInput" v-model="form.reason" type="textarea" :rows="3" autocomplete="off" :disabled="locked" /><span class="count">{{ [...form.reason].length }}/200</span></el-form-item>
        <el-form-item prop="currentPassword" label="当前操作者密码"><el-input ref="currentPasswordInput" v-model="form.currentPassword" type="password" show-password autocomplete="current-password" :disabled="locked" /></el-form-item>
      </el-form>
    </template>
    <template #footer><el-button @click="requestClose">取消</el-button><el-button type="danger" native-type="submit" form="admin-user-password-reset-form" :loading="busy" :disabled="locked">确认重置</el-button></template>
  </el-dialog>
</template>
<script setup>
import { computed,nextTick,onBeforeUnmount,reactive,ref,watch } from 'vue'
import { useAdminUserPasswordResetStore } from '@/stores/admin-user-password-reset'
import { normalizePasswordResetRequest } from '@/api/admin-user-entitlements'
const props=defineProps({owner:{type:Object,default:null}});const emit=defineEmits(['closed','succeeded','conflict','failed']);const store=useAdminUserPasswordResetStore()
const formRef=ref(null),newPasswordInput=ref(null),confirmPasswordInput=ref(null),reasonInput=ref(null),currentPasswordInput=ref(null),errorAlert=ref(null)
const form=reactive({newPassword:'',confirmPassword:'',reason:'',currentPassword:''});let visibleOwner=null,closingOwner=null
const busy=computed(()=>['verifying','submitting','querying'].includes(store.state));const locked=computed(()=>busy.value||store.state==='pending_recovery');const failureMessage=computed(()=>({authentication_failed:'认证会话已失效',action_rate_limited:'操作过于频繁，请稍后重试',request_failed:'请求失败，请重新填写后重试'}[store.failureCode]||'请求无法完成，请重新确认后重试'))
function request(){if(form.newPassword!==form.confirmPassword)throw new Error('password_mismatch');return normalizePasswordResetRequest({targetGuid:store.target?.guid,newPassword:form.newPassword,reason:form.reason,currentPassword:form.currentPassword,expectedAuthVersion:store.target?.authVersion})}
function validNewPassword(){try{normalizePasswordResetRequest({targetGuid:'1',newPassword:form.newPassword,reason:'x',currentPassword:'x',expectedAuthVersion:1});return true}catch{return false}}
const rules={newPassword:[{validator:(_r,_v,d)=>validNewPassword()?d():d(new Error('密码须为 8–20 个字符且不能使用常见弱密码')),trigger:['blur','change']}],confirmPassword:[{validator:(_r,_v,d)=>form.newPassword===form.confirmPassword?d():d(new Error('两次密码不一致')),trigger:['blur','change']}],reason:[{validator:(_r,_v,d)=>{const n=[...form.reason.trim()].length;n>=1&&n<=200?d():d(new Error('请输入 1–200 个字符的原因'))},trigger:['blur','change']}],currentPassword:[{required:true,message:'请输入当前操作者密码',trigger:'blur'}]}
function nativeNewPassword(){return newPasswordInput.value?.input??newPasswordInput.value?.$el?.querySelector?.('input')}function nativeCurrentPassword(){return currentPasswordInput.value?.input??currentPasswordInput.value?.$el?.querySelector?.('input')}function nativeConfirmPassword(){return confirmPasswordInput.value?.input??confirmPasswordInput.value?.$el?.querySelector?.('input')}
function clearSecrets(){form.newPassword='';form.confirmPassword='';form.currentPassword='';for(const input of [nativeNewPassword(),nativeCurrentPassword(),nativeConfirmPassword()])if(input)input.value=''}
function clearForm(){clearSecrets();form.reason='';formRef.value?.clearValidate?.()}
function focusFirst(event){event?.preventDefault?.();const token=props.owner;nextTick(()=>nextTick(()=>{if(store.owns(token))newPasswordInput.value?.focus?.()}))}
function focusError(token){nextTick(()=>{if(store.owns(token))errorAlert.value?.$el?.focus?.()})}
function onOpen(){visibleOwner=props.owner;clearForm();focusFirst()}function requestClose(){if(store.owns(props.owner)){closingOwner=props.owner;clearForm();store.close(props.owner)}}
function onClosed(){const token=closingOwner??visibleOwner;closingOwner=null;if(store.isOpen)return;visibleOwner=null;clearForm();emit('closed',token)}
async function submit(){const token=props.owner;if(!store.owns(token)||locked.value)return;if(['failed','conflict','succeeded'].includes(store.state))store.reset(token);try{await formRef.value.validate()}catch{return}const input=request();const running=store.submit(token,input);clearSecrets();const result=await running;if(!store.owns(token)||!result)return;if(result.state==='succeeded')emit('succeeded',result,token);else if(result.state==='conflict')emit('conflict',token);else{emit('failed',result.failureCode,token);focusError(token)}}
watch(()=>store.dialogRevision,()=>{if(store.isOpen)onOpen()});watch(()=>store.isOpen,(open,old)=>{if(!open&&old&&!closingOwner)closingOwner=visibleOwner??props.owner},{flush:'sync'});onBeforeUnmount(clearForm)
</script>
<style scoped>.count{display:block;width:100%;text-align:right;color:var(--el-text-color-secondary);font-size:12px}</style>
