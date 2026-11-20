'use strict';
const map=L.map('map',{preferCanvas:true,zoomSnap:0,zoomDelta:0.5}).setView([53.5,-117],5);
const streetTiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const q=document.getElementById('q'),results=document.getElementById('results'),status=document.getElementById('status'),detail=document.getElementById('detail');
const files=['data/BC_TELUS.geojson','data/AB_TELUS.geojson','data/SK_TELUS.geojson','data/BC_Rogers.geojson','data/AB_Rogers.geojson'];
const carrierOf=s=>String(s?.properties?.Carrier||'TELUS').toLowerCase()==='rogers'?'Rogers':'TELUS';
const carrierColor=s=>carrierOf(s)==='Rogers'?'#DA291C':'#4B8BCE';
function carrierBadge(s){const badge=document.createElement('span');badge.className='carrier-badge '+(carrierOf(s)==='Rogers'?'carrier-rogers':'carrier-telus');badge.textContent=carrierOf(s)==='Rogers'?'SR':'ST';badge.title=carrierOf(s);badge.setAttribute('aria-label',carrierOf(s));return badge}
let sites=[],selected=null,matches=[],activeIndex=-1;
let coordinateAnchor=null,coordinateMarker=null;
const provinceEnabled=()=>true;
// Spatial grid: avoids checking every site every time the map moves.
const CELL_SIZE=1;
const spatialGrid=new Map();
function gridKey(x,y){return x+','+y}
function indexSites(){spatialGrid.clear();for(const s of sites){const [lon,lat]=s.geometry.coordinates;const key=gridKey(Math.floor(lon/CELL_SIZE),Math.floor(lat/CELL_SIZE));if(!spatialGrid.has(key))spatialGrid.set(key,[]);spatialGrid.get(key).push(s)}}
function sitesInBounds(bounds){const sw=bounds.getSouthWest(),ne=bounds.getNorthEast(),found=[];
 for(let x=Math.floor(sw.lng/CELL_SIZE);x<=Math.floor(ne.lng/CELL_SIZE);x++)for(let y=Math.floor(sw.lat/CELL_SIZE);y<=Math.floor(ne.lat/CELL_SIZE);y++){
 const cell=spatialGrid.get(gridKey(x,y));if(!cell)continue;for(const s of cell){const [lon,lat]=s.geometry.coordinates;if(bounds.contains([lat,lon])&&provinceEnabled(s))found.push(s)}
 }return found}
const markers=L.layerGroup().addTo(map);
// Portrait preview is non-draggable so vertical swipes scroll the site details.
// Zoom buttons remain interactive; map is initialized after it is visible.
let previewMap=null;
const portraitQuery=window.matchMedia('(max-width:700px) and (orientation:portrait)');
function destroyPreview(){if(previewMap){previewMap.remove();previewMap=null}}
function initializePreview(){
  if(!selected || !portraitQuery.matches || previewMap)return;
  const canvas=sidebarElement.querySelector('.site-map-preview-canvas');
  if(!canvas || !canvas.getBoundingClientRect().width)return;
  const [lon,lat]=selected.geometry.coordinates;
  previewMap=L.map(canvas,{
    zoomControl:true,scrollWheelZoom:false,dragging:false,touchZoom:false,
    doubleClickZoom:false,boxZoom:false,keyboard:false,preferCanvas:true
  }).setView([lat,lon],15);
  if(mapLayerMode==='satellite'&&activeSatelliteProvider)L.tileLayer(activeSatelliteProvider.url,{maxZoom:19,maxNativeZoom:activeSatelliteProvider.maxNativeZoom,attribution:activeSatelliteProvider.attribution}).addTo(previewMap);
  else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(previewMap);
  L.circleMarker([lat,lon],{radius:9,color:carrierColor(selected),fillColor:carrierColor(selected),fillOpacity:1,weight:3}).addTo(previewMap);
  requestAnimationFrame(()=>previewMap?.invalidateSize({pan:false}));
}
function updatePreviewLayout(){
  if(!portraitQuery.matches)destroyPreview();
  else requestAnimationFrame(initializePreview);
  requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}
portraitQuery.addEventListener?.('change',updatePreviewLayout);
window.addEventListener('resize',updatePreviewLayout);
function addSitePreview(parent,lat,lon,siteId){
  const panel=document.createElement('section');panel.className='site-map-preview';
  panel.setAttribute('aria-label','Map location for '+siteId);
  const label=document.createElement('div');label.className='site-map-preview-label';label.textContent='Site location · use + / − to zoom';
  const canvas=document.createElement('div');canvas.className='site-map-preview-canvas';
  panel.append(label,canvas);parent.append(panel);
  // Called from choose() after the site header is attached to the document.
}

const clean=s=>String(s??'').trim();
const normalizeId=s=>clean(s).replace(/^([a-z]{2})\s*0*(\d+)$/i,(_,p,n)=>p.toUpperCase()+n.padStart(6,'0'));
const fold=s=>clean(s).toLocaleLowerCase();
const idOf=s=>normalizeId(s.properties['Site ID']||s.properties.name||'');
// A shared link selects a site without changing the map's normal search behaviour.
const siteLink=id=>{const url=new URL(window.location.href);url.searchParams.set('site',id);return url.href;};
function shareSite(s){copyValue(siteLink(idOf(s)),document.getElementById('shareSiteLink'));}

const workspace=document.getElementById('workspace');
// A single scroll container owns the entire sidebar. Pinning moves the actual
// selected-site card into a direct-child sticky dock (no cloned Leaflet maps).
const pinButton=document.getElementById('pinSidebar');
const sidebarElement=document.getElementById('sidebar');
const pinnedSite=document.getElementById('pinnedSite');
let isPinned=false;
function applyPin(){
  const head=(pinnedSite.querySelector('.site-head')||detail.querySelector('.site-head'));
  if(head){
    if(isPinned){pinnedSite.append(head)}
    else detail.prepend(head);
  }
  sidebarElement.classList.toggle('is-pinned',isPinned);
  pinButton.setAttribute('aria-pressed',String(isPinned));
  const label=isPinned?'Unpin search and site':'Pin search and site at top';
  pinButton.title=label;pinButton.setAttribute('aria-label',label);
  requestAnimationFrame(updatePreviewLayout);
}
pinButton.addEventListener('click',()=>{isPinned=!isPinned;applyPin()});

