const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(process.argv[2],'utf8');
const revision=source.match(/release.sourceRevision,'([^']+)'/)[1];
(async()=>{
 for(const name of ['wrong_candidate','budget_exhausted','existing_result']){
  let launches=0,writes=0,reserves=0;
  const fakeFs={existsSync:()=>true,readFileSync(path){
   if(path.endsWith('accounts.json'))return JSON.stringify([{}, {username:'synthetic',password:'synthetic'}]);
   if(path.endsWith('release-result.json'))return JSON.stringify({status:'deployed',sourceRevision:name==='wrong_candidate'?'wrong':revision,sourceHealth:200,publicHealth:200,frontendUnchanged:true});
   if(path.endsWith('budget.json'))return JSON.stringify({maximumRequests:4,maxTokensPerRequest:32,attempts:Array(name==='budget_exhausted'?4:3).fill({})});
   throw Error('unexpected synthetic read');
  },writeFileSync(){writes++},openSync(path,flag){reserves++;assert.equal(flag,'wx');const e=Error('existing');e.code='EEXIST';throw e},closeSync(){}};
  const context={require(id){if(id.endsWith('/playwright'))return {chromium:{launch(){launches++;throw Error('unexpected browser launch')}}};if(id==='fs')return fakeFs;return require(id)},console:{log(){},error(){}},process:{exitCode:0},Buffer};
  await vm.runInNewContext(source,context);
  assert.equal(launches,0);assert.equal(writes,0);assert.equal(context.process.exitCode,1);assert.equal(reserves,name==='existing_result'?1:0);
  console.log('PASS '+name+' blocks before browser, budget write or result overwrite');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
