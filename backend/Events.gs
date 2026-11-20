/** FTC Events integration. Credentials belong in Script Properties, never this file. */
const FIRST_EVENTS_ROOT = 'https://ftc-api.firstinspires.org/v2.0/';
const FIRST_DEFAULT_EVENT = {code:'USCOBRQ',name:'Broomfield Qualifier',dateStart:'2027-01-16T00:00:00',city:'Broomfield',venue:'Prospect Ridge Academy'};

function firstEvents_(body) {
  try {
    const actor = authedUser_(body.userId, body.token);
    if (!actor) return out_({ok:false,error:'Please sign in again'});
    if (!scope_(actor, body.org)) return out_({ok:false,error:'Team access denied'});
    const season = Number(body.season);
    if (!Number.isInteger(season) || season < 2020 || season > 2100) return out_({ok:false,error:'Invalid event season'});
    const props = PropertiesService.getScriptProperties();
    const username = props.getProperty('FTC_EVENTS_USERNAME'), key = props.getProperty('FTC_EVENTS_KEY');
    if (!username || !key) return out_({ok:false,error:'Events setup is needed. Ask your admin to configure the FTC Events credentials.'});
    const headers = {Authorization:'Basic ' + Utilities.base64Encode(username + ':' + key), Accept:'application/json'};
    if (body.mode === 'list') {
      const result = firstFetch_('' + season + '/events?teamNumber=' + encodeURIComponent(body.org), headers);
      if (!result.ok) return out_({ok:false,error:result.error});
      const events = firstArray_(result.data, 'events');
      if (season === 2026 && !events.some(e => String(e.code).toUpperCase() === FIRST_DEFAULT_EVENT.code)) events.push(FIRST_DEFAULT_EVENT);
      return out_({ok:true,eventsVersion:1,events:events, fetchedAt:result.fetchedAt});
    }
    const code = String(body.eventCode || '').toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) return out_({ok:false,error:'Invalid event code'});
    const prefix = season + '/', encoded = encodeURIComponent(code);
    const paths = [prefix+'events?eventCode='+encoded,prefix+'rankings/'+encoded,prefix+'schedule/'+encoded+'/qual/hybrid',prefix+'schedule/'+encoded+'/playoff/hybrid',prefix+'teams?eventCode='+encoded+'&page=1'];
    const results = firstFetchMany_(paths,headers);
    const meta = results[0];
    if (!meta.ok) return out_({ok:false,error:meta.error});
    const event = firstArray_(meta.data,'events').find(e=>String(e.code).toUpperCase()===code);
    if (!event) return out_({ok:false,error:'This event is not published for the selected season.'});
    const sections = {};
    ['rankings','qual','playoff','teams'].forEach((name,i)=>{
      const r=results[i+1], field = name==='qual'||name==='playoff'?'schedule':name;
      sections[name]=r.ok?{ok:true,items:firstArray_(r.data,field),fetchedAt:r.fetchedAt}:{ok:false,error:r.error};
    });
    if (sections.teams.ok) {
      const total = Number(results[4].data.pageTotal || 1);
      if (!Number.isInteger(total) || total < 1 || total > 50) sections.teams={ok:false,error:'The team list could not be loaded completely. Please try again.'};
      else if (total > 1) {
        const paths=[]; for(let page=2;page<=total;page++) paths.push(prefix+'teams?eventCode='+encoded+'&page='+page);
        firstFetchMany_(paths,headers).forEach(r=>{
          if (!r.ok) sections.teams={ok:false,error:r.error};
          else if (sections.teams.ok) { sections.teams.items=sections.teams.items.concat(firstArray_(r.data,'teams')); sections.teams.fetchedAt=Math.min(sections.teams.fetchedAt,r.fetchedAt); }
        });
      }
    }
    return out_({ok:true,eventsVersion:1,season:season,eventCode:code,event:event,sections:sections});
  } catch (err) {
    // Never reflect upstream response bodies, headers, or credentials to clients.
    return out_({ok:false,error:'FTC Events could not be reached. Try again; saved event data is still available.'});
  }
}
function firstArray_(obj,key) {
  // FIRST's schema uses camelCase; accept the legacy capitalized wrapper too.
  const value=obj[key] || obj[key[0].toUpperCase()+key.slice(1)];
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Invalid FIRST response');
  return value;
}
function firstFetch_(path,headers) { return firstFetchMany_([path],headers)[0]; }
function firstFetchMany_(paths,headers) {
  const cache=CacheService.getScriptCache(), result=[], missing=[];
  paths.forEach((path,i)=>{
    const key='firstEvents1:'+path, saved=cache.get(key);
    if (saved) { try {result[i]=JSON.parse(saved);return;} catch(e) {} }
    missing.push({path:path,index:i,key:key});
  });
  if (missing.length) {
    const responses=UrlFetchApp.fetchAll(missing.map(m=>({url:FIRST_EVENTS_ROOT+m.path,headers:headers,muteHttpExceptions:true,followRedirects:false})));
    responses.forEach((response,i)=>{
      const status=response.getResponseCode(), m=missing[i]; let value;
      if (status===200) {
        try {value={ok:true,data:JSON.parse(response.getContentText()),fetchedAt:Date.now()};}
        catch(e) {value={ok:false,error:'FTC Events returned an unreadable response. Try again.'};}
      } else if (status===401 || status===403) value={ok:false,error:'FTC Events rejected the configured credentials. Ask your admin to check them.'};
      else if (status===404) value={ok:false,error:'This information is not available from FIRST yet.'};
      else if (status===429) value={ok:false,error:'FTC Events is busy. Wait a minute before refreshing.'};
      else value={ok:false,error:'FTC Events is temporarily unavailable (HTTP '+status+').'};
      result[m.index]=value;
      if (value.ok) { const text=JSON.stringify(value); if(text.length<45000) {try {cache.put(m.key,text,60);} catch(e) {}} }
    });
  }
  return result;
}
