'use strict';
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const names = {travel:'一起旅行',food:'好好吃饭',daily:'日常碎片'};
  const clone = v => JSON.parse(JSON.stringify(v));
  const uid = () => typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const seeds = {
    version:2,
    memories:[
      {id:'trip-vlad',type:'travel',title:'海参崴',place:'俄罗斯 · 海参崴',date:'',text:'',cover:'vlad',photos:[],caption:'俄罗斯这一趟，我们一起去的。'},
      {id:'trip-hohhot',type:'travel',title:'呼和浩特',place:'内蒙古 · 呼和浩特',date:'',text:'',cover:'hohhot',photos:[],caption:'呼和浩特，来过啦。'},
      {id:'trip-tianjin',type:'travel',title:'天津',place:'天津',date:'',text:'',cover:'tianjin',photos:[],caption:'天津的照片，都放这儿。'},
      {id:'trip-aranya',type:'travel',title:'阿那亚',place:'河北 · 阿那亚',date:'',text:'',cover:'aranya',photos:[],caption:'阿那亚这一站，慢慢补照片。'},
      {id:'food-salmon',type:'food',title:'粉虫虫最爱的三文鱼',place:'虫虫们的饭桌',date:'',text:'粉虫虫最喜欢吃三文鱼。绿虫虫陪着吃。',cover:'salmon',photos:[],caption:'今天吃三文鱼了吗？'},
      {id:'our-worms',type:'daily',title:'虫虫们，黏在一起',place:'我们俩',date:'',text:'绿虫虫和粉虫虫。\n没什么事，就是想黏着。',cover:'daily',photos:['assets/together.png','assets/green.png','assets/pink.png'],caption:'两只虫虫，挨得紧紧的。'}
    ],wishes:[]
  };
  const MAX_PHOTOS=200,BATCH_PHOTOS=20;
  let publishedState=clone(seeds),savedDraft=null,draftMode=false,pendingDraftAction=null;
  let state=clone(seeds),currentFilter='all',searchTerm='',db=null,storageMode='indexeddb',ready=false,photos=[],photoBusy=false,activeDetail=null,activeAlbum=null,albumBusy=false,viewerIndex=0,viewerMemory=null,draftVersion=0,pendingDelete=null,pendingImport=null,toastTimer,writeQueue=Promise.resolve();
  const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500)}
  function hint(selector,message,error=false){$(selector).textContent=message;$(selector).classList.toggle('error',error)}
  const bundledPhotos={'together.png':'assets/together.png','green.png':'assets/green.png','pink.png':'assets/pink.png'};
  const resolvePhoto=p=>typeof p==='string'&&p.startsWith('assets/')?(bundledPhotos[p.slice(7)]||p):p;
  const photoValid = p => typeof p==='string'&&(Object.values(bundledPhotos).includes(p)||/^assets\/photos\/[a-f0-9]{64}\.(jpeg|png|webp)$/.test(p)||(p.length<=4000000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)));
  function validDate(v){if(!v)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v}
  function validateData(data){
    if(!data||![1,2].includes(data.version)||!Array.isArray(data.memories)||!Array.isArray(data.wishes)||data.memories.length>1000||data.wishes.length>1000)throw Error('这不是虫虫手账的备份，或版本暂时不支持。');
    const ids=new Set();
    const memories=data.memories.map(m=>{
      if(!m||typeof m.id!=='string'||!m.id||m.id.length>120||ids.has(m.id)||!names[m.type]||typeof m.title!=='string'||!m.title.trim()||m.title.length>80||typeof m.place!=='string'||m.place.length>60||typeof m.date!=='string'||!validDate(m.date)||typeof m.text!=='string'||m.text.length>5000||!Array.isArray(m.photos)||m.photos.length>MAX_PHOTOS||!m.photos.map(resolvePhoto).every(photoValid))throw Error('备份里的回忆格式不完整，未修改当前手账。');
      ids.add(m.id);return {id:m.id,type:m.type,title:m.title,place:m.place,date:m.date,text:m.text,cover:['vlad','hohhot','tianjin','aranya','salmon','daily'].includes(m.cover)?m.cover:'daily',photos:m.photos.map(resolvePhoto),caption:typeof m.caption==='string'?m.caption.slice(0,160):''};
    });
    const wishes=data.wishes.map(w=>{if(!w||typeof w.id!=='string'||!w.id||w.id.length>120||ids.has(w.id)||typeof w.title!=='string'||!w.title.trim()||w.title.length>100||typeof w.done!=='boolean')throw Error('备份里的愿望格式不完整，未修改当前手账。');ids.add(w.id);return {id:w.id,title:w.title,done:w.done}});
    return {version:data.version,memories,wishes};
  }
  async function openStorage(){
    try{
      db=await new Promise((resolve,reject)=>{const req=indexedDB.open('chongchong-github-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('journal');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onblocked=()=>reject(Error('storage blocked'))});
      return await new Promise((resolve,reject)=>{const tx=db.transaction('journal','readonly');const req=tx.objectStore('journal').get('our-life');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
    }catch(e){storageMode='localstorage';const raw=localStorage.getItem('chongchong-github-draft-v1');return raw?JSON.parse(raw):null}
  }
  async function saveStorage(next){
    if(storageMode==='localstorage'){localStorage.setItem('chongchong-github-draft-v1',JSON.stringify(next));return}
    await new Promise((resolve,reject)=>{const tx=db.transaction('journal','readwrite');tx.objectStore('journal').put(next,'our-life');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('save aborted'))});
  }
  function mutate(update,message){
    const job=writeQueue.then(async()=>{if(!ready)throw Error('浏览器存储暂不可用，请先导出已有内容，或换普通浏览窗口再试。');if(!draftMode)throw Error('先打开本机草稿，再记这一笔。');const next=update(clone(state));await saveStorage(next);savedDraft=clone(next);state=next;render();if(message)toast(message+' 已存到本机草稿。');return true});
    writeQueue=job.catch(()=>{});
    return job.catch(e=>{toast(e.name==='QuotaExceededError'?'浏览器空间不足，未保存。请先导出备份，再减少照片后重试。':e.message||'保存未完成，请重试。');return false});
  }
  const artFor=m=>m.cover||(m.type==='food'?'salmon':'daily');
  function renderMemories(){
    const list=state.memories.filter(m=>(currentFilter==='all'||m.type===currentFilter)&&(!searchTerm||[m.title,m.place,m.text,m.caption].join(' ').toLowerCase().includes(searchTerm.toLowerCase())));
    $('#all-count').textContent=state.memories.length;
    const cards=list.map(m=>`<article class="memory-card"><button class="card-open" data-open="${esc(m.id)}" aria-label="打开回忆：${esc(m.title)}"><div class="card-image ${m.id==='our-worms'?'worm-cover':''}">${m.photos.length?`<img src="${m.photos[0]}" alt="${esc(m.title)}的回忆照片" loading="lazy">`:Art.picture(artFor(m))}<span class="card-label ${m.type}">${m.type==='travel'?'↗':m.type==='food'?'♡':'✧'} ${names[m.type]}</span>${m.photos.length?'':'<span class="card-art-label">插画封面</span>'}</div><div class="card-copy"><h3>${esc(m.title)}</h3><p>${esc(m.text||m.caption||'还没写，先放照片。')}</p><div class="card-meta"><span>⌖ ${esc(m.place||'我们俩的日常')}</span><span aria-hidden="true">♡</span></div></div></button><div class="card-album-action"><span>${m.photos.length?`${m.photos.length} 张照片`:'相册还空着'}</span><button data-add-photos="${esc(m.id)}" aria-label="给${esc(m.title)}加照片">＋ 加照片</button></div></article>`).join('');
    $('#memory-grid').innerHTML=cards;
    $('#empty-state').hidden=list.length>0;
    $('#empty-copy').textContent=searchTerm?'没找到，换个词试试？':'这里还没记东西，先写一笔吧。';
  }
  function renderWishes(){
    $('#wish-list').innerHTML=state.wishes.map(w=>`<li class="wish-item ${w.done?'done':''}"><input class="wish-check" type="checkbox" data-check="${esc(w.id)}" ${w.done?'checked':''} aria-label="标记愿望${esc(w.title)}为${w.done?'未实现':'已实现'}"><span class="wish-title">${esc(w.title)}</span><button class="wish-delete" data-delete-wish="${esc(w.id)}" aria-label="移除愿望：${esc(w.title)}">×</button></li>`).join('');
    $('#wish-empty').hidden=state.wishes.length>0;
    const completed=state.wishes.filter(w=>w.done).length;
    $('#wish-count').textContent=state.wishes.filter(w=>!w.done).length;
    $('#wish-progress').textContent=state.wishes.length?`${completed} / ${state.wishes.length} 件，做到啦 ♡`:'先写一件吧';
    document.querySelectorAll('[data-idea]').forEach(b=>{const exists=state.wishes.some(w=>w.title===b.dataset.idea);b.disabled=exists;b.querySelector('span:last-child').textContent=exists?'✓':'＋'});
  }
  function render(){
    renderMemories();renderWishes();
    $('#publication-status').textContent=draftMode?'本机草稿 · 尚未发布':'公开相册 · 所有人可看';
    $('#draft-toggle').textContent=draftMode?'看已发布相册':'打开本机草稿';
    document.body.classList.toggle('draft-mode',draftMode);
    $('#city-count').textContent=new Set(state.memories.filter(m=>m.type==='travel'&&m.place.trim()).map(m=>m.place.trim())).size;
  }
  function openEditor(id=null,type=null){
    if(!ready){toast('存储尚未准备好，请稍后再试。');return}
    const m=id?state.memories.find(m=>m.id===id):null;
    $('#memory-form').reset();$('#memory-title').setCustomValidity('');draftVersion++;$('#memory-id').value=m?.id||'';$('#editor-heading').textContent=m?'补几句，再放点照片':'今天记点什么';
    $('#memory-type').value=m?.type||type||(currentFilter==='all'?'daily':currentFilter);
    $('#memory-title').value=m?.title||'';$('#memory-place').value=m?.place||'';$('#memory-date').value=m?.date||(m?'':today());$('#memory-text').value=m?.text||'';
    photos=[...(m?.photos||[])];photoBusy=false;$('#save-memory').disabled=false;hint('#photo-status','');renderPhotoPreview();$('#editor-dialog').showModal();
  }
  function renderPhotoPreview(){
    $('#photo-preview').innerHTML=photos.map((p,i)=>`<div class="photo-thumb"><img src="${p}" alt="待保存的照片 ${i+1}" loading="lazy"><button type="button" data-remove-photo="${i}" aria-label="移除第 ${i+1} 张照片">×</button></div>`).join('');
  }
  async function compressPhoto(file){
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 照片。');
    if(file.size>15*1024*1024)throw Error('单张照片请控制在 15 MB 以内。');
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('这张照片没有读成功，请换一张试试。'));image.src=url});
      const ratio=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fffdf5';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.82);if(!photoValid(data))throw Error('照片较复杂，缩小后再试试。');return data;
    }finally{URL.revokeObjectURL(url)}
  }
  function showDetail(id){
    const m=state.memories.find(m=>m.id===id);if(!m)return;activeDetail=id;
    const slots=['放一张合照','放一点风景','记一顿好吃的'];
    const gallery=m.photos.map((p,i)=>`<button class="album-photo ${m.id==='our-worms'?'original-worm':''}" data-view-photo="${i}" aria-label="查看${esc(m.title)}的第 ${i+1} 张照片"><img src="${p}" alt="${esc(m.title)}的第 ${i+1} 张照片" loading="lazy"><span>${String(i+1).padStart(2,'0')}</span></button>`).join('');
    const emptySlots=m.photos.length?'':slots.map((text,i)=>`<button class="album-placeholder" data-add-photos="${esc(id)}"><span aria-hidden="true">${['♡','☼','♧'][i]}</span>${text}</button>`).join('');
    $('#detail-body').innerHTML=`<div class="detail-visual ${m.id==='our-worms'?'worm-cover':''}">${m.photos.length?`<img src="${m.photos[0]}" alt="${esc(m.title)}的照片">`:Art.picture(artFor(m))}<button class="icon-button close-dialog" aria-label="关闭回忆详情">×</button></div><div class="detail-content"><span class="detail-type">${names[m.type]} · OUR ALBUM</span><h2>${esc(m.title)}</h2><div class="detail-meta"><span>⌖ ${esc(m.place||'我们俩的日常')}</span><span>◷ ${m.date?esc(m.date.replaceAll('-','.')):'哪天去的？有空补一下'}</span></div>${m.text?`<p class="detail-story">${esc(m.text)}</p>`:`<p class="detail-story">${esc(m.caption||'先放照片，有空再写。')}</p>`}<div class="album-heading"><div><h3>这儿的照片</h3><span>${m.photos.length} 张 · 可以继续加</span></div><button class="button small" data-add-photos="${esc(id)}">＋ 再加几张</button></div><div class="album-grid">${gallery}${emptySlots}<button class="album-placeholder add-photo-tile" data-add-photos="${esc(id)}"><span aria-hidden="true">＋</span>${m.photos.length?'再放几张':'从这里加照片'}</button></div><p class="form-hint album-note">一次能选 20 张，这本相册最多放 200 张。点照片可以看大图。</p><div id="album-status" class="form-hint" role="status"></div><div class="detail-actions"><button class="delete-link" id="delete-memory">删除这一页</button><button class="secondary small" id="edit-memory">✎ 改改文字 / 整理照片</button></div></div>`;
    if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
  }
  function chooseAlbumPhotos(id){
    if(!ready){toast('还没准备好，等一下再试。');return}
    if(albumBusy){toast('照片还在保存，稍等一下。');return}
    const m=state.memories.find(m=>m.id===id);if(!m)return;
    if(m.photos.length>=MAX_PHOTOS){toast('这页放满 200 张啦，可以新开一页。');return}
    activeAlbum=id;$('#album-photos').click();
  }
  function showPhoto(index,id=activeDetail){
    const m=state.memories.find(m=>m.id===id);if(!m?.photos.length)return;
    viewerMemory=id;viewerIndex=(index+m.photos.length)%m.photos.length;
    $('#large-photo').src=m.photos[viewerIndex];$('#large-photo').alt=`${m.title}的第 ${viewerIndex+1} 张照片`;
    $('#photo-counter').textContent=`${viewerIndex+1} / ${m.photos.length}`;$('#photo-title').textContent=m.title;
    $('#photo-prev').disabled=m.photos.length<2;$('#photo-next').disabled=m.photos.length<2;
    if(!$('#photo-dialog').open)$('#photo-dialog').showModal();
  }
  function openBackup(){hint('#backup-status','');pendingImport=null;$('#import-confirm').hidden=true;$('#backup-dialog').showModal()}
  async function addWish(title){
    const clean=title.trim();if(!clean)return false;if(clean.length>100){toast('愿望最多写 100 个字哦。');return false}
    if(state.wishes.some(w=>w.title===clean)){toast('已经记过这件事啦。');return false}
    return await mutate(s=>{if(s.wishes.some(w=>w.title===clean))return s;s.wishes.push({id:uid(),title:clean,done:false});return s},'记下了，下次一起。');
  }
  document.addEventListener('click',async e=>{
    const close=e.target.closest('.close-dialog');if(close){close.closest('dialog').close();return}
    const add=e.target.closest('[data-action="new-memory"]');if(add){openEditor();return}
    const card=e.target.closest('[data-open]');if(card){showDetail(card.dataset.open);return}
    const albumAdd=e.target.closest('[data-add-photos]');if(albumAdd){chooseAlbumPhotos(albumAdd.dataset.addPhotos);return}
    const viewPhoto=e.target.closest('[data-view-photo]');if(viewPhoto){showPhoto(Number(viewPhoto.dataset.viewPhoto));return}
    const filter=e.target.closest('[data-filter]');if(filter){currentFilter=filter.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.toggle('selected',b===filter);b.setAttribute('aria-pressed',String(b===filter))});renderMemories();return}
    const remove=e.target.closest('[data-remove-photo]');if(remove){if(photoBusy)return;photos.splice(Number(remove.dataset.removePhoto),1);renderPhotoPreview();return}
    const idea=e.target.closest('[data-idea]');if(idea){await addWish(idea.dataset.idea);return}
    const del=e.target.closest('[data-delete-wish]');if(del){await mutate(s=>{s.wishes=s.wishes.filter(w=>w.id!==del.dataset.deleteWish);return s},'这一条删掉了。');return}
    if(e.target.closest('#edit-memory')){$('#detail-dialog').close();openEditor(activeDetail);return}
    if(e.target.closest('#delete-memory')){pendingDelete=activeDetail;$('#confirm-dialog').showModal();return}
  });
  $('#search').addEventListener('input',e=>{searchTerm=e.target.value.trim();renderMemories()});
  $('#food-record').addEventListener('click',()=>openEditor(null,'food'));
  $('#backup-open').addEventListener('click',openBackup);$('#backup-footer').addEventListener('click',openBackup);
  $('#memory-photos').addEventListener('change',async e=>{
    const files=[...e.target.files];e.target.value='';if(!files.length)return;
    if(files.length>BATCH_PHOTOS||files.length+photos.length>MAX_PHOTOS){hint('#photo-status','一次选 20 张以内，这页最多放 200 张。可以分几次加。',true);return}
    const draft=draftVersion;photoBusy=true;$('#save-memory').disabled=true;hint('#photo-status','正在整理照片…');
    try{const batch=[];for(const file of files)batch.push(await compressPhoto(file));if(draft!==draftVersion)return;photos.push(...batch);renderPhotoPreview();hint('#photo-status',`现在有 ${photos.length} 张照片，点“保存”就放好啦。`)}catch(error){if(draft===draftVersion)hint('#photo-status',error.message,true)}finally{if(draft===draftVersion){photoBusy=false;$('#save-memory').disabled=false}}
  });
  $('#editor-dialog').addEventListener('close',()=>{draftVersion++});
  $('#album-photos').addEventListener('change',async e=>{
    const files=[...e.target.files],target=activeAlbum;e.target.value='';if(!files.length||!target)return;
    const m=state.memories.find(m=>m.id===target);if(!m)return;
    if(files.length>BATCH_PHOTOS||files.length+m.photos.length>MAX_PHOTOS){toast('一次选 20 张以内，这页最多放 200 张。');return}
    albumBusy=true;toast(`在放照片，0 / ${files.length}…`);
    try{const batch=[];for(let i=0;i<files.length;i++){batch.push(await compressPhoto(files[i]));if($('#album-status'))hint('#album-status',`正在整理 ${i+1} / ${files.length} 张照片…`)}
      const ok=await mutate(s=>{const record=s.memories.find(r=>r.id===target);if(!record)throw Error('这页已经不在了，照片没有保存。');if(record.photos.length+batch.length>MAX_PHOTOS)throw Error('这页放满啦，新开一页继续放吧。');record.photos.push(...batch);return s},`${batch.length} 张照片，放好啦。`);
      if(ok&&$('#detail-dialog').open&&activeDetail===target)showDetail(target);
    }catch(error){toast(error.message)}finally{albumBusy=false}
  });
  $('#photo-prev').addEventListener('click',()=>showPhoto(viewerIndex-1,viewerMemory));$('#photo-next').addEventListener('click',()=>showPhoto(viewerIndex+1,viewerMemory));
  $('#photo-dialog').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();showPhoto(viewerIndex-1,viewerMemory)}if(e.key==='ArrowRight'){e.preventDefault();showPhoto(viewerIndex+1,viewerMemory)}});
  $('#memory-form').addEventListener('submit',async e=>{
    e.preventDefault();if(photoBusy)return;
    const title=$('#memory-title').value.trim();if(!title){$('#memory-title').setCustomValidity('给这段回忆起个名字吧。');$('#memory-title').reportValidity();return}
    if(!validDate($('#memory-date').value)){toast('日期不对，再选一下吧。');return}
    const id=$('#memory-id').value;const type=$('#memory-type').value;const existing=state.memories.find(m=>m.id===id);
    const record={id:id||uid(),type,title,place:$('#memory-place').value.trim(),date:$('#memory-date').value,text:$('#memory-text').value.trim(),photos:[...photos],cover:existing?.cover||(type==='food'?'salmon':'daily'),caption:existing?.caption||''};
    $('#save-memory').disabled=true;
    const ok=await mutate(s=>{const index=s.memories.findIndex(m=>m.id===record.id);if(index>=0)s.memories[index]=record;else s.memories.unshift(record);return s},'存好啦。');
    $('#save-memory').disabled=false;if(ok){$('#editor-dialog').close();if(currentFilter!=='all'&&currentFilter!==type){currentFilter='all';document.querySelectorAll('[data-filter]').forEach(b=>{const selected=b.dataset.filter==='all';b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected))})}if(searchTerm){searchTerm='';$('#search').value=''}renderMemories()}
  });
  $('#memory-title').addEventListener('input',()=>$('#memory-title').setCustomValidity(''));
  $('#delete-confirm').addEventListener('click',async()=>{if(!pendingDelete)return;$('#delete-confirm').disabled=true;const ok=await mutate(s=>{s.memories=s.memories.filter(m=>m.id!==pendingDelete);return s},'这一页删掉了。');$('#delete-confirm').disabled=false;if(ok){$('#confirm-dialog').close();$('#detail-dialog').close();pendingDelete=null}});
  $('#wish-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('#wish-form button');button.disabled=true;try{if(await addWish($('#wish-input').value))$('#wish-input').value=''}finally{button.disabled=false}});
  $('#wish-list').addEventListener('change',async e=>{if(!e.target.matches('[data-check]'))return;const id=e.target.dataset.check,done=e.target.checked;e.target.disabled=true;const ok=await mutate(s=>{const w=s.wishes.find(w=>w.id===id);if(w)w.done=done;return s},done?'做到啦，打个勾。':'先留着，下次再做。');if(!ok)renderWishes()});
  $('#export-data').addEventListener('click',()=>{
    const payload={app:'chongchong-happy-life',exportedAt:new Date().toISOString(),...clone(state)};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`虫虫们的幸福生活-备份-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);hint('#backup-status','备份已生成，请将下载的文件妥善保管。');
  });
  $('#import-data').addEventListener('change',async e=>{
    const file=e.target.files[0];e.target.value='';pendingImport=null;$('#import-confirm').hidden=true;if(!file)return;
    try{if(file.size>250*1024*1024)throw Error('备份文件过大，请选择 250 MB 以内的备份。');const raw=JSON.parse(await file.text());if(raw.app!=='chongchong-happy-life')throw Error('请选择由虫虫手账导出的 JSON 备份。');pendingImport=validateData(raw);$('#import-summary').textContent=`这份备份里有 ${pendingImport.memories.length} 段回忆、${pendingImport.wishes.length} 个愿望。恢复后会替换这里现有的 ${state.memories.length} 段回忆和 ${state.wishes.length} 个愿望。`;hint('#backup-status','备份已检查，请确认是否恢复。');$('#import-confirm').hidden=false}catch(error){hint('#backup-status',error instanceof SyntaxError?'文件内容无法识别，请选择完整的 JSON 备份。':error.message,true)}
  });
  $('#confirm-import').addEventListener('click',async()=>{if(!pendingImport)return;$('#confirm-import').disabled=true;const ok=await mutate(()=>clone(pendingImport),'恢复好啦。');$('#confirm-import').disabled=false;if(ok){pendingImport=null;$('#import-confirm').hidden=true;hint('#backup-status','恢复好了，照片和文字都在。')}});
  $('#cancel-import').addEventListener('click',()=>{pendingImport=null;$('#import-confirm').hidden=true;hint('#backup-status','已取消恢复，当前手账没有改变。')});
  function askForDraft(action=null){
    pendingDraftAction=action;
    if(!$('#draft-dialog').open)$('#draft-dialog').showModal();
  }
  const draftTriggers='[data-action="new-memory"],[data-add-photos],#edit-memory,#delete-memory,[data-idea],[data-delete-wish],.wish-check,#food-record,#confirm-import,#wish-form .wish-add';
  document.addEventListener('click',e=>{
    const target=e.target.closest(draftTriggers);
    if(!target||draftMode)return;
    e.preventDefault();e.stopImmediatePropagation();
    askForDraft(()=>{
      if(target.matches('[data-add-photos]')){chooseAlbumPhotos(target.dataset.addPhotos);return}
      if(target.id==='edit-memory'){$('#detail-dialog').close();openEditor(activeDetail);return}
      if(target.id==='delete-memory'){pendingDelete=activeDetail;$('#confirm-dialog').showModal();return}
      if(target.matches('.wish-check')){$(`[data-check="${CSS.escape(target.dataset.check)}"]`)?.click();return}
      if(target.matches('[data-delete-wish]')){$(`[data-delete-wish="${CSS.escape(target.dataset.deleteWish)}"]`)?.click();return}
      target.click();
    });
  },true);
  document.addEventListener('submit',e=>{
    if(e.target.id!=='wish-form'||draftMode)return;
    e.preventDefault();e.stopImmediatePropagation();askForDraft(()=>e.target.requestSubmit());
  },true);
  $('#draft-start').addEventListener('click',()=>{
    if(!ready){toast('本机存储还没准备好，稍后再试。');return}
    state=clone(savedDraft||publishedState);draftMode=true;render();
    if(activeDetail&&$('#detail-dialog').open)showDetail(activeDetail);
    $('#draft-dialog').close();const action=pendingDraftAction;pendingDraftAction=null;if(action)action();
  });
  $('#draft-toggle').addEventListener('click',()=>{
    if(!draftMode){askForDraft();return}
    state=clone(publishedState);draftMode=false;render();toast('正在看已发布相册，本机草稿还留着。');
  });
  async function init(){
    let snapshotLoaded=false;
    try{const response=await fetch('journal.json',{cache:'no-store'});if(!response.ok)throw Error('snapshot');publishedState=validateData(await response.json());snapshotLoaded=true}catch(error){toast('已发布相册暂时没读到，先显示最初的照片。')}
    try{const stored=await openStorage();savedDraft=stored?validateData(stored):null;ready=true}catch(error){toast('本机草稿暂时不能保存，仍可浏览已发布相册。')}
    state=clone(publishedState);render();
    if(!snapshotLoaded)$('#publication-status').textContent='已发布相册未加载 · 刷新再试';
  }
  init();
})();