const collapseButton=document.getElementById('collapseSidebar');
const expandButton=document.getElementById('expandSidebar');
// Familiar close affordance for the Site Explorer, with an accessible, brief hint.
collapseButton.title='Close Site Explorer';
collapseButton.setAttribute('aria-label','Close Site Explorer');
collapseButton.innerHTML='<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
collapseButton.style.display='inline-flex';
collapseButton.style.alignItems='center';
collapseButton.style.justifyContent='center';
const explorerToast=document.createElement('div');
explorerToast.id='explorerReopenHint';
explorerToast.setAttribute('role','status');
explorerToast.setAttribute('aria-live','polite');
explorerToast.textContent='Site Explorer closed. Use the arrow on the map to reopen it.';
explorerToast.style.cssText='position:fixed;left:50%;bottom:24px;transform:translate(-50%,12px);max-width:min(92vw,420px);box-sizing:border-box;padding:11px 16px;border-radius:10px;background:#172b4d;color:#fff;box-shadow:0 6px 24px #0003;font:500 13px/1.45 system-ui,sans-serif;text-align:center;z-index:10000;pointer-events:none;opacity:0;transition:opacity .18s ease,transform .18s ease;';
document.body.append(explorerToast);
let explorerToastTimer;
function showExplorerReopenHint(){
  clearTimeout(explorerToastTimer);
  explorerToast.style.opacity='1';
  explorerToast.style.transform='translate(-50%,0)';
  explorerToastTimer=setTimeout(()=>{
    explorerToast.style.opacity='0';
    explorerToast.style.transform='translate(-50%,12px)';
  },2800);
}
function setSidebarCollapsed(collapsed){
  workspace.classList.toggle('sidebar-collapsed',collapsed);
  collapseButton.setAttribute('aria-expanded',String(!collapsed));
  expandButton.setAttribute('aria-expanded',String(!collapsed));
  window.setTimeout(()=>map.invalidateSize({pan:false}),260);
}
collapseButton.addEventListener('click',()=>{setSidebarCollapsed(true);showExplorerReopenHint();});
expandButton.addEventListener('click',()=>{setSidebarCollapsed(false);clearTimeout(explorerToastTimer);explorerToast.style.opacity='0';});
function card(parent,title,value,open=true,extraClass=''){
  if(!clean(value))return;
  const section=document.createElement('details');section.className='detail-card';section.open=open;
  const heading=document.createElement('summary');heading.textContent=title;section.append(heading);
  const body=document.createElement('div');body.className='card-body';
  const content=document.createElement('div');content.className='content '+extraClass;
  content.textContent=clean(value);body.append(content);section.append(body);parent.append(section);
}
// Clipboard feedback is visible and announced to assistive technology.
async function copyValue(value,button){
  const original=button.getAttribute('aria-label')||button.title||'Copy';
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(value);
    else{
      const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();
      if(!document.execCommand('copy'))throw Error('Copy unavailable');area.remove();
    }
    button.classList.add('copied');button.setAttribute('aria-label','Copied');button.title='Copied';
    const live=document.getElementById('copyStatus');if(live)live.textContent='Copied to clipboard';
    setTimeout(()=>{button.classList.remove('copied');button.setAttribute('aria-label',original);button.title=original},1600);
  }catch(e){const live=document.getElementById('copyStatus');if(live)live.textContent='Unable to copy. Select the text and copy manually.';console.warn(e)}
}
function copyIcon(value,label){
  const b=document.createElement('button');b.type='button';b.className='copy-icon';
  b.setAttribute('aria-label',label);b.title=label;
  b.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  b.addEventListener('click',()=>copyValue(value,b));return b;
}
function coordinatesCard(parent,coordinates){
  const section=document.createElement('section');section.className='detail-card coordinates-card';
  const heading=document.createElement('h3');heading.className='static-heading';heading.textContent='Coordinates';section.append(heading);
  const row=document.createElement('div');row.className='copy-row';
  const value=document.createElement('span');value.className='copyable-value coordinates';value.textContent=coordinates;
  value.title='Click to copy coordinates';value.tabIndex=0;value.setAttribute('role','button');value.setAttribute('aria-label','Copy coordinates '+coordinates);
  value.addEventListener('click',()=>copyValue(coordinates,value));value.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();copyValue(coordinates,value)}});
  row.append(value,copyIcon(coordinates,'Copy coordinates'));section.append(row);parent.append(section);
}
function rogersDimensions(parent,properties){
  const fields=[['Elevation (m)',properties['Elevation (m)']],['Tower Height (m)',properties['Tower Height (m)']]]
    .filter(([,value])=>clean(value));
  if(!fields.length)return;
  const section=document.createElement('section');section.className='detail-card rogers-dimensions';
  for(const [label,value] of fields){
    const item=document.createElement('div');item.className='rogers-dimension';
    const title=document.createElement('span');title.className='rogers-dimension-label';title.textContent=label;
    const number=document.createElement('span');number.className='rogers-dimension-value';number.textContent=clean(value);
    item.append(title,number);section.append(item);
  }
  parent.append(section);
}
function contactsCard(parent,raw,primeTech){
  if(!clean(raw))return;
  const section=document.createElement('section');section.className='detail-card contacts-card';
  const heading=document.createElement('div');heading.className='static-heading section-heading';
  const title=document.createElement('h3');title.textContent='Useful Contact Info';heading.append(title);section.append(heading);
  const body=document.createElement('div');body.className='contact-lines';
  // Launch the dialer or email composer with only the matched contact value. Preserve original text.
  // Display the original contact text unchanged, preserving dates and context.
  const emailRe=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phoneRe=/(?<![\w@])(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}(?:\s*(?:ext\.?|x|extension)\s*\d{1,6})?(?![\w@])/gi;
  const prime=clean(primeTech);
  const primeNormalized=prime.replace(/\s+/g,' ').trim().toLowerCase();
  clean(raw).split(/\r?\n/).forEach(line=>{
    if(primeNormalized && line.replace(/\s+/g,' ').trim().toLowerCase()===primeNormalized)line='Prime Tech: '+line;
    if(!line.trim()){const gap=document.createElement('div');gap.className='contact-gap';body.append(gap);return}
    const row=document.createElement('div');row.className='contact-row';
    const label=document.createElement('span');label.className='contact-text';label.textContent=line;row.append(label);
    const actions=document.createElement('span');actions.className='contact-actions';
    const emails=[...new Set([...line.matchAll(emailRe)].map(m=>m[0]))];
    const phones=[...new Set([...line.matchAll(phoneRe)].map(m=>m[0]))];
    for(const phone of phones){
      const dial=phone.replace(/(?:ext\.?|x|extension)\s*\d{1,6}$/i,'').replace(/[^\d+]/g,'');
      if(dial.replace(/\D/g,'').length<10)continue;
      const group=document.createElement('span');group.className='contact-action-group';group.setAttribute('aria-label','Phone actions for '+dial);const button=document.createElement('a');button.href='tel:'+dial;button.setAttribute('aria-label','Call '+dial);button.title='Call '+dial;button.classList.add('contact-copy','contact-phone');button.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.7L7.1 10a16 16 0 0 0 6.9 6.9l1.6-1.9a2 2 0 0 1 1.7-.6l3 .5a2 2 0 0 1 1.7 2Z"/></svg>';group.append(button);
      const copy=copyIcon(dial,'Copy phone number '+dial);copy.classList.add('contact-copy','contact-phone-copy');group.append(copy);actions.append(group);
    }
    for(const email of emails){const group=document.createElement('span');group.className='contact-action-group';group.setAttribute('aria-label','Email actions for '+email);const button=document.createElement('a');button.href='mailto:'+email;button.setAttribute('aria-label','Email '+email);button.title='Email '+email;button.classList.add('contact-copy','contact-email');button.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';group.append(button);const copy=copyIcon(email,'Copy email address '+email);copy.classList.add('contact-copy','contact-email-copy');group.append(copy);actions.append(group)}
    // No action for lines without a recognizable phone or email.
    if(actions.childElementCount)row.append(actions);
    body.append(row);
  });section.append(body);parent.append(section);
}

// Site update submissions: public site key only. Never put the Turnstile secret in client code.
// GitHub-controlled frontend switch; fail closed if configuration is unavailable.
let azmSiteUpdatesEnabled = false;
async function loadAzmSiteUpdateConfig() {
  try {
    const response = await fetch('config.json', { cache: 'no-store' });
    if (!response.ok) throw Error('Configuration unavailable');
    const config = await response.json();
    azmSiteUpdatesEnabled = config.siteUpdatesEnabled === true;
  } catch (error) {
    azmSiteUpdatesEnabled = false;
    console.warn('Site updates disabled: configuration could not be loaded.', error);
  }
  if (!azmSiteUpdatesEnabled) updateDraft = null;
  if (selected) choose(selected);
}
const AZM_UPDATE_ENDPOINT = 'https://arkclxdnknhcybganauj.supabase.co/functions/v1/submit-site-update';
const AZM_TURNSTILE_SITE_KEY = '0x4AAAAAAGFfIzZUSa6BY0z6';
let azmTurnstileLoader = null;
function loadAzmTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (azmTurnstileLoader) return azmTurnstileLoader;
  azmTurnstileLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => window.turnstile ? resolve(window.turnstile) : reject(Error('Verification could not load.'));
    script.onerror = () => reject(Error('Verification could not load. Check your connection.'));
    document.head.append(script);
  }).catch(error => { azmTurnstileLoader = null; throw error; });
  return azmTurnstileLoader;
}
function azmProvince(site) {
  const explicit = String(site.properties.Province || '').trim().toUpperCase();
  if (['BC', 'AB', 'SK'].includes(explicit)) return explicit;
  return idOf(site).slice(0, 2).toUpperCase();
}
function azmSubmissionChanges(changes) {
  return changes.map(change => ({
    field_name: change.field,
    action: change.action,
    original_value: change.action === 'add' ? null : change.oldValue,
    proposed_value: change.action === 'remove' ? null : change.newValue
  }));
}

