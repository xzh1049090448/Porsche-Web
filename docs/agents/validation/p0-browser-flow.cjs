// Local fixture verification only; all external requests are blocked.
const {chromium}=require(process.env.P0_PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const TARGET_URL=process.env.P0_URL||'http://127.0.0.1:5178';
(async()=>{
 const browser=await chromium.launch({headless:false,channel:'chrome'});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 const calls=[],errors=[],unexpected=[];let loggedIn=false,serial=0;
 const user={guid:'90071992547409931',username:'fixture_user',nickname:'本地测试用户',role:'user',status:'active'};
 const profile={guid:user.guid,nickname:user.nickname,is_verified:false,plan_type:'free',total_tokens_used:42,daily_calls_used:1,daily_call_limit:100,created_at:'2026-09-02T00:00:00Z'};
 const auth=()=>({access_token:'fixture-access-'+ ++serial,token_type:'Bearer',expires_in:300,user});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==TARGET_URL){unexpected.push(url.origin);return route.abort();}
  if(!url.pathname.startsWith('/api/'))return route.continue();
  const p=url.pathname,m=req.method();calls.push({method:m,path:p});
  const json=(status,data)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const err=(status,code)=>json(status,{error:{code,message:'测试错误',type:'authentication_error',request_id:'fixture'}});
  if(p==='/api/v1/auth/register')return json(201,{user});
  if(p==='/api/v1/auth/login'){loggedIn=true;return json(200,auth());}
  if(p==='/api/v1/auth/refresh')return loggedIn?json(200,auth()):err(401,'auth_invalid_refresh');
  if(p==='/api/v1/auth/logout')return err(401,'auth_session_invalid');
  if(!loggedIn)return json(401,{detail:'Token无效或已过期'});
  if(p==='/api/v1/auth/self')return json(200,{user});
  if(p==='/api/v1/auth/self/password')return err(401,'auth_request_failed');
  if(p==='/api/v1/auth/sessions')return json(200,{data:[{guid:'90071992547409941',login_method:'password',ip:'192.0.2.1',user_agent:'Local fixture browser',created_at:'2026-09-02T00:00:00Z',last_active_at:'2026-09-02T00:00:00Z',expires_at:'2026-09-03T00:00:00Z',current:true}]});
  if(p==='/api/v1/users/me'){if(m==='PUT')Object.assign(profile,req.postDataJSON());return json(200,profile);}
  if(p==='/api/v1/users/me/usage')return json(200,{total_tokens_used:42,daily_calls_used:1,daily_call_limit:100,remaining_daily_calls:99,plan_type:'free'});
  if(p==='/api/v1/platform/models')return json(200,{data:[],catalog_stale:false});
  if(p==='/api/v1/conversations')return json(200,{items:[],total:0});
  if(p==='/api/v1/billing/analytics/access')return json(200,{allowed:false});
  unexpected.push(m+' '+p);return json(500,{detail:'unhandled local fixture'});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(TARGET_URL+'/register');
  await page.getByPlaceholder(/用户名|Username/i).fill('fixture_user');
  await page.getByPlaceholder(/昵称|Nickname/i).fill('本地测试用户');
  await page.locator('input[type=password]').nth(0).fill('Fixture!Pass923');
  await page.locator('input[type=password]').nth(1).fill('Fixture!Pass923');
  await page.locator('.submit-btn').click();
  await page.waitForURL('**/login');
  assert.equal(calls.filter(x=>x.path==='/api/v1/auth/login').length,0,'register must not login');
  await page.getByPlaceholder(/用户名|Username/i).fill('fixture_user');
  await page.locator('input[type=password]').fill('Fixture!Pass923');
  await page.locator('.submit-btn').click();
  await page.waitForURL(TARGET_URL+'/');
  await page.goto(TARGET_URL+'/profile');
  await page.getByText(/登录设备|Signed-in devices/).waitFor();
  assert.equal(await page.locator('input:disabled').first().inputValue(),'fixture_user');
  assert.equal(await page.locator('body').innerText().then(t=>t.includes('NaN')),false);
  await page.locator('input').first().fill('资料更新昵称');
  await page.getByRole('button',{name:/^保存$|^Save$/}).click();
  await page.locator('.user-name').filter({hasText:'资料更新昵称'}).waitFor({timeout:5000});
  const beforeRefresh=calls.filter(x=>x.path==='/api/v1/auth/refresh').length;
  const passwords=page.locator('input[type=password]');
  await passwords.nth(0).fill('Wrong!Pass923');await passwords.nth(1).fill('Changed!Pass923');await passwords.nth(2).fill('Changed!Pass923');
  await page.getByRole('button',{name:/修改密码|Change password/i}).click();
  await page.getByText('测试错误',{exact:false}).first().waitFor();
  assert.equal(new URL(page.url()).pathname,'/profile');
  assert.equal(calls.filter(x=>x.path==='/api/v1/auth/self/password').length,1);
  assert.equal(calls.filter(x=>x.path==='/api/v1/auth/refresh').length,beforeRefresh,'wrong password must not refresh');
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
  assert(!stored.includes('fixture-access'),'no persisted access token');
  await page.screenshot({path:'/tmp/porsche-p0-profile.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/porsche-p0-profile-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'mobile page must not overflow');
  await page.setViewportSize({width:1280,height:900});
  await page.locator('.user-trigger').click();
  await page.getByRole('menuitem',{name:/退出登录|Log out|Sign out/i}).click();
  await page.locator('.el-message-box__btns .el-button--primary').click();
  await page.waitForURL('**/login');
  await page.getByText('已在本地退出；服务端会话状态尚未确认，认证操作已暂停。').waitFor();
  const refreshBeforeReload=calls.filter(x=>x.path==='/api/v1/auth/refresh').length;
  await page.reload();
  await page.getByText('已在本地退出；服务端会话状态尚未确认，认证操作已暂停。').waitFor();
  assert.equal(calls.filter(x=>x.path==='/api/v1/auth/refresh').length,refreshBeforeReload,'failed logout reload must not refresh');
  assert.deepEqual(unexpected,[],'no external/unhandled requests');
  assert.deepEqual(errors,[],'no unhandled Vue or browser errors');
  console.log(JSON.stringify({result:'PASS',checks:['register-no-auto-login','login','refresh-profile','profile-nickname-update','wrong-password-no-refresh','no-access-storage','mobile-no-overflow','logout401-reload-suppressed'],calls,errors,unexpected}));
 }catch(e){console.log(JSON.stringify({url:page.url(),calls,errors,unexpected})); await page.screenshot({path:'/tmp/porsche-p0-failure.png',timeout:3000}).catch(()=>{});throw e}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
