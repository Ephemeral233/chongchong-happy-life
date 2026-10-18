import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const input=process.argv[2];
if(!input){console.error('用法：node tools/publish-album.mjs /完整路径/相册备份.json');process.exit(1)}
const inputPath=path.resolve(input);
if(fs.statSync(inputPath).size>250*1024*1024)throw Error('备份超过 250 MB。');
const raw=JSON.parse(fs.readFileSync(inputPath,'utf8').replace(/^\uFEFF/,''));
if(raw.app!=='chongchong-happy-life'||![1,2].includes(raw.version)||!Array.isArray(raw.memories)||!Array.isArray(raw.wishes)||raw.memories.length>1000||raw.wishes.length>1000)throw Error('请选择虫虫手账导出的完整备份。');
const ids=new Set(),photos=new Map();
const kinds=['travel','food','daily'];
const covers=['vlad','hohhot','tianjin','aranya','salmon','daily'];
const string=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
function id(value){if(!string(value,120,true)||ids.has(value))throw Error('记录编号缺失或重复。');ids.add(value);return value}
function photo(value){
  if(typeof value!=='string')throw Error('照片格式无效。');
  if(/^assets\/(together|green|pink)\.png$/.test(value)||/^assets\/photos\/[a-f0-9]{64}\.(jpeg|png|webp)$/.test(value)){
    if(!fs.existsSync(path.join(root,value)))throw Error('备份引用的照片文件不在项目中：'+value);
    return value;
  }
  const match=value.length<=4000000&&value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw Error('照片应是 JPG、PNG、WebP 或项目内的照片。');
  const bytes=Buffer.from(match[2],'base64');
  const signature=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!signature)throw Error('照片内容与格式不一致。');
  const destination='assets/photos/'+createHash('sha256').update(bytes).digest('hex')+'.'+match[1];photos.set(destination,bytes);return destination;
}
const memories=raw.memories.map(m=>{
  if(!m||!kinds.includes(m.type)||!string(m.title,80,true)||!string(m.place,60)||!string(m.text,5000)||typeof m.date!=='string'||(m.date!==''&&(!/^\d{4}-\d{2}-\d{2}$/.test(m.date)||Number.isNaN(Date.parse(m.date+'T00:00:00Z'))||new Date(m.date+'T00:00:00Z').toISOString().slice(0,10)!==m.date))||!Array.isArray(m.photos)||m.photos.length>200)throw Error('有一页的标题、日期或照片格式不完整。');
  return {id:id(m.id),type:m.type,title:m.title,place:m.place,date:m.date,text:m.text,cover:covers.includes(m.cover)?m.cover:'daily',caption:typeof m.caption==='string'?m.caption.slice(0,160):'',photos:m.photos.map(photo)};
});
const wishes=raw.wishes.map(w=>{if(!w||!string(w.title,100,true)||typeof w.done!=='boolean')throw Error('愿望格式不完整。');return {id:id(w.id),title:w.title,done:w.done}});
for(const [destination,bytes]of photos){fs.mkdirSync(path.dirname(path.join(root,destination)),{recursive:true});fs.writeFileSync(path.join(root,destination),bytes)}
fs.writeFileSync(path.join(root,'journal.json'),JSON.stringify({version:2,memories,wishes},null,2)+'\n');
console.log(`已准备 ${memories.length} 段回忆、${wishes.length} 个愿望和 ${photos.size} 张新增照片。提交并推送后，网站会更新。`);