// Site update proposals are saved only after server verification and approval.
let updateDraft=null;
function updateButton(label,handler,variant=''){
  const button=document.createElement('button');button.type='button';
  button.className='azm-edit-btn '+variant;button.textContent=label;
  button.addEventListener('click',handler);return button;
}
function updateKey(field,index){return field+'::'+(index===null?'field':index)}
function updateChanges(){
  if(!updateDraft)return;
  updateDraft.changes=new Map();
  // Contacts are one GeoJSON string, not separate database fields. Build a
  // single proposal containing the complete resulting string, so approval
  // stores precisely what the existing site card will display.
  const contactEntries=updateDraft.entries.filter(e=>e.field==='Useful Contact Info');
  for(const entry of updateDraft.entries){
    if(entry.field==='Useful Contact Info')continue;
    const value=entry.input.value;
    if(value===entry.original)continue;
    if(entry.original==='' && value.trim()==='')continue;
    updateDraft.changes.set(updateKey(entry.field,entry.index),{
      field:entry.field,index:entry.index,oldValue:entry.original,newValue:value,
      action:entry.original===''?'add':value.trim()===''?'remove':'replace'
    });
  }
  if(contactEntries.length){
    const original=updateDraft.contactOriginal||'';
    const parts=contactEntries.map(e=>e.input.value.trim()).filter(Boolean);
    // Preserve the original contact block byte-for-byte when editing only new entries.
    // Always separate newly added contacts with a blank line, even for legacy records.
    const separator='\n\n';
    const unchangedExisting=contactEntries.filter(e=>!String(e.index).startsWith('new-')).every(e=>e.input.value===e.original);
    const newParts=contactEntries.filter(e=>String(e.index).startsWith('new-')).map(e=>e.input.value.trim()).filter(Boolean);
    const next=unchangedExisting && original.trim()
      ? [original, ...newParts].join(separator)
      : parts.join(separator);
    if(next!==original){
      updateDraft.changes.set(updateKey('Useful Contact Info',null),{
        field:'Useful Contact Info',index:null,oldValue:original,newValue:next,
        action:!original.trim()?'add':!next?'remove':'replace'
      });
    }
  }
  if(updateDraft.submitButton)updateDraft.submitButton.disabled=updateDraft.changes.size===0;
}
function startSiteEdit(){
  if(!selected || !azmSiteUpdatesEnabled)return;
  updateDraft={site:selected,entries:[],changes:new Map(),review:false,name:'',submitButton:null,contactOriginal:'',contactSeparator:'\n\n'};
  renderUpdateMode();
}
function discardSiteEdit(){updateDraft=null;choose(selected)}
function createEditableField(container,field,original,index=null,labelText=''){
  if(!document.getElementById('azm-contact-removal-styles')){
    const style=document.createElement('style');
    style.id='azm-contact-removal-styles';
    style.textContent='\n/* Explicit, reversible contact-removal requests in Improve Info. */\n.azm-contact-edit-controls{display:flex;justify-content:flex-end;margin-top:4px}\n.azm-contact-remove{font-size:12px;min-height:32px;padding:5px 10px;color:#a33a36;background:transparent;border:1px solid #e4c7c5;border-radius:6px}\n.azm-contact-remove:hover,.azm-contact-remove:focus-visible{background:#fff0ef}\n.azm-contact-pending-removal .azm-live-input{opacity:.55;text-decoration:line-through;background:#f5f6f7}\n.azm-contact-pending-removal .azm-contact-remove{color:#17639c;border-color:#bfd5e6}\n.azm-contact-pending-removal .azm-contact-remove:hover,.azm-contact-pending-removal .azm-contact-remove:focus-visible{background:#eaf4fc}\n';
    document.head.append(style);
  }
  const wrap=document.createElement('div');wrap.className='azm-live-field';
  if(labelText){const label=document.createElement('label');label.className='azm-live-label';label.textContent=labelText;wrap.append(label)}
  const input=document.createElement('textarea');input.className='azm-edit-input azm-live-input';
  input.rows=field==='Site Info / Notes'||field==='Site Special Instructions'?5:2;
  input.value=original;input.placeholder=field==='Useful Contact Info'?'Enter contact details':'Enter information';
  input.setAttribute('aria-label',labelText||field);
  wrap.append(input);
  if(field==='Useful Contact Info' && original.trim()){
    const control=updateButton('Remove',()=>{
      const removing=control.dataset.removing!=='true';
      control.dataset.removing=String(removing);
      control.textContent=removing?'Undo':'Remove';
      control.setAttribute('aria-label',(removing?'Undo removal of ':'Remove ')+(labelText||'contact'));
      if(removing)wrap.dataset.previousValue=input.value;
      input.value=removing?'':(wrap.dataset.previousValue??original);
      input.disabled=removing;
      wrap.classList.toggle('azm-contact-pending-removal',removing);
      updateChanges();
    });
    control.classList.add('azm-contact-remove');
    control.setAttribute('aria-label','Remove '+(labelText||'contact'));
    const controls=document.createElement('div');
    controls.className='azm-contact-edit-controls';
    controls.append(control);
    wrap.append(controls);
    input.addEventListener('input',()=>{
      // Editing after an undo keeps the normal replace workflow.
      if(control.dataset.removing==='true')return;
      updateChanges();
    });
  }else{
    input.addEventListener('input',updateChanges);
  }
  container.append(wrap);
  updateDraft.entries.push({field,index,original,input});
  return input;
}
function addContactField(container,focus=false){
  const index='new-'+updateDraft.entries.length;
  const input=createEditableField(container,'Useful Contact Info','',index,'New contact');
  if(focus)input.focus();
  return input;
}
function renderUpdateMode(){
  if(!selected||!updateDraft||!azmSiteUpdatesEnabled)return;
  // Rebuild the existing site presentation once, then replace display content in place.
  choose(selected);
  if(!updateDraft||updateDraft.site!==selected)return;
  updateDraft.entries=[];updateDraft.changes=new Map();updateDraft.submitButton=null;
  const header=pinnedSite.querySelector('.site-head')||detail.querySelector('.site-head');
  if(!header)return;
  detail.querySelectorAll('.azm-improve-section').forEach(node=>node.remove());
  const notice=document.createElement('p');notice.className='azm-edit-notice azm-live-notice';
  notice.textContent='Changes require admin approval.';
  if(updateDraft.review){renderUpdateConfirmation(header,notice);return}
  // The address is replaced, not repeated beneath its original text.
  const address=header.querySelector('.address');
  if(address){
    const row=address.closest('.identity-row')||address;
    const container=document.createElement('div');container.className='azm-live-address';
    createEditableField(container,'Site Address',String(selected.properties['Site Address']||''),null,'Site address');
    row.replaceWith(container);
  }else{
    const container=document.createElement('div');container.className='azm-live-address';
    createEditableField(container,'Site Address','',null,'Site address');
    header.append(container);
  }
  // Replace the notes content inside its original card.
  let notes=[...detail.querySelectorAll('details.detail-card')].find(el=>el.querySelector('summary')?.textContent==='Site Information & Notes');
  if(!notes){notes=document.createElement('details');notes.className='detail-card';notes.open=true;
    const summary=document.createElement('summary');summary.textContent='Site Information & Notes';notes.append(summary);
    const contacts=detail.querySelector('.contacts-card');if(contacts)contacts.before(notes);else detail.prepend(notes);
  }
  notes.open=true;
  notes.querySelectorAll(':scope > :not(summary)').forEach(el=>el.remove());
  const notesBody=document.createElement('div');notesBody.className='azm-live-card-body';
  createEditableField(notesBody,'Site Info / Notes',String(selected.properties['Site Info / Notes']||''));
  notes.append(notesBody);
  // Only edit Site Special Instructions when the site already has content.
  if(clean(selected.properties['Site Special Instructions'])){
    const instructions=[...detail.querySelectorAll('details.detail-card')].find(el=>el.querySelector('summary')?.textContent==='Site Special Instructions');
    if(instructions){
      instructions.open=true;
      instructions.querySelectorAll(':scope > :not(summary)').forEach(el=>el.remove());
      const instructionsBody=document.createElement('div');instructionsBody.className='azm-live-card-body';
      createEditableField(instructionsBody,'Site Special Instructions',String(selected.properties['Site Special Instructions']));
      instructions.append(instructionsBody);
    }
  }
  // Keep the contact card in its original location, replacing its rows with textareas.
  let contacts=detail.querySelector('.contacts-card');
  if(!contacts){contacts=document.createElement('section');contacts.className='detail-card contacts-card';
    const heading=document.createElement('div');heading.className='static-heading section-heading';
    const h=document.createElement('h3');h.textContent='Useful Contact Info';heading.append(h);contacts.append(heading);
    notes.after(contacts);
  }
  contacts.querySelectorAll(':scope > :not(.section-heading)').forEach(el=>el.remove());
  const contactArea=document.createElement('div');contactArea.className='azm-live-contacts';
  // Contact entries are separated by blank lines. Single line breaks belong to
  // the same contact (for example, a name followed by a telephone number).
  // Never split an individual contact into independent removal requests.
  const rawContacts=String(selected.properties['Useful Contact Info']||'');
  updateDraft.contactOriginal=rawContacts;
  // Preserve the site's existing formatting. Blank lines delimit contacts
  // where present. Without delimiters, keep the legacy text together rather
  // than guessing that each name/phone line is a separate person.
  updateDraft.contactSeparator=/\r?\n[\t ]*\r?\n/.test(rawContacts)?'\n\n':'\n';
  const contactEntries=rawContacts.trim()
    ? rawContacts.trim().split(/\r?\n[\t ]*\r?\n+/).map(value=>value.trim()).filter(Boolean)
    : [];
  contactEntries.forEach((entry,index)=>{
    createEditableField(contactArea,'Useful Contact Info',entry,index,'Contact '+(index+1));
  });
  const add=updateButton('+ Add Contact',()=>addContactField(contactArea,true));add.classList.add('azm-add-contact');
  const addRow=document.createElement('div');addRow.className='azm-add-contact-row';addRow.append(add);
  // Keep the add control in the same normal-flow column as the contact inputs.
  // This prevents it from drifting into the next site-information section.
  contactArea.append(addRow);
  contacts.append(contactArea);
  // Controls follow the existing site details; no duplicated edit panel.
  const footer=document.createElement('section');footer.className='azm-live-footer';
  footer.append(notice);
  const actions=document.createElement('div');actions.className='azm-edit-footer';
  const submit=updateButton('Submit',()=>{updateChanges();if(!updateDraft.changes.size)return;
    updateDraft.review=true;renderUpdateConfirmation(header,notice);},'primary');
  submit.disabled=true;updateDraft.submitButton=submit;
  actions.append(updateButton('Cancel',discardSiteEdit),submit);footer.append(actions);detail.append(footer);
  // Editing is local and does not alter the underlying GeoJSON.
}
function renderUpdateConfirmation(header,notice){
  updateChanges();
  const draft=updateDraft;
  const changes=[...draft.changes.values()];
  const savedEntries=draft.entries;
  const originalChildren=[...detail.children];
  for(const node of originalChildren)if(node!==header)node.classList.add('azm-edit-hidden');
  header.querySelectorAll('.azm-live-address').forEach(el=>el.classList.add('azm-edit-hidden'));
  const previous=detail.querySelector('.azm-confirm-panel');if(previous)previous.remove();
  const panel=document.createElement('section');panel.className='azm-edit-panel azm-confirm-panel';
  const heading=document.createElement('h3');heading.textContent='Confirm changes';panel.append(heading,notice.cloneNode(true));
  for(const change of changes){
    const item=document.createElement('div');item.className='azm-review-item';
    const title=document.createElement('strong');title.textContent=change.field;item.append(title);
    const before=document.createElement('div');before.className='azm-review-before';before.textContent='Before: '+(change.oldValue||'(empty)');
    const after=document.createElement('div');after.className='azm-review-after';after.textContent='After: '+(change.newValue.trim()||'(removed)');
    item.append(before,after);panel.append(item);
  }
  const label=document.createElement('label');label.className='azm-name-label';label.textContent='Your name *';
  const name=document.createElement('input');name.type='text';name.maxLength=120;name.autocomplete='name';
  name.placeholder='Full name';name.value=draft.name;
  label.append(name);panel.append(label);
  const verification=document.createElement('div');verification.className='azm-turnstile';
  verification.setAttribute('aria-label','Human verification');
  panel.append(verification);
  const message=document.createElement('p');message.className='azm-submit-message';
  message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  panel.append(message);
  const footer=document.createElement('div');footer.className='azm-edit-footer';
  const confirm=updateButton('Confirm & Submit',submit,'primary');
  const back=updateButton('Back',()=>{
    if(submitting)return;
    if(widgetId!==null && window.turnstile)window.turnstile.remove(widgetId);
    draft.review=false;
    panel.remove();
    for(const node of originalChildren)node.classList.remove('azm-edit-hidden');
    header.querySelectorAll('.azm-live-address').forEach(el=>el.classList.remove('azm-edit-hidden'));
    draft.entries=savedEntries;updateChanges();
  });
  const cancel=updateButton('Cancel',()=>{
    if(submitting)return;
    if(widgetId!==null && window.turnstile)window.turnstile.remove(widgetId);
    discardSiteEdit();
  });
  footer.append(back,cancel,confirm);panel.append(footer);
  detail.prepend(panel);
  let token='',widgetId=null,submitting=false;
  const isCurrent=()=>updateDraft===draft && panel.isConnected;
  function setMessage(text,isError=false){
    message.textContent=text;
    message.classList.toggle('is-error',isError);
  }
  function syncConfirm(){
    confirm.disabled=submitting || name.value.trim().length<2 || name.value.trim().length>120 || !token;
  }
  name.addEventListener('input',()=>{draft.name=name.value;syncConfirm()});
  syncConfirm();
  setMessage('Loading verification…');
  loadAzmTurnstile().then(turnstile=>{
    if(!isCurrent())return;
    setMessage('');
    widgetId=turnstile.render(verification,{
      sitekey:AZM_TURNSTILE_SITE_KEY,
      theme:'auto',
      size:'flexible',
      callback(value){token=value;syncConfirm()},
      'expired-callback'(){token='';syncConfirm();setMessage('Verification expired. Please verify again.',true)},
      'error-callback'(){token='';syncConfirm();setMessage('Verification unavailable. Please retry.',true)}
    });
  }).catch(error=>{if(isCurrent())setMessage(error.message,true)});
  async function submit(){
    if(submitting || !token || !isCurrent() || !azmSiteUpdatesEnabled)return;
    const technicianName=name.value.trim();
    if(technicianName.length<2 || technicianName.length>120){setMessage('Enter your name (2–120 characters).',true);return}
    const payload={
      technician_name:technicianName,
      carrier:carrierOf(draft.site),
      province:azmProvince(draft.site),
      site_code:idOf(draft.site),
      changes:azmSubmissionChanges(changes),
      turnstile_token:token
    };
    submitting=true;syncConfirm();back.disabled=true;cancel.disabled=true;
    setMessage('Submitting changes…');
    try{
      const response=await fetch(AZM_UPDATE_ENDPOINT,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || result.success===false){
        throw Error(result.error || 'Submission failed. Please try again.');
      }
      if(!isCurrent())return;
      if(widgetId!==null && window.turnstile)window.turnstile.remove(widgetId);
      updateDraft=null;
      panel.replaceChildren();
      const success=document.createElement('h3');success.textContent='Submitted for approval';
      const description=document.createElement('p');
      description.textContent=changes.length+' proposed change'+(changes.length===1?' has':'s have')+' been sent to the admin. Site information will remain unchanged until approved.';
      panel.append(success,description);
      const done=updateButton('Done',()=>choose(selected),'primary');
      panel.append(done);
      panel.scrollIntoView({block:'nearest'});
    }catch(error){
      if(!isCurrent())return;
      setMessage(error.message || 'Unable to submit. Please try again.',true);
      token='';
      if(widgetId!==null && window.turnstile)window.turnstile.reset(widgetId);
    }finally{
      submitting=false;
      if(isCurrent()){back.disabled=false;cancel.disabled=false;syncConfirm()}
    }
  }
  requestAnimationFrame(()=>{panel.scrollIntoView({block:'nearest'})});
}

