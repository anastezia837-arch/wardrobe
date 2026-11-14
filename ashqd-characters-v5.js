const DB_NAME="ashqd-character-archive";
const DB_VERSION=2;
let db=null;
let currentCharacterId=null;
let activePhoto=null;
let previewUrl=null;
let fullImageUrl=null;
let activeClothingRef=null;
let clothingPreviewUrl=null;
let clothingDetailUrl=null;
const $=s=>document.querySelector(s);
const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const makeId=()=> "id-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
function toast(message){const el=$("#toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),2600)}
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const database=request.result;if(!database.objectStoreNames.contains("characters"))database.createObjectStore("characters",{keyPath:"id"});if(!database.objectStoreNames.contains("photos")){const store=database.createObjectStore("photos",{keyPath:"id"});store.createIndex("characterId","characterId",{unique:false})}if(!database.objectStoreNames.contains("clothingRefs"))database.createObjectStore("clothingRefs",{keyPath:"id"})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
function requestStore(name,mode,action){return new Promise((resolve,reject)=>{if(!db){reject(new Error("База данных ещё не готова"));return}let result;let settled=false;try{const tx=db.transaction(name,mode);const store=tx.objectStore(name);const req=action(store);req.onsuccess=()=>{result=req.result};req.onerror=()=>{if(!settled){settled=true;reject(req.error||new Error("Ошибка запроса к базе данных"))}};tx.oncomplete=()=>{if(!settled){settled=true;resolve(result)}};tx.onerror=()=>{if(!settled){settled=true;reject(tx.error||new Error("Ошибка транзакции"))}};tx.onabort=()=>{if(!settled){settled=true;reject(tx.error||new Error("Сохранение отменено браузером"))}}}catch(error){reject(error)}})}
const getAll=name=>requestStore(name,"readonly",s=>s.getAll());
const getOne=(name,id)=>requestStore(name,"readonly",s=>s.get(id));
const put=(name,value)=>requestStore(name,"readwrite",s=>s.put(value));
const remove=(name,id)=>requestStore(name,"readwrite",s=>s.delete(id));
function showModal(id){$("#"+id).classList.remove("hidden");document.body.classList.add("modal-open")}
function closeModal(id){$("#"+id).classList.add("hidden");if(!document.querySelector(".modal-backdrop:not(.hidden)"))document.body.classList.remove("modal-open");if(id==="photoModal")clearPreview();if(id==="clothingModal")clearClothingPreview();if(id==="imageModal"&&fullImageUrl){URL.revokeObjectURL(fullImageUrl);fullImageUrl=null}if(id==="clothingDetailModal"&&clothingDetailUrl){URL.revokeObjectURL(clothingDetailUrl);clothingDetailUrl=null}}
function clearPreview(){if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null}$("#previewImage").removeAttribute("src");$("#imagePreview").classList.add("hidden");$("#photoFile").value=""}
function filePreview(file){if(!file||!file.type.startsWith("image/"))return;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$("#previewImage").src=previewUrl;$("#imagePreview").classList.remove("hidden")}
async function compressImage(file){
  // Try to reduce oversized references, but never block saving when browser codecs fail.
  try{
    if(typeof createImageBitmap!=="function")return file;
    const bitmap=await createImageBitmap(file);
    const limit=1800,ratio=Math.min(1,limit/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas");
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext("2d");
    if(!ctx){bitmap.close?.();return file}
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close?.();
    const result=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.86));
    return result||file;
  }catch(error){
    console.warn("ASHQD image optimization skipped; keeping original file:",error);
    return file;
  }
}

