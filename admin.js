'use strict';
// Public project URL and publishable/anon key only. NEVER paste a service-role or secret key here.
const SUPABASE_URL = 'https://arkclxdnknhcybganauj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_d9hAAthfiQwDgFc_yNrKtQ_d-nH1DAA';
const $ = id => document.getElementById(id);
const show = (id, visible) => { $(id).hidden = !visible; };
const message = (id, text, error=false) => { $(id).textContent=text; $(id).classList.toggle('error',error); };
const text = (tag, value, className='') => { const el=document.createElement(tag); el.textContent=String(value??''); if(className)el.className=className; return el; };
const date = value => value ? new Date(value).toLocaleString() : '—';
let db, currentUser=null, requests=[], busy=false, page=0, totalMatching=0;
const PAGE_SIZE=50;
// Site names come from the same public GeoJSON used by the directory.
const siteNameFiles=new Map();
function siteNamesFor(province,carrier){
  const key=String(province||'').toUpperCase()+'_'+(String(carrier||'').toLowerCase()==='rogers'?'Rogers':'TELUS');
  if(!/^(BC|AB|SK)_(TELUS|Rogers)$/.test(key))return Promise.resolve(new Map());
  if(!siteNameFiles.has(key)){
    siteNameFiles.set(key,fetch('data/'+key+'.geojson').then(r=>{if(!r.ok)throw Error('Site data unavailable');return r.json();}).then(data=>{
      const names=new Map();for(const feature of data.features||[]){const p=feature.properties||{};const id=String(p['Site ID']||p.name||'').trim().toUpperCase();if(id)names.set(id,String(p['Site Name']||'').trim());}return names;
    }).catch(()=>new Map()));
  }
  return siteNameFiles.get(key);
}
function showSiteName(target,request){
  siteNamesFor(request.province,request.carrier).then(names=>{
    if(!target.isConnected)return;const name=names.get(String(request.site_code||'').trim().toUpperCase());
    if(name)target.textContent=name;
  });
}