// Always show the beginning of the newly selected site's details.
// Measure relative to the sidebar scroll container, not offsetTop (which
// depends on positioned ancestors and can leave the panel mid-content).
function resetSelectedSiteScroll(){
  requestAnimationFrame(()=>{
    if(isPinned){sidebarElement.scrollTop=0;return;}
    const sidebarTop=sidebarElement.getBoundingClientRect().top;
    const detailTop=detail.getBoundingClientRect().top;
    sidebarElement.scrollTop=Math.max(0,sidebarElement.scrollTop+detailTop-sidebarTop-12);
  });
}
function choose(s){
  if(updateDraft && updateDraft.site!==s)updateDraft=null;
  destroyPreview();
  selected=s;const p=s.properties,[lon,lat]=s.geometry.coordinates;
  q.value=idOf(s);results.replaceChildren();matches=[];activeIndex=-1;
  status.textContent='';
  // Return a previously pinned card before replacing the detail contents.
  pinnedSite.replaceChildren();
  detail.replaceChildren();
  const head=document.createElement('section');head.className='site-head';
  const idRow=document.createElement('div');idRow.className='identity-row identity-primary';const id=document.createElement('div');id.className='site-id';id.textContent=idOf(s);idRow.append(id,copyIcon(idOf(s),'Copy site code'));const share=document.createElement('button');share.id='shareSiteLink';share.type='button';share.className='copy-icon';share.title='Copy link to this site';share.setAttribute('aria-label','Copy link to this site');share.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5 15.4 6.5M8.6 13.5 15.4 17.5"/></svg>';share.addEventListener('click',()=>copyValue(siteLink(idOf(s)),share));idRow.append(share);const structure=clean(p['Antenna Structure']);const structureLabel=document.createElement('span');structureLabel.className='structure-badge'+(structure?'':' structure-unspecified');structureLabel.textContent=structure||'Not specified';structureLabel.title='Antenna Structure';idRow.append(structureLabel,carrierBadge(s));head.append(idRow);
  const nameRow=document.createElement('div');nameRow.className='identity-row';const h=document.createElement('h2');h.textContent=clean(p['Site Name'])||'Unnamed site';nameRow.append(h);if(clean(p['Site Name']))nameRow.append(copyIcon(clean(p['Site Name']),'Copy site name'));head.append(nameRow);
  if(clean(p['Site Address'])){const address=document.createElement('div');address.className='address';address.textContent=clean(p['Site Address']);const addressRow=document.createElement('div');addressRow.className='identity-row';addressRow.append(address,copyIcon(clean(p['Site Address']),'Copy site address'));head.append(addressRow)}
  addSitePreview(head,lat,lon,idOf(s));
  const actions=document.createElement('div');actions.className='quick-actions';
  const navigate=document.createElement('a');navigate.className='action primary';
  navigate.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lon);
  navigate.target='_blank';navigate.rel='noopener noreferrer';navigate.textContent='↗ Open in Google Maps';actions.append(navigate);
  head.append(actions);
  detail.append(head);
  requestAnimationFrame(initializePreview);
  const coords=clean(p['GPS Coordinates'])||lat+', '+lon;
  coordinatesCard(detail,coords);
  if(carrierOf(s)==='Rogers')rogersDimensions(detail,p);
  card(detail,'Site Information & Notes',p['Site Info / Notes'],true);
  contactsCard(detail,p['Useful Contact Info'],carrierOf(s)==='Rogers'?p['Prime Tech']:'');
  const standard=new Set(['Site ID','Site Name','Site Address','Site Info / Notes','Useful Contact Info','GPS Coordinates','Open in Google Maps','Antenna Structure','name','description','_umap_options']);
  const rogersHidden=new Set(['Carrier','Province','Status','Prime Tech','Coordinate Source','Source PDF','Source Pages','Elevation (m)','Tower Height (m)']);
  for(const [key,value] of Object.entries(p)){
    if(standard.has(key)||(carrierOf(s)==='Rogers'&&rogersHidden.has(key))||key.startsWith('_')||value==null||typeof value==='object')continue;
    card(detail,key,value,false);
  }
  if (azmSiteUpdatesEnabled) {
    const improveSection=document.createElement('div');improveSection.className='azm-improve-section';
    const improve=updateButton('Improve Info',startSiteEdit);
    improve.classList.add('azm-edit-launch');
    improveSection.append(improve);detail.append(improveSection);
  }
  const live=document.createElement('div');live.id='copyStatus';live.className='sr-only';live.setAttribute('role','status');live.setAttribute('aria-live','polite');detail.append(live);
  applyPin();
  resetSelectedSiteScroll();
  if(workspace.classList.contains('sidebar-collapsed'))setSidebarCollapsed(false);
  // Every site selection, including nearby results and Back to original, centers the map.
  map.stop();
  map.flyTo([lat,lon],15,{duration:.65});
  renderMarkers();
  if(typeof updateNearbyReturn==='function')updateNearbyReturn();
  // Nearby search results remain anchored to the original site until explicitly cleared.
}

function renderMarkers(){
  // No background site dots: sites appear on the map only after the technician
  // selects a site or explicitly runs Nearby Site Finder.
  markers.clearLayers();
  if(selected && provinceEnabled(selected) && !nearbyActive){
    const [lon,lat]=selected.geometry.coordinates;
    L.circleMarker([lat,lon],{radius:10,color:carrierColor(selected),fillColor:carrierColor(selected),fillOpacity:1,weight:3})
      .bindTooltip('Selected · '+idOf(selected)).addTo(markers);
  }
  if(coordinateAnchor && !nearbyActive){coordinateMarker=L.circleMarker(coordinateAnchor,{radius:9,color:'#d97706',weight:3,fillColor:'#f59e0b',fillOpacity:1}).bindTooltip('Coordinate search centre').addTo(markers);}
  renderNearbyHighlights();

}