function clearClothingPreview(){if(clothingPreviewUrl){URL.revokeObjectURL(clothingPreviewUrl);clothingPreviewUrl=null}$("#clothingPreviewImage").removeAttribute("src");$("#clothingPreview").classList.add("hidden");$("#clothingFile").value=""}
function renderClothingPreview(file){if(!file||!file.type.startsWith("image/"))return;if(clothingPreviewUrl)URL.revokeObjectURL(clothingPreviewUrl);clothingPreviewUrl=URL.createObjectURL(file);$("#clothingPreviewImage").src=clothingPreviewUrl;$("#clothingPreview").classList.remove("hidden")}
async function renderClothingRefs(){
 const refs=(await getAll("clothingRefs")).sort((a,b)=>b.createdAt-a.createdAt);
 const query=$("#clothingSearch").value.trim().toLowerCase();
 const filtered=refs.filter(r=>[r.title,r.description,...(r.tags||[])].join(" ").toLowerCase().includes(query));
 $("#clothingCount").textContent=String(refs.length).padStart(2,"0");
 $("#clothingGrid").innerHTML=filtered.map((r,i)=>{const url=URL.createObjectURL(r.blob);return '<article class="clothing-card" data-clothing="'+esc(r.id)+'" style="animation-delay:'+(i*40)+'ms"><div class="clothing-card-image"><img src="'+url+'" alt="'+esc(r.title)+'" loading="lazy"><span class="clothing-file-no">REF / '+String(i+1).padStart(3,"0")+'</span><span class="clothing-open">OPEN ↗</span></div><div class="clothing-card-info"><h3>'+esc(r.title)+'</h3><p>'+esc(r.description)+'</p><div class="clothing-card-bottom"><div class="clothing-tags">'+(r.tags||[]).slice(0,3).map(t=>'<span>#'+esc(t)+'</span>').join("")+'</div><button type="button" data-copy-clothing="'+esc(r.id)+'">COPY TEXT ▣</button></div></div></article>'}).join("");
 $("#clothingEmpty").classList.toggle("hidden",filtered.length>0);
 $("#clothingGrid").classList.toggle("hidden",filtered.length===0);
}
async function openClothingDetail(id){
 const ref=await getOne("clothingRefs",id);if(!ref)return;activeClothingRef=ref;
 if(clothingDetailUrl)URL.revokeObjectURL(clothingDetailUrl);
 clothingDetailUrl=URL.createObjectURL(ref.blob);
 $("#clothingDetailImage").src=clothingDetailUrl;$("#clothingDetailImage").alt=ref.title;
 $("#clothingDetailTitle").textContent=ref.title;
 $("#clothingDetailCode").textContent=ref.id.slice(-6).toUpperCase();
 $("#clothingDetailDescription").textContent=ref.description;
 $("#clothingDetailTags").innerHTML=(ref.tags||[]).map(t=>'<span>#'+esc(t)+'</span>').join("");
 $("#downloadClothingImage").href=clothingDetailUrl;
 $("#downloadClothingImage").download=(ref.title||"clothing-reference").replace(/[^\w\-]+/g,"-")+".webp";
 showModal("clothingDetailModal");
}
async function copyClothingDescription(ref){
 const text=ref.description||"";
 try{
   if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);
   else{const area=document.createElement("textarea");area.value=text;area.style.position="fixed";area.style.opacity="0";document.body.appendChild(area);area.select();if(!document.execCommand("copy"))throw new Error("Clipboard unavailable");area.remove()}
   toast("ОПИСАНИЕ СКОПИРОВАНО ✧");
 }catch(error){console.error("ASHQD copy description failed:",error);toast("НЕ УДАЛОСЬ СКОПИРОВАТЬ ТЕКСТ")}
}

