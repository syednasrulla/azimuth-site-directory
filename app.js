'use strict';
const map=L.map('map',{preferCanvas:true,zoomSnap:0,zoomDelta:0.5}).setView([53.5,-117],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
const q=document.getElementById('q'),results=document.getElementById('results'),status=document.getElementById('status'),detail=document.getElementById('detail');
const files=['data/BC.geojson','data/AB.geojson','data/SK.geojson'];
let sites=[],selected=null,matches=[],activeIndex=-1;
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
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,attribution:'&copy; OpenStreetMap contributors'
  }).addTo(previewMap);
  L.circleMarker([lat,lon],{radius:9,color:'#b45309',fillColor:'#f59e0b',fillOpacity:1,weight:3}).addTo(previewMap);
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
  destroyPreview();
  selected=s;const p=s.properties,[lon,lat]=s.geometry.coordinates;
  q.value=idOf(s);results.replaceChildren();matches=[];activeIndex=-1;
  status.textContent='Selected '+idOf(s)+' — '+clean(p['Site Name']);
  // Return a previously pinned card before replacing the detail contents.
  pinnedSite.replaceChildren();
  detail.replaceChildren();
  const head=document.createElement('section');head.className='site-head';
  const idRow=document.createElement('div');idRow.className='identity-row identity-primary';const id=document.createElement('div');id.className='site-id';id.textContent=idOf(s);idRow.append(id,copyIcon(idOf(s),'Copy site code'));const structure=clean(p['Antenna Structure']);const structureLabel=document.createElement('span');structureLabel.className='structure-badge'+(structure?'':' structure-unspecified');structureLabel.textContent=structure||'Not specified';structureLabel.title='Antenna Structure';idRow.append(structureLabel);head.append(idRow);
  const nameRow=document.createElement('div');nameRow.className='identity-row';const h=document.createElement('h2');h.textContent=clean(p['Site Name'])||'Unnamed site';nameRow.append(h);if(clean(p['Site Name']))nameRow.append(copyIcon(clean(p['Site Name']),'Copy site name'));head.append(nameRow);
  if(clean(p['Site Address'])){const address=document.createElement('div');address.className='address';address.textContent=clean(p['Site Address']);const addressRow=document.createElement('div');addressRow.className='identity-row';addressRow.append(address,copyIcon(clean(p['Site Address']),'Copy site address'));head.append(addressRow)}
  addSitePreview(head,lat,lon,idOf(s));
  const actions=document.createElement('div');actions.className='quick-actions';
  const navigate=document.createElement('a');navigate.className='action primary';
  navigate.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(lat+','+lon);
  navigate.target='_blank';navigate.rel='noopener noreferrer';navigate.textContent='↗ Open in Google Maps';actions.append(navigate);
  head.append(actions);detail.append(head);
  requestAnimationFrame(initializePreview);
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
  applyPin();
  if(workspace.classList.contains('sidebar-collapsed'))setSidebarCollapsed(false);
  // Nearby exploration is navigation, not a new search: preserve the map viewport.
  if(!nearbyNavigating)map.flyTo([lat,lon],15,{duration:.65});
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
    L.circleMarker([lat,lon],{radius:10,color:'#b45309',fillColor:'#f59e0b',fillOpacity:1,weight:3})
      .bindTooltip('Selected · '+idOf(selected)).addTo(markers);
  }
  renderNearbyHighlights();
  const count=document.getElementById('mapCount');
  if(count)count.textContent=nearbyActive
    ? `${nearbyFound.length.toLocaleString()} search results`
    : selected ? 'Selected site' : 'Search for a site to display markers';
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
    b.setAttribute('role','option');b.setAttribute('aria-selected','false');b.addEventListener('click',()=>{q.blur();endNearbyExploration();choose(s);requestAnimationFrame(()=>{sidebarElement.scrollTop=isPinned?0:Math.max(0,detail.offsetTop-12)})});results.append(b);
  });
}
q.setAttribute('autocomplete','off');q.setAttribute('aria-label','Search by Site ID, site name or address');
results.setAttribute('role','listbox');results.setAttribute('aria-label','Matching sites');
q.addEventListener('input',()=>{endNearbyExploration();search()});
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
let nearbyPanelOpen=false, nearbyOriginalSite=null, nearbyNavigating=false;
// A search starts from the selected site only when Find is explicitly pressed.
// Selecting a result never reruns a search or changes the session anchor.
const nearbyReturn=document.createElement('button');
nearbyReturn.type='button';nearbyReturn.className='nearby-return';nearbyReturn.hidden=true;
nearbyFinder.insertBefore(nearbyReturn,nearbyFinder.querySelector('.nearby-heading'));
const nearbyLegend=document.createElement('div');nearbyLegend.className='nearby-legend';nearbyLegend.hidden=true;
nearbyLegend.innerHTML='<span><i class="legend-origin" aria-hidden="true"></i>Original</span><span><i class="legend-nearby" aria-hidden="true"></i>Nearby</span><span><i class="legend-current" aria-hidden="true"></i>Viewing</span>';
nearbyFinder.insertBefore(nearbyLegend,nearbyFinder.querySelector('.nearby-heading').nextSibling);
function updateNearbyReturn(){
 const show=Boolean(nearbyActive && nearbyOriginalSite && selected!==nearbyOriginalSite);
 nearbyReturn.hidden=!show;
 nearbyLegend.hidden=!nearbyActive;
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
 if(!nearbyOriginalSite)return;
 nearbyNavigating=true;choose(nearbyOriginalSite);nearbyNavigating=false;
 updateNearbyReturn();
 if(nearbyMobileQuery.matches)requestAnimationFrame(()=>{sidebarElement.scrollTop=Math.max(0,detail.offsetTop-12)});
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
 nearbyNavigating=true;
 choose(site);
 nearbyNavigating=false;
 updateNearbyReturn();
 if(nearbyMobileQuery.matches){
   requestAnimationFrame(()=>{sidebarElement.scrollTop=Math.max(0,detail.offsetTop-12)});
 }
}
function renderNearbyHighlights(){
 nearbyHighlightLayer.clearLayers();if(!nearbyActive)return;
 // Draw distinct nearby markers. Current result is a larger, double-ringed marker.
 for(const item of nearbyFound){
  const s=item.s;if(s===nearbyOriginalSite)continue;
  const [lon,lat]=s.geometry.coordinates,viewing=s===selected;
  L.circleMarker([lat,lon],{radius:viewing?19:15,color:viewing?'#7c3aed':'#0ea5e9',weight:0,fillColor:viewing?'#a78bfa':'#38bdf8',fillOpacity:.20,interactive:false}).addTo(nearbyHighlightLayer);
  L.circleMarker([lat,lon],{radius:viewing?11:8,color:viewing?'#fff':'#67e8f9',weight:viewing?4:2.5,fillColor:viewing?'#7c3aed':'#0369a1',fillOpacity:1,className:viewing?'nearby-viewing-marker':'nearby-glow'}).bindTooltip((viewing?'Viewing · ':'Nearby · ')+idOf(s)).on('click',()=>selectNearbyResult(s)).addTo(nearbyHighlightLayer);
 }
 // The anchor remains visible, even if the technician is viewing another result.
 if(nearbyOriginalSite){const [lon,lat]=nearbyOriginalSite.geometry.coordinates;
  L.circleMarker([lat,lon],{radius:12,color:'#fff',weight:3,fillColor:'#e08a16',fillOpacity:1,className:'nearby-origin-marker'}).bindTooltip('Original · '+idOf(nearbyOriginalSite)).on('click',()=>selectNearbyResult(nearbyOriginalSite)).addTo(nearbyHighlightLayer);
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
 const token=++nearbyRequest,sessionAnchor=selected;
 if(!sessionAnchor){nearbyStatus.textContent='Select a destination site first.';return}
 const [destLon,destLat]=sessionAnchor.geometry.coordinates,destination=[destLat,destLon];
 const routeMode=nearbyMode==='settlement';let origin=destination,originLabel=idOf(sessionAnchor),route=null,routeDistance=0;
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
   if(s===sessionAnchor)continue;
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
 if(!selected||!sites.length){nearbyStatus.textContent='Select a site to search around.';return}
 const anchor=nearbyOriginalSite||selected;
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

nearbyModeButtons.forEach(button=>button.addEventListener('click',()=>setNearbyMode(button.dataset.nearbyMode)));
document.getElementById('nearbyFind').addEventListener('click',()=>{nearbyPlace.blur();runNearbySearch()});
document.getElementById('nearbyClear').addEventListener('click',()=>clearNearby());
nearbyPlace.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();nearbyPlace.blur();runNearbySearch()}});


(async()=>{try{const data=await Promise.all(files.map(async f=>{const r=await fetch(f);if(!r.ok)throw Error('Could not load '+f);return r.json()}));
  sites=data.flatMap(d=>d.features).filter(s=>s.geometry?.type==='Point'&&s.geometry.coordinates?.length===2&&s.geometry.coordinates.every(Number.isFinite));
  indexSites();search();renderMarkers();
}catch(e){status.textContent='Loading error: '+e.message+' — run through a local web server (not file://).';console.error(e)}})();