function updateActive(){
  [...results.querySelectorAll('button')].forEach((b,i)=>{
    b.classList.toggle('active',i===activeIndex);
    b.setAttribute('aria-selected',String(i===activeIndex));
    if(i===activeIndex)b.scrollIntoView({block:'nearest'});
  });
}
function parseCoordinates(raw){
  const m=String(raw||'').trim().match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[,;\s]\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
  if(!m)return null;
  const lat=Number(m[1]),lon=Number(m[2]);
  return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lat,lon]:null;
}
function formatCoordinates(c){return c.map(n=>n.toFixed(5)).join(', ')}
function clearCoordinateAnchor(){coordinateAnchor=null;coordinateMarker=null;}
function showCoordinateAnchor(){
  if(!coordinateAnchor)return;
  updateDraft=null;destroyPreview();selected=null;detail.replaceChildren();pinnedSite.replaceChildren();
  const panel=document.createElement('section');panel.className='detail-card coordinate-location';
  panel.append(textCoordinate('h2','Coordinate location'),textCoordinate('p',formatCoordinates(coordinateAnchor)));
  detail.append(panel);q.value=formatCoordinates(coordinateAnchor);results.replaceChildren();matches=[];
  status.textContent='';
  applyPin();map.stop();map.flyTo(coordinateAnchor,13,{duration:.6});renderMarkers();updateNearbyReturn();
  if(workspace.classList.contains('sidebar-collapsed'))setSidebarCollapsed(false);
}
function textCoordinate(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
function selectCoordinates(coords){
  endNearbyExploration();coordinateAnchor=coords;nearbyRadius.value='0';syncSiteRadiusState();
  if(nearbyMode!=='site')setNearbyMode('site');showCoordinateAnchor();
}
function search(){
  results.replaceChildren();matches=[];activeIndex=-1;
  const term=fold(q.value),normalized=fold(normalizeId(q.value));
  const coords=parseCoordinates(q.value);
  if(coords){status.textContent='';return;}
  if(!term){status.textContent='';return}
  const scored=[];
  for(const s of sites){if(!provinceEnabled(s))continue;const p=s.properties,id=fold(idOf(s)),name=fold(p['Site Name']),address=fold(p['Site Address']);
    let rank=0;
    if(id===normalized||id===term)rank=5;
    else if(id.startsWith(normalized)||id.startsWith(term))rank=4;
    else if(name.startsWith(term))rank=3;
    else if(id.includes(term)||name.includes(term))rank=2;
    else if(address.includes(term))rank=1;
    if(rank)scored.push({s,rank});
  }
  scored.sort((a,b)=>b.rank-a.rank||idOf(a.s).localeCompare(idOf(b.s)));
  matches=scored.slice(0,30).map(x=>x.s);
  status.textContent=scored.length?'':'No matching sites';
  matches.forEach((s,i)=>{const p=s.properties,b=document.createElement('button');b.type='button';b.className='site-result';
    const name=document.createElement('strong');name.textContent=idOf(s)+' — '+clean(p['Site Name']);b.append(name,carrierBadge(s));
    if(clean(p['Site Address'])){const address=document.createElement('span');address.className='result-address';address.textContent=clean(p['Site Address']);b.append(address)}
    b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.addEventListener('click',()=>{q.blur();endNearbyExploration();clearCoordinateAnchor();choose(s)});results.append(b);
  });
}
q.setAttribute('autocomplete','off');q.setAttribute('aria-label','Search by Site ID, site name or address');
results.setAttribute('role','listbox');results.setAttribute('aria-label','Matching sites');
q.addEventListener('input',()=>{endNearbyExploration();search()});
document.getElementById('coordinateSearch')?.addEventListener('click',()=>{const coords=parseCoordinates(q.value);if(coords){q.blur();selectCoordinates(coords);}else search();});
function keepSearchVisible(){
  if(document.activeElement!==q)return;
  const box=q.closest('.search-box');
  if(!box)return;
  box.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
}
q.addEventListener('focus',()=>{endNearbyExploration();requestAnimationFrame(keepSearchVisible)});
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',()=>requestAnimationFrame(keepSearchVisible));
}

q.addEventListener('keydown',e=>{
  if(e.key==='Escape'){results.replaceChildren();matches=[];activeIndex=-1;return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!matches.length)return;e.preventDefault();activeIndex=e.key==='ArrowDown'?(activeIndex+1)%matches.length:(activeIndex<=0?matches.length-1:activeIndex-1);updateActive();return;
  }
  if(e.key==='Enter'){
    // The phone's Done/Go/OK key submits the query, not a site selection.
    // Keep all matches visible until the technician explicitly taps one.
    e.preventDefault();
    q.blur();
    const coords=parseCoordinates(q.value);
    if(coords){selectCoordinates(coords);return;}
    activeIndex=-1;
    updateActive();
    requestAnimationFrame(()=>{
      // The keyboard may still be closing. Keep the query and its results in view.
      const searchBox=q.closest('.search-box');
      if(searchBox && !isPinned){
        sidebarElement.scrollTop=Math.max(0,searchBox.offsetTop+searchBox.parentElement.offsetTop-12);
      }
    });
  }
});
map.on('moveend',renderMarkers);

// Nearby Site Finder — coordinates are searched locally; geocoding is explicit and optional.
const nearbyFinder=document.getElementById('nearbyFinder');
const nearbyDesktopSlot=document.getElementById('nearbyDesktopSlot');
const nearbyMobileSlot=document.getElementById('nearbyMobileSlot');
const nearbyToggle=document.getElementById('nearbyToggle');
const nearbyDesktopHost=document.getElementById('nearbyDesktopHost');
const nearbyMobileQuery=window.matchMedia('(max-width:900px)');
let nearbyPanelOpen=false, nearbyOriginalSite=null;
// A search starts from the selected site only when Find is explicitly pressed.
// Selecting a result never reruns a search or changes the session anchor.
const nearbyReturn=document.createElement('button');
nearbyReturn.type='button';nearbyReturn.className='nearby-return';nearbyReturn.hidden=true;
nearbyFinder.insertBefore(nearbyReturn,nearbyFinder.querySelector('.nearby-heading'));
function updateNearbyReturn(){
 const show=Boolean(nearbyActive && (nearbyOriginalSite?selected!==nearbyOriginalSite:coordinateAnchor&&selected));
 nearbyReturn.hidden=!show;
 if(coordinateAnchor&&!nearbyOriginalSite){nearbyReturn.textContent='← Back to coordinates';nearbyReturn.title='Return to coordinate search centre';nearbyReturn.setAttribute('aria-label',nearbyReturn.title);}
 if(nearbyOriginalSite){
  const id=idOf(nearbyOriginalSite);
  nearbyReturn.textContent='← Back to original · '+id;
  nearbyReturn.title='Return to original site '+id;
  nearbyReturn.setAttribute('aria-label','Return to original site '+id);
 }
 nearbyResults.querySelectorAll('.nearby-result').forEach(button=>{
  const current=Boolean(selected && button.dataset.siteId===idOf(selected));
  button.classList.toggle('is-viewing',current);
  button.setAttribute('aria-current',current?'true':'false');
 });
}
nearbyReturn.addEventListener('click',()=>{
 if(coordinateAnchor&&!nearbyOriginalSite){showCoordinateAnchor();return;}
 if(!nearbyOriginalSite)return;
 choose(nearbyOriginalSite);
 updateNearbyReturn();

});
function setNearbyPanelOpen(open){
 nearbyPanelOpen=Boolean(open);
 nearbyDesktopHost.classList.toggle('is-open',nearbyPanelOpen);
 nearbyToggle.setAttribute('aria-expanded',String(nearbyPanelOpen));
 nearbyToggle.title=nearbyPanelOpen?'Close Nearby Site Finder':'Open Nearby Site Finder';
 nearbyToggle.setAttribute('aria-label',nearbyToggle.title);
}
nearbyToggle.addEventListener('click',()=>setNearbyPanelOpen(!nearbyPanelOpen));
function layoutNearbyFinder(){
 const mobile=nearbyMobileQuery.matches;
 const slot=mobile?nearbyMobileSlot:nearbyDesktopSlot;
 if(nearbyFinder.parentElement!==slot)slot.append(nearbyFinder);
 nearbyDesktopHost.hidden=mobile;
 if(!mobile)nearbyDesktopHost.classList.toggle('is-open',nearbyPanelOpen);
}
nearbyMobileQuery.addEventListener?.('change',layoutNearbyFinder);
window.addEventListener('resize',layoutNearbyFinder);
layoutNearbyFinder();
document.getElementById('nearbyFind').hidden=true;
const nearbyRadius=document.getElementById('nearbyRadius');
const nearbyRadiusControls=document.getElementById('nearbyRadiusControls');
const nearbyRadiusValue=document.getElementById('nearbyRadiusValue');
const nearbyStatus=document.getElementById('nearbyStatus');
const nearbyResults=document.getElementById('nearbyResults');
const nearbyPlace=document.getElementById('nearbyPlace');
const nearbyPlaceRow=document.getElementById('nearbyPlaceRow');
// Fixed office origin: one-tap route to the currently selected site.
// Reuse the existing From Town routing and corridor search; no new routing API.
const HOME_ORIGIN=Object.freeze({lat:49.21893260057106,lon:-122.97955062711837});
const nearbyPlaceLabel=nearbyPlaceRow.querySelector('label[for="nearbyPlace"]');
const nearbyHomeHeader=document.createElement('div');
nearbyHomeHeader.className='nearby-home-header';
nearbyPlaceLabel.before(nearbyHomeHeader);
nearbyHomeHeader.append(nearbyPlaceLabel);
const nearbyHomeButton=document.createElement('button');
nearbyHomeButton.type='button';
nearbyHomeButton.className='nearby-home-button';
nearbyHomeButton.title='Show the route from the AZM West office to the selected site, including other sites along the way.';
nearbyHomeButton.setAttribute('aria-label','Show the route from the AZM West office to the selected site, including other sites along the way');
nearbyHomeButton.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2"/><path d="M9 19h7a4 4 0 0 0 0-8h-8a4 4 0 0 1 0-8h7"/><path d="m13 1 3 2-3 2"/></svg><span>From Base</span>';
nearbyHomeHeader.append(nearbyHomeButton);
const nearbyHomeStyle=document.createElement('style');
nearbyHomeStyle.textContent=`
.nearby-home-header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;margin-bottom:5px}
.nearby-home-header label{margin:0;min-width:0}
.nearby-home-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;flex:0 0 auto;padding:4px 7px;border:1px solid transparent;border-radius:6px;background:transparent;color:#2465a0;font:inherit;font-size:12px;font-weight:600;line-height:1.3;cursor:pointer;min-height:36px}
.nearby-home-button:hover{background:#edf4fc;border-color:#d4e4f5}
.nearby-home-button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}
.nearby-home-button:disabled{opacity:.5;cursor:wait}
@media (pointer:coarse){.nearby-home-button{min-height:44px;min-width:44px;padding:9px 10px}}
`;
document.head.append(nearbyHomeStyle);
const nearbyRouteRadius=document.getElementById('nearbyRouteRadius');
const nearbyRouteRadiusValue=document.getElementById('nearbyRouteRadiusValue');
const nearbySuggestions=document.getElementById('nearbySuggestions');
let townSuggestion=null,townTimer=null,townAbort=null,townSequence=0;
let cachedRoute=null,cachedRouteDistance=0,cachedRouteTown='',cachedRouteOrigin=null;
const nearbyModeButtons=[...document.querySelectorAll('[data-nearby-mode]')];
const nearbyHighlightLayer=L.layerGroup().addTo(map);
const nearbyShapeLayer=L.layerGroup().addTo(map);
let nearbyMode='site',nearbyActive=false,nearbyFound=[],nearbyOrigin=null,nearbyOriginLabel='',nearbyRequest=0;
let settlementAutoLabel='';
const radians=n=>n*Math.PI/180;
function distanceKm(a,b){const dLat=radians(b[0]-a[0]),dLon=radians(b[1]-a[1]);const h=Math.sin(dLat/2)**2+Math.cos(radians(a[0]))*Math.cos(radians(b[0]))*Math.sin(dLon/2)**2;return 12742*Math.asin(Math.min(1,Math.sqrt(h)))}
function distanceToSegmentKm(point,a,b){ // Local equirectangular projection: short-range corridor approximation.
 const lat0=radians((a[0]+b[0]+point[0])/3),scale=111.195;
 const xy=p=>[p[1]*Math.cos(lat0)*scale,p[0]*scale];const [px,py]=xy(point),[ax,ay]=xy(a),[bx,by]=xy(b);
 const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
 return Math.hypot(px-ax-t*dx,py-ay-t*dy);
}
function nearbyDistanceLabel(km){return km<1?Math.round(km*1000)+' m':km.toFixed(2)+' km'}
function routeRadiusLabel(){const m=Number(nearbyRouteRadius.value);return m<1000?m+' m':(m/1000).toFixed(1)+' km'}
function radiusLabel(){const m=Number(nearbyRadius.value);return m===0?'Not active':m<1000?m+' m':(m/1000).toFixed(1)+' km'}
function syncSiteRadiusState(){
 const active=Number(nearbyRadius.value)>0;
 nearbyRadiusControls.classList.toggle('is-inactive',!active);
 nearbyRadius.classList.toggle('is-inactive',!active);
 nearbyRadiusValue.textContent=radiusLabel();
 nearbyRadius.setAttribute('aria-valuetext',active?radiusLabel():'Not active; move slider to find nearby sites');
}
function setNearbyMode(mode){
 nearbyMode=mode;
 nearbyPlaceRow.hidden=mode!=='settlement';nearbyRadiusControls.hidden=mode!=='site';
 document.getElementById('nearbyFind').hidden=mode==='site';
 nearbyModeButtons.forEach(button=>{const active=button.dataset.nearbyMode===mode;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));});
 clearNearby(false);
 if(mode!=='site'){nearbyRadius.value='0';}
 syncSiteRadiusState();
 nearbyStatus.textContent=mode==='site'?'Move the radius slider to find sites.':'Enter your starting town and find sites along the driving route to the selected site.';
}
function clearNearby(resetText=true){
 nearbyRequest++;nearbyActive=false;nearbyFound=[];nearbyOrigin=null;
 nearbyOriginalSite=null;nearbyResults.replaceChildren();
 nearbyHighlightLayer.clearLayers();nearbyShapeLayer.clearLayers();
 updateNearbyReturn();if(resetText)nearbyStatus.textContent='Nearby results cleared.';
 renderMarkers();
}
function endNearbyExploration(){
 // Starting a main-sidebar search ends radius exploration completely.
 clearTimeout(radiusSearchTimer);
 cancelAnimationFrame(radiusFrame);
 if(Number(nearbyRadius.value)!==0){nearbyRadius.value='0';syncSiteRadiusState();}
 if(nearbyActive || nearbyOriginalSite || nearbyShapeLayer.getLayers().length)clearNearby();
}

