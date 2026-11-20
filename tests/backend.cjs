const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),assert=require('assert');
function makeBackend(){
 const sheets=new Map(),props=new Map(),cache=new Map();
 function sheet(){const rows=[];return {rows,getLastRow:()=>rows.length,getLastColumn:()=>Math.max(1,...rows.map(r=>r.length)),appendRow:r=>rows.push([...r]),setFrozenRows(){},getRange:(r,c,nr=1,nc=1)=>({getValues:()=>Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>rows[r+i-1]?.[c+j-1]??'')),setValues:vs=>vs.forEach((row,i)=>row.forEach((v,j)=>{(rows[r+i-1] ||= [])[c+j-1]=v;}))})};}
 const ctx=vm.createContext({console,Date,SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets.get(n),insertSheet:n=>{let sh=sheet();sheets.set(n,sh);return sh;}})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID()},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},UrlFetchApp:{fetchAll:rs=>rs.map(()=>({getResponseCode:()=>404,getContentText:()=>''}))}});
 vm.runInContext(fs.readFileSync(__dirname+'/../backend/Code.gs','utf8'),ctx);
 vm.runInContext(fs.readFileSync(__dirname+'/../backend/Events.gs','utf8'),ctx);
 return {ctx,sheets,call:b=>ctx.doPost({postData:{contents:JSON.stringify(b)}})};
}
function seed(b){b.ctx.upsertMany_('user',[
{id:'admin',type:'user',data:{name:'Cohen',role:'admin'},updatedAt:1,deleted:false},
{id:'scout',type:'user',data:{name:'Alex',role:'scout'},updatedAt:1,deleted:false},
{id:'bee',type:'user',org:'17300',data:{name:'Bee',role:'scout'},updatedAt:1,deleted:false}],1);
 b.ctx.upsertMany_('field',[{id:'legacy',type:'field',data:{team:'123',match:'1'},updatedAt:1,deleted:false}],1);
}
if(require.main===module){
 const b=makeBackend();seed(b);const call=b.call;
 const a=call({action:'login',org:'17190',loginId:'admin',password:'1111'});assert(a.ok);
 const s=call({action:'login',org:'17190',loginId:'scout',password:'1111'});assert(s.ok);
 const bee=call({action:'login',org:'17300',loginId:'bee',password:'1111'});assert(bee.ok);
 const req=(u,org,more={})=>({userId:u.user.id,token:u.token,org,...more});
 assert(!call({action:'login',org:'17300',loginId:'scout',password:'1111'}).ok);
 assert.deepEqual(call({action:'directory',org:'17300'}).users.map(u=>u.name),['Bee']);
 assert(call({org:'17190'}).auth===false);
 assert(call(req(s,'17300')).ok===false);
 assert(call(req(a,'17190')).records.some(r=>r.id==='legacy'&&r.org==='17190'));
 assert(!call(req(a,'17300')).records.some(r=>r.id==='legacy'));
 assert(!call(req(bee,'17300')).records.some(r=>r.id==='admin'));
 const rec={id:'new',type:'field',org:'17300',updatedAt:2,data:{team:'123',match:'2'}};
 assert.equal(call(req(s,'17190',{records:[rec]})).rejected.length,1);
 assert.equal(call(req(bee,'17300',{records:[rec]})).rejected.length,0);
 assert.equal(call(req(a,'17190',{records:[{...rec,org:'17190'}]})).rejected.length,1);
 assert.equal(call(req(s,'17190',{records:[{id:'scout',type:'user',org:'17190',data:{name:'Alex',role:'admin'},updatedAt:2}]})).rejected.length,1);
 assert.equal(call(req(a,'17190',{records:[{id:'scout',type:'user',org:'17190',data:{name:'Alex',role:'scout',pin:'1234'},updatedAt:2}]})).rejected.length,1);
 assert(!call(req(s,'17190',{action:'resetpw',targetId:'bee'})).ok);
 assert(!call(req(s,'17190',{action:'setpw',oldPw:'1111',newPw:'abcd'})).ok);
 assert(!call(req(s,'17190',{action:'setpw',oldPw:'1111',newPw:'12345'})).ok);
 const changed=call(req(s,'17190',{action:'setpw',oldPw:'1111',newPw:'0426'}));assert(changed.ok);
 assert.equal(call(req(s,'17190')).auth,false);
 assert(!call({action:'login',org:'17190',loginId:'scout',password:'1111'}).ok);
 const newLogin=call({action:'login',org:'17190',loginId:'scout',password:'0426'});assert(newLogin.ok&&!newLogin.isDefault);
 assert(!JSON.stringify(call(req(a,'17190'))).includes('pin2:'));
 assert(!JSON.stringify(call({action:'directory',org:'17190'})).includes('token'));
 assert(call(req(a,'17190',{action:'resetpw',targetId:'scout',newPw:'9999'})).ok);
 assert.equal(call(req(newLogin,'17190')).auth,false);
 assert(call({action:'login',org:'17190',loginId:'scout',password:'1111'}).isDefault);
 assert(!call({action:'login',org:'17190',loginId:'scout',password:'9999'}).ok);
 // Existing password hashes become the requested default PIN without changing scouting data.
 b.ctx.setStoredHash_('scout','legacy-password-hash');assert(call({action:'login',org:'17190',loginId:'scout',password:'1111'}).ok);
 const dir=call({action:'directory',org:'17190'});assert(dir.users.every(u=>Object.keys(u).sort().join(',')==='id,name,org'));
 console.log('Backend checks passed: migration, isolation, role enforcement, PIN privacy/reset, session revocation.');
}
module.exports={makeBackend,seed};