function showHome(){currentCharacterId=null;$("#homeView").classList.remove("hidden");$("#characterView").classList.add("hidden");window.scrollTo({top:0,behavior:"smooth"});renderCharacters();renderClothingRefs()}
function setBranchView(){ $("#homeView").classList.add("hidden");$("#characterView").classList.remove("hidden");window.scrollTo({top:0,behavior:"smooth"})}
async function renderCharacters(){
 const [characters,photos]=await Promise.all([getAll("characters"),getAll("photos")]);
 characters.sort((a,b)=>b.createdAt-a.createdAt);
 const query=$("#searchInput").value.trim().toLowerCase();
 const filtered=characters.filter(c=>[c.name,c.bio,...(c.tags||[])].join(" ").toLowerCase().includes(query));
 $("#characterCount").textContent=String(characters.length).padStart(2,"0");
 $("#characterGrid").innerHTML=filtered.map((c,index)=>{const count=photos.filter(p=>p.characterId===c.id).length;return '<article class="branch-card" data-character="'+esc(c.id)+'" style="animation-delay:'+(index*45)+'ms"><div class="branch-top"><span>FILE / '+String(index+1).padStart(3,"0")+'</span><span class="branch-icon">✧</span></div><h3 class="branch-name">'+esc(c.name)+'</h3><p class="branch-bio">'+esc(c.bio||"Персональная ветка персонажа. Нажми, чтобы открыть архив.")+'</p><div class="branch-tags">'+(c.tags||[]).slice(0,4).map(t=>"<span>#"+esc(t)+"</span>").join("")+'</div><div class="branch-footer"><span class="branch-meta">'+String(count).padStart(2,"0")+' IMAGE FILES</span><span class="branch-open">OPEN FILE <b>↗</b></span></div></article>'}).join("");
 $("#emptyState").classList.toggle("hidden",filtered.length>0);
 $("#characterGrid").classList.toggle("hidden",filtered.length===0);
}
async function openCharacter(id){
 const character=await getOne("characters",id);if(!character)return;
 currentCharacterId=id;
 $("#characterCode").textContent=id.slice(-6).toUpperCase();
 $("#characterName").textContent=character.name;
 $("#characterBio").textContent=character.bio||"Описание пока не добавлено.";
 $("#characterTags").innerHTML=(character.tags||[]).map(t=>"<span>#"+esc(t)+"</span>").join("");
 setBranchView();await renderPhotos();
}
async function renderPhotos(){
 if(!currentCharacterId)return;
 const allPhotos=(await getAll("photos")).filter(p=>p.characterId===currentCharacterId).sort((a,b)=>b.createdAt-a.createdAt);
 $("#photoCount").textContent=String(allPhotos.length).padStart(2,"0")+" FILES";
 $("#photoGrid").innerHTML=allPhotos.map((p,i)=>{const url=URL.createObjectURL(p.blob);return '<article class="photo-card" data-photo="'+esc(p.id)+'"><div class="photo-thumb"><img src="'+url+'" alt="'+esc(p.title||"Character photo")+'"><span class="photo-index">IMG / '+String(i+1).padStart(2,"0")+'</span><button class="photo-copy-small" data-copy-photo="'+esc(p.id)+'" type="button">▣ COPY</button></div><div class="photo-caption"><b>'+esc(p.title||"Untitled reference")+'</b><span>'+new Date(p.createdAt).toLocaleDateString("ru-RU")+'</span></div></article>'}).join("");
 $("#photoEmpty").classList.toggle("hidden",allPhotos.length>0);
 $("#photoGrid").classList.toggle("hidden",allPhotos.length===0);
}
async function openPhoto(id){
 const photo=await getOne("photos",id);if(!photo)return;activePhoto=photo;
 if(fullImageUrl)URL.revokeObjectURL(fullImageUrl);
 fullImageUrl=URL.createObjectURL(photo.blob);
 $("#fullImage").src=fullImageUrl;$("#fullImage").alt=photo.title||"Character photo";
 $("#imageTitle").textContent=photo.title||"Untitled reference";$("#imageNote").textContent=photo.note||"";
 $("#imageFileCode").textContent=photo.id.slice(-6).toUpperCase();
 const ext=photo.blob.type==="image/png"?"png":"webp";
 $("#downloadPhoto").href=fullImageUrl;$("#downloadPhoto").download=(photo.title||"ashqd-image").replace(/[^\w\-]+/g,"-")+"."+ext;
 showModal("imageModal");
}
async function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
async function copyPhoto(photo){
 try{
   let pngBlob;
   if(photo.blob.type==="image/png")pngBlob=photo.blob;
   else{const bitmap=await createImageBitmap(photo.blob);const canvas=document.createElement("canvas");canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext("2d").drawImage(bitmap,0,0);pngBlob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));bitmap.close()}
   if(!navigator.clipboard||!window.ClipboardItem)throw new Error("Clipboard API unavailable");
   await navigator.clipboard.write([new ClipboardItem({"image/png":pngBlob})]);
   toast("IMAGE COPIED TO CLIPBOARD ✧");
 }catch(error){await downloadBlob(photo.blob,(photo.title||"ashqd-image")+".webp");toast("БРАУЗЕР НЕ РАЗРЕШИЛ КОПИРОВАНИЕ — ФОТО СКАЧАНО")}
}
$("#openCharacter").addEventListener("click",()=>showModal("characterModal"));
$("#heroCreate").addEventListener("click",()=>showModal("characterModal"));
$("#emptyCreate").addEventListener("click",()=>showModal("characterModal"));
$("#brandHome").addEventListener("click",e=>{e.preventDefault();showHome()});
$("#footerHome").addEventListener("click",e=>{e.preventDefault();showHome()});
$("#navBranches").addEventListener("click",e=>{e.preventDefault();showHome();document.querySelector("#catalog").scrollIntoView({behavior:"smooth"})});
$("#navAbout").addEventListener("click",e=>{e.preventDefault();if($("#homeView").classList.contains("hidden"))showHome();setTimeout(()=>$("#about").scrollIntoView({behavior:"smooth"}),20)});
$("#searchInput").addEventListener("input",renderCharacters);
$("#characterGrid").addEventListener("click",e=>{const card=e.target.closest("[data-character]");if(card)openCharacter(card.dataset.character)});
$("#backToBranches").addEventListener("click",showHome);
$("#addPhoto").addEventListener("click",()=>{clearPreview();$("#photoForm").reset();showModal("photoModal")});
$("#emptyAddPhoto").addEventListener("click",()=>$("#addPhoto").click());
$("#photoFile").addEventListener("change",e=>filePreview(e.target.files[0]));
$("#clearPhoto").addEventListener("click",clearPreview);
$("#uploadZone").addEventListener("dragover",e=>{e.preventDefault();e.currentTarget.classList.add("dragging")});
$("#uploadZone").addEventListener("dragleave",e=>e.currentTarget.classList.remove("dragging"));
$("#uploadZone").addEventListener("drop",e=>{e.preventDefault();e.currentTarget.classList.remove("dragging");const file=e.dataTransfer.files[0];if(file&&file.type.startsWith("image/")){const dt=new DataTransfer();dt.items.add(file);$("#photoFile").files=dt.files;filePreview(file)}});
document.addEventListener("paste",e=>{if($("#photoModal").classList.contains("hidden"))return;const item=Array.from(e.clipboardData.items||[]).find(x=>x.type.startsWith("image/"));if(item){const file=item.getAsFile();const dt=new DataTransfer();dt.items.add(file);$("#photoFile").files=dt.files;filePreview(file);toast("IMAGE READY TO SAVE ✧")}});
$("#characterForm").addEventListener("submit",async e=>{e.preventDefault();const submit=e.currentTarget.querySelector("button[type=submit]");submit.disabled=true;submit.textContent="SAVING...";try{if(!db)throw new Error("База данных не подключилась. Обнови страницу и попробуй снова.");const data=new FormData(e.currentTarget);const name=String(data.get("name")||"").trim();if(!name)throw new Error("Введи имя персонажа.");const character={id:makeId(),name,bio:String(data.get("bio")||"").trim(),tags:String(data.get("tags")||"").split(",").map(x=>x.trim().replace(/^#/,"")).filter(Boolean),createdAt:Date.now()};await put("characters",character);await renderCharacters();e.currentTarget.reset();closeModal("characterModal");toast("ПЕРСОНАЖ СОЗДАН ✧")}catch(error){console.error("ASHQD character save failed:",error);toast("НЕ УДАЛОСЬ СОХРАНИТЬ: "+(error?.message||"ошибка базы данных"));}finally{submit.disabled=false;submit.textContent="CREATE BRANCH ↗"}});
$("#photoForm").addEventListener("submit",async e=>{e.preventDefault();if(!currentCharacterId){toast("СНАЧАЛА ОТКРОЙ ВЕТКУ ПЕРСОНАЖА");return}const submit=e.currentTarget.querySelector("button[type=submit]");submit.disabled=true;submit.textContent="SAVING...";try{if(!db)throw new Error("База данных не подключилась");const file=$("#photoFile").files[0];if(!file)throw new Error("Сначала выбери изображение");if(file.size>20*1024*1024)throw new Error("Файл слишком большой (лимит 20 МБ)");const data=new FormData(e.currentTarget);const blob=await compressImage(file);const photo={id:makeId(),characterId:currentCharacterId,title:String(data.get("title")||"").trim(),note:String(data.get("note")||"").trim(),blob,createdAt:Date.now()};await put("photos",photo);await renderPhotos();e.currentTarget.reset();closeModal("photoModal");toast("ФОТО СОХРАНЕНО В ГАЛЕРЕЮ ✧")}catch(error){console.error("ASHQD photo save failed:",error);toast("НЕ УДАЛОСЬ СОХРАНИТЬ: "+(error?.message||"ошибка базы данных"))}finally{submit.disabled=false;submit.textContent="SAVE TO GALLERY ↗"}});
$("#photoGrid").addEventListener("click",async e=>{const copy=e.target.closest("[data-copy-photo]");if(copy){e.stopPropagation();const photo=await getOne("photos",copy.dataset.copyPhoto);if(photo)await copyPhoto(photo);return}const card=e.target.closest("[data-photo]");if(card)openPhoto(card.dataset.photo)});
$("#copyPhoto").addEventListener("click",()=>{if(activePhoto)copyPhoto(activePhoto)});
$("#deletePhoto").addEventListener("click",async()=>{if(!activePhoto)return;if(!confirm("Удалить это фото из ветки персонажа?"))return;await remove("photos",activePhoto.id);activePhoto=null;closeModal("imageModal");await renderPhotos();toast("PHOTO DELETED")});
$("#deleteCharacter").addEventListener("click",async()=>{if(!currentCharacterId)return;if(!confirm("Удалить ветку персонажа и все фотографии внутри неё? Это действие нельзя отменить."))return;const photos=(await getAll("photos")).filter(p=>p.characterId===currentCharacterId);for(const photo of photos)await remove("photos",photo.id);await remove("characters",currentCharacterId);showHome();toast("CHARACTER BRANCH DELETED")});

$("#navClothing").addEventListener("click",e=>{e.preventDefault();if($("#homeView").classList.contains("hidden"))showHome();setTimeout(()=>$("#clothingCatalog").scrollIntoView({behavior:"smooth"}),20)});
$("#openClothingModal").addEventListener("click",()=>{clearClothingPreview();$("#clothingForm").reset();showModal("clothingModal")});
$("#emptyClothingCreate").addEventListener("click",()=>$("#openClothingModal").click());
$("#clothingFile").addEventListener("change",e=>renderClothingPreview(e.target.files[0]));
$("#clearClothingPhoto").addEventListener("click",clearClothingPreview);
$("#clothingSearch").addEventListener("input",renderClothingRefs);
$("#clothingGrid").addEventListener("click",async e=>{
 const copy=e.target.closest("[data-copy-clothing]");
 if(copy){e.stopPropagation();const ref=await getOne("clothingRefs",copy.dataset.copyClothing);if(ref)await copyClothingDescription(ref);return}
 const card=e.target.closest("[data-clothing]");if(card)openClothingDetail(card.dataset.clothing);
});
$("#clothingForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const submit=e.currentTarget.querySelector("button[type=submit]");
 submit.disabled=true;submit.textContent="SAVING...";
 try{
   if(!db)throw new Error("База данных не подключилась");
   const data=new FormData(e.currentTarget);
   const file=$("#clothingFile").files[0];
   if(!file)throw new Error("Выбери фотографию одежды");
   if(file.size>20*1024*1024)throw new Error("Файл слишком большой (лимит 20 МБ)");
   const title=String(data.get("title")||"").trim();
   const description=String(data.get("description")||"").trim();
   if(!title||!description)throw new Error("Заполни название и описание");
   const blob=await compressImage(file);
   const ref={id:makeId(),title,description,blob,tags:String(data.get("tags")||"").split(",").map(x=>x.trim().replace(/^#/,"")).filter(Boolean),createdAt:Date.now()};
   await put("clothingRefs",ref);
   await renderClothingRefs();
   e.currentTarget.reset();closeModal("clothingModal");
   toast("CLOTHING REF ADDED ✧");
 }catch(error){console.error("ASHQD clothing ref save failed:",error);toast("НЕ УДАЛОСЬ СОХРАНИТЬ: "+(error?.message||"ошибка хранилища"))}
 finally{submit.disabled=false;submit.textContent="SAVE CLOTHING REF ↗"}
});
$("#copyClothingDescription").addEventListener("click",()=>{if(activeClothingRef)copyClothingDescription(activeClothingRef)});
$("#deleteClothingRef").addEventListener("click",async()=>{
 if(!activeClothingRef)return;
 if(!confirm("Удалить этот референс одежды?"))return;
 await remove("clothingRefs",activeClothingRef.id);activeClothingRef=null;
 closeModal("clothingDetailModal");await renderClothingRefs();toast("CLOTHING REF DELETED");
});

document.querySelectorAll("[data-close]").forEach(button=>button.addEventListener("click",()=>closeModal(button.dataset.close)));
document.querySelectorAll(".modal-backdrop").forEach(modal=>modal.addEventListener("click",e=>{if(e.target===modal)closeModal(modal.id)}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".modal-backdrop:not(.hidden)").forEach(m=>closeModal(m.id))});
(async()=>{try{if(!("indexedDB" in window))throw new Error("IndexedDB недоступна в этом браузере");db=await openDB();localStorage.removeItem("ashqd-outfits-v2");localStorage.removeItem("ashqd-favorites-v1");await renderCharacters();await renderClothingRefs()}catch(error){console.error("ASHQD database init failed:",error);toast("ОШИБКА ХРАНИЛИЩА: "+(error?.message||"разреши данные сайтов в браузере"))}})();