function selectNearbyResult(site){
 // Navigation only: retain the anchor, results, radius and highlights.
 choose(site);
 updateNearbyReturn();

}
function renderNearbyHighlights(){
 nearbyHighlightLayer.clearLayers();if(!nearbyActive)return;
 // Draw distinct nearby markers. Current result is a larger, double-ringed marker.
 for(const item of nearbyFound){
  const s=item.s;if(s===nearbyOriginalSite)continue;
  const [lon,lat]=s.geometry.coordinates,viewing=s===selected;
  L.circleMarker([lat,lon],{radius:viewing?19:15,color:carrierColor(s),weight:0,fillColor:carrierColor(s),fillOpacity:.20,interactive:false}).addTo(nearbyHighlightLayer);
  L.circleMarker([lat,lon],{radius:viewing?11:8,color:viewing?'#fff':carrierColor(s),weight:viewing?4:2.5,fillColor:carrierColor(s),fillOpacity:1,className:viewing?'nearby-viewing-marker':'nearby-glow'}).bindTooltip((viewing?'Viewing · ':'Nearby · ')+carrierOf(s)+' · '+idOf(s)).on('click',()=>selectNearbyResult(s)).addTo(nearbyHighlightLayer);
 }
 // The anchor remains visible, even if the technician is viewing another result.
 // Keep coordinateAnchor for distance calculations and Back, but do not overlay nearby site markers.
 if(nearbyOriginalSite){const [lon,lat]=nearbyOriginalSite.geometry.coordinates;
  L.circleMarker([lat,lon],{radius:12,color:'#fff',weight:3,fillColor:carrierColor(nearbyOriginalSite),fillOpacity:1,className:'nearby-origin-marker'}).bindTooltip('Original · '+carrierOf(nearbyOriginalSite)+' · '+idOf(nearbyOriginalSite)).on('click',()=>selectNearbyResult(nearbyOriginalSite)).addTo(nearbyHighlightLayer);
  L.circleMarker([lat,lon],{radius:4,color:'#7c3900',weight:0,fillColor:'#fff',fillOpacity:1,interactive:false}).addTo(nearbyHighlightLayer);
 }
}