let searchDelay;
function setBusy(value){busy=value; $('refresh').disabled=value; $('previousPage').disabled=value || page===0; $('nextPage').disabled=value || (page+1)*PAGE_SIZE>=totalMatching; document.querySelectorAll('.decision-row button').forEach(b=>b.disabled=value);}
async function checkAdmin(user){
  const {data,error}=await db.from('app_roles').select('role').eq('user_id',user.id).eq('role','admin').maybeSingle();
  if(error)throw Error('Unable to verify administrator permissions: '+error.message);
  return Boolean(data);
}
async function enter(session){
  show('login',false); show('dashboard',false);
  if(!session?.user){currentUser=null;show('login',true);return;}
  try{
    if(!await checkAdmin(session.user)){
      await db.auth.signOut();currentUser=null;show('login',true);
      message('loginMessage','This account does not have administrator access.',true);return;
    }
    currentUser=session.user;$('accountEmail').textContent=session.user.email||'Administrator';
    show('dashboard',true);await loadRequests();
  }catch(err){currentUser=null;show('login',true);message('loginMessage',err.message,true);}
}
async function countRequests(status){
  let query=db.from('site_update_requests').select('id',{count:'exact',head:true}).eq('status',status);
  const {count,error}=await query;
  if(error)throw error;
  return count??0;
}
async function loadRequests(){
  if(!currentUser||busy)return;
  setBusy(true);if(!$('dashboardMessage').textContent || $('dashboardMessage').textContent==='Loading requests…')message('dashboardMessage','Loading requests…');
  try{
    const [pending,approved,rejected]=await Promise.all([
      countRequests('pending'),countRequests('approved'),countRequests('rejected')
    ]);
    $('pendingCount').textContent=String(pending);
    $('approvedCount').textContent=String(approved);
    $('rejectedCount').textContent=String(rejected);
    const status=$('statusFilter').value;
    const site=$('siteFilter').value.trim();
    let query=db.from('site_update_requests')
      .select('id,submission_id,technician_name,carrier,province,site_code,field_name,action,original_value,proposed_value,reason,status,submitted_at,reviewed_at,reviewed_by,published_at,published_commit_sha',{count:'exact'});
    if(status!=='all')query=query.eq('status',status);
    if(site)query=query.ilike('site_code','%'+site.replace(/[%,()]/g,'')+'%');
    const {data,error,count}=await query.order('submitted_at',{ascending:false}).order('id',{ascending:false}).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
    if(error)throw error;
    totalMatching=count??0;
    if(page>0&&page*PAGE_SIZE>=totalMatching){page=Math.max(0,Math.ceil(totalMatching/PAGE_SIZE)-1);return await reloadAfterPageCorrection();}
    requests=data||[];
    if($('dashboardMessage').textContent==='Loading requests…')message('dashboardMessage','');
    render();
    updatePagination();
  }catch(err){message('dashboardMessage','Unable to load requests: '+errorText(err),true);$('submissions').replaceChildren();}
  finally{setBusy(false);}
}
async function reloadAfterPageCorrection(){
  // A page can become empty when a request changes status; reload at the last valid page.
  const status=$('statusFilter').value,site=$('siteFilter').value.trim();
  let query=db.from('site_update_requests')
    .select('id,submission_id,technician_name,carrier,province,site_code,field_name,action,original_value,proposed_value,reason,status,submitted_at,reviewed_at,reviewed_by,published_at,published_commit_sha');
  if(status!=='all')query=query.eq('status',status);
  if(site)query=query.ilike('site_code','%'+site.replace(/[%,()]/g,'')+'%');
  const {data,error}=await query.order('submitted_at',{ascending:false}).order('id',{ascending:false}).range(page*PAGE_SIZE,(page+1)*PAGE_SIZE-1);
  if(error)throw error;
  requests=data||[];message('dashboardMessage','');render();updatePagination();
}
function updatePagination(){
  const pages=Math.ceil(totalMatching/PAGE_SIZE);
  show('pagination',pages>1);
  $('pageInfo').textContent='Page '+(page+1)+' of '+Math.max(1,pages)+' · '+totalMatching+' matching requests';
  $('previousPage').disabled=busy||page===0;
  $('nextPage').disabled=busy||(page+1)>=pages;
}
function errorText(err){
  if(typeof err==='string')return err;
  if(err?.message&&err.message!=='[object Object]')return err.message;
  if(err?.error_description)return err.error_description;
  if(err?.error)return errorText(err.error);
  try{return JSON.stringify(err)||'Unknown error';}catch{return 'Unknown error';}
}
function valueBlock(label,value,proposed=false){
  const box=document.createElement('div');box.append(text('div',label,'value-label'));
  const v=text('div',value==null||value===''?(proposed?'(removed or empty)':'(empty)'):value,'value'+(proposed?' proposed':''));
  if(value==null||value==='')v.classList.add('empty');box.append(v);return box;
}
function copySubmissionId(value,button){
  const original=button.textContent;
  navigator.clipboard.writeText(String(value)).then(()=>{
    button.textContent='Copied';setTimeout(()=>button.textContent=original,1300);
  }).catch(()=>window.prompt('Copy submission ID',String(value)));
}
function render(){
  const groups=new Map();
  for(const r of requests){const key=r.submission_id||r.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const root=$('submissions');root.replaceChildren();
  if(!groups.size){root.append(text('div','No matching requests.','empty-state'));return;}
  for(const [submissionId,items] of groups){
    const first=items[0];const section=document.createElement('details');section.className='submission submission-compact';
    const head=document.createElement('summary');head.className='submission-summary';
    const main=document.createElement('div');main.className='submission-main';
    main.append(text('strong',first.site_code||'Unknown site','submission-site'));
    const siteName=text('span','','submission-site-name');main.append(siteName);showSiteName(siteName,first);
    main.append(text('span',String(first.carrier||'').toLowerCase()==='rogers'?'SR':'ST','submission-carrier'));
    const sub=text('div',(first.technician_name||'Unknown technician')+' · '+date(first.submitted_at)+' · '+items.length+' change'+(items.length===1?'':'s'),'submission-meta');
    const heading=document.createElement('div');heading.className='submission-heading';heading.append(main,sub);
    head.append(heading);
    const statuses=[...new Set(items.map(i=>i.status))];
    const status=statuses.length===1?statuses[0]:'Mixed';
    const right=document.createElement('span');right.className='submission-summary-right';
    right.append(text('span',status,'status-pill status-'+status.toLowerCase()));
    if(status==='approved' && items.some(i=>!i.published_at))right.append(text('span','Not published','publication-note'));
    right.append(text('span','⌄','submission-chevron'));head.append(right);section.append(head);
    const body=document.createElement('div');body.className='submission-body';
    const idRow=document.createElement('div');idRow.className='submission-id-row';
    idRow.append(text('span','Submission ID','metadata'),text('code',submissionId,'submission-id'));
    const copy=text('button','Copy ID','copy-id');copy.type='button';copy.addEventListener('click',()=>copySubmissionId(submissionId,copy));idRow.append(copy);body.append(idRow);
    const list=document.createElement('div');list.className='change-list';
    for(const r of items){
      const card=document.createElement('article');card.className='change';
      const top=document.createElement('div');top.className='change-top';top.append(text('h3',r.field_name||'Field'),text('span',r.action||'Change','action'));card.append(top);
      card.append(valueBlock('Original',r.original_value));card.append(valueBlock('Proposed',r.proposed_value,true));
      if(r.reason)card.append(valueBlock('Reason',r.reason));
      if(r.status==='pending'){
        const row=document.createElement('div');row.className='decision-row';
        for(const [decision,label,cls] of [['approved','Approve','approve'],['rejected','Reject','reject']]){
          const button=text('button',label,cls);button.type='button';button.disabled=busy;
          button.addEventListener('click',()=>review(r,decision));row.append(button);
        }card.append(row);
      }else{
        card.append(text('p',r.status.charAt(0).toUpperCase()+r.status.slice(1)+' · '+date(r.reviewed_at),'decision-note'));
        if(r.published_at)card.append(text('p','Published '+date(r.published_at),'decision-note'));
        else if(r.status==='approved'){
          const retry=text('button','Retry publishing','copy-id');retry.type='button';retry.disabled=busy;retry.addEventListener('click',()=>publishOne(r));
          card.append(text('p','Not published','decision-note'),retry);
        }
      }
      list.append(card);
    }
    body.append(list);section.append(body);root.append(section);
  }
}
async function publishRequest(id){
  const {data,error}=await db.functions.invoke('publish-approved-updates',{body:{request_id:id}});
  if(error){
    let detail=errorText(error);
    if(error.context?.json){try{const payload=await error.context.json();detail=errorText(payload.error||payload.message||payload);}catch{}}
    throw Error(detail);
  }
  if(data?.error)throw Error(errorText(data.error));
  if(data?.queued!==true)throw Error('Publishing was not queued. Check the request before retrying.');
}
async function publishOne(r){
  if(busy||!currentUser||r.status!=='approved'||r.published_at)return;
  setBusy(true);message('dashboardMessage','Queueing publication for '+r.site_code+'…');
  try{await publishRequest(r.id);message('dashboardMessage','Publishing queued. GitHub Actions will update the site data; refresh to check status.');}
  catch(err){message('dashboardMessage','Publishing failed: '+errorText(err),true);}
  finally{setBusy(false);await loadRequests();}
}
async function review(r,decision){
  if(busy||!currentUser||r.status!=='pending')return;
  const approving=decision==='approved';
  if(!window.confirm('Are you sure you want to '+(approving?'approve and publish':'reject')+' this change for '+r.site_code+'?\n\n'+r.field_name))return;
  setBusy(true);message('dashboardMessage',approving?'Approving and queueing publication…':'Rejecting…');
  try{
    const {error}=await db.rpc('review_site_update',{p_request_id:r.id,p_decision:decision});
    if(error)throw error;
    if(approving){
      try{await publishRequest(r.id);message('dashboardMessage','Approved. Publishing queued in GitHub Actions; refresh to check status.');}
      catch(err){message('dashboardMessage','Approved, but publishing failed: '+errorText(err)+'. Use Retry publishing on the approved request.',true);}
    }else message('dashboardMessage','Rejected.');
  }catch(err){message('dashboardMessage','Decision failed: '+errorText(err),true);}
  finally{setBusy(false);await loadRequests();}
}
$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('signIn');button.disabled=true;message('loginMessage','Signing in…');
  try{const {data,error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;$('password').value='';message('loginMessage','');await enter(data.session);}
  catch(err){message('loginMessage',err.message,true);}finally{button.disabled=false;}
});
$('signOut').addEventListener('click',async()=>{await db.auth.signOut();currentUser=null;show('dashboard',false);show('login',true);message('loginMessage','Signed out.');});
$('refresh').addEventListener('click',loadRequests);
$('statusFilter').addEventListener('change',()=>{page=0;loadRequests();});
$('siteFilter').addEventListener('input',()=>{clearTimeout(searchDelay);searchDelay=setTimeout(()=>{page=0;loadRequests();},350);});
$('previousPage').addEventListener('click',()=>{if(!busy&&page>0){page--;loadRequests();}});
$('nextPage').addEventListener('click',()=>{if(!busy&&(page+1)*PAGE_SIZE<totalMatching){page++;loadRequests();}});
(async()=>{
  if(SUPABASE_PUBLISHABLE_KEY.startsWith('PASTE_')){show('setup',true);return;}
  if(!window.supabase?.createClient){show('setup',true);$('setup').append(text('p','Supabase library could not load. Check your connection.'));return;}
  db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  const {data,error}=await db.auth.getSession();
  if(error){show('login',true);message('loginMessage',error.message,true);return;}
  await enter(data.session);
})();
