import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileOpener } from '@capacitor-community/file-opener';
import { supabase } from './data.js';
import { isNative } from './native.js';
import { uid } from './util.js';

export const MAX_FILES = 3;
const BUCKET = 'attachments';
const MAX_PDF = 5 * 1024 * 1024, MAX_IMAGE_IN = 15 * 1024 * 1024, IMG_EDGE = 1600;

/* ---------- local blob store (IndexedDB) ---------- */
let dbp = null;
function db(){
  if(!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open('finly-files', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('blobs');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn){ const d = await db(); return new Promise((res, rej) => { const t = d.transaction('blobs', mode), s = t.objectStore('blobs'); const q = fn(s); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); }); }
export const putLocal = (id, blob) => tx('readwrite', s => s.put(blob, id));
export const getLocal = id => tx('readonly', s => s.get(id));
export const delLocal = id => tx('readwrite', s => s.delete(id));

/* ---------- picking & preparing ---------- */
export class FileError extends Error {}
const extOf = type => type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
async function shrinkImage(file){
  const bmp = await createImageBitmap(file).catch(() => null);
  if(!bmp) throw new FileError('That image couldn\'t be read. Try a JPG or PNG.');
  const k = Math.min(1, IMG_EDGE / Math.max(bmp.width, bmp.height));
  if(k === 1 && file.size < 900 * 1024 && /jpe?g|png|webp/.test(file.type)) return file;
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
}
/** Validates and (for photos) compresses a picked file. Returns { meta, blob }. */
export async function prepareFile(file){
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImg = /^image\//.test(file.type);
  if(!isPdf && !isImg) throw new FileError('Only photos and PDFs can be attached.');
  if(isPdf && file.size > MAX_PDF) throw new FileError('PDFs must be under 5 MB.');
  if(isImg && file.size > MAX_IMAGE_IN) throw new FileError('That photo is too large (max 15 MB).');
  const blob = isPdf ? file : await shrinkImage(file);
  const type = isPdf ? 'application/pdf' : (blob.type || 'image/jpeg');
  const name = (file.name || (isPdf ? 'document.pdf' : 'photo.jpg')).replace(/[^\w.\- ()]/g, '_').slice(0, 60);
  return { meta:{ id:uid(), name, type, size:blob.size, path:null, at:new Date().toISOString() }, blob };
}

/* ---------- opening ---------- */
async function blobFor(att){
  let b = await getLocal(att.id).catch(() => null);
  if(b) return b;
  if(!att.path) throw new FileError('This file hasn\'t finished uploading from the other device yet.');
  if(!navigator.onLine) throw new FileError('Connect to the internet to download this file.');
  const { data, error } = await supabase.storage.from(BUCKET).download(att.path);
  if(error) throw new FileError('Couldn\'t download the file. Please try again.');
  await putLocal(att.id, data).catch(() => {});
  return data;
}
export async function thumbUrl(att){
  if(!/^image\//.test(att.type)) return null;
  const b = await getLocal(att.id).catch(() => null);
  return b ? URL.createObjectURL(b) : null;
}
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
export async function openBlob(blob, att){
  if(isNative){
    const path = `open-${att.id}.${extOf(att.type)}`;
    const w = await Filesystem.writeFile({ path, data: await toB64(blob), directory: Directory.Cache });
    await FileOpener.open({ filePath: w.uri, contentType: att.type, openWithDefault: true });
    return;
  }
  const url = URL.createObjectURL(new Blob([blob], { type: att.type }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function openAttachment(att){ return openBlob(await blobFor(att), att); }

/* ---------- background upload + cleanup (runs after each data sync) ---------- */
let busy = false;
/**
 * items: current items; markUploaded(itemId, attId, path) persists the path;
 * deletes: queued storage paths that may be orphaned; isReferenced(path) checks current data.
 */
export async function syncFiles({ userId, items, markUploaded, deletes, isReferenced, clearDelete }){
  if(busy || !supabase?.storage || !navigator.onLine) return;
  busy = true;
  try{
    for(const it of items){
      for(const a of it.files || []){
        if(a.path) continue;
        const blob = await getLocal(a.id).catch(() => null);
        if(!blob) continue;
        const path = `${userId}/${a.id}.${extOf(a.type)}`;
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType:a.type, upsert:true });
        if(error){ console.warn('Upload failed', error); continue; }
        markUploaded(it.id, a.id, path);
      }
    }
    const gone = deletes.filter(p => !isReferenced(p));
    if(gone.length){
      const { error } = await supabase.storage.from(BUCKET).remove(gone);
      if(!error) gone.forEach(clearDelete);
    }
    deletes.filter(isReferenced).forEach(clearDelete);
  }catch(e){ console.warn('File sync failed', e); }
  finally{ busy = false; }
}