// Route corridor: local projection onto every road segment; return position along route.
function routeProximity(point,route){
 const scale=111.195,lat0=radians(point[0]),cos=Math.cos(lat0);
 const px=point[1]*cos*scale,py=point[0]*scale;
 let best=Infinity,progress=0,acc=0;
 for(let i=1;i<route.length;i++){
  const a=route[i-1],b=route[i];
  const ax=a[1]*cos*scale,ay=a[0]*scale,bx=b[1]*cos*scale,by=b[0]*scale;
  const dx=bx-ax,dy=by-ay,seg=dx*dx+dy*dy;
  const t=seg?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/seg)):0;
  const d=Math.hypot(px-ax-t*dx,py-ay-t*dy);
  if(d<best){best=d;progress=acc+t*distanceKm(a,b)}
  acc+=distanceKm(a,b);
 }
 return {km:best,progress};
}
async function runNearbySearch(){
 if(!sites.length){nearbyStatus.textContent='Site records are still loading.';return}
 const token=++nearbyRequest,sessionAnchor=coordinateAnchor?null:selected;
 if(!sessionAnchor&&!coordinateAnchor){nearbyStatus.textContent='Select a site or enter coordinates first.';return}
 if(nearbyMode==='settlement'&&!sessionAnchor){nearbyStatus.textContent='From Town requires a destination site.';return}
 const destination=coordinateAnchor||[sessionAnchor.geometry.coordinates[1],sessionAnchor.geometry.coordinates[0]];
 const [destLat,destLon]=destination;
 const routeMode=nearbyMode==='settlement';let origin=destination,originLabel=coordinateAnchor?formatCoordinates(coordinateAnchor):idOf(sessionAnchor),route=null,routeDistance=0;
 const radius=Number(routeMode?nearbyRouteRadius.value:nearbyRadius.value)/1000;
 if(!routeMode && radius===0){clearNearby(false);nearbyStatus.textContent='Move the radius slider to find sites.';return}
 const findButton=document.getElementById('nearbyFind');findButton.disabled=true;
 try{
  if(routeMode){
   const query=nearbyPlace.value.trim();
   if(query.length<3)throw Error('Enter your starting town or city.');
   nearbyStatus.textContent='Finding town and driving route…';
   if(townSuggestion && townSuggestion.query===query){
    origin=[townSuggestion.lat,townSuggestion.lon];originLabel=townSuggestion.label;
   }else{
    const geo=await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q='+encodeURIComponent(query),{headers:{'Accept':'application/json'}});
    if(!geo.ok)throw Error('Town lookup unavailable. Try again later.');
    const places=await geo.json();if(token!==nearbyRequest)return;
    if(!places.length)throw Error('Town not found. Include the province, e.g. Edmonton, AB.');
    origin=[Number(places[0].lat),Number(places[0].lon)];originLabel=places[0].display_name.split(',').slice(0,2).join(',');
   }
   // OSRM's public demo endpoint is suitable for prototype testing only.
   const url='https://router.project-osrm.org/route/v1/driving/'+origin[1]+','+origin[0]+';'+destLon+','+destLat+'?overview=full&geometries=geojson&steps=false';
   const response=await fetch(url);if(!response.ok)throw Error('Driving-route service unavailable. Try again later.');
   const data=await response.json();if(token!==nearbyRequest)return;
   if(data.code!=='Ok'||!data.routes?.length)throw Error('No driving route found between town and destination.');
   route=data.routes[0].geometry.coordinates.map(([lon,lat])=>[lat,lon]);
   routeDistance=data.routes[0].distance/1000;
   cachedRoute=route;cachedRouteDistance=routeDistance;cachedRouteTown=query;cachedRouteOrigin=origin;
   if(route.length<2)throw Error('Route geometry is incomplete.');
  }
  if(token!==nearbyRequest)return;
  nearbyOrigin=origin;nearbyOriginLabel=originLabel;nearbyOriginalSite=sessionAnchor;nearbyActive=true;
  nearbyFound=[];
  // Restrict route candidates by bounding rectangle before computing segment distances.
  const bounds=route?L.latLngBounds(route).pad(.035):null;
  for(const s of sites){
   if(sessionAnchor&&s===sessionAnchor)continue;
   const [lon,lat]=s.geometry.coordinates,point=[lat,lon];
   if(bounds&&!bounds.contains(point))continue;
   const result=route?routeProximity(point,route):{km:distanceKm(point,origin),progress:0};
   if(result.km<=radius+1e-8)nearbyFound.push({s,km:result.km,progress:result.progress});
  }
  nearbyFound.sort((a,b)=>route?(a.progress-b.progress||a.km-b.km):(a.km-b.km||idOf(a.s).localeCompare(idOf(b.s))));
  nearbyResults.replaceChildren();nearbyShapeLayer.clearLayers();
  if(route){L.polyline(route,{color:'#0284c7',weight:5,opacity:.85}).addTo(nearbyShapeLayer)}
  else if(radius>0)L.circle(origin,{radius:radius*1000,color:'#0284c7',weight:1.5,fillColor:'#38bdf8',fillOpacity:.07}).addTo(nearbyShapeLayer);
  if(route)L.circleMarker(origin,{radius:7,color:'#fff',weight:2,fillColor:'#0f766e',fillOpacity:1}).bindTooltip('From '+originLabel).addTo(nearbyShapeLayer);
  nearbyStatus.textContent=route?nearbyFound.length+' sites within '+routeRadiusLabel()+' of '+Math.round(routeDistance)+' km driving route · ordered from '+originLabel:nearbyFound.length+' sites within '+radiusLabel()+' of '+originLabel;
  if(!nearbyFound.length){const empty=document.createElement('p');empty.className='nearby-empty';empty.textContent=route?'No sites found within '+routeRadiusLabel()+' of the route. Try a wider corridor.':'No sites found. Try a larger radius.';nearbyResults.append(empty)}
  nearbyFound.slice(0,100).forEach(({s,km})=>{
   const b=document.createElement('button');b.type='button';b.className='nearby-result';b.dataset.siteId=idOf(s);
   const label=document.createElement('span'),name=document.createElement('strong'),sub=document.createElement('small');
   name.textContent=idOf(s);sub.textContent=clean(s.properties['Site Name'])||'Unnamed site';label.append(name,sub);
   const distance=document.createElement('span');distance.className='nearby-distance';distance.textContent=nearbyDistanceLabel(km)+(route?' off route':'');
   b.append(label,distance);b.addEventListener('click',()=>selectNearbyResult(s));nearbyResults.append(b);
  });
  if(nearbyFound.length>100){const note=document.createElement('p');note.className='nearby-empty';note.textContent='Showing first 100 of '+nearbyFound.length+' sites.';nearbyResults.append(note)}
  updateNearbyReturn();renderMarkers();
  if(route)map.fitBounds(L.latLngBounds(route),{padding:[35,35]});
  // Site-radius framing is controlled exclusively by the slider; do not fit result markers.
 }catch(err){if(token===nearbyRequest)nearbyStatus.textContent=err.message||'Route search failed.'}
 finally{findButton.disabled=false}
}
// Keep the blue geographic radius at a consistent visual size as the user
// adjusts the slider. Change map scale, not the map element's CSS dimensions.
// Do not animate successive tile zooms; the browser can repaint naturally.
let radiusFrame=0,radiusSearchTimer=0;
function frameRadiusCircle(anchor,metres){
 const [lon,lat]=anchor.geometry.coordinates;
 const size=map.getSize();
 if(!size.x||!size.y)return;
 // Circle diameter fills ~82% of the shorter viewport dimension.
 const circleRadiusPx=Math.max(24,Math.min(size.x,size.y)*0.41);
 const latitudeRadians=lat*Math.PI/180;
 const metresPerPixel=metres/circleRadiusPx;
 const zoom=Math.max(2,Math.min(19,Math.log2((156543.03392804097*Math.cos(latitudeRadians))/metresPerPixel)));
 map.stop();
 map.setView([lat,lon],zoom,{animate:false,reset:false});
}
function updateNearbyRadius(){
 syncSiteRadiusState();
 if(nearbyMode!=='site')return;
 clearTimeout(radiusSearchTimer);
 cancelAnimationFrame(radiusFrame);
 const metres=Number(nearbyRadius.value);
 if(metres===0){clearNearby(false);nearbyStatus.textContent='Move the radius slider to find sites.';return}
 if((!selected&&!coordinateAnchor)||!sites.length){nearbyStatus.textContent='Select a site or enter coordinates first.';return}
 const anchor=coordinateAnchor?{geometry:{coordinates:[coordinateAnchor[1],coordinateAnchor[0]]}}:(nearbyOriginalSite||selected);
 radiusFrame=requestAnimationFrame(()=>frameRadiusCircle(anchor,metres));
 radiusSearchTimer=setTimeout(()=>{
  if(nearbyMode!=='site'||Number(nearbyRadius.value)===0)return;
  // A new slider value updates the same original site, never the browsed result.
  const viewed=selected;
  if(nearbyOriginalSite)selected=nearbyOriginalSite;
  try{runNearbySearch()}finally{selected=viewed}
 },180);
}
nearbyRadius.addEventListener('input',updateNearbyRadius);
syncSiteRadiusState();
nearbyRouteRadius.addEventListener('input',()=>{
 nearbyRouteRadiusValue.textContent=routeRadiusLabel();
 // Route-corridor changes are staged until the technician explicitly presses Find sites.
 // Preserve existing route, result list, highlights, and map position in the meantime.
 if(nearbyMode==='settlement' && nearbyActive && cachedRoute){
  nearbyStatus.textContent='Corridor changed to '+routeRadiusLabel()+' · Press Find sites to update results.';
 }
});
function refreshRouteCorridor(){
 const route=cachedRoute, radius=Number(nearbyRouteRadius.value)/1000;
 if(!route||!nearbyOriginalSite)return;
 nearbyFound=[];
 const bounds=L.latLngBounds(route).pad(.10);
 for(const site of sites){
  if(site===nearbyOriginalSite)continue;
  const [lon,lat]=site.geometry.coordinates,point=[lat,lon];
  if(!bounds.contains(point))continue;
  const proximity=routeProximity(point,route);
  if(proximity.km<=radius+1e-8)nearbyFound.push({s:site,km:proximity.km,progress:proximity.progress});
 }
 nearbyFound.sort((a,b)=>a.progress-b.progress||a.km-b.km);
 nearbyResults.replaceChildren();
 for(const {s,km} of nearbyFound.slice(0,100)){
  const button=document.createElement('button');button.type='button';button.className='nearby-result';button.dataset.siteId=idOf(s);
  const label=document.createElement('span'),name=document.createElement('strong'),sub=document.createElement('small');
  name.textContent=idOf(s);sub.textContent=clean(s.properties['Site Name'])||'Unnamed site';label.append(name,sub);
  const distance=document.createElement('span');distance.className='nearby-distance';distance.textContent=nearbyDistanceLabel(km)+' off route';
  button.append(label,distance);button.addEventListener('click',()=>selectNearbyResult(s));nearbyResults.append(button);
 }
 if(nearbyFound.length>100){const note=document.createElement('p');note.className='nearby-empty';note.textContent='Showing first 100 of '+nearbyFound.length+' sites.';nearbyResults.append(note)}
 if(!nearbyFound.length){const note=document.createElement('p');note.className='nearby-empty';note.textContent='No sites within '+routeRadiusLabel()+' of route.';nearbyResults.append(note)}
 nearbyStatus.textContent=nearbyFound.length+' sites within '+routeRadiusLabel()+' of '+Math.round(cachedRouteDistance)+' km route';
 renderMarkers();updateNearbyReturn();
}
function hideTownSuggestions(){nearbySuggestions.hidden=true;nearbySuggestions.replaceChildren();nearbyPlace.setAttribute('aria-expanded','false')}
function townLabel(props){return [props.name,props.state,props.country].filter(Boolean).join(', ')}
async function fetchTownSuggestions(query,sequence){
 townAbort?.abort();townAbort=new AbortController();
 try{
  // Photon supports incremental search; do not send per-keystroke requests to Nominatim.
  const response=await fetch('https://photon.komoot.io/api/?limit=6&lang=en&q='+encodeURIComponent(query),{signal:townAbort.signal});
  if(!response.ok)throw Error('Suggestions unavailable');
  const json=await response.json();if(sequence!==townSequence)return;
  const candidates=(json.features||[]).filter(f=>f.properties?.countrycode==='CA' && ['city','town','village','municipality','hamlet','locality'].includes(f.properties?.type || f.properties?.osm_value));
  nearbySuggestions.replaceChildren();
  for(const f of candidates){
   const label=townLabel(f.properties),[lon,lat]=f.geometry.coordinates;
   const option=document.createElement('button');option.type='button';option.className='nearby-suggestion';option.setAttribute('role','option');option.textContent=label;
   option.addEventListener('click',()=>{townSuggestion={query:label,label,lat,lon};nearbyPlace.value=label;hideTownSuggestions();nearbyPlace.blur()});
   nearbySuggestions.append(option);
  }
  nearbySuggestions.hidden=!nearbySuggestions.children.length;
  nearbyPlace.setAttribute('aria-expanded',String(!nearbySuggestions.hidden));
 }catch(error){if(error.name!=='AbortError')hideTownSuggestions()}
}
nearbyPlace.addEventListener('input',()=>{
 townSuggestion=null;settlementAutoLabel='';clearTimeout(townTimer);townAbort?.abort();
 const query=nearbyPlace.value.trim();const sequence=++townSequence;hideTownSuggestions();
 if(query.length>=3)townTimer=setTimeout(()=>fetchTownSuggestions(query,sequence),350);
});
nearbyPlace.addEventListener('keydown',event=>{
 if(event.key==='Escape')hideTownSuggestions();
 if(event.key==='ArrowDown'&&!nearbySuggestions.hidden){event.preventDefault();nearbySuggestions.querySelector('button')?.focus()}
});
nearbySuggestions.addEventListener('keydown',event=>{if(event.key==='Escape'){hideTownSuggestions();nearbyPlace.focus()}});
document.addEventListener('pointerdown',event=>{if(!nearbyPlaceRow.contains(event.target))hideTownSuggestions()});

