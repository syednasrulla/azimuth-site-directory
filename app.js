'use strict';
const map=L.map('map',{preferCanvas:true}).setView([53.5,-117],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const q=document.getElementById('q'),results=document.getElementById('results'),status=document.getElementById('status'),detail=document.getElementById('detail');
const files=['data/BC.geojson','data/AB.geojson','data/SK.geojson'];
let sites=[],selected=null,matches=[],activeIndex=-1;
const provinceCodes=['BC','AB','SK'];
const provinceNames={BC:'British Columbia',AB:'Alberta',SK:'Saskatchewan'};
const activeProvinces=new Set(provinceCodes);
const provinceOf=s=>idOf(s).slice(0,2);
const provinceEnabled=s=>activeProvinces.has(provinceOf(s));
// Spatial grid: avoids checking every site every time the map moves.
const CELL_SIZE=1;
const spatialGrid=new Map();
function gridKey(x,y){return x+','+y}
function indexSites(){spatialGrid.clear();for(const s of sites){const [lon,lat]=s.geometry.coordinates;const key=gridKey(Math.floor(lon/CELL_SIZE),Math.floor(lat/CELL_SIZE));if(!spatialGrid.has(key))spatialGrid.set(key,[]);spatialGrid.get(key).push(s)}}
function sitesInBounds(bounds){const sw=bounds.getSouthWest(),ne=bounds.getNorthEast(),found=[];
 for(let x=Math.floor(sw.lng/CELL_SIZE);x<=Math.floor(ne.lng/CELL_SIZE);x++)for(let y=Math.floor(sw.lat/CELL_SIZE);y<=Math.floor(ne.lat/CELL_SIZE);y++){
 const cell=spatialGrid.get(gridKey(x,y));if(!cell)continue;for(const s of cell){const [lon,lat]=s.geometry.coordinates;if(bounds.contains([lat,lon])&&provinceEnabled(s))found.push(s)}
 }return found}
const provinceFilter=document.getElementById('provinceFilters');
function setupProvinceFilters(){if(!provinceFilter)return;provinceFilter.replaceChildren();
 for(const code of provinceCodes){const label=document.createElement('label');label.className='province-option';
 const input=document.createElement('input');input.type='checkbox';input.checked=true;input.value=code;
 input.setAttribute('aria-label','Show '+provinceNames[code]+' sites');
 input.addEventListener('change',()=>{if(input.checked)activeProvinces.add(code);else activeProvinces.delete(code);renderMarkers();search();});
 const text=document.createElement('span');text.textContent=code;label.title=provinceNames[code];label.append(input,text);provinceFilter.append(label)}
}

const markers=L.layerGroup().addTo(map);
const clean=s=>String(s??'').trim();
const normalizeId=s=>clean(s).replace(/^([a-z]{2})\s*0*(\d+)$/i,(_,p,n)=>p.toUpperCase()+n.padStart(6,'0'));
const fold=s=>clean(s).toLocaleLowerCase();
const idOf=s=>normalizeId(s.properties['Site ID']||s.properties.name||'');
const workspace=document.getElementById('workspace');
const collapseButton=document.getElementById('collapseSidebar');
const expandButton=document.getElementById('expandSidebar');
function setSidebarCollapsed(collapsed){
  workspace.classList.toggle('sidebar-collapsed',collapsed);
  collapseButton.setAttribute('aria-expanded',String(!collapsed));
  expandButton.setAttribute('aria-expanded',String(!collapsed));
  window.setTimeout(()=>map.invalidateSize({pan:false}),260);
}
collapseButton.addEventListener('click',()=>setSidebarCollapsed(true));
expandButton.addEventListener('click',()=>setSidebarCollapsed(false));
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
function contactsCard(parent,raw){
  if(!clean(raw))return;
  const section=document.createElement('section');section.className='detail-card contacts-card';
  const heading=document.createElement('div');heading.className='static-heading section-heading';
  const title=document.createElement('h3');title.textContent='Useful Contact Info';heading.append(title);section.append(heading);
  const body=document.createElement('div');body.className='contact-lines';
  // Launch the dialer or email composer with only the matched contact value. Preserve original text.
  // Display the original contact text unchanged, preserving dates and context.
  const emailRe=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phoneRe=/(?<![\w@])(?:\+?1[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}(?:\s*(?:ext\.?|x|extension)\s*\d{1,6})?(?![\w@])/gi;
  clean(raw).split(/\r?\n/).forEach(line=>{
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
function choose(s){
  selected=s;const p=s.properties,[lon,lat]=s.geometry.coordinates;
  q.value=idOf(s);results.replaceChildren();matches=[];activeIndex=-1;
  status.textContent='Selected '+idOf(s)+' — '+clean(p['Site Name']);
  detail.replaceChildren();
  const head=document.createElement('section');head.className='site-head';
  const idRow=document.createElement('div');idRow.className='identity-row identity-primary';const id=document.createElement('div');id.className='site-id';id.textContent=idOf(s);idRow.append(id,copyIcon(idOf(s),'Copy site code'));const structure=clean(p['Antenna Structure']);const structureLabel=document.createElement('span');structureLabel.className='structure-badge'+(structure?'':' structure-unspecified');structureLabel.textContent=structure||'Not specified';structureLabel.title='Antenna Structure';idRow.append(structureLabel);head.append(idRow);
  const nameRow=document.createElement('div');nameRow.className='identity-row';const h=document.createElement('h2');h.textContent=clean(p['Site Name'])||'Unnamed site';nameRow.append(h);if(clean(p['Site Name']))nameRow.append(copyIcon(clean(p['Site Name']),'Copy site name'));head.append(nameRow);
  if(clean(p['Site Address'])){const address=document.createElement('div');address.className='address';address.textContent=clean(p['Site Address']);const addressRow=document.createElement('div');addressRow.className='identity-row';addressRow.append(address,copyIcon(clean(p['Site Address']),'Copy site address'));head.append(addressRow)}
  const actions=document.createElement('div');actions.className='quick-actions';
  const navigate=document.createElement('a');navigate.className='action primary';
  navigate.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lon);
  navigate.target='_blank';navigate.rel='noopener noreferrer';navigate.textContent='↗ Open in Google Maps';actions.append(navigate);
  head.append(actions);detail.append(head);
  const coords=clean(p['GPS Coordinates'])||lat+', '+lon;
  coordinatesCard(detail,coords);
  card(detail,'Site Information & Notes',p['Site Info / Notes'],true);
  contactsCard(detail,p['Useful Contact Info']);
  const standard=new Set(['Site ID','Site Name','Site Address','Site Info / Notes','Useful Contact Info','GPS Coordinates','Open in Google Maps','Antenna Structure','name','description','_umap_options']);
  for(const [key,value] of Object.entries(p)){
    if(standard.has(key)||key.startsWith('_')||value==null||typeof value==='object')continue;
    card(detail,key,value,false);
  }
  const live=document.createElement('div');live.id='copyStatus';live.className='sr-only';live.setAttribute('role','status');live.setAttribute('aria-live','polite');detail.append(live);
  if(workspace.classList.contains('sidebar-collapsed'))setSidebarCollapsed(false);
  map.flyTo([lat,lon],15,{duration:.65});renderMarkers();
}

function renderMarkers(){
  markers.clearLayers();if(!sites.length)return;
  const bounds=map.getBounds().pad(.12);
  const candidates=sitesInBounds(bounds).filter(s=>s!==selected);
  // Keep the interface responsive at regional zoom levels. All records remain searchable.
  const MAX_MARKERS=900;
  const step=Math.max(1,Math.ceil(candidates.length/MAX_MARKERS));
  for(let i=0;i<candidates.length;i+=step){const s=candidates[i],[lon,lat]=s.geometry.coordinates;
    L.circleMarker([lat,lon],{radius:5,color:'#2563eb',fillOpacity:.75,weight:1}).on('click',()=>choose(s)).addTo(markers);
  }
  if(selected&&provinceEnabled(selected)){const [lon,lat]=selected.geometry.coordinates;
    L.circleMarker([lat,lon],{radius:10,color:'#b45309',fillColor:'#f59e0b',fillOpacity:1,weight:3}).on('click',()=>choose(selected)).addTo(markers);
  }
  const count=document.getElementById('mapCount');
  if(count)count.textContent=candidates.length>MAX_MARKERS?`Showing a sample of ${candidates.length.toLocaleString()} sites in view · Zoom in for more`:`${candidates.length.toLocaleString()} sites in view`;
}

function updateActive(){
  [...results.querySelectorAll('button')].forEach((b,i)=>{
    b.classList.toggle('active',i===activeIndex);
    b.setAttribute('aria-selected',String(i===activeIndex));
    if(i===activeIndex)b.scrollIntoView({block:'nearest'});
  });
}
function search(){
  results.replaceChildren();matches=[];activeIndex=-1;
  const term=fold(q.value),normalized=fold(normalizeId(q.value));
  if(!term){status.textContent=`${sites.length.toLocaleString()} sites loaded · Search Site ID, name or address`;return}
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
  status.textContent=scored.length?`${scored.length.toLocaleString()} matching sites${scored.length>30?' · Showing first 30':''}`:'No matching sites';
  matches.forEach((s,i)=>{const p=s.properties,b=document.createElement('button');b.type='button';b.className='site-result';
    const name=document.createElement('strong');name.textContent=idOf(s)+' — '+clean(p['Site Name']);b.append(name);
    if(clean(p['Site Address'])){const address=document.createElement('span');address.className='result-address';address.textContent=clean(p['Site Address']);b.append(address)}
    b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.addEventListener('click',()=>choose(s));results.append(b);
  });
}
q.setAttribute('autocomplete','off');q.setAttribute('aria-label','Search by Site ID, site name or address');
results.setAttribute('role','listbox');results.setAttribute('aria-label','Matching sites');
q.addEventListener('input',search);
q.addEventListener('keydown',e=>{
  if(e.key==='Escape'){results.replaceChildren();matches=[];activeIndex=-1;return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){
    if(!matches.length)return;e.preventDefault();activeIndex=e.key==='ArrowDown'?(activeIndex+1)%matches.length:(activeIndex<=0?matches.length-1:activeIndex-1);updateActive();return;
  }
  if(e.key==='Enter'&&matches.length){e.preventDefault();choose(matches[activeIndex>=0?activeIndex:0])}
});
map.on('moveend',renderMarkers);
(async()=>{try{const data=await Promise.all(files.map(async f=>{const r=await fetch(f);if(!r.ok)throw Error('Could not load '+f);return r.json()}));
  sites=data.flatMap(d=>d.features).filter(s=>s.geometry?.type==='Point'&&s.geometry.coordinates?.length===2&&s.geometry.coordinates.every(Number.isFinite));
  indexSites();setupProvinceFilters();search();renderMarkers();
}catch(e){status.textContent='Loading error: '+e.message+' — run through a local web server (not file://).';console.error(e)}})();