nearbyHomeButton.addEventListener('click',async()=>{
 if(nearbyMode!=='settlement')return;
 if(!selected||coordinateAnchor){
  nearbyStatus.textContent='Select a destination site first.';
  return;
 }
 clearTimeout(townTimer);
 townAbort?.abort();
 townSequence++;
 hideTownSuggestions();
 townSuggestion={query:'Home',label:'Main location',...HOME_ORIGIN};
 nearbyPlace.value='Home';
 nearbyPlace.blur();
 nearbyHomeButton.disabled=true;
 try{await runNearbySearch()}finally{nearbyHomeButton.disabled=false}
});
nearbyModeButtons.forEach(button=>button.addEventListener('click',()=>setNearbyMode(button.dataset.nearbyMode)));
document.getElementById('nearbyFind').addEventListener('click',()=>{nearbyPlace.blur();runNearbySearch()});
document.getElementById('nearbyClear').addEventListener('click',()=>clearNearby());
nearbyPlace.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();nearbyPlace.blur();runNearbySearch()}});


// Satellite uses only sources with permission for commercial informational use.
// NASA's daily imagery is fresher but low-resolution; the openly licensed
// EOX 2016 mosaic is the high-zoom fallback. Do not use EOX 2018+ (NC license).
let mapLayerMode='map',activeSatelliteProvider=null,satelliteLayer=null;
let satelliteProbeToken=0,satelliteProbeTimer=0;
const SATELLITE_CREDIT_NASA='Imagery: NASA GIBS / NASA Earthdata';
const SATELLITE_CREDIT_EOX='EOxCloudless 2016 by EOX (modified Copernicus Sentinel data 2016 & 2017)';
const satelliteControl=L.control({position:'bottomright'});
satelliteControl.onAdd=()=>{
 const el=L.DomUtil.create('div','azm-layer-toggle leaflet-control');
 const mapButton=document.createElement('button');mapButton.type='button';mapButton.textContent='Map';mapButton.className='is-current';
 const divider=document.createElement('span');divider.textContent='·';divider.setAttribute('aria-hidden','true');
 const satButton=document.createElement('button');satButton.type='button';satButton.textContent='Satellite';satButton.disabled=true;satButton.title='Checking openly licensed imagery…';
 el.append(mapButton,divider,satButton);L.DomEvent.disableClickPropagation(el);L.DomEvent.disableScrollPropagation(el);
 mapButton.addEventListener('click',()=>setMapLayer('map'));
 satButton.addEventListener('click',()=>setMapLayer('satellite'));
 satelliteControl.mapButton=mapButton;satelliteControl.satButton=satButton;
 return el;
};
satelliteControl.addTo(map);
function satelliteTileXY(lat,lon,z){
 const x=Math.floor((lon+180)/360*2**z);
 const rad=Math.max(-85.0511,Math.min(85.0511,lat))*Math.PI/180;
 const y=Math.floor((1-Math.asinh(Math.tan(rad))/Math.PI)/2*2**z);
 return [Math.max(0,Math.min(2**z-1,x)),Math.max(0,Math.min(2**z-1,y))];
}
function probeImage(url){return new Promise(resolve=>{
 const img=new Image();let done=false;
 const finish=ok=>{if(done)return;done=true;clearTimeout(timeout);img.onload=null;img.onerror=null;resolve(ok);};
 const timeout=setTimeout(()=>finish(false),3800);
 img.onload=()=>finish(img.naturalWidth>0&&img.naturalHeight>0);
 img.onerror=()=>finish(false);img.src=url;
});}
function satelliteCandidates(lat,lon,zoom){
 const now=new Date();const list=[];
 // Most recent candidates first; avoid today's frequently incomplete acquisitions.
 for(let days=1;days<=4;days++){
  const day=new Date(now.getTime()-days*86400000).toISOString().slice(0,10);
  for(const source of ['VIIRS_NOAA20_CorrectedReflectance_TrueColor','MODIS_Terra_CorrectedReflectance_TrueColor']){
   const url='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'+source+'/default/'+day+'/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';
   list.push({date:day,url,maxNativeZoom:9,attribution:SATELLITE_CREDIT_NASA,source});
  }
 }
 // EOX 2016 is CC BY 4.0 and can be used commercially with attribution.
 list.push({date:'2016-01-01',url:'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',maxNativeZoom:14,attribution:SATELLITE_CREDIT_EOX,source:'EOX 2016'});
 // At site zoom, NASA's 250 m imagery is too coarse; use 10 m Sentinel mosaic.
 return zoom>11?[list[list.length-1]]:list;
}
async function checkSatelliteAvailability(){
 const token=++satelliteProbeToken;
 const {lat,lng}=map.getCenter(),zoom=map.getZoom();
 const candidates=satelliteCandidates(lat,lng,zoom);
 // Only probe the tile containing the current map centre, not the whole viewport.
 let found=null;
 for(const candidate of candidates){
  const z=Math.min(Math.floor(zoom),candidate.maxNativeZoom);
  const [x,y]=satelliteTileXY(lat,lng,z);
  const tile=candidate.url.replace('{z}',z).replace('{x}',x).replace('{y}',y);
  if(await probeImage(tile)){found=candidate;break;}
  if(token!==satelliteProbeToken)return;
 }
 if(token!==satelliteProbeToken)return;
 activeSatelliteProvider=found;
 satelliteControl.satButton.disabled=!found;
 satelliteControl.satButton.title=found?'Satellite imagery: '+found.source+' ('+found.date+')':'No compatible openly licensed satellite tiles found at this location and zoom';
 if(mapLayerMode==='satellite'){
  if(found)activateSatelliteLayer(found);
  else setMapLayer('map');
 }
}
function scheduleSatelliteCheck(){clearTimeout(satelliteProbeTimer);satelliteProbeTimer=setTimeout(checkSatelliteAvailability,350);}
function activateSatelliteLayer(provider){
 if(satelliteLayer){map.removeLayer(satelliteLayer);satelliteLayer=null;}
 satelliteLayer=L.tileLayer(provider.url,{maxZoom:19,maxNativeZoom:provider.maxNativeZoom,attribution:provider.attribution,keepBuffer:2});
 satelliteLayer.addTo(map);satelliteLayer.bringToBack();
 if(previewMap){destroyPreview();requestAnimationFrame(initializePreview);}
}
function setMapLayer(mode){
 if(mode==='satellite'&&!activeSatelliteProvider)return;
 mapLayerMode=mode;
 if(mode==='satellite'){
  map.removeLayer(streetTiles);activateSatelliteLayer(activeSatelliteProvider);
 }else{
  if(satelliteLayer){map.removeLayer(satelliteLayer);satelliteLayer=null;}
  streetTiles.addTo(map);streetTiles.bringToBack();
  if(previewMap){destroyPreview();requestAnimationFrame(initializePreview);}
 }
 satelliteControl.mapButton.classList.toggle('is-current',mode==='map');
 satelliteControl.satButton.classList.toggle('is-current',mode==='satellite');
}
map.on('moveend zoomend',scheduleSatelliteCheck);
scheduleSatelliteCheck();

(async()=>{try{const data=await Promise.all(files.map(async f=>{const r=await fetch(f);if(!r.ok)throw Error('Could not load '+f);return r.json()}));
  sites=data.flatMap(d=>d.features).filter(s=>s.geometry?.type==='Point'&&s.geometry.coordinates?.length===2&&s.geometry.coordinates.every(Number.isFinite));
  indexSites();search();renderMarkers();
  const linkedId=normalizeId(new URLSearchParams(window.location.search).get('site')||'');
  if(linkedId){const linkedSite=sites.find(s=>idOf(s)===linkedId);if(linkedSite){choose(linkedSite);const [lon,lat]=linkedSite.geometry.coordinates;map.setView([lat,lon],15);}}
}catch(e){status.textContent='Loading error: '+e.message+' — run through a local web server (not file://).';console.error(e)}})();

loadAzmSiteUpdateConfig();
