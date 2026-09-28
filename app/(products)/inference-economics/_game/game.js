/*
 * 推理经济学 2022–2028 · Inference Economics — the game, one file.
 *
 * Eight self-contained blocks, in the order the original page ran them:
 *   0 the inference engine (formulas, settlement)     4 the pretraining shell + glossary
 *   1 the inference line's UI, saves, lessons, demo   5 the pretraining line's rendering
 *   2 the pretraining line's data (from the DB)       6 the pretraining line's controls + saves
 *   3 the pretraining engine                          7 the home menu
 *
 * Two things differ from the standalone page. The world — hardware, years,
 * the tech tree, power plans, cards, architectures, research, the glossary —
 * is read from window.__IE_DATA, which the page loads from the product's
 * database before this file runs (data/seed.json is its initial value). And
 * saves go through window.__IE_STORE, which the page backs with the
 * product's database so a person's progress follows their account; the
 * browser's own storage is only a fallback. Finished runs are reported the
 * same way, for the leaderboard.
 */

(function(){
"use strict";
const $=id=>document.getElementById(id);
const CFG=window.__IE_DATA.config;
const SEC_PER_YEAR=CFG.SEC_PER_YEAR, PUE=CFG.PUE, KWH=CFG.KWH;
/* 实测 MBU 与集群利用率的合并折扣：峰值模型 × 0.5 才接近真实 */
const EFF=CFG.EFF;

/* ============ 硬件（真实规格；Rubin Ultra 与 Feynman 为推算） ============ */
/* 硬件、年份、技术栈、电力方案都来自产品数据库（data/seed.json 是初始值） */
const HW=window.__IE_DATA.hardware;
const HWM={}; HW.forEach(h=>HWM[h.k]=h);

/* ============ 七个年份 ============ */
const YEARS=window.__IE_DATA.years;

/* ============ 技术栈 ============ */
const TECH=window.__IE_DATA.tech;

/* ============ 电力方案 ============ */
function PWR(year){
 const ferc = year>=CFG.FERC_YEAR ? CFG.FERC_MULT : 1.0;
 return window.__IE_DATA.power.map(o=>({k:o.k,n:o.n,mw:o.mw,px:o.ferc?o.px*ferc:o.px,lead:o.lead,desc:o.desc}));
}

/* ============ 状态 ============ */
const S={
 i:0, cash:CFG.start_bu1.cash, eng:CFG.start_bu1.eng, power:CFG.start_bu1.power, pending:[], fleet:{}, far:false,
 tech:{}, off:{}, newTech:{}, cumTok:0, cumRev:0, cumCost:0, trace:[], slaOk:0,
 /* ---- 会计账 ---- */
 capital:CFG.start_bu1.cash,          /* 实收资本 */
 gpuCapex:0, gpuAccDep:0,   /* 机队原值 / 累计折旧（3 年直线） */
 pwCapex:0,  pwAccDep:0,    /* 电力设施原值 / 累计摊销（10 年直线） */
 debt:0, retained:0,        /* 信贷负债 / 留存收益 */
 fin:[],                    /* 逐年三表明细 */
 buyKey:'h100', buy:{}, pwKey:'none', cfg:{}, batchI:0, tpI:1, w:2, kv:2, wWant:2, kvWant:2
};
const BATCH=CFG.BATCH, TPS=CFG.TPS;

/* ============ 格式化 ============ */
const f1=n=>n.toFixed(1);
function fT(x){ if(x>=1e12)return (x/1e12).toFixed(1)+'T'; if(x>=1e9)return (x/1e9).toFixed(1)+'B';
  if(x>=1e6)return (x/1e6).toFixed(1)+'M'; if(x>=1e3)return (x/1e3).toFixed(1)+'K'; return x.toFixed(0); }
function fM(m){ return m>=1000 ? '$'+(m/1000).toFixed(2)+'B' : '$'+m.toFixed(0)+'M'; }
const fB=b=> b>=1e9 ? (b/1e9).toFixed(1)+' GB' : (b/1e6).toFixed(0)+' MB';
const fF=f=> f>=1e12 ? (f/1e12).toFixed(2)+' TFLOP' : (f/1e9).toFixed(0)+' GFLOP';
const gn=n=>n.toLocaleString('en-US');

/* 生效的技术栈 = 已解锁 且 本年未停用；依赖失效则一并失效 */
function TE(){
 const o={};
 for(const k in S.tech){ if(S.tech[k] && !S.off[k]) o[k]=true; }
 if(!o.q8) delete o.q4;                 /* FP4 依赖 FP8 通路 */
 return o;
}

/* ============ 核心：完全用文档里那套公式结算 ============ */
/* 每一型卡有自己的运行参数；机队是混编的 */
function defCfg(){ return {batchI:0,tpI:1,w:2,kv:2}; }
function cfgOf(k,opt){
 if(opt && opt.hwKey===k) return opt;
 return S.cfg[k] || (S.cfg[k]=defCfg());
}
function evalOne(h,c,Y,T){
 const B=BATCH[c.batchI], tp=TPS[c.tpI], w=c.w, kvq=c.kv/2;
 let peak,fmt,fp4miss=false;
 if(w===0.5 && h.f4){peak=h.f4;fmt='NVFP4';}
 else if(w===0.5){peak=h.f16;fmt='W4A16';fp4miss=true;}
 else if(w===1){peak=h.f8;fmt='FP8';}
 else {peak=h.f16;fmt='BF16';}
 const kvPer=Y.kvKB*1024*(T.mla?1/6:1)*kvq;
 const Leff=T.lin? Math.min(Y.L,8192) : Y.L;
 let wBytes=Y.P*w/tp;
 if(T.moe) wBytes*= h.nvl?0.6:1;
 const kvBytes=B*Leff*kvPer/tp, total=wBytes+kvBytes;
 const flops=2*Y.P*B/tp*(T.moe?1/8:1);
 const memMs=total/h.bw*1000, cmpMs=flops/peak*1000;
 const tpTax=1+0.07*(tp-1);
 let tpot=Math.max(memMs,cmpMs)*tpTax;
 const I=flops/total, ridge=peak/h.bw, memBound=memMs>=cmpMs;
 let specMul=1; if(T.spec) specMul = B<=8?1.9 : (B<=16?1.15:0.75);
 let pref=Y.L; if(T.radix) pref*=0.25;
 let ttft=2*Y.P*pref/tp/peak*1000*(T.moe?1/8:1);
 if(T.disagg) ttft*=0.55;
 if(S.far) ttft+=90;
 if(!T.chunk && ttft>600) tpot*=1.25;
 const resident=Y.P*w/tp+kvBytes;
 const oom=resident>h.cap*0.93;
 const perGpu=oom?0:(B*1000/tpot)*specMul/tp*EFF;
 return {B:B,tp:tp,w:w,kvq:kvq,peak:peak,fmt:fmt,fp4miss:fp4miss,kvPer:kvPer,Leff:Leff,
  wBytes:wBytes,kvBytes:kvBytes,total:total,flops:flops,memMs:memMs,cmpMs:cmpMs,tpTax:tpTax,
  tpot:tpot,I:I,ridge:ridge,memBound:memBound,specMul:specMul,ttft:ttft,resident:resident,
  oom:oom,perGpu:perGpu,sla:(!oom && tpot<=50 && ttft<=1000)};
}
function sim(opt){
 const Y=YEARS[S.i], T=TE(), hw=HWM[opt.hwKey]||HW[0];
 const focus=evalOne(hw,opt,Y,T);
 const agg={};
 Object.keys(S.fleet).forEach(k=>{ if(S.fleet[k]>0) agg[k]=(agg[k]||0)+S.fleet[k]; });
 const buys=opt.buys||{};
 Object.keys(buys).forEach(k=>{ if(buys[k]>0) agg[k]=(agg[k]||0)+buys[k]; });
 const rows=Object.keys(agg).map(k=>({k:k,n:agg[k],h:HWM[k],e:evalOne(HWM[k],cfgOf(k,opt),Y,T)}));
 /* 供电顺序：每瓦产出高的先上；产出为 0 的不通电（不耗电，但照样折旧） */
 rows.sort((a,b)=>(b.e.perGpu/b.h.kw)-(a.e.perGpu/a.h.kw));
 let budgetW=S.power*1e6/PUE;
 let capTok=0,capOk=0,usedW=0,fleetN=0,litN=0,idleN=0;
 const mix=[];
 rows.forEach(r2=>{
  fleetN+=r2.n;
  let lit=0;
  if(r2.e.perGpu>0){ lit=Math.min(r2.n, Math.floor(budgetW/(r2.h.kw*1000))); budgetW-=lit*r2.h.kw*1000; }
  litN+=lit; idleN+=r2.n-lit; usedW+=lit*r2.h.kw*1000*PUE;
  capTok+=lit*r2.e.perGpu; capOk+=lit*r2.e.perGpu*(r2.e.sla?1:0.6);
  mix.push({k:r2.k,n:r2.n,lit:lit,idle:r2.n-lit,perGpu:r2.e.perGpu,oom:r2.e.oom,
    need:r2.e.resident,cap:r2.h.cap,kw:r2.h.kw,tpot:r2.e.tpot,ttft:r2.e.ttft,sla:r2.e.sla,e:r2.e});
 });
 mix.sort((a,b)=>HWM[b.k].bw-HWM[a.k].bw);
 let needW=0;
 mix.forEach(m=>{ if(m.perGpu>0) needW+=m.n*m.kw*1000*PUE; });
 const elecM=usedW/1000*8760*KWH/1e6;
 const out={hw:hw,mix:mix,fleetN:fleetN,fleetPow:litN,idleN:idleN,capTok:capTok,capOk:capOk,
   elecM:elecM,powerUsedMW:usedW/1e6,powerNeedMW:needW/1e6,powerMW:S.power,
   powerFit:(needW>0? Math.min(1,(S.power*1e6)/needW) : 1),
   powered:Math.floor(S.power*1e6/(hw.kw*1000*PUE)),
   buyCost:Object.keys(buys).reduce((a,k)=>a+buys[k]*HWM[k].px,0), buys:buys};
 for(const k in focus) out[k]=focus[k];
 return out;
}
window.__G={S:S,sim:sim,TE:TE,evalOne:evalOne,cfgOf:cfgOf,defCfg:defCfg,YEARS:YEARS,HW:HW,TECH:TECH,PWR:PWR,BATCH:BATCH,TPS:TPS};
})();


(function(){
"use strict";
const G=window.__G, S=G.S, YEARS=G.YEARS, HW=G.HW, TECH=G.TECH, BATCH=G.BATCH, TPS=G.TPS;
const HWM={}; HW.forEach(h=>HWM[h.k]=h);
const $=id=>document.getElementById(id);
const SEC=3.15e7, PUE=1.15, KWH=0.07;
function fT(x){ if(x>=1e12)return (x/1e12).toFixed(1)+'T'; if(x>=1e9)return (x/1e9).toFixed(1)+'B';
  if(x>=1e6)return (x/1e6).toFixed(1)+'M'; if(x>=1e3)return (x/1e3).toFixed(1)+'K'; return x.toFixed(0); }
function fM(m){ return Math.abs(m)>=1000 ? '$'+(m/1000).toFixed(2)+'B' : '$'+m.toFixed(0)+'M'; }
const fB=b=> b>=1e9?(b/1e9).toFixed(1)+' GB':(b/1e6).toFixed(0)+' MB';
const fF=f=> f>=1e12?(f/1e12).toFixed(2)+' TFLOP':(f/1e9).toFixed(0)+' GFLOP';
const gn=n=>n.toLocaleString('en-US');
let PW=[];
const FRESH=JSON.parse(JSON.stringify(S));

/* ================= 名词 tooltip ================= */
const TERMS=Object.assign({}, window.__IE_DATA.terms.bu1);
function buildKeys(){ return Object.keys(TERMS).sort((a,b)=>b.length-a.length).map(k=>({
  k:k, re:/^[\x20-\x7e]+$/.test(k)
        ? new RegExp('(?<![A-Za-z0-9/])'+k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![A-Za-z0-9])','i')
        : new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))
})); }
let TKEYS=buildKeys();
function annotate(root){
  if(!root) return;
  const used={};
  const walk=node=>{
    for(let i=0;i<node.childNodes.length;i++){
      const c=node.childNodes[i];
      if(c.nodeType===3){
        const txt=c.nodeValue; if(!txt||txt.length<2) continue;
        for(const t of TKEYS){
          if(used[t.k]) continue;
          const m=t.re.exec(txt); if(!m) continue;
          const span=document.createElement('span');
          span.className='tt'; span.setAttribute('data-tip',TERMS[t.k]);
          if(!node.closest('button')) span.tabIndex=0;
          span.textContent=m[0];
          const after=c.splitText(m.index); after.nodeValue=after.nodeValue.slice(m[0].length);
          node.insertBefore(span,after); used[t.k]=1; i++; break;
        }
      } else if(c.nodeType===1 && !c.classList.contains('tt')) walk(c);
    }
  };
  walk(root);
}
/* 共享的固定定位气泡：不会被任何滚动容器裁切 */
const TIP=document.createElement('div'); TIP.id='tipbox'; document.body.appendChild(TIP);
let tipEl=null;
function showTip(el){
 const txt=el.getAttribute('data-tip'); if(!txt) return;
 tipEl=el; TIP.textContent=txt; TIP.classList.add('on');
 TIP.style.left='0px'; TIP.style.top='0px';
 const r=el.getBoundingClientRect(), t=TIP.getBoundingClientRect();
 let x=r.left+r.width/2-t.width/2;
 x=Math.max(8,Math.min(x,innerWidth-t.width-8));
 let y=r.top-t.height-9;
 if(y<8) y=r.bottom+9;
 TIP.style.left=x+'px'; TIP.style.top=y+'px';
}
function hideTip(){ TIP.classList.remove('on'); tipEl=null; }
document.addEventListener('mouseover',e=>{
 const el=e.target.closest&&e.target.closest('.tt[data-tip]');
 if(el){ if(el!==tipEl) showTip(el); } else if(tipEl && !(e.target.closest&&e.target.closest('.tt'))) hideTip();
});
document.addEventListener('mouseleave',()=>hideTip(),true);
document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('.tt[data-tip]'); if(el)showTip(el);});
document.addEventListener('focusout',hideTip);
window.addEventListener('scroll',hideTip,true);

/* ---- 16:9 舞台：整幅画面等比缩放到窗口里 ---- */
const DESIGN_H=1072, DESIGN_W=Math.round(DESIGN_H*16/9);
function fitStage(){
 const app=document.querySelector('.app'); if(!app) return;
 if(innerWidth<1181){ app.style.transform=''; app.style.width=''; app.style.height=''; return; }
 const H=Math.min(innerHeight, innerWidth*9/16);
 const z=Math.max(0.5,Math.min(1.45, H/DESIGN_H));
 app.style.width=DESIGN_W+'px'; app.style.height=DESIGN_H+'px';
 app.style.transform='scale('+z+')';
}
addEventListener('resize',()=>{fitStage();hideTip();});

/* ================= 渲染 ================= */
function renderYear(){
 const Y=YEARS[S.i];
 $('hudYr').textContent=Y.y+' · 第 '+(S.i+1)+' / 7 回合';
 $('eraName').textContent=Y.era;
 $('eraTag').textContent=Y.tag;
 $('briefTag').textContent=Y.y+' Briefing';
 $('briefText').innerHTML=Y.brief.map(p=>'<p>'+p+'</p>').join('');
 $('wlBox').innerHTML=[
  ['模型',(Y.P/1e9)+'B'],['上下文',gn(Y.L)],['KV/tok',Y.kvKB+'KB'],
  ['需求',fT(Y.demand)+' tok/s'],['市场价','$'+Y.price.toFixed(1)+'/Mtok']
 ].map(r=>'<div class="wr"><span class="k">'+r[0]+'</span><span class="v">'+r[1]+'</span></div>').join('');
 $('evtBox').innerHTML = (Y.evt ? '<div class="evt"><div class="h">'+Y.evt.h+'</div><p>'+Y.evt.p+'</p></div>' : '')+
   '<p class="tiphint">虚线下划线的名词、以及所有选项按钮，悬停都有解释。</p>';
 annotate($('briefText')); annotate($('wlBox')); annotate($('evtBox'));
 $('btnGo').textContent='结算 '+Y.y+' 年';
 PW=G.PWR(Y.y); S.pwKey='none'; S.buy={}; PREV=null; PREVIN=null;
 const av=HW.filter(h=>h.from<=Y.y); S.buyKey=av[av.length-1].k;
 renderPower(); renderHw(); renderTech(); syncSelects(); refresh();
}
function renderPower(){
 $('pwOpts').innerHTML=PW.map(o=>{
  const cost=o.mw*o.px, isRec=YEARS[S.i].rec.pw===o.k;
  const tip=(o.mw?fM(cost)+' · '+o.lead+' 年后到位。':'')+o.desc;
  return '<button class="opt tt'+(S.pwKey===o.k?' on':'')+(isRec?' rec':'')+'" data-pw="'+o.k+'" data-tip="'+tip+'"'+(cost>S.cash?' disabled':'')+'>'+
   '<span class="t">'+o.n+(isRec?'<span class="recb">推荐</span>':'')+'</span>'+
   '<span class="s">'+(o.mw?'+'+o.mw+'MW · '+o.lead+'y · '+fM(cost):'跳过')+'</span></button>';
 }).join('');
 [].forEach.call($('pwOpts').children,b=>b.addEventListener('click',()=>{S.pwKey=(S.pwKey===b.dataset.pw&&b.dataset.pw!=='none')?'none':b.dataset.pw;renderPower();refresh();save();}));
 const pend=S.pending.filter(p=>p.at>YEARS[S.i].y);
 annotate($('pwOpts'));
 $('pwHint').textContent = pend.length? ('在途 '+pend.map(p=>'+'+p.mw+'MW@'+p.at).join(' / ')) : '每年只能启动一个';
}
function renderHw(){
 const y=YEARS[S.i].y;
 $('hwOpts').innerHTML=HW.map(h=>{
  const av=h.from<=y, own=S.fleet[h.k]||0, u=h.u;
  const cf=S.cfg[h.k];
  const tip=(av?(h.note+'　·　'+(h.bw/1e12).toFixed(2)+' TB/s · '+(h.cap/1e9).toFixed(0)+' GB · '+h.kw+' kW/张 · '+
        u.n+' 张/'+u.t+'（'+(h.kw*u.n).toFixed(0)+' kW/'+u.t+'）· '+fM(h.px*1000).replace('M','K')+'/张')
     :(h.from+' 年才上市：'+h.note))+
    (own?'　||　库存 '+gn(own)+' 张 = '+(own/u.n).toFixed(own%u.n?1:0)+' '+u.t+
        (cf?'，当前配置 batch '+BATCH[cf.batchI]+' / TP '+TPS[cf.tpI]:''):'　||　尚未持有');
  return '<button class="opt tt'+(S.buyKey===h.k?' on buy':'')+(av?'':' lock')+(own?' owned':'')+'" data-hw="'+h.k+'" data-tip="'+tip+'"'+(av?'':' disabled')+'>'+
   '<span class="t">'+h.n+'</span><span class="s">'+(own?gn(own)+'张':(av?(h.bw/1e12).toFixed(1)+'TB/s':h.from))+'</span></button>';
 }).join('');
 [].forEach.call($('hwOpts').children,b=>{ if(!b.disabled) b.addEventListener('click',()=>{
   const k=b.dataset.hw, fresh=!S.cfg[k];
   S.buyKey=k; if(fresh) S.cfg[k]=G.defCfg();
   renderHw(); syncSelects(); refresh();
   if(fresh) applyBest();            /* 新卡型自动给一套能跑的参数 */
   save();
 }); });
 annotate($('hwOpts'));
}
function renderTech(){
 const y=YEARS[S.i].y;
 const EFF=G.TE();
 $('techOpts').innerHTML=TECH.map(t=>{
  const owned=!!S.tech[t.k], isNew=!!S.newTech[t.k], off=owned&&!!S.off[t.k];
  const on=owned&&!off, av=t.from<=y, reqOk=!t.req||S.tech[t.req], afford=S.eng>=t.cost;
  const blockedByDep=on&&!EFF[t.k];
  const lockedDis=!owned&&(!av||!reqOk||!afford);
  let meta,cls='';
  if(!owned){ meta=t.cost+'pt'; }
  else if(isNew){ meta='↺ 退 '+t.cost+'pt'; cls=' on new'; }
  else if(off){ meta='○ 已停用'; cls=' offed'; }
  else { meta='◉ 启用中'; cls=' on'; }
  if(blockedByDep&&on){ meta='○ 依赖已停'; cls=' offed'; }
  const tip=(owned
    ? (isNew?'本年刚解锁——再点一次撤销并退回 '+t.cost+' 个工程点。':'已固化。点一下本年停用，再点一下恢复——用来对比「有它 vs 没它」，工程点不退。')+'　'
    : (av?(reqOk?'':'需要先解锁「'+TECH.filter(x=>x.k===t.req)[0].n+'」：'):(t.from+' 年后可用：')))+t.desc;
  return '<button class="opt tt'+cls+(owned&&t.trap&&on?' trap':'')+
   (YEARS[S.i].rec.tech.indexOf(t.k)>=0&&!owned&&!lockedDis?' rec':'')+'" data-t="'+t.k+'" data-tip="'+tip+'"'+(lockedDis?' disabled':'')+'>'+
   '<span class="t">'+t.n+(YEARS[S.i].rec.tech.indexOf(t.k)>=0&&!owned?'<span class="recb">推荐</span>':'')+'</span>'+
   '<span class="s">'+meta+'</span></button>';
 }).join('');
 [].forEach.call($('techOpts').children,b=>{ if(!b.disabled) b.addEventListener('click',()=>{
   const t=TECH.filter(x=>x.k===b.dataset.t)[0];
   if(!S.tech[t.k]){ if(S.eng<t.cost) return; S.eng-=t.cost; S.tech[t.k]=true; S.newTech[t.k]=true; delete S.off[t.k]; }
   else if(S.newTech[t.k]){
     const dep=TECH.filter(x=>x.req===t.k&&S.tech[x.k])[0];
     if(dep){ $('nextupT').innerHTML='<b>'+dep.n+'</b> 依赖 <b>'+t.n+'</b>，要先撤销它才能退这一项。'; return; }
     delete S.tech[t.k]; delete S.newTech[t.k]; delete S.off[t.k]; S.eng+=t.cost;
   }
   else { if(S.off[t.k]) delete S.off[t.k]; else S.off[t.k]=true; }
   renderTech(); syncSelects(); refresh(); save();
 }); });
 annotate($('techOpts'));
 const offN=Object.keys(S.off).filter(k=>S.tech[k]).length;
 $('engHint').textContent='剩余 '+S.eng+' 点'+(offN?'　· 已停用 '+offN+' 项':'　· 点已解锁项可停用');
}
function syncSelects(){
 const TT=G.TE();
 const wOpts=[[2,'BF16 — 2 B/参数']]; if(TT.q8)wOpts.push([1,'FP8 — 1 B/参数']); if(TT.q4)wOpts.push([0.5,'FP4 — 0.5 B/参数']);
 $('oW').innerHTML=wOpts.map(o=>'<option value="'+o[0]+'">'+o[1]+'</option>').join('');
 const c=cur();
 const wantW=(S.wWant!==undefined?S.wWant:c.w);
 c.w = wOpts.some(o=>o[0]===wantW) ? wantW : wOpts[wOpts.length-1][0];
 $('oW').value=c.w;
 const kOpts=[[2,'FP16 KV']]; if(TT.kv8)kOpts.push([1,'FP8 KV']);
 $('oKv').innerHTML=kOpts.map(o=>'<option value="'+o[0]+'">'+o[1]+'</option>').join('');
 const wantK=(S.kvWant!==undefined?S.kvWant:c.kv);
 c.kv = kOpts.some(o=>o[0]===wantK) ? wantK : kOpts[kOpts.length-1][0];
 $('oKv').value=c.kv;
 const maxB=G.TE().cb?YEARS[S.i].maxB:2;
 $('oBatch').max=maxB; if(c.batchI>maxB)c.batchI=maxB;
 $('oBatch').value=c.batchI; $('oTp').value=c.tpI;
 $('cfgFor').textContent=HWM[S.buyKey].n;
}
function hud(){
 $('hCash').textContent=fM(S.cash);
 $('hPower').innerHTML=S.power.toFixed(0)+'<small>MW</small>';
 let n=0; Object.keys(S.fleet).forEach(k=>n+=S.fleet[k]);
 $('hFleet').textContent=gn(n);
 $('hEng').textContent=S.eng;
 const totDem=YEARS.slice(0,S.i).reduce((a,y)=>a+y.demand*SEC,0);
 $('hShare').innerHTML=(totDem?Math.min(100,S.cumTok/totDem*100):0).toFixed(0)+'<small>%</small>';
 $('hTok').textContent=fT(S.cumTok);
 const bb=balance(); $('hNet').textContent=fM(bb.equity);
 $('hNet').parentNode.className='st'+(bb.equity<0?' bad':bb.debt>0?' warn':'');
 $('hCash').parentNode.className='st'+(S.cash<0?' bad':S.cash<40?' warn':'');
}

/* ================= 存档：自动保存到账号（window.__IE_STORE） ================= */
const SKEY='inference-economics', SAVE_V=6;
let saveTimer=null;
function saveNow(){
 try{
   window.__IE_STORE.set(SKEY, JSON.stringify({v:SAVE_V,t:Date.now(),lesson:lessonI,S:S}));
   const el=$('saveTag'); if(el){ el.hidden=false; el.classList.add('on');
     clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('on'),1400); }
 }catch(e){}
}
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(saveNow,400); }
function loadSave(){
 try{ const raw=window.__IE_STORE.get(SKEY); if(!raw) return null;
   const o=JSON.parse(raw); if(!o||o.v!==SAVE_V||!o.S) return null;
   if(typeof o.S.i!=='number'||o.S.i>=YEARS.length) return null;
   return o;
 }catch(e){ return null; }
}
function clearSave(){ try{ window.__IE_STORE.remove(SKEY); }catch(e){} }
function applySave(o){
 Object.keys(o.S).forEach(k=>{ S[k]=o.S[k]; });
 if(typeof o.lesson==='number') lessonI=o.lesson;
}
function showResume(o){
 const Y=YEARS[o.S.i];
 let fleet=0; Object.keys(o.S.fleet||{}).forEach(k=>fleet+=o.S.fleet[k]);
 const techN=Object.keys(o.S.tech||{}).length;
 const when=new Date(o.t);
 const pad=n=>(n<10?'0':'')+n;
 $('shYl').textContent='发现存档 · '+when.getFullYear()+'-'+pad(when.getMonth()+1)+'-'+pad(when.getDate())+' '+pad(when.getHours())+':'+pad(when.getMinutes());
 $('shTitle').className=''; $('shTitle').textContent='要接着上次的进度玩吗？';
 $('shBody').innerHTML=
  '<div class="resume">'+
   '<div class="rb"><span class="k">进行到</span><span class="v">'+Y.y+' 年 · 第 '+(o.S.i+1)+' / 7 回合</span></div>'+
   '<div class="rb"><span class="k">现金</span><span class="v">'+fM(o.S.cash)+'</span></div>'+
   '<div class="rb"><span class="k">机队 / 电力</span><span class="v">'+gn(fleet)+' 张 · '+(o.S.power||0)+' MW</span></div>'+
   '<div class="rb"><span class="k">已解锁技术</span><span class="v">'+techN+' 项</span></div>'+
  '</div>'+
  '<div class="lesson"><div class="lh">自动保存</div><p>你的进度跟着<b>你的账号</b>走：每做一次决策就自动写进服务器，换设备、换浏览器登录后都能接着玩。想从头再来，随时点底部的<b>「重开」</b>。</p></div>';
 $('shFoot').innerHTML='<button class="btn ghost" id="rsNew">从 2022 年重新开始</button><button class="btn" id="rsGo">继续 '+Y.y+' 年</button>';
 $('rsGo').onclick=()=>{ applySave(o); $('scrim').hidden=true; renderYear(); };
 $('rsNew').onclick=()=>{ clearSave(); $('scrim').hidden=true; renderYear(); help(); };
 $('scrim').hidden=false;
}
function resetGame(){
 $('shYl').textContent='重新开始';
 $('shTitle').className=''; $('shTitle').textContent='确定要清掉存档，从 2022 年重来吗？';
 $('shBody').innerHTML='<div class="lesson miss"><div class="lh">不可撤销</div><p>当前这一局的现金、机队、已解锁的技术栈和七年轨迹都会被清空。<b>已经解锁的技术不会保留到新一局。</b></p></div>';
 $('shFoot').innerHTML='<button class="btn ghost" id="rsCancel">算了，继续玩</button><button class="btn" id="rsYes">确定重开</button>';
 $('rsCancel').onclick=()=>{$('scrim').hidden=true;};
 $('rsYes').onclick=()=>{
   clearSave();
   Object.keys(FRESH).forEach(k=>{ S[k]=JSON.parse(JSON.stringify(FRESH[k])); });
   PREV=null; PREVIN=null; LAST=null;
   $('scrim').hidden=true; renderYear();
 };
 $('scrim').hidden=false;
}

/* ================= 教练：目标清单 + 下一步建议 ================= */
let coachOpen=true;
function bestCfg(){
 const Y=YEARS[S.i];
 const TT=G.TE();
 const wOpts=[2].concat(TT.q8?[1]:[]).concat(TT.q4?[0.5]:[]);
 const kOpts=[2].concat(TT.kv8?[1]:[]);
 const maxB=TT.cb?Y.maxB:2;
 let best=null;
 for(let bi=0;bi<=maxB;bi++)for(let ti=0;ti<4;ti++)for(const w of wOpts)for(const kv of kOpts){
   const o={hwKey:S.buyKey,buys:{},buyN:0,batchI:bi,tpI:ti,w:w,kv:kv};
   const r=G.sim(o);
   if(r.oom||r.tpot>50||r.ttft>1000)continue;
   /* 每一型卡独立配置，所以目标就是这一型的每卡吞吐 */
   if(!best||r.perGpu>best.r.perGpu)best={o:o,r:r};
 }
 return best;
}
function applyBest(){
 const b=bestCfg();
 if(!b){ $('nextupT').innerHTML='当前硬件下<b>没有任何可行配置</b>——换一代卡，或者先去技术栈里解锁能减字节的手段。'; return; }
 const c=cur(); c.batchI=b.o.batchI;c.tpI=b.o.tpI;c.w=b.o.w;c.kv=b.o.kv;S.wWant=b.o.w;S.kvWant=b.o.kv;
 $('oBatch').value=c.batchI;$('oTp').value=c.tpI;$('oW').value=c.w;$('oKv').value=c.kv;
 refresh();
}
function coach(r,ctx){
 const Y=YEARS[S.i], T=G.TE(), rec=Y.rec;
 $('coachH').textContent='教练 · '+Y.y+' 年该做的事';
 $('coachWhy').innerHTML=rec.why;

 /* ---- 目标清单，实时打勾 ---- */
 const recTech=rec.tech.filter(k=>!T[k]);
 const pwOk = rec.pw==='none' || S.pwKey===rec.pw || S.pending.some(p=>p.at>Y.y);
 const cfgOk = !r.oom && r.tpot<=50 && r.ttft<=1000;
 const capOk = r.capTok>=Y.demand;
 const litOk = r.fleetN===0 || r.idleN<=r.fleetN*0.02;
 const items=[
  ['配置能跑起来且不超 SLA', cfgOk, cfgOk?(r.tpot.toFixed(0)+' ms / '+(r.ttft/1000).toFixed(2)+' s'):'先把右边四行调绿'],
  ['本年该解锁的技术已到位', recTech.length===0, recTech.length===0?'✓':('还差 '+recTech.map(k=>TECH.filter(x=>x.k===k)[0].n).join('、'))],
  ['产能盖住需求', capOk, (r.capTok/Y.demand*100).toFixed(0)+'% of '+fT(Y.demand)],
  ['没有空转的卡', litOk, r.idleN?('空转 '+gn(r.idleN)+' 张'):(gn(r.fleetPow)+' 张全通电')],
  ['电力已经在路上', pwOk, pwOk?'✓':'今年不投，三年后会缺']
 ];
 $('coachCk').innerHTML=items.map(it=>'<div class="'+(it[1]?'on':'off')+'"><span class="m">'+(it[1]?'✓':'○')+'</span>'+
   '<span>'+it[0]+'</span><span class="r">'+it[2]+'</span></div>').join('');

 /* ---- 下一步：只给一条，最要紧的那条 ---- */
 let tip='', done=false;
 const nm=k=>TECH.filter(x=>x.k===k)[0].n;
 if(r.oom){
   let fix=null;
   for(let ti=cur().tpI+1;ti<4;ti++){ const t2=G.sim(Object.assign(opts(),{tpI:ti})); if(!t2.oom){fix=TPS[ti];break;} }
   tip = fix ? ('显存放不下：这套配置每卡要 '+fB(r.resident)+'，而一张 '+r.hw.n+' 是 '+(r.hw.cap/1e9).toFixed(0)+' GB、<b>可用约 '+(r.hw.cap*0.93/1e9).toFixed(0)+' GB</b>（留 7% 给激活值和显存碎片）。<b>把 TP 拉到 '+fix+'</b>，权重就被摊到 '+fix+' 张卡上了。')
             : ('显存放不下，TP 拉满也不行。<b>把 batch 调小</b>，或者先解锁量化 / KV 压缩把字节减下来。');
 } else if(r.tpot>50){
   tip = r.memBound
     ? ('TPOT '+r.tpot.toFixed(0)+' ms 超了，而且<b>你在等内存</b>（搬字节 '+r.memMs.toFixed(0)+' ms vs 做运算 '+r.cmpMs.toFixed(1)+' ms）。加算力没用，去减字节：'+
        (!T.q8?'解锁 <b>'+nm('q8')+'</b>':(!T.kv8&&r.kvBytes>r.wBytes?'解锁 <b>'+nm('kv8')+'</b>':(!T.mla&&r.kvBytes>r.wBytes?'解锁 <b>'+nm('mla')+'</b>':'把 batch 调小一档')))+'。')
     : ('TPOT '+r.tpot.toFixed(0)+' ms 超了，这次<b>你在等算力</b>。把 batch 调小一档，或者换一代峰值更高的卡。');
 } else if(r.ttft>1000){
   tip = 'TTFT '+(r.ttft/1000).toFixed(1)+' s 超了——<b>这是 prefill 的问题，不是 decode</b>，调 batch 没用。'+
     (!T.radix?'解锁 <b>'+nm('radix')+'</b>，多轮对话的公共前缀就不用重算了。':
      (!T.disagg?'解锁 <b>'+nm('disagg')+'</b>，把 prefill 卸到别的卡上。':
       (cur().w>0.5&&G.TE().q4?'把权重精度切到 FP4，prefill 是算力受限的，位宽减半直接翻倍。':'把 TP 加大，prefill 的算力也会被摊开。')));
 } else if((r.mix||[]).some(m=>m.oom&&m.lit>0)){
   const bad=(r.mix||[]).filter(m=>m.oom&&m.lit>0);
   const n=bad.reduce((a,m)=>a+m.lit,0);
   let fix=null;
   for(let ti=cur().tpI+1;ti<4;ti++){ const t2=G.sim(Object.assign(opts(),{tpI:ti}));
     if(!t2.oom){fix=TPS[ti];break;} }
   tip='机队里有 <b>'+gn(n)+' 张 '+bad.map(m=>HWM[m.k].n).join(' / ')+'</b> 在当前配置下<b>装不下</b>（要 '+fB(bad[0].need)+'，那代卡只有 '+(bad[0].cap/1e9).toFixed(0)+' GB），'+
     '<b>它们的产出是 0，但折旧和电费照付</b>。整个机队跑的是同一套配置——'+
     (fix?'<b>把 TP 拉到 '+fix+'</b> 就都能跑起来。':'把 batch 调小，或者解锁量化 / KV 压缩把字节减下来。');
 } else if(!litOk){
   const dark=r.idleN, last=S.i===YEARS.length-1;
   const room=Math.max(0,(S.buy[S.buyKey]||0)-dark);
   tip = '电力不够：<b>'+gn(dark)+' 张卡空转</b>（已用 '+r.powerUsedMW.toFixed(1)+' / '+S.power+' MW）——折旧照付，产出没有。'+
     (last ? '最后一年了，电力再投也来不及到位：<b>把「买多少张」收到 '+gn(room)+' 张以内</b>，省下的钱不如不花。'
           : '两条路：<b>把买入量收到 '+gn(room)+' 张以内</b>，或者今年就投电力——但注意 lead time，燃气 1 年、核电 2 年、并网 3 年，<b>今年投的电是给后年用的</b>。');
 } else if(!capOk){
   const gap=Math.ceil((Y.demand-r.capTok)/Math.max(1,r.perGpu));
   const canPay=Math.floor(S.cash/r.hw.px), canPower=r.powered-r.fleetN;
   tip = '产能还差 '+(Y.demand-r.capTok>0?fT(Y.demand-r.capTok):'0')+' tok/s，约 <b>'+gn(gap)+' 张 '+r.hw.n+'</b>。'+
     (gap>canPay?'钱不够（只买得起 '+gn(canPay)+' 张）——先把 batch 推上去提高每卡产出。':
      (gap>canPower?'电不够（还能点亮 '+gn(Math.max(0,canPower))+' 张）——今年必须投电力。':'把「买多少张」滑到底就行。'));
 } else if(recTech.length){
   tip = '眼下达标了，但<b>'+recTech.map(nm).join('、')+'</b> 今年就该解锁——这些手段是给明年后年铺的，晚一年就补不回来。';
 } else {
   done=true;
   tip = '这一年该做的都做了。还能再挖一层：<b>把成本压下去</b>——现在 $'+ctx.perM.toFixed(2)+'/Mtok，市场价 $'+Y.price.toFixed(1)+'。试试提高 batch 或降低精度，看第 4 行的强度离拐点还有多远。';
 }
 $('nextup').className='nextup'+(done?' done':'');
 $('nextupT').innerHTML=tip;
 annotate($('coachWhy')); annotate($('nextup'));
}

/* ================= 实时推演 ================= */
function cur(){ if(!S.cfg[S.buyKey]) S.cfg[S.buyKey]=G.defCfg(); return S.cfg[S.buyKey]; }
function opts(){ const c=cur(); return {hwKey:S.buyKey,buys:S.buy,buyN:S.buy[S.buyKey]||0,batchI:c.batchI,tpI:c.tpI,w:c.w,kv:c.kv}; }
function buySpend(){ return Object.keys(S.buy).reduce((a,k)=>a+(S.buy[k]||0)*HWM[k].px,0); }
function unitOf(k){ return (HWM[k]&&HWM[k].u)||{n:1,t:'张'}; }
function unitTxt(k,n){ const u=unitOf(k); return gn(n)+' 张 · '+(n/u.n).toFixed(n%u.n?1:0)+' '+u.t; }
function refresh(){
 const Y=YEARS[S.i], o=opts(), r=G.sim(o);
 /* 采购上限 */
 const pwO=PW.filter(x=>x.k===S.pwKey)[0], pwCost=pwO?pwO.mw*pwO.px:0;
 const shock=Y.y===2023?0.6:1;
 const u=unitOf(S.buyKey);
 const spendOther=buySpend()-(S.buy[S.buyKey]||0)*r.hw.px;
 const affordable=Math.floor(Math.max(0,(S.cash-pwCost-spendOther))/r.hw.px*shock);
 const need=r.perGpu>0?Math.ceil(Y.demand/r.perGpu*1.7):2000;
 const maxU=Math.max(0,Math.floor(Math.min(affordable,Math.max(u.n*4,need))/u.n));
 $('buyN').max=maxU;
 let curU=Math.round((S.buy[S.buyKey]||0)/u.n); if(curU>maxU)curU=maxU;
 S.buy[S.buyKey]=curU*u.n; $('buyN').value=curU;
 $('buyNv').innerHTML=gn(curU)+' '+u.t+'<span style="color:var(--txt40);font-weight:400"> · '+gn(curU*u.n)+' 张</span>';
 const pend=Object.keys(S.buy).filter(k=>S.buy[k]>0);
 $('buyCap').innerHTML='买得起 '+gn(Math.floor(affordable/u.n))+' '+u.t+(shock<1?'　缺货×0.6':'')+
   '<br>库存 '+gn(S.fleet[S.buyKey]||0)+' 张 · '+u.n+' 张/'+u.t+' · '+(r.hw.kw*u.n).toFixed(0)+' kW/'+u.t+
   (pend.length>1?'<br>本年已下单 '+pend.map(k=>HWM[k].n+' '+gn(S.buy[k])+'张').join('、'):'');
 $('buyHint').textContent=r.buyCost>0?('本年采购 '+fM(r.buyCost)):'不买也可以';
 $('oBatchV').textContent=BATCH[cur().batchI];
 const bMax=G.TE().cb?Y.maxB:2, atMax=cur().batchI>=bMax;
 $('batchNote').innerHTML = !G.TE().cb
   ? '上限 <b>4</b>：没有 continuous batching，请求只能一批批排队来'
   : (atMax ? '已到本年上限 <b>'+BATCH[bMax]+'</b> —— 卡住你的是<span class="tt" tabindex="0" data-tip="batch 是同一步里在跑的并发请求数。你不可能把还没到达的请求也塞进这一批——所以 batch 的天花板是这一年真实的在线并发量，而不是显存。显存只决定「放不放得下」，并发决定「有没有那么多」。">这一年的并发请求数</span>，不是显存。加大 TP 腾出的显存，没有请求可填'
            : '本年上限 '+BATCH[bMax]+'（由并发请求数决定，不是显存）');
 $('oTpV').textContent=TPS[cur().tpI];

 const set=(id,v,u,cls)=>{const e=$(id);e.className='kb'+(cls?' '+cls:'');e.querySelector('.v').innerHTML=v+'<small>'+u+'</small>';};
 if(r.oom){
   set('kTpot','—','ms','bad'); set('kTtft','—','ms','bad'); set('kCap','0','tok/s','bad'); set('kCost','—','$/Mtok','bad');
   $('trkCap').className='trk bad'; $('trkCapV').textContent='0%'; $('trkCapB').style.width='0';
   $('trkCapS').textContent='这套配置放不下，产能为 0';
   $('trkPw').className='trk warn'; $('trkPwV').textContent='—'; $('trkPwB').style.width='0';
   $('trkPwS').textContent='可用 '+S.power+' MW';
   $('btnGo').disabled=true; $('barMsg').innerHTML='<b>显存放不下</b>——这套配置一张卡都跑不起来，看左边教练面板的「下一步」。';
   LAST={r:r,ctx:{pw:0,perM:0}};
   renderFin({rev:0,elec:0,dep:0,interest:S.debt*0.08,net:0,cfo:0,cfi:0,cff:0,cash1:S.cash,
     gpuNet:Math.max(0,S.gpuCapex-S.gpuAccDep),pwNet:Math.max(0,S.pwCapex-S.pwAccDep),debt:S.debt,
     assets:S.cash+Math.max(0,S.gpuCapex-S.gpuAccDep)+Math.max(0,S.pwCapex-S.pwAccDep),equity:S.capital+S.retained});
   coach(r,{pw:0,perM:0}); renderChain(r,{pw:0,perM:0,dep:0,elec:0,served:0}); drawStruct(r,{pw:0}); hud(); return;
 }
 $('btnGo').disabled=false;
 const slaT=r.tpot<=50, slaF=r.ttft<=1000;
 set('kTpot',r.tpot.toFixed(1),'ms',slaT?'good':'bad');
 set('kTtft',r.ttft<1000?r.ttft.toFixed(0):(r.ttft/1000).toFixed(2),r.ttft<1000?'ms':'s',slaF?'good':'bad');
 set('kCap',r.perGpu>=1000?(r.perGpu/1000).toFixed(1)+'K':r.perGpu.toFixed(0),'tok/s',r.perGpu>0?'good':'bad');

 /* 成本与三表口径：与结算完全一致 */
 let elec=r.elecM, pw=r.fleetPow;
 if(G.TE().disagg) elec*=0.85;
 const gpuCapexP=S.gpuCapex+r.buyCost, pwCapexP=S.pwCapex+pwCost;
 const gpuDepP=Math.max(0,Math.min(gpuCapexP/3, gpuCapexP-S.gpuAccDep));
 const pwDepP =Math.max(0,Math.min(pwCapexP/10, pwCapexP-S.pwAccDep));
 const dep=gpuDepP+pwDepP, interest=S.debt*0.08;
 const served=Math.min(r.capTok,Y.demand)*(r.capTok>0?r.capOk/r.capTok:1);
 const perM = served>0 ? (dep+elec+interest)*1e12/(served*SEC) : 0;
 const revP=served*SEC/1e6*Y.price/1e6;
 const cfoP=revP-elec-interest, cfiP=-(r.buyCost+pwCost);
 let borrowP=0; if(S.cash+cfoP+cfiP<0) borrowP=-(S.cash+cfoP+cfiP);
 const FIN={rev:revP,elec:elec,dep:dep,interest:interest,net:revP-elec-dep-interest,
   cfo:cfoP,cfi:cfiP,cff:borrowP,cash1:S.cash+cfoP+cfiP+borrowP,
   gpuNet:gpuCapexP-(S.gpuAccDep+gpuDepP),pwNet:pwCapexP-(S.pwAccDep+pwDepP),
   debt:S.debt+borrowP};
 FIN.assets=FIN.cash1+FIN.gpuNet+FIN.pwNet;
 FIN.equity=S.capital+S.retained+FIN.net;
 renderFin(FIN);
 set('kCost',served>0?perM.toFixed(2):'—','$/Mtok',perM<Y.price*0.55?'good':perM<Y.price?'warn':'bad');

 /* ---- 顶部两个 tracker ---- */
 const capPct=Y.demand>0? r.capTok/Y.demand*100 : 0;
 const pwPct=r.powerFit*100;
 const setTrk=(id,pct,val,sub)=>{
  const box=$(id); box.className='trk '+(pct>=99.5?'ok':pct>=60?'warn':'bad');
  $(id+'V').textContent=val; $(id+'B').style.width=Math.max(0,Math.min(100,pct))+'%';
  $(id+'S').innerHTML=sub;
 };
 setTrk('trkCap',capPct,(capPct>=999?'999+':capPct.toFixed(0))+'%',
   fT(r.capTok)+' / '+fT(Y.demand)+' tok/s'+(capPct>=100?'　<span style="color:var(--ok)">已盖住需求</span>':'　还差 '+fT(Math.max(0,Y.demand-r.capTok))));
 setTrk('trkPw',pwPct,pwPct.toFixed(0)+'%',
   '已用 '+r.powerUsedMW.toFixed(1)+' / 可用 '+S.power+' MW　需求 '+r.powerNeedMW.toFixed(1)+' MW'+
   (r.idleN?'　<span style="color:var(--bad)">空转 '+gn(r.idleN)+' 张</span>':''));
 let msg;
 if(r.capTok<Y.demand*0.5) msg='产能只有需求的 <b>'+capPct.toFixed(0)+'%</b>。先想清楚是哪一项卡住了：字节、电，还是 batch。';
 else if(!slaT) msg='TPOT <b>'+r.tpot.toFixed(0)+' ms</b> 超过 50 ms 的 SLA，用户会跑掉——产出要打 0.6 折。';
 else if(!slaF) msg='TTFT <b>'+(r.ttft/1000).toFixed(1)+' s</b> 超过 1 秒。这是 prefill 的问题，不是 decode。';
 else msg='这套配置能达标。看看还能不能把 <b>$/Mtok</b> 再压下去。';
 $('barMsg').innerHTML=msg;
 LAST={r:r,ctx:{pw:pw,perM:perM}};
 save();
 coach(r,{pw:pw,perM:perM});
 renderChain(r,{pw:pw,perM:perM,dep:dep,elec:elec,served:served});
 drawStruct(r,{pw:pw});
 hud();
}

/* ================= 完整公式链：变量名(数值) ================= */
let PREV=null, PREVIN=null;
const esc=x=>String(x);
function V(n,v,cls,hot){return '<span class="vr '+(cls||'')+(hot?' hot':'')+'">'+n+'<em>('+v+')</em></span>';}
function ms(x){return x<1?x.toFixed(2):x<100?x.toFixed(1):x.toFixed(0);}
function dchip(cur,prev,lessBetter){
 if(prev==null||!isFinite(prev)||prev===0||!isFinite(cur))return '';
 if(cur===0) return '<span class="dlt '+(lessBetter?'good':'bad')+'">归零</span>';
 const rr=cur/prev; if(!isFinite(rr)||rr<=0) return '';
 if(Math.abs(rr-1)<0.005) return '';
 const up=rr>1, good = lessBetter ? !up : up;
 const txt=(up?'↑':'↓')+(up?rr:1/rr).toFixed(2)+'×';
 return '<span class="dlt '+(good?'good':'bad')+'">'+txt+'</span>';
}
function renderChain(r,ctx){
 const Y=YEARS[S.i],T=G.TE(),hw=r.hw;
 const tp=r.tp,B=r.B,w=r.w,kvq=r.kvq;
 const kv0=Y.kvKB, mlaF=T.mla?6:1, moeW=T.moe?(hw.nvl?0.6:1):1, moeF=T.moe?8:1;
 const prefL=T.radix?Y.L*0.25:Y.L;

 /* --- 输入变量：谁变了 --- */
 const inp={P:Y.P,w:w,TP:tp,B:B,L:r.Leff,kv:kv0*1024/mlaF*kvq,BW:hw.bw,peak:r.peak,HW:hw.k,
            MLA:mlaF,MoE:moeW,spec:r.specMul,cards:ctx.pw};
 const hot={};
 let chg=[];
 const NAMES={P:'模型参数量 P',w:'权重精度 w',TP:'张量并行 TP',B:'batch B',L:'有效上下文 L',
              kv:'每 token KV 字节 kv',BW:'HBM 带宽 BW',peak:'峰值算力 peak',HW:'硬件',
              MLA:'MLA 压缩比',MoE:'MoE 字节系数',spec:'spec 倍率',cards:'点亮卡数'};
 const FMT={P:v=>(v/1e9)+'B',w:v=>v+' B',TP:v=>v,B:v=>v,L:v=>gn(v),kv:v=>(v/1024).toFixed(0)+' KB',
            BW:v=>(v/1e12).toFixed(2)+' TB/s',peak:v=>(v/1e12).toFixed(0)+' TF/s',HW:v=>HWM[v]?HWM[v].n:v,
            MLA:v=>'÷'+v,MoE:v=>'×'+v,spec:v=>'×'+v,cards:v=>gn(v)};
 if(PREVIN){ Object.keys(inp).forEach(function(k){ if(inp[k]!==PREVIN[k]){ hot[k]=1;
   chg.push('<b>'+NAMES[k]+'</b> '+FMT[k](PREVIN[k])+' → '+FMT[k](inp[k])); } }); }
 $('chgbar').className='chgbar'+(chg.length?'':' idle');
 $('chgbar').innerHTML = chg.length
   ? '这一次你改了：'+chg.join('　·　')+'。下面每一步右边的 <span class="dlt bad">↑</span> / <span class="dlt good">↓</span> 就是它带来的变化。'
   : '拨动任何一个控件，下面会标出<b>是哪个变量变了</b>，以及它把每一步的结果推向了哪个方向。';

 /* --- 计算中间量 --- */
 const Wb=r.wBytes, Kb=r.kvBytes, by=r.total, tmem=r.memMs, fl=r.flops, tcmp=r.cmpMs;
 const tpot=r.tpot, perG=r.perGpu, cap=r.capTok, I=r.I, ridge=r.ridge, ttft=r.ttft;
 const cur={Wb:Wb,Kb:Kb,by:by,tmem:tmem,fl:fl,tcmp:tcmp,tpot:tpot,perG:perG,cap:cap,I:I,ttft:ttft,cost:ctx.perM};
 const D=(k,less)=>PREV?dchip(cur[k],PREV[k],less):'';

 const row=(id,nm,sym,sub,res,key)=>'<div class="cr'+(key?' key':'')+'">'+
   '<div class="sym"><span class="nm">'+nm+'</span>　'+sym+'</div>'+
   '<div class="sub">'+sub+'　<span class="res">'+res+'</span></div></div>';
 const g=(t,sub)=>'<div class="cg">'+t+(sub?'<span>'+sub+'</span>':'')+'</div>';

 let H='';
 H+=g('A · 字节账','每张卡每走一步要从 HBM 读多少');
 H+=row('W','W　权重字节','W = P × w ÷ TP'+(T.moe?' × MoE':''),
   '= '+V('P',FMT.P(Y.P),'m',hot.P)+' × '+V('w',w+' B/参数','m',hot.w)+' ÷ '+V('TP',tp,'k',hot.TP)+
   (T.moe?' × '+V('MoE',moeW,'s',hot.MoE):''),
   '= <b>'+fB(Wb)+'</b>'+D('Wb',true));
 H+=row('K','K　KV cache 字节','K = B × L × kv ÷ MLA × q ÷ TP',
   '= '+V('B',B,'m',hot.B)+' × '+V('L',gn(r.Leff),'m',hot.L)+' × '+V('kv',kv0+' KB','m')+
   (T.mla?' ÷ '+V('MLA',6,'s'):'')+' × '+V('q',kvq.toFixed(1),'s')+' ÷ '+V('TP',tp,'k',hot.TP),
   '= <b>'+fB(Kb)+'</b>'+D('Kb',true)+(Kb>Wb?'　<span class="dlt bad">KV 已超权重</span>':'　<span class="vr k">K/W<em>('+(Kb/Wb).toFixed(2)+')</em></span>'));
 H+=row('by','bytes　每步总字节','bytes = W + K',
   '= '+V('W',fB(Wb),'m')+' + '+V('K',fB(Kb),'m'),
   '= <b>'+fB(by)+'</b>'+D('by',true),true);

 H+=g('B · 时间账','搬字节要多久，做运算要多久');
 H+=row('tmem','t_mem　搬这些字节的时间','t_mem = bytes ÷ BW',
   '= '+V('bytes',fB(by),'m')+' ÷ '+V('BW',(hw.bw/1e12).toFixed(2)+' TB/s','m',hot.BW||hot.HW),
   '= <b>'+ms(tmem)+' ms</b>'+D('tmem',true));
 H+=row('fl','FLOP　这一步的运算量','FLOP = 2 × P × B ÷ TP'+(T.moe?' ÷ MoE激活':''),
   '= 2 × '+V('P',FMT.P(Y.P),'c',hot.P)+' × '+V('B',B,'c',hot.B)+' ÷ '+V('TP',tp,'k',hot.TP)+
   (T.moe?' ÷ '+V('专家激活',moeF,'s'):''),
   '= <b>'+fF(fl)+'</b>'+D('fl'));
 H+=row('tcmp','t_cmp　算这些的时间','t_cmp = FLOP ÷ peak',
   '= '+V('FLOP',fF(fl),'c')+' ÷ '+V('peak',(r.peak/1e12).toFixed(0)+' TFLOP/s','c',hot.peak||hot.HW)+
   '　<span class="vr k">格式<em>('+hw.n+' '+r.fmt+')</em></span>',
   '= <b>'+ms(tcmp)+' ms</b>'+D('tcmp',true));
 H+=row('tpot','TPOT　两者取大的那个','TPOT = max(t_mem, t_cmp) × TP通信税',
   '= max('+V('t_mem',ms(tmem)+' ms','m')+', '+V('t_cmp',ms(tcmp)+' ms','c')+') × '+V('tax',r.tpTax.toFixed(2),'s',hot.TP),
   '= <b>'+ms(tpot)+' ms</b>'+D('tpot',true)+(r.memBound?'<span class="dlt bad">搬字节赢了</span>':'<span class="dlt good">算数赢了</span>')+
   '　<span class="vr k">SLA<em>(≤ 50 ms)</em></span>',true);

 H+=g('C · 产出账','这些时间换成多少 token');
 H+=row('perG','每卡吞吐','每卡 = B ÷ TPOT ÷ TP'+(r.specMul!==1?' × spec':'')+' × EFF',
   '= '+V('B',B,'m',hot.B)+' ÷ '+V('TPOT',ms(tpot)+' ms','m')+' ÷ '+V('TP',tp,'k',hot.TP)+
   (r.specMul!==1?' × '+V('spec',r.specMul,r.specMul>1?'c':'s',hot.spec):'')+' × '+V('EFF','0.5','k'),
   '= <b>'+perG.toFixed(0)+' tok/s</b>'+D('perG'));
 const mix=r.mix||[];
 const mixTxt=mix.length? mix.map(m=>V(HWM[m.k].n,gn(m.lit)+'×'+(m.oom?'0':m.perGpu.toFixed(0)),m.oom?'s':'c')).join(' + ')
                       : '<span class="vr k">机队<em>(0 张)</em></span>';
 const oomN=mix.filter(m=>m.oom).reduce((a,m)=>a+m.lit,0);
 H+=row('cap','机队产能','产能 = Σ（各代卡的点亮张数 × 该代每卡吞吐）',
   '= '+mixTxt+(oomN?'　<span class="dlt bad">'+gn(oomN)+' 张放不下 → 产出 0</span>':''),
   '= <b>'+fT(cap)+' tok/s</b>'+D('cap')+'　vs '+V('需求',fT(Y.demand),'m')+' → <b>'+(cap/Y.demand*100).toFixed(0)+'%</b>',true);

 H+=g('D · 你被谁卡住','强度和拐点比大小');
 H+=row('I','I　算术强度 / ridge　拐点','I = FLOP ÷ bytes　　ridge = peak ÷ BW',
   'I = '+V('FLOP',fF(fl),'c')+' ÷ '+V('bytes',fB(by),'m')+' = <b>'+(I<10?I.toFixed(1):I.toFixed(0))+'</b>'+D('I')+
   '<br>ridge = '+V('peak',(r.peak/1e12).toFixed(0)+' TF/s','c')+' ÷ '+V('BW',(hw.bw/1e12).toFixed(2)+' TB/s','m')+' = <b>'+Math.round(ridge)+'</b>',
   I<ridge?'I &lt; ridge → <b>带宽受限</b>：加算力没用，只能减字节或提强度'
          :'I ≥ ridge → <b>算力受限</b>：轮到 kernel 优化和减 FLOP 了');
 H+=row('ttft','TTFT　首字延迟（prefill，另一套账）','TTFT = 2 × P × L_prefill ÷ TP ÷ peak',
   '= 2 × '+V('P',FMT.P(Y.P),'c',hot.P)+' × '+V('L_prefill',gn(Math.round(prefL)),'c')+
   (T.radix?'<span class="vr k">radix<em>(×0.25)</em></span>':'')+' ÷ '+V('TP',tp,'k',hot.TP)+' ÷ '+V('peak',(r.peak/1e12).toFixed(0)+' TF/s','c')+
   (T.disagg?' × '+V('P/D分离','0.55','s'):'')+(S.far?' + '+V('异地光程','90 ms','s'):''),
   '= <b>'+(ttft<1000?ttft.toFixed(0)+' ms':(ttft/1000).toFixed(2)+' s')+'</b>'+D('ttft',true)+'　<span class="vr k">SLA<em>(≤ 1 s)</em></span>');

 H+=g('E · 成本账','折旧和电费摊到每百万 token');
 H+=row('cost','$ / 百万 token','单位成本 = (折旧 + 电费) ÷ 产出 token',
   '= ('+V('折旧',fM(ctx.dep),'s')+' + '+V('电费',fM(ctx.elec),'s')+') ÷ '+V('本年产出',fT(ctx.served*3.15e7),'c'),
   '= <b>$'+(ctx.perM||0).toFixed(2)+'</b>'+D('cost',true)+'　vs '+V('市场价','$'+Y.price.toFixed(1),'m'));

 $('chain').innerHTML=H;

 /* --- 变量表 --- */
 const rows=[
  ['P','模型参数量',FMT.P(Y.P),'本年设定',hot.P],
  ['w','每个参数几字节',w+' B','权重精度',hot.w],
  ['B','一步里同时跑多少条序列',B,'你的滑块',hot.B],
  ['L','有效上下文长度',gn(r.Leff),T.lin&&Y.L>8192?'linear 截断':'本年设定',hot.L],
  ['kv','每 token 的 KV 字节',(kv0/mlaF*kvq).toFixed(0)+' KB','模型·MLA·KV精度',hot.kv],
  ['TP','一个副本铺几张卡',tp,'你的滑块',hot.TP],
  ['BW','HBM 总带宽',(hw.bw/1e12).toFixed(2)+' TB/s','选的卡',hot.BW],
  ['peak','当前格式峰值算力',(r.peak/1e12).toFixed(0)+' TF/s','卡×格式',hot.peak],
  ['cap','单卡显存容量',(hw.cap/1e9).toFixed(0)+' GB','选的卡',hot.HW],
  ['tax','TP 通信税：每层两次 all-reduce',r.tpTax.toFixed(2),'TP 越大越贵',hot.TP],
  ['EFF','实测折扣：MBU 与利用率的合并系数','0.5','固定',0],
  ['N','点亮的卡数 = 电力 ÷ 单卡功耗 ÷ PUE',gn(ctx.pw)+'/'+gn(r.fleetN),'电力',hot.cards]
 ];
 $('varsBox').innerHTML='<table class="vt"><tbody>'+
   rows.map(r2=>'<tr class="'+(r2[4]?'hotrow':'')+'"><td class="tt" data-tip="'+r2[1]+'">'+r2[0]+'</td>'+
     '<td>'+r2[2]+'</td><td>'+r2[3]+'</td></tr>').join('')+'</tbody></table>';

 const sp2=hw.spec||{}, NST2=hw.st||6;
 $('specBox').innerHTML='<table class="vt"><tbody>'+
  '<tr><td class="tt" data-tip="'+(sp2.pub?'SM 数 × 每 SM 每周期的张量核 FLOP × 时钟。4 个张量核 × 512 次乘加 × 2 = 4096 FLOP/周期。':'这张卡的 SM 数与时钟未公布，公式不变。')+'">peak</td>'+
    '<td>'+(sp2.pub? sp2.sm+'SM × '+gn(sp2.fpc)+' × '+sp2.clk+'GHz' : '未公布 SM/时钟')+'</td><td>'+(sp2.pub?(sp2.sm*sp2.fpc*sp2.clk/1000).toFixed(0):(hw.f16/1e12).toFixed(0))+' TF BF16</td></tr>'+
  '<tr><td class="tt" data-tip="HBM 不是一块，是 N 个一样的堆栈环绕计算 die，同一个地址空间，带宽相加。">BW</td>'+
    '<td>'+NST2+' × '+(sp2.mem||'HBM')+' 每个 '+(hw.bw/NST2/1e12).toFixed(2)+' TB/s</td><td>'+(hw.bw/1e12).toFixed(2)+' TB/s</td></tr>'+
  '<tr><td class="tt" data-tip="容量同样是各堆栈相加。容量决定装不装得下，带宽决定多快扫一遍——两件事。">cap</td>'+
    '<td>'+NST2+' × 约 '+(sp2.gbs||Math.round(hw.cap/1e9/NST2))+' GB</td><td>'+(hw.cap/1e9).toFixed(0)+' GB</td></tr>'+
  '<tr><td class="tt" data-tip="拐点 = peak ÷ BW，要吃满这张卡每读一字节至少得干多少活。低于它你在等内存。">ridge</td>'+
    '<td>peak ÷ BW</td><td>'+Math.round(r.ridge)+' F/B</td></tr>'+
  '</tbody></table>';
  PREV=cur; PREVIN=inp;
 annotate($('varsBox'));
}

/* ================= 机队清单：每型卡的容量、库存、配置、产出 ================= */
function renderFleet(r){
 const mix=r.mix||[];
 if(!mix.length){ $('fleetList').innerHTML='<p class="fnote" style="margin-top:7px">机队还是空的。左边「采购硬件」买第一批卡——<b>每一型卡都有自己的运行参数</b>，点卡型就能切过去单独配。</p>'; return; }
 $('fleetList').innerHTML='<table class="flt"><thead><tr>'+
  '<th>卡型</th><th>显存</th><th>带宽</th><th>库存</th><th>'+ '机柜/节点' +'</th><th>通电</th><th>配置</th><th>每卡</th><th>TPOT</th></tr></thead><tbody>'+
  mix.map(m=>{const h=HWM[m.k],u=h.u,c=G.cfgOf(m.k,opts());
   return '<tr class="'+(m.k===S.buyKey?'foc ':'')+(m.perGpu<=0?'dead':'')+'">'+
    '<td class="tt" data-tip="'+h.n+'：'+h.note+'　·　'+(h.cap/1e9).toFixed(0)+' GB 显存（可用约 '+(h.cap*0.93/1e9).toFixed(0)+' GB）· '+(h.bw/1e12).toFixed(2)+' TB/s · '+h.kw+' kW/张 · '+u.n+' 张/'+u.t+'">'+h.n+'</td>'+
    '<td>'+(h.cap/1e9).toFixed(0)+'G</td>'+
    '<td>'+(h.bw/1e12).toFixed(1)+'T</td>'+
    '<td>'+gn(m.n-(S.buy[m.k]||0))+(S.buy[m.k]>0?'<span class="ok"> +'+gn(S.buy[m.k])+'</span>':'')+'</td>'+
    '<td>'+(m.n/u.n).toFixed(m.n%u.n?1:0)+' '+u.t+'</td>'+
    '<td class="'+(m.idle>0?'warn':'ok')+'">'+gn(m.lit)+(m.idle>0?' <span class="bad">−'+gn(m.idle)+'</span>':'')+'</td>'+
    '<td>B'+BATCH[c.batchI]+'/TP'+TPS[c.tpI]+'</td>'+
    '<td class="'+(m.perGpu>0?'':'bad')+'">'+(m.oom?'放不下':m.perGpu.toFixed(0))+'</td>'+
    '<td class="'+(m.sla?'ok':'bad')+'">'+(m.oom?'—':m.tpot.toFixed(0)+'ms')+'</td></tr>';}).join('')+
  '</tbody></table>'+
  '<p class="fnote" style="margin-top:3px">点左边的卡型给<b>那一型</b>单独配参数；产出为 0 的卡不通电。</p>';
 annotate($('fleetList'));
}

/* ================= 结构图 ================= */
function drawStruct(r,ctx){
 const hw=r.hw, tp=r.tp, capB=hw.cap, Wb=r.wBytes, Kb=r.kvBytes;
 const usedW=Math.min(1,Wb/capB), usedK=Math.min(Math.max(0,1-usedW),Kb/capB);
 const barX=24, barW=512, barY=286, barH=26;
 const wPx=usedW*barW, kPx=usedK*barW;
 const nSlots=12, slotW=34, slotGap=6, sx=24;
 let slots='';
 for(let i=0;i<nSlots;i++){
   const inTp=i<tp;
   slots+='<rect x="'+(sx+i*(slotW+slotGap))+'" y="30" width="'+slotW+'" height="26" rx="2" fill="'+(inTp?'var(--cmp)':'var(--edge)')+'" opacity="'+(inTp?'.85':'.5')+'"/>';
 }
 const tpBoxW=tp*slotW+(tp-1)*slotGap+10;
 const F='font-family:var(--mono)';
 const NST=hw.st||6;
 function stackGroup(x0,w,count){
   const gap=3, bw=(w-10-(count-1)*gap)/count;
   let o='<rect x="'+x0+'" y="116" width="'+w+'" height="82" rx="2" fill="var(--mem)" opacity=".10" stroke="var(--mem)"/>';
   for(let i=0;i<count;i++) o+='<rect x="'+(x0+5+i*(bw+gap)).toFixed(1)+'" y="126" width="'+bw.toFixed(1)+'" height="56" rx="1" fill="var(--mem)" opacity=".5"/>';
   return o;
 }
 renderFleet(r);
 $('struct').innerHTML=
 '<svg viewBox="0 0 560 322" role="img" aria-label="机柜、GPU 封装、HBM 与带宽的结构示意，当前数值标在图上">'+
 /* --- 机柜 --- */
 '<text x="20" y="13" style="'+F+';font-size:9px;fill:var(--txt40);letter-spacing:.11em">机柜 / NVLINK 域　·　'+(hw.nvl?'NVL72 级大域':'HGX 8 卡节点')+'</text>'+
 '<rect x="12" y="18" width="536" height="58" rx="3" fill="none" stroke="var(--edge2)"/>'+
 slots+
 '<rect x="'+(sx-5)+'" y="25" width="'+tpBoxW+'" height="36" rx="3" fill="none" stroke="var(--cmp)" stroke-width="1.4" stroke-dasharray="3 2"/>'+
 '<text x="'+(sx-5)+'" y="72" style="'+F+';font-size:8.5px;fill:var(--cmp);font-weight:700">一个副本 = TP('+tp+') 张卡</text>'+
 '<text x="536" y="42" text-anchor="end" style="'+F+';font-size:9.5px;fill:var(--txt60)">点亮 '+gn(ctx.pw)+' / '+gn(r.fleetN)+' 张</text>'+
 '<text x="536" y="57" text-anchor="end" style="'+F+';font-size:9.5px;fill:var(--txt40)">单卡 '+hw.kw+' kW　·　PUE 1.15</text>'+
 /* --- 封装 --- */
 '<text x="20" y="96" style="'+F+';font-size:9px;fill:var(--txt40);letter-spacing:.11em">一个 GPU 封装　·　'+hw.n+'</text>'+
 '<rect x="12" y="101" width="536" height="112" rx="3" fill="var(--panel)" stroke="var(--edge2)"/>'+
 /* HBM 堆栈：左右两组只是画法，实际是环绕计算 die 的 N 个相同堆栈 */
 (function(){return '';})()+
 stackGroup(24,78,Math.ceil((hw.st||6)/2))+
 '<text x="63" y="112" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--mem);font-weight:700">HBM ×'+Math.ceil((hw.st||6)/2)+'</text>'+
 stackGroup(458,78,(hw.st||6)-Math.ceil((hw.st||6)/2))+
 '<text x="497" y="112" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--mem);font-weight:700">HBM ×'+((hw.st||6)-Math.ceil((hw.st||6)/2))+'</text>'+
 '<text x="63" y="192" text-anchor="middle" style="'+F+';font-size:8.5px;fill:var(--txt40)">cap('+(capB/1e9).toFixed(0)+' GB) 是总和</text>'+
 '<text x="497" y="192" text-anchor="middle" style="'+F+';font-size:8.5px;fill:var(--txt40)">BW 也是总和</text>'+
 /* 计算 die */
 '<rect x="212" y="116" width="136" height="82" rx="2" fill="var(--cmp)" opacity=".12" stroke="var(--cmp)"/>'+
 '<text x="280" y="138" text-anchor="middle" style="'+F+';font-size:11px;fill:var(--cmp);font-weight:700">计算 die</text>'+
 '<text x="280" y="157" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--txt60)">peak('+(r.peak/1e12).toFixed(0)+' TF/s)</text>'+
 '<text x="280" y="173" text-anchor="middle" style="'+F+';font-size:8.5px;fill:var(--txt40)">'+r.fmt+' 张量核</text>'+
 '<text x="280" y="190" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--cmp);font-weight:600">t_cmp('+ms(r.cmpMs)+' ms)</text>'+
 /* 双向箭头 */
 '<line x1="104" y1="150" x2="208" y2="150" stroke="var(--mem)" stroke-width="2"/>'+
 '<polygon points="208,150 200,146 200,154" fill="var(--mem)"/><polygon points="104,150 112,146 112,154" fill="var(--mem)"/>'+
 '<text x="156" y="143" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--mem);font-weight:700">BW('+(hw.bw/1e12).toFixed(2)+' TB/s)</text>'+
 '<text x="156" y="167" text-anchor="middle" style="'+F+';font-size:9px;fill:var(--mem);font-weight:600">t_mem('+ms(r.memMs)+' ms)</text>'+
 '<text x="156" y="182" text-anchor="middle" style="'+F+';font-size:8px;fill:var(--txt40)">每步搬 '+fB(r.total)+'</text>'+
 '<line x1="352" y1="150" x2="454" y2="150" stroke="var(--mem)" stroke-width="2"/>'+
 '<polygon points="454,150 446,146 446,154" fill="var(--mem)"/><polygon points="352,150 360,146 360,154" fill="var(--mem)"/>'+
 '<text x="403" y="143" text-anchor="middle" style="'+F+';font-size:8.5px;fill:var(--mem)">同一条带宽</text>'+
 '<text x="403" y="167" text-anchor="middle" style="'+F+';font-size:8px;fill:var(--txt40)">'+(r.memBound?'瓶颈在这一侧':'这一侧还有余量')+'</text>'+
 '<text x="280" y="209" text-anchor="middle" style="'+F+';font-size:8.5px;fill:var(--txt40)">'+NST+' 个 HBM 堆栈干的是同一件事：同一个地址空间，容量相加、带宽相加。画成两边只因为它们在中介层上环绕着计算 die</text>'+
 /* 结论条 */
 '<rect x="12" y="223" width="536" height="30" rx="3" fill="'+(r.memBound?'var(--mem)':'var(--cmp)')+'" opacity=".1"/>'+
 '<text x="24" y="242" style="'+F+';font-size:10px;fill:var(--txt)">TPOT = max( t_mem('+ms(r.memMs)+') , t_cmp('+ms(r.cmpMs)+') ) × tax('+r.tpTax.toFixed(2)+') = <tspan style="font-weight:700">'+ms(r.tpot)+' ms</tspan></text>'+
 '<text x="536" y="242" text-anchor="end" style="'+F+';font-size:9.5px;font-weight:700;fill:'+(r.memBound?'var(--mem)':'var(--cmp)')+'">'+(r.memBound?'带宽受限':'算力受限')+'</text>'+
 /* 容量条 */
 '<text x="24" y="276" style="'+F+';font-size:9px;fill:var(--txt40);letter-spacing:.11em">单卡显存占用　cap('+(capB/1e9).toFixed(0)+' GB)</text>'+
 '<rect x="'+barX+'" y="'+barY+'" width="'+barW+'" height="'+barH+'" fill="var(--panel2)" stroke="var(--edge)"/>'+
 '<rect x="'+barX+'" y="'+barY+'" width="'+wPx.toFixed(1)+'" height="'+barH+'" fill="var(--mem)" opacity=".85"/>'+
 '<rect x="'+(barX+wPx).toFixed(1)+'" y="'+barY+'" width="'+kPx.toFixed(1)+'" height="'+barH+'" fill="var(--mem)" opacity=".4"/>'+
 (wPx>70?'<text x="'+(barX+6)+'" y="'+(barY+17)+'" style="'+F+';font-size:9.5px;fill:#fff;font-weight:600">W('+fB(Wb)+')</text>':'')+
 (kPx>72?'<text x="'+(barX+wPx+6).toFixed(1)+'" y="'+(barY+17)+'" style="'+F+';font-size:9.5px;fill:var(--txt);font-weight:600">K('+fB(Kb)+')</text>':'')+
 '<text x="536" y="'+(barY+17)+'" text-anchor="end" style="'+F+';font-size:9.5px;font-weight:600;fill:'+(r.oom?'var(--bad)':'var(--txt40)')+'">'+
   (r.oom?'放不下！要 '+fB(r.resident):'剩 '+fB(Math.max(0,capB-r.resident)))+'</text>'+
 '</svg>';
}

/* ================= 结算 ================= */
function commit(){
 const Y=YEARS[S.i], o=opts(), r=G.sim(o);
 const pwO=PW.filter(x=>x.k===S.pwKey)[0], pwCost=pwO?pwO.mw*pwO.px:0;
 const cash0=S.cash;
 if(pwO&&pwO.mw>0){ S.pending.push({mw:pwO.mw,at:Y.y+pwO.lead}); if(pwO.k==='far')S.far=true; }
 Object.keys(S.buy).forEach(k=>{ if(S.buy[k]>0) S.fleet[k]=(S.fleet[k]||0)+S.buy[k]; });

 /* ---- 资本开支入账 ---- */
 S.gpuCapex+=r.buyCost; S.pwCapex+=pwCost;
 const capex=r.buyCost+pwCost;

 /* ---- 折旧与摊销（非现金） ---- */
 const gpuDep=Math.max(0,Math.min(S.gpuCapex/3, S.gpuCapex-S.gpuAccDep));
 const pwDep =Math.max(0,Math.min(S.pwCapex/10, S.pwCapex-S.pwAccDep));
 S.gpuAccDep+=gpuDep; S.pwAccDep+=pwDep;
 const DA=gpuDep+pwDep;

 /* ---- 电费按点亮的卡算 ---- */
 let elec=r.elecM, pw=r.fleetPow;
 if(G.TE().disagg) elec*=0.85;

 /* ---- 收入 ---- */
 const slaT=r.tpot<=50, slaF=r.ttft<=1000;
 const slaFactor=r.capTok>0?r.capOk/r.capTok:1;
 const sla=slaFactor>0.999;
 const served=Math.min(r.capTok,Y.demand)*slaFactor;
 const tokens=served*SEC;
 const rev=tokens/1e6*Y.price/1e6;

 /* ---- 利息：按期初负债 8% ---- */
 const interest=S.debt*0.08;

 /* ---- 现金流量表 ---- */
 const cfo=rev-elec-interest;          /* 经营：净利 + 折旧摊销 = 收入 − 电费 − 利息 */
 const cfi=-capex;                      /* 投资 */
 let borrow=0, need=cash0+cfo+cfi;
 if(need<0){ borrow=-need; S.debt+=borrow; }
 const cff=borrow;
 S.cash=cash0+cfo+cfi+cff;

 /* ---- 损益 ---- */
 const netIncome=rev-elec-DA-interest;
 S.retained+=netIncome;

 S.cumTok+=tokens; S.cumRev+=rev; S.cumCost+=elec+DA+interest;
 if(sla) S.slaOk++;
 const bs=balance();
 S.fin.push({y:Y.y,rev:rev,elec:elec,DA:DA,gpuDep:gpuDep,pwDep:pwDep,interest:interest,
   net:netIncome,cfo:cfo,cfi:cfi,cff:cff,capex:capex,buy:r.buyCost,pwCost:pwCost,
   cash0:cash0,cash1:S.cash,debt:S.debt,assets:bs.assets,equity:bs.equity,
   tokens:tokens,unit:tokens>0?(DA+elec+interest)*1e12/tokens:0});
 saveNow();
 S.trace.push({y:Y.y,share:Math.min(100,served/Y.demand*100),sla:sla,tpot:r.tpot,cost:tokens>0?(DA+elec)*1e12/tokens:0});

 showSettle(r,{dep:DA,gpuDep:gpuDep,pwDep:pwDep,elec:elec,pw:pw,capex:capex,buy:r.buyCost,pwCost:pwCost,
   rev:rev,served:served,tokens:tokens,sla:sla,slaT:slaT,slaF:slaF,net:netIncome,cfo:cfo,cfi:cfi,cff:cff,
   borrow:borrow,interest:interest,cash0:cash0,cashDelta:S.cash-cash0,Y:Y});
}

function lessons(r,x){
 const L=[],Y=x.Y,T=G.TE();
 if(!x.slaT) L.push({c:'miss',h:'TPOT 没达标',p:'单步 <code>'+r.tpot.toFixed(1)+' ms</code>，其中搬字节 <code>'+r.memMs.toFixed(1)+' ms</code>、做运算 <code>'+r.cmpMs.toFixed(2)+' ms</code>。'+
   (r.memBound?'<b>你在等内存。</b>加算力、换更强的卡都没用——只有减字节（量化、MLA、FP8 KV）或提高算术强度才有效。':'<b>你在等算力。</b>到这一侧才轮到 kernel 优化和减 FLOP。')});
 if(!x.slaF) L.push({c:'miss',h:'TTFT 没达标 —— 这是 prefill 的锅',p:'首字 <code>'+(r.ttft/1000).toFixed(2)+' s</code>。TTFT 由 prefill 决定，随 prompt 长度增长，和 decode 的带宽账是<b>两个完全相反的 regime</b>。'+
   (T.radix?'':'<b>你还没上 radix / prefix cache</b>——多轮对话里第 N 轮的 prompt 是前 N−1 轮全文，不复用前缀，TTFT 会随轮次线性爆炸。')});
 if(r.kvBytes>r.wBytes) L.push({c:'',h:'KV cache 已经超过权重',p:'KV <code>'+fB(r.kvBytes)+'</code> vs 权重 <code>'+fB(r.wBytes)+'</code>。<b>到这个区间再量化权重就没意义了，瓶颈已经换人。</b>该动的是 KV：FP8 KV、MLA 低秩压缩，或者让 KV 与长度解耦的 linear attention。'});
 if(T.spec&&r.specMul<1) L.push({c:'miss',h:'Speculative decoding 变成了净亏损',p:'batch = <code>'+r.B+'</code> 时你早就越过拐点了，验证多出来的 FLOP 是白烧。<b>spec decode 和大 batch 是互斥的</b>——它只在低 batch、低延迟场景里赚。'});
 if(T.moe&&!r.hw.nvl) L.push({c:'miss',h:'MoE 在小 NVLink 域里会反噬',p:'decode 时一个 batch 里的 token 路由到不同专家，你得把大量专家权重读进来。<b>专家并行的 all-to-all 必须待在 NVLink 域内</b>——'+r.hw.n+' 没有 NVL72 那样的大域，MoE 省下的 FLOP 被多读的字节吃回去了。'});
 if(r.fleetN>x.pw*1.05) L.push({c:'miss',h:'你买的卡有 '+((1-x.pw/r.fleetN)*100).toFixed(0)+'% 点不亮',p:'机队 <code>'+gn(r.fleetN)+'</code> 张，电力只够点亮 <code>'+gn(x.pw)+'</code> 张。折旧照付，产出没有。<b>2026 年之后限制规模的从来不是买不买得到卡，是三年前有没有去排那个队。</b>'});
 if(r.fp4miss) L.push({c:'miss',h:'这代卡没有 FP4 张量核',p:r.hw.n+' 上 4-bit 权重只能走 W4A16：<b>省的是字节，算力那侧仍按 BF16 峰值算</b>。FP4 算力从 Blackwell 才开始有——精度格式和硬件代际是绑死的。'});
 if(x.sla&&r.capTok>=Y.demand){
  const upm = x.tokens>0 ? ((x.dep+x.elec)*1e12/x.tokens).toFixed(2) : '—';
  L.push({c:'win',h:'这一年你吃满了需求',p:'产能 <code>'+fT(r.capTok)+' tok/s</code> ≥ 需求 <code>'+fT(Y.demand)+'</code>，TPOT 与 TTFT 都在 SLA 内，单位成本 <code>$'+upm+'/Mtok</code>（市场价 $'+Y.price.toFixed(1)+'）。<b>这就是 goodput 的正确定义：满足 SLA 前提下的吞吐。</b>'});
 }
 if(L.length<2) L.push({c:'',h:r.memBound?'这一年你被带宽卡住':'这一年你被算力卡住',
   p:'强度 <code>'+(r.I<10?r.I.toFixed(1):r.I.toFixed(0))+' FLOP/byte</code>，'+r.hw.n+' '+r.fmt+' 的拐点是 <code>'+Math.round(r.ridge)+'</code>。'+
     (r.memBound?'离拐点还差得远——软件侧能做的只有三件：<b>减字节、提强度、减 FLOP</b>。':'已越过拐点，kernel 优化和减 FLOP 才开始有回报。')});
 return L.slice(0,3);
}

function showSettle(r,x){
 const Y=x.Y;
 $('shYl').textContent=Y.y+' 年结算 · 第 '+(S.i+1)+' / 7 回合';
 const t=$('shTitle');
 if(!x.sla){t.className='bad';t.textContent='SLA 没守住，产出打了 0.6 折';}
 else if(x.served>=Y.demand*0.98){t.className='ok';t.textContent='需求全吃下了';}
 else {t.className='warn';t.textContent='达标，但产能只覆盖了 '+(x.served/Y.demand*100).toFixed(0)+'% 的需求';}
 const row=(k,v,cls)=>'<div class="lk">'+k+'</div><div class="lv'+(cls?' '+cls:'')+'">'+v+'</div>';
 $('shBody').innerHTML=
  '<div class="ledger">'+
   row('服务产出','<b>'+fT(x.tokens)+'</b> token（'+fT(x.served)+' tok/s）')+
   row('收入 @ $'+Y.price.toFixed(1)+'/Mtok',money(x.rev),'pos')+
   row('电费 @ PUE 1.15','−'+fM(x.elec),'neg')+
   row('折旧摊销（非现金）　卡 '+fM(x.gpuDep)+' + 电力 '+fM(x.pwDep),'−'+fM(x.dep),'neg')+
   (x.interest>0?row('信贷利息 8%','−'+fM(x.interest),'neg'):'')+
   row('<b>本年净利</b>','<b>'+money(x.net)+'</b>',x.net>=0?'pos':'neg')+
   row('经营现金流 CFO　净利 + 折旧摊销',money(x.cfo),x.cfo>=0?'pos':'neg')+
   row('投资现金流 CFI　购卡 '+fM(x.buy)+' + 电力 '+fM(x.pwCost),money(x.cfi),'neg')+
   (x.borrow>0?row('动用信贷 CFF',money(x.cff),'neg'):'')+
   row('现金 '+fM(x.cash0)+' → 期末',money(x.cash0+x.cashDelta),x.cashDelta>=0?'pos':'neg')+
   row('净资产 / 机队净值',money(balance().equity)+' / '+money(balance().gpuNet))+
   row('点亮 / 机队',gn(x.pw)+' / '+gn(r.fleetN)+' 张')+
   row('TPOT / TTFT',r.tpot.toFixed(1)+' ms / '+(r.ttft/1000).toFixed(2)+' s',x.sla?'pos':'neg')+
   row('单位成本','$'+(x.tokens>0?((x.dep+x.elec+x.interest)*1e12/x.tokens).toFixed(2):'—')+' / Mtok　vs 市场价 $'+Y.price.toFixed(1))+
  '</div>'+
  lessons(r,x).map(l=>'<div class="lesson '+l.c+'"><div class="lh">'+l.h+'</div><p>'+l.p+'</p></div>').join('');
annotate($('shBody'));
 $('shFoot').innerHTML='<button class="btn" id="nx">'+(S.i>=YEARS.length-1?'看总评':'进入 '+YEARS[S.i+1].y+' 年')+'</button>';
 $('nx').onclick=next;
 $('scrim').hidden=false;
}
function next(){
 if($('scrim').hidden) return;
 $('scrim').hidden=true;
 S.i++;
 if(S.i>=YEARS.length){ clearSave(); if(!DEMO.on) sendRun(); final(); return; }
 const y=YEARS[S.i].y;
 S.pending=S.pending.filter(p=>{ if(p.at<=y){S.power+=p.mw;return false;} return true; });
 S.eng+=4; S.newTech={}; S.off={};
 saveNow();
 renderYear();
}

/* 一局打完：把战绩写进产品数据库（演示局不算） */
function sendRun(){
 try{ const d=scoreData();
   window.__IE_STORE.run('bu1',{rank:d.rank,score:Math.round(d.share*1000)/10,
     summary:{share:d.share,totTok:d.totTok,totRev:d.totRev,capexAll:d.capexAll,unit:d.unit,equity:d.b.equity,sla:d.sla,fleetN:d.fleetN,power:d.power,tech:d.tech,
              trace:S.trace.map(t=>({y:t.y,share:t.share,sla:t.sla}))}});
 }catch(e){}
}
function final(){
 const share=S.trace.length? S.trace.reduce((a,t)=>a+t.share,0)/S.trace.length/100 : 0;
 let rank,cmt;
 if(share>=.72){rank='S';cmt='六层瓶颈你基本全踩对了：软件栈提前铺、电力提前排队、精度格式跟着硬件走。';}
 else if(share>=.52){rank='A';cmt='大方向对，漏掉的多半是某一年的提前量——某个技术晚解锁一年，或者电力晚排了一轮。';}
 else if(share>=.32){rank='B';cmt='你解决了带宽账，但没解决电。2026 年之后的落差基本都来自这里。';}
 else if(share>=.16){rank='C';cmt='大概率是被 batch 或 KV 卡死过：continuous batching 和 KV 压缩是回报最高的两件事，越早越好。';}
 else {rank='D';cmt='回到第一课：batch=1 的 decode 每读一遍权重只吐一个 token。先把强度提上去，再谈别的。';}
 $('shYl').textContent='2022 – 2028 · 七年总评';
 $('shTitle').className='';$('shTitle').textContent='收官';
 $('shBody').innerHTML=
  '<div class="rank">'+rank+'</div><p style="color:var(--txt60);margin:0 0 16px;font-size:15px">'+cmt+'</p>'+
  '<div class="fgrid">'+
   ['累计产出|'+fT(S.cumTok)+' token','七年平均覆盖率|'+(share*100).toFixed(0)+'%',
    'SLA 达标年份|'+S.slaOk+' / 7','期末净资产|'+fM(balance().equity),
    '期末现金|'+fM(S.cash),'机队净值|'+fM(balance().gpuNet),
    '累计收入|'+fM(S.cumRev),'信贷余额|'+fM(S.debt)]
   .map(s=>{const p=s.split('|');return '<div class="kb"><span class="k">'+p[0]+'</span><span class="v tnum">'+p[1]+'</span></div>';}).join('')+
  '</div>'+
  '<div class="trace">'+S.trace.map(t=>'<div class="trow"><span class="ty">'+t.y+'</span>'+
    '<span class="td">TPOT '+t.tpot.toFixed(0)+' ms · $'+t.cost.toFixed(2)+'/Mtok</span>'+
    '<span class="tv '+(t.sla?'ok':'bad')+'">'+t.share.toFixed(0)+'% '+(t.sla?'达标':'超时')+'</span></div>').join('')+'</div>'+
  '<div class="lesson"><div class="lh">财务口径</div><p>七年累计收入 <b>'+fM(S.cumRev)+'</b>，投入资本开支 <b>'+fM(S.gpuCapex+S.pwCapex)+'</b>（买卡 '+fM(S.gpuCapex)+' + 电力 '+fM(S.pwCapex)+'），期末净资产 <b>'+fM(balance().equity)+'</b>。<b>推理生意的特点：CFO 很健康，但 CFI 会把它吃掉大半</b>——算力必须持续重投，看现金够不够要看 CFO 减 CFI，不是看净利。</p></div>'+'<div class="lesson" style="margin-top:8px"><div class="lh">一句话</div><p>需求每年 5 倍，芯片供给 3.3 倍，单卡带宽 1.6 倍，电网 1.23 倍，并网 ≈1 倍。<b>每一层的落差就是一个瓶颈</b>，而软件侧能做的事从头到尾只有三件：<b>减字节、提强度、减 FLOP</b>。换代只会让这些功夫更值钱。</p></div>';
 $('shFoot').innerHTML='<button class="btn ghost" id="rs">再来一局</button><button class="btn ghost" id="finBtn2">财务报表</button><button class="btn" id="scBtn">战绩卡 · 可截图</button>';
 $('rs').onclick=()=>{clearSave();location.reload();};
 $('finBtn2').onclick=finance;
 $('scBtn').onclick=shareCard;
 $('scrim').hidden=false;
}

/* ================= 仪表盘上的迷你三表 ================= */
function renderFin(F){
 const row=(k,v,cls,tot)=>'<tr'+(tot?' class="tot"':'')+'><td>'+k+'</td><td'+(cls?' class="'+cls+'"':'')+'>'+money(v)+'</td></tr>';
 $('finBox').innerHTML='<table class="ft"><tbody>'+
  row('现金',F.cash1,F.cash1<0?'neg':'')+
  row('机队净值',F.gpuNet)+
  row('电力设施净值',F.pwNet)+
  row('资产合计',F.assets,'',true)+
  row('信贷负债',F.debt,F.debt>0?'neg':'')+
  row('净资产（权益）',F.equity,'acc',true)+
  '<tr class="gap"><td colspan="2"></td></tr>'+
  row('本年净利',F.net,F.net>=0?'pos':'neg')+
  row('经营现金流 CFO',F.cfo,F.cfo>=0?'pos':'neg')+
  row('投资现金流 CFI',F.cfi,'neg')+
  (F.cff>0?row('动用信贷 CFF',F.cff,'neg'):'')+
  row('现金净变动',F.cfo+F.cfi+F.cff,(F.cfo+F.cfi+F.cff)>=0?'pos':'neg',true)+
 '</tbody></table>';
 annotate($('finBox'));
}

/* ================= 资产负债表 / 现金流量表 ================= */
function balance(){
 const gpuNet=Math.max(0,S.gpuCapex-S.gpuAccDep), pwNet=Math.max(0,S.pwCapex-S.pwAccDep);
 const assets=S.cash+gpuNet+pwNet;
 const equity=S.capital+S.retained;
 return {cash:S.cash,gpuNet:gpuNet,pwNet:pwNet,assets:assets,debt:S.debt,capital:S.capital,
         retained:S.retained,equity:equity,le:S.debt+equity,net:assets-S.debt};
}
function fRow(k,v,cls,ind){return '<div class="fk'+(ind?' ind':'')+'">'+k+'</div><div class="fv'+(cls?' '+cls:'')+'">'+v+'</div>';}
function money(m){ const s=(m<0?'−':'')+fM(Math.abs(m)); return s; }
function finance(){
 const b=balance(), last=S.fin.length?S.fin[S.fin.length-1]:null;
 const Y=YEARS[Math.min(S.i,YEARS.length-1)];
 const sum=k=>S.fin.reduce((a,x)=>a+x[k],0);
 $('shYl').textContent='财务报表 · 截至 '+(last?last.y:(Y.y-1))+' 年末'+(S.fin.length?'':'（还没有结算过任何一年）');
 $('shTitle').className=''; $('shTitle').textContent='资产负债表与现金流量表';
 let H='';

 /* 资产负债表 */
 H+='<div class="fsec"><div class="fh">资产负债表 <span>期末快照 · 资产 = 负债 + 权益</span></div><div class="fgrid2">'+
   '<div class="fcol"><div class="fsub">资产</div><div class="ftab">'+
     fRow('现金',money(b.cash),b.cash<0?'neg':'')+
     fRow('机队净值　原值 '+fM(S.gpuCapex)+' − 累计折旧 '+fM(S.gpuAccDep),money(b.gpuNet))+
     fRow('电力设施净值　原值 '+fM(S.pwCapex)+' − 累计摊销 '+fM(S.pwAccDep),money(b.pwNet))+
     fRow('<b>资产合计</b>','<b>'+money(b.assets)+'</b>','tot')+
   '</div></div>'+
   '<div class="fcol"><div class="fsub">负债与权益</div><div class="ftab">'+
     fRow('信贷负债　利率 8%/年',money(b.debt),b.debt>0?'neg':'')+
     fRow('实收资本',money(b.capital))+
     fRow('留存收益　历年净利累计',money(b.retained),b.retained<0?'neg':'pos')+
     fRow('<b>负债与权益合计</b>','<b>'+money(b.le)+'</b>','tot')+
   '</div></div></div>'+
   '<p class="fnote2">净资产（股东权益）<b>'+money(b.equity)+'</b>　·　'+
   (b.debt>0?'已动用信贷 <b class="bad">'+fM(b.debt)+'</b>，每年吃掉 '+fM(b.debt*0.08)+' 利息':'零负债')+
   '　·　机队占总资产 <b>'+(b.assets>0?(b.gpuNet/b.assets*100).toFixed(0):0)+'%</b></p></div>';

 /* 现金流量表 */
 if(last){
  H+='<div class="fsec"><div class="fh">现金流量表 <span>'+last.y+' 年　·　右列为七年累计</span></div><div class="ftab3">'+
   '<div class="fk3 hd"></div><div class="fv3 hd">'+last.y+'</div><div class="fv3 hd">累计</div>'+
   '<div class="fk3 grp">经营活动</div><div class="fv3"></div><div class="fv3"></div>'+
   '<div class="fk3 ind">收入</div><div class="fv3 pos">'+money(last.rev)+'</div><div class="fv3 pos">'+money(sum('rev'))+'</div>'+
   '<div class="fk3 ind">电费</div><div class="fv3 neg">'+money(-last.elec)+'</div><div class="fv3 neg">'+money(-sum('elec'))+'</div>'+
   '<div class="fk3 ind">利息</div><div class="fv3 neg">'+money(-last.interest)+'</div><div class="fv3 neg">'+money(-sum('interest'))+'</div>'+
   '<div class="fk3 sub">经营活动净现金 CFO</div><div class="fv3 tot">'+money(last.cfo)+'</div><div class="fv3 tot">'+money(sum('cfo'))+'</div>'+
   '<div class="fk3 grp">投资活动</div><div class="fv3"></div><div class="fv3"></div>'+
   '<div class="fk3 ind">购卡</div><div class="fv3 neg">'+money(-last.buy)+'</div><div class="fv3 neg">'+money(-sum('buy'))+'</div>'+
   '<div class="fk3 ind">电力投资</div><div class="fv3 neg">'+money(-last.pwCost)+'</div><div class="fv3 neg">'+money(-sum('pwCost'))+'</div>'+
   '<div class="fk3 sub">投资活动净现金 CFI</div><div class="fv3 tot">'+money(last.cfi)+'</div><div class="fv3 tot">'+money(sum('cfi'))+'</div>'+
   '<div class="fk3 grp">融资活动</div><div class="fv3"></div><div class="fv3"></div>'+
   '<div class="fk3 ind">新增信贷</div><div class="fv3">'+money(last.cff)+'</div><div class="fv3">'+money(sum('cff'))+'</div>'+
   '<div class="fk3 sub">现金净变动</div><div class="fv3 tot">'+money(last.cash1-last.cash0)+'</div><div class="fv3 tot">'+money(S.cash-S.capital)+'</div>'+
   '<div class="fk3">期初现金 → 期末现金</div><div class="fv3 tot">'+money(last.cash1)+'</div><div class="fv3 tot">'+money(S.cash)+'</div>'+
  '</div>'+
  '<p class="fnote2">折旧摊销 <b>'+fM(last.DA)+'</b> 是非现金支出：它压低净利，但不动现金——所以 CFO 比净利高出正好这么多。<b>本年净利 '+money(last.net)+'，CFO '+money(last.cfo)+'。</b></p></div>';

  /* 逐年 */
  H+='<div class="fsec"><div class="fh">逐年明细</div><div class="fyear">'+
   '<div class="hd">年</div><div class="hd">收入</div><div class="hd">净利</div><div class="hd">CFO</div><div class="hd">CFI</div><div class="hd">期末现金</div><div class="hd">净资产</div><div class="hd">$/Mtok</div>'+
   S.fin.map(f=>'<div>'+f.y+'</div><div>'+fM(f.rev)+'</div><div class="'+(f.net>=0?'pos':'neg')+'">'+money(f.net)+'</div>'+
     '<div class="'+(f.cfo>=0?'pos':'neg')+'">'+money(f.cfo)+'</div><div class="neg">'+money(f.cfi)+'</div>'+
     '<div>'+money(f.cash1)+'</div><div>'+money(f.equity)+'</div><div>$'+f.unit.toFixed(2)+'</div>').join('')+
  '</div></div>';
 } else {
  H+='<div class="lesson"><div class="lh">还没有数据</div><p>先结算完 '+Y.y+' 年，这里就会出现完整的现金流量表和逐年明细。</p></div>';
 }

 H+='<div class="lesson"><div class="lh">这两张表怎么读</div><p><b>资产负债表</b>回答「你现在有什么」：现金 + 机队净值 + 电力设施。卡按 <b>3 年直线折旧</b>，电力设施按 <b>10 年</b>——所以买卡那一刻现金变成资产，之后三年一点点变成成本。<br><b>现金流量表</b>回答「钱去哪了」：收入减电费和利息是 <b>CFO</b>；买卡和投电力是 <b>CFI</b>，全额一次性出现金；不够就自动动用信贷（<b>CFF</b>），利率 8%。<br><b>关键直觉：</b>推理生意的 CFO 通常很健康，但 CFI 会把它全吃掉——因为算力必须持续重投。<b>看现金够不够，要看 CFO 减 CFI，不是看净利。</b></p></div>';

 $('shBody').innerHTML=H;
 $('shFoot').innerHTML='<button class="btn" id="fclose">回到游戏</button>';
 $('fclose').onclick=()=>{$('scrim').hidden=true;};
 annotate($('shBody'));
 $('scrim').hidden=false;
}

/* ================= 原理小课堂：用你此刻的数字讲清每一件事 ================= */
let LAST=null, lessonI=0;
function specRows(hw){
 const sp=hw.spec||{}, N=hw.st||6;
 const perStackBW=hw.bw/N, perStackGB=sp.gbs||Math.round(hw.cap/1e9/N);
 return {sp:sp,N:N,perStackBW:perStackBW,perStackGB:perStackGB};
}
const LESSONS=[
{t:'一、peak 是三个数乘出来的',
 b:function(hw,r){const s=specRows(hw),sp=s.sp;
  return '<p><b>峰值算力 = SM 数 × 每个 SM 每周期能做的张量核 FLOP × 时钟频率。</b>没有别的东西了。</p>'+
  '<div class="lz"><div class="lzr"><span>SM 数</span><b>'+(sp.pub?sp.sm:'未公布')+'</b><i>GPU 的基本计算单元，每个里面有 4 个张量核</i></div>'+
  '<div class="lzr"><span>每 SM 每周期</span><b>'+(sp.pub?gn(sp.fpc)+' FLOP':'未公布')+'</b><i>4 个张量核 × 512 次乘加 × 2（一次乘加算两个 FLOP）= 4096</i></div>'+
  '<div class="lzr"><span>张量核时钟</span><b>'+(sp.pub?sp.clk+' GHz':'未公布')+'</b><i>注意是张量核的时钟，比标称 boost 低一点</i></div></div>'+
  (sp.pub?'<p class="lzeq">'+sp.sm+' × '+gn(sp.fpc)+' × '+sp.clk+' GHz = <b>'+(sp.sm*sp.fpc*sp.clk/1000).toFixed(0)+' TFLOP/s</b>（BF16 dense）</p>'
         :'<p class="lzeq">'+hw.n+' 的 SM 数与时钟 NVIDIA 没有完整公布，但公式不变。它的 BF16 dense 峰值是 <b>'+(hw.f16/1e12).toFixed(0)+' TFLOP/s</b>。</p>')+
  '<p><b>为什么精度减半、数字就翻倍？</b>张量核的数据通路位宽是固定的。位宽减半，同一个周期就能塞进两倍的元素。所以这张卡：</p>'+
  '<div class="lz"><div class="lzr"><span>BF16</span><b>'+(hw.f16/1e12).toFixed(0)+' TF/s</b><i>2 字节/元素</i></div>'+
  '<div class="lzr"><span>FP8</span><b>'+(hw.f8/1e12).toFixed(0)+' TF/s</b><i>1 字节，正好翻倍</i></div>'+
  '<div class="lzr"><span>FP4</span><b>'+(hw.f4?(hw.f4/1e12).toFixed(0)+' TF/s':'没有')+'</b><i>'+(hw.f4?'0.5 字节，再翻倍':'Blackwell 之后才有 FP4 张量核')+'</i></div></div>'+
  '<p class="lzwarn"><b>两个必须知道的坑。</b>① NVIDIA 官网常标的「1,979 TFLOPS FP16」是 <b>2:4 结构化稀疏</b>的数字，dense 只有一半。别人报 peak 时先问一句 dense 还是 sparse。本局用的全是 dense。<br>② 这是<b>张量核</b>的数，不是 CUDA Core。H100 的 FP32 CUDA core 只有 67 TFLOP/s，差 15 倍。谈 LLM 时说 peak，说的都是张量核。</p>';}},

{t:'二、带宽是堆栈加出来的',
 b:function(hw,r){const s=specRows(hw);
  return '<p>HBM 不是一块，是<b>'+s.N+' 个一模一样的堆栈</b>，通过硅中介层环绕在计算 die 周围。它们是同一个地址空间——<b>容量相加，带宽也相加</b>。软件完全看不到它们是分开的。</p>'+
  '<div class="lz"><div class="lzr"><span>堆栈数</span><b>'+s.N+' 个</b><i>'+s.sp.mem+'</i></div>'+
  '<div class="lzr"><span>每堆栈容量</span><b>≈ '+s.perStackGB+' GB</b><i>× '+s.N+' = cap('+(hw.cap/1e9).toFixed(0)+' GB)</i></div>'+
  '<div class="lzr"><span>每堆栈带宽</span><b>≈ '+(s.perStackBW/1e12).toFixed(2)+' TB/s</b><i>× '+s.N+' = BW('+(hw.bw/1e12).toFixed(2)+' TB/s)</i></div></div>'+
  '<p><b>带宽从哪来？</b>每个堆栈用硅通孔（TSV）拉出 <b>1024 根</b>数据线（HBM4 翻倍到 2048 根），带宽 = 位宽 × 每根线的速率。所以想加带宽只有三条路：<b>多插堆栈、加宽位宽、提高每根线的速率</b>。</p>'+
  '<p class="lzgood"><b>这解释了 H200 那一代。</b>H200 和 H100 是<b>同一颗计算芯片，一个晶体管都没变</b>——只是把 5 个 HBM3 换成 6 个更快的 HBM3e。结果算力 0% 增长，带宽 +43%。<b>一代新品只加带宽不加算力，等于 NVIDIA 自己承认：缺的从来不是算力。</b></p>'+
  '<p class="lzwarn"><b>容量和带宽是两件事，别混。</b>容量决定你<em>装不装得下</em>（第 04 行那个显存占用条），带宽决定你<em>多快扫一遍</em>（t_mem）。B300 就是反例：显存从 192 加到 288 GB，带宽<b>一点没动</b>，还是 8 TB/s。</p>';}},

{t:'三、为什么 decode 在搬字节，不在算数',
 b:function(hw,r){const Y=YEARS[S.i];
  const oneStep=r.total, oneFlop=r.flops;
  return '<p>一次 decode，模型要把<b>整套权重完整读一遍</b>，才吐出一个 token。你现在这一步：</p>'+
  '<div class="lz"><div class="lzr"><span>要搬的字节</span><b>'+fB(oneStep)+'</b><i>权重 '+fB(r.wBytes)+' + KV '+fB(r.kvBytes)+'</i></div>'+
  '<div class="lzr"><span>要做的运算</span><b>'+fF(oneFlop)+'</b><i>2 × 参数量 × batch</i></div>'+
  '<div class="lzr"><span>搬字节要</span><b>'+ms(r.memMs)+' ms</b><i>'+fB(oneStep)+' ÷ '+(hw.bw/1e12).toFixed(2)+' TB/s</i></div>'+
  '<div class="lzr"><span>做运算要</span><b>'+ms(r.cmpMs)+' ms</b><i>'+fF(oneFlop)+' ÷ '+(r.peak/1e12).toFixed(0)+' TFLOP/s</i></div></div>'+
  '<p class="lzeq">两者相差 <b>'+(r.memMs/Math.max(r.cmpMs,0.0001)).toFixed(0)+' 倍</b>。计算单元有 '+(100-100/Math.max(1,r.memMs/Math.max(r.cmpMs,0.0001))).toFixed(1)+'% 的时间在<b>等内存</b>。</p>'+
  '<p><b>batch=1 时这件事最荒唐</b>：读一遍 140 GB 的权重，只为了产出一个 token。这就是为什么 continuous batching 是回报最高的一件事——<b>权重读一遍，让 B 条序列一起用</b>，搬的字节几乎没变，产出却翻了 B 倍。</p>'+
  '<p class="lzwarn"><b>prefill 是反过来的。</b>它一次并行吃掉几千个 token，算术强度上千，是<b>算力受限</b>的。所以 TTFT 和 TPOT 要用完全不同的手段去优化——调 batch 救不了 TTFT，上 radix cache 也救不了 TPOT。</p>';}},

{t:'四、batch 是最赚的旋钮，但它的天花板不是显存',
 b:function(hw,r){const Y=YEARS[S.i],bMax=G.TE().cb?Y.maxB:2;
  return '<p><b>为什么加大 batch 几乎是白赚：</b>权重那部分字节是<b>常数</b>，读一遍所有序列共享。所以 batch 翻倍，搬的字节几乎没变（只有 KV 那一小块跟着涨），产出却接近翻倍。</p>'+
  '<div class="lz"><div class="lzr"><span>权重字节</span><b>'+fB(r.wBytes)+'</b><i>和 batch 无关，永远是这么多</i></div>'+
  '<div class="lzr"><span>KV 字节</span><b>'+fB(r.kvBytes)+'</b><i>随 batch 线性涨，这才是代价</i></div>'+
  '<div class="lzr"><span>当前 batch</span><b>'+r.B+'</b><i>本年上限 '+BATCH[bMax]+'</i></div></div>'+
  '<p><b>那上限为什么是 '+BATCH[bMax]+'？</b>不是显存。batch 是<b>同一步里正在跑的并发请求数</b>——你不可能把还没到达的请求塞进这一批。所以天花板是这一年真实的在线并发量。</p>'+
  '<div class="lz"><div class="lzr"><span>显存决定</span><b>放不放得下</b><i>装不下就 OOM，加 TP 或减 batch</i></div>'+
  '<div class="lzr"><span>并发决定</span><b>有没有那么多</b><i>2022 年你就是没那么多用户</i></div></div>'+
  '<p class="lzwarn"><b>加 batch 的两个代价。</b>① KV cache 跟着线性膨胀，长上下文时它会超过权重，那时再量化权重就没意义了。② 单用户的 TPOT 会变差——<b>吞吐和延迟就是靠 batch 这个旋钮互相换的</b>，这也是 goodput 必须带 SLA 约束的原因。</p>';}},

{t:'五、TP 是拿来「装下」的，不是拿来「变快」的',
 b:function(hw,r){
  const Y=YEARS[S.i],rows=[];
  for(let ti=0;ti<4;ti++){
    const o=Object.assign({},opts(),{tpI:ti,buys:{},buyN:0}); const x=G.sim(o);
    rows.push('<div class="lzr"><span>TP = '+TPS[ti]+'</span><b>'+(x.oom?'放不下':x.perGpu.toFixed(0)+' tok/s')+'</b><i>'+
      (x.oom?'每卡需要 '+fB(x.resident)+'，可用约 '+(hw.cap*0.93/1e9).toFixed(0)+' GB'
            :'每卡读 '+fB(x.total)+' · TPOT '+ms(x.tpot)+' ms · 通信税 '+x.tpTax.toFixed(2)+'×')+'</i></div>');
  }
  return '<p>把一层横切到多张卡上算，就是<b>张量并行 TP</b>。它确实让每张卡少读字节、TPOT 变短——但看<b>每卡吞吐</b>这一列，用你此刻的配置实算一遍：</p>'+
  '<div class="lz">'+rows.join('')+'</div>'+
  '<p><b>为什么 TPOT 降了，每卡吞吐反而跌？</b>因为吞吐的算式是 <code>B ÷ TPOT ÷ TP</code>——分母上多了个 TP。字节被切成 1/4，时间也降到约 1/4，<b>但你用掉了 4 张卡，每卡的份额被抵消掉了</b>。</p>'+
  '<p>再加上<b>通信税</b>：TP 的每一层都要做两次 all-reduce，把各卡的部分结果汇总。本局按 1 + 0.07×(TP−1) 计，TP=8 就是 1.49×，这部分是<b>净损耗</b>。</p>'+
  '<p class="lzgood"><b>所以规则很简单：能装下的前提下，TP 越小越好。</b>这也是为什么 TP 必须待在 NVLink 域内——通信税已经这么贵了，跨出机柜走以太网直接崩。真正的大模型部署里，TP 开多大基本就是「刚好能装下」那个值。</p>';}},

{t:'六、拐点：为什么每一代卡都更难喂饱',
 b:function(hw,r){
  const rows=HW.map(h=>{const p=h.f4||h.f8;const rg=p/h.bw;
    return '<div class="lzr"><span>'+h.n+'</span><b>'+Math.round(rg)+'</b><i>peak '+(p/1e12).toFixed(0)+' TF/s ÷ BW '+(h.bw/1e12).toFixed(2)+' TB/s'+(h.from>YEARS[S.i].y?' · 还没上市':'')+'</i></div>';}).join('');
  return '<p><b>拐点（ridge point）= peak ÷ BW</b>，单位是 FLOP/byte。它回答一个问题：<b>要让这张卡的计算单元不闲着，每从显存读一个字节，至少得干多少活？</b></p>'+
  '<p>你此刻的<b>算术强度 I = '+(r.I<10?r.I.toFixed(1):r.I.toFixed(0))+'</b>，这张卡的<b>拐点 = '+Math.round(r.ridge)+'</b>。'+
  (r.I<r.ridge?'I 远低于拐点 → 你在<b>等内存</b>。这时候换更强的卡、优化 kernel 全都没用，只有<b>减字节</b>或<b>提高强度</b>有效。':'I 已越过拐点 → 你终于在<b>等算力</b>了，kernel 优化和减 FLOP 才开始有回报。')+'</p>'+
  '<p><b>每一代硬件的拐点（按各自最低精度算）：</b></p><div class="lz">'+rows+'</div>'+
  '<p class="lzwarn"><b>这一列一路在涨，只有 H200 那次是降的</b>（因为它只加带宽不加算力）。原因就是第一、二课里那两个数：<b>四年里算力涨了 25 倍，带宽只涨了 6.6 倍。</b></p>'+
  '<p class="lzgood"><b>结论反直觉但很重要：硬件越强，把它喂饱所需的软件功夫越多，不是越少。</b>换代不会替你解决 batching、KV 压缩、分离部署——它只会把这些事的回报放大。你在软件侧能做的从头到尾只有三件：<b>减字节、提强度、减 FLOP</b>。</p>';}},

{t:'七、同一张卡，拐点为什么一会儿 295 一会儿 591',
 b:function(hw,r){
  const rows=[['BF16',hw.f16],['FP8',hw.f8],['FP4',hw.f4]].filter(x=>x[1]).map(x=>
    '<div class="lzr"><span>'+x[0]+'</span><b>'+Math.round(x[1]/hw.bw)+'</b><i>peak '+(x[1]/1e12).toFixed(0)+' TF/s ÷ BW '+(hw.bw/1e12).toFixed(2)+' TB/s</i></div>').join('');
  return '<p><b>因为拐点不是一张卡的属性，是「一张卡 + 一个精度格式」的属性。</b>算式是 <code>peak ÷ BW</code>，而 peak 随精度翻倍，BW 不变——所以同一张卡，你用什么格式跑，拐点就是几。</p>'+
  '<p>'+hw.n+' 现在这张卡：</p><div class="lz">'+rows+'</div>'+
  '<p class="lzeq">H100 就是最典型的例子：<b>BF16 是 295</b>（989 ÷ 3.35），<b>FP8 是 591</b>（1979 ÷ 3.35）。同一张卡，两个数都对，差别只在你说的是哪个格式。</p>'+
  '<p><b>所以看到别人报拐点，先问两句：</b>① 哪个精度？② dense 还是 sparse？这两个问题任一没问清，数字就能差 2 到 4 倍。</p>'+
  '<p class="lzwarn"><b>还有一层更微妙的，面试里能加分。</b>「拐点一代比一代高」这句话里，涨幅有两个来源，得拆开看：<br><br>'+
  '<b>① 同精度下的剪刀差</b>——算力涨得比带宽快。这部分其实很温和：H100 的 FP8 拐点 591，B200 的 FP8 拐点约 <b>562</b>（4.5 PF ÷ 8 TB/s），<b>不升反降</b>，因为那一代带宽涨了 2.4 倍、FP8 算力只涨了 2.3 倍。<br><br>'+
  '<b>② 每代把标称精度又往下压一档</b>——Hopper 报 FP8，Blackwell 之后报 NVFP4。591 → 1250 这一跳，几乎全部来自格式下探而不是硅片。<br><br>'+
  '而且降精度是<b>两头一起动</b>的：权重字节减半让你的强度翻倍，拐点也翻倍，<b>净效果基本抵消</b>。所以「换 FP4 就能吃满卡」是错的。</p>'+
  '<p class="lzgood"><b>结论：</b>路线图上 591 → 2273 那个 3.9 倍，是跨格式口径叠出来的；同精度看只有 1.5–2 倍。<b>但方向不变——门槛确实在抬高，只是没有标称数字那么吓人。</b>真正稳定不变的还是那三件事：减字节、提强度、减 FLOP。</p>';}},

{t:'八、A100 和 H100 差在哪',
 b:function(hw,r){
  const A={sm:108,fpc:2048,clk:1.41,f16:312e12,bw:2.039e12};
  const rows=[
   ['制程 / 晶体管','TSMC 7nm · 542 亿','TSMC 4N · 800 亿'],
   ['SM 数','108','132（+22%）'],
   ['每 SM 每周期','2,048 FLOP','4,096 FLOP（×2）'],
   ['张量核时钟','1.41 GHz','1.83 GHz（+30%）'],
   ['BF16 dense 峰值','312 TFLOP/s','989 TFLOP/s（×3.17）'],
   ['FP8','没有','1,979 TFLOP/s（新增）'],
   ['显存','80 GB HBM2e','80 GB HBM3'],
   ['带宽','2.04 TB/s','3.35 TB/s（×1.64）'],
   ['BF16 拐点','153','295（×1.93）'],
   ['NVLink','3 代 600 GB/s','4 代 900 GB/s'],
   ['功耗','400 W','700 W']
  ].map(x=>'<div class="lzr"><span>'+x[0]+'</span><b>'+x[1]+'</b><i>'+x[2]+'</i></div>').join('');
  return '<p>A100 是 2020 年的 Ampere，H100 是 2022 年的 Hopper。左边 A100，右边 H100：</p>'+
  '<div class="lz">'+rows+'</div>'+
  '<p class="lzeq">用第 1 课那个公式验一遍，3.17 倍是三个因子乘出来的：<br>'+
  '<b>1.22</b>（SM 数）× <b>2.00</b>（每 SM 每周期）× <b>1.30</b>（时钟）= <b>3.17</b>'+
  '<br>108 × 2,048 × 1.41 GHz = 312 TF/s　　132 × 4,096 × 1.83 GHz = 989 TF/s</p>'+
  '<p><b>对 LLM 来说真正重要的四件事：</b></p>'+
  '<p>① <b>FP8 + Transformer Engine</b>。A100 最低只到 INT8（而且不好用），H100 第一次把 FP8 做进张量核，还能<b>逐层动态在 FP8 和 FP16 之间切</b>。这是「降精度换吞吐」路线的起点。<br>'+
  '② <b>TMA</b>（Tensor Memory Accelerator）。一条指令描述整块多维数据的异步搬运，把地址计算从 SM 里卸掉——<b>FlashAttention-3 能跑起来的硬件前提</b>。<br>'+
  '③ <b>Thread Block Cluster</b>。多个 block 组成 cluster，可以直接访问彼此的 shared memory。CUDA 编程模型十年来最大的一次改动，调度粒度从 SM 升到 SM 组。<br>'+
  '④ <b>带宽 2.04 → 3.35 TB/s</b>。对 decode 来说，这一条比算力涨 3 倍更直接——TPOT 差不多就按这个比例改善。</p>'+
  '<p class="lzwarn"><b>但注意拐点：153 → 295，接近翻倍。</b>算力涨 3.17 倍，带宽只涨 1.64 倍——<b>H100 比 A100 更难喂饱</b>。这个模式从 A100 那一代就开始了，一直延续到今天。你在 A100 上 batch=64 能吃满的活，在 H100 上要 batch≈128 才行。</p>'+
  '<p class="lzgood"><b>一句话：A100 → H100 的头条不是「快了 3 倍」，是「多了 FP8 和 TMA」。</b>纯算力的 3 倍你多半吃不到，因为 decode 卡在带宽上，而带宽只涨了 1.64 倍。真正能兑现的是格式（FP8 让权重字节减半）和 kernel（TMA 让 FlashAttention 跑得动）。</p>';}}
];
function openLesson(i){
 lessonI=Math.max(0,Math.min(LESSONS.length-1,i));
 const L=LESSONS[lessonI], hw=(LAST&&LAST.r)?LAST.r.hw:HWM[S.buyKey], r=LAST?LAST.r:G.sim(opts());
 $('shYl').textContent='原理小课堂 · 第 '+(lessonI+1)+' / '+LESSONS.length+' 课　·　数字取自你此刻的配置（'+hw.n+'）';
 $('shTitle').className=''; $('shTitle').textContent=L.t;
 $('shBody').innerHTML='<div class="lesson" style="border-left-color:var(--cmp);margin-bottom:16px"><p>'+
   LESSONS.map((x,j)=>'<button class="lnav'+(j===lessonI?' on':'')+'" data-l="'+j+'">'+(j+1)+'</button>').join('')+
   '　<span style="font-family:var(--mono);font-size:11px;color:var(--txt40)">切换课号，随时回到游戏</span></p></div>'+
   '<div class="lbody">'+L.b(hw,r)+'</div>';
 [].forEach.call($('shBody').querySelectorAll('.lnav'),b=>b.addEventListener('click',()=>openLesson(+b.dataset.l)));
 $('shFoot').innerHTML=
   (lessonI>0?'<button class="btn ghost" id="lprev">← 上一课</button>':'')+
   (lessonI<LESSONS.length-1?'<button class="btn ghost" id="lnext">下一课 →</button>':'')+
   '<button class="btn" id="lclose">回到游戏</button>';
 if($('lprev'))$('lprev').onclick=()=>openLesson(lessonI-1);
 if($('lnext'))$('lnext').onclick=()=>openLesson(lessonI+1);
 $('lclose').onclick=()=>{$('scrim').hidden=true;};
 annotate($('shBody'));
 $('scrim').hidden=false;
 $('shBody').parentNode.scrollTop=0;
}

/* ================= 战绩卡：可截图、可复制，拿去和朋友比 ================= */
function scoreData(){
 const share=S.trace.length? S.trace.reduce((a,x)=>a+x.share,0)/S.trace.length/100 : 0;
 let rank='D';
 if(share>=.72)rank='S'; else if(share>=.52)rank='A'; else if(share>=.32)rank='B'; else if(share>=.16)rank='C';
 const b=balance();
 const totTok=S.cumTok, totRev=S.cumRev, capexAll=S.gpuCapex+S.pwCapex;
 const unit=totTok>0? (S.fin.reduce((a,f)=>a+f.DA+f.elec+f.interest,0))*1e12/totTok : 0;
 let fleetN=0; Object.keys(S.fleet).forEach(k=>fleetN+=S.fleet[k]);
 return {share:share,rank:rank,b:b,totTok:totTok,totRev:totRev,capexAll:capexAll,unit:unit,
   fleetN:fleetN,power:S.power,sla:S.slaOk,tech:Object.keys(S.tech)};
}
function shareCard(){
 const d=scoreData();
 $('shYl').textContent='战绩卡 · 截图发给朋友比一比';
 $('shTitle').className=''; $('shTitle').textContent='2022–2028 七年战绩';
 const yr=S.trace.map((x,i)=>{const f=S.fin[i]||{};
   return '<div class="'+(x.share>=99?'full':(x.sla?'':'miss'))+'"><span class="yy">'+x.y+'</span><b>'+x.share.toFixed(0)+'%</b></div>';}).join('');
 const techNames=d.tech.map(k=>{const o=TECH.filter(x=>x.k===k)[0];return o?o.n:k;});
 $('shBody').innerHTML=
 '<div class="card2" id="cardShot">'+
  '<div class="c2h"><span class="ttl">推理经济学</span><span class="sub">2022 → 2028 · 七回合</span><span class="rk '+d.rank+'">'+d.rank+'</span></div>'+
  '<div class="c2g">'+
   '<div class="c2b"><span class="k">累计产出</span><span class="v">'+fT(d.totTok)+'<small>tok</small></span></div>'+
   '<div class="c2b"><span class="k">平均覆盖率</span><span class="v">'+(d.share*100).toFixed(0)+'<small>%</small></span></div>'+
   '<div class="c2b"><span class="k">期末净资产</span><span class="v">'+fM(d.b.equity)+'</span></div>'+
   '<div class="c2b"><span class="k">单位成本</span><span class="v">$'+d.unit.toFixed(2)+'<small>/Mtok</small></span></div>'+
   '<div class="c2b"><span class="k">累计收入</span><span class="v">'+fM(d.totRev)+'</span></div>'+
   '<div class="c2b"><span class="k">累计资本开支</span><span class="v">'+fM(d.capexAll)+'</span></div>'+
   '<div class="c2b"><span class="k">SLA 达标</span><span class="v">'+d.sla+'<small>/ 7 年</small></span></div>'+
   '<div class="c2b"><span class="k">期末机队 / 电力</span><span class="v">'+(d.fleetN>=1000?(d.fleetN/1000).toFixed(1)+'K':d.fleetN)+'<small>张 · '+d.power+' MW</small></span></div>'+
  '</div>'+
  '<div class="c2y">'+yr+'</div>'+
  '<div class="c2t">'+(techNames.length?techNames.map(n=>'<span>'+n+'</span>').join(''):'<span>没解锁任何技术</span>')+'</div>'+
  '<div class="c2f"><span>需求 5×/年 · 芯片 3.3× · 带宽 1.6× · 电网 1.23×</span><span>'+new Date().toLocaleDateString('zh-CN')+'</span></div>'+
 '</div>'+
 '<p class="shot">截图这张卡就能发给朋友。或者点 <b>复制文字成绩</b>，直接粘进聊天框。</p>'+
 '<textarea id="shareTxt" style="position:absolute;left:-9999px" readonly></textarea>';
 $('shareTxt').value=
  '【推理经济学 2022–2028】评级 '+d.rank+'\n'+
  '累计产出 '+fT(d.totTok)+' token ｜ 平均覆盖率 '+(d.share*100).toFixed(0)+'%\n'+
  '期末净资产 '+fM(d.b.equity)+' ｜ 累计收入 '+fM(d.totRev)+' ｜ 资本开支 '+fM(d.capexAll)+'\n'+
  '单位成本 $'+d.unit.toFixed(2)+'/Mtok ｜ SLA 达标 '+d.sla+'/7 年\n'+
  '期末机队 '+gn(d.fleetN)+' 张 · '+d.power+' MW ｜ 技术栈 '+(techNames.join('、')||'无')+'\n'+
  '逐年覆盖率 '+S.trace.map(x=>x.y+':'+x.share.toFixed(0)+'%').join(' ');
 $('shFoot').innerHTML='<button class="btn ghost" id="cpTxt">复制文字成绩</button><button class="btn" id="scClose">回到总评</button>';
 $('cpTxt').onclick=()=>{
   const ta=$('shareTxt'); ta.select(); ta.setSelectionRange(0,99999);
   let ok=false;
   try{ ok=document.execCommand('copy'); }catch(e){}
   if(!ok && navigator.clipboard){ navigator.clipboard.writeText(ta.value).then(()=>{},()=>{}); ok=true; }
   $('cpTxt').textContent=ok?'已复制 ✓':'手动复制：'+ta.value.slice(0,0);
   if(!ok){ ta.style.position='static'; ta.style.left='0'; ta.style.width='100%'; ta.style.height='120px'; }
 };
 $('scClose').onclick=final;
 $('scrim').hidden=false;
}

/* ================= 演示模式：自动走完一整局 ================= */
const DEMO={on:false,stop:false,speed:1,backup:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms/DEMO.speed));
function flash(el){ if(!el)return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
function say(txt,yr){ $('demoTxt').innerHTML=txt; if(yr)$('demoYr').textContent=yr; }
function demoAsk(){
 $('shYl').textContent='演示模式';
 $('shTitle').className=''; $('shTitle').textContent='自动走完一整局，大约 40 秒';
 $('shBody').innerHTML='<div class="lesson"><div class="lh">会发生什么</div><p>从 2022 年开始，逐年自动做决策：<b>解锁本年推荐的技术 → 选电力方案 → 换到最新的卡 → 按最优配参数 → 下单 → 结算</b>，每一步都会在顶上说明「现在在干什么、为什么」。你可以随时<b>停止</b>，也能切到 2× / 4× 加速。</p><p>看完一遍，整个循环和每个旋钮的作用就清楚了——然后再自己从头玩。</p></div>'+
  (S.i>0||Object.keys(S.tech).length? '<div class="lesson miss"><div class="lh">你当前的进度</div><p>演示会从 2022 年重新开始。<b>你现在这一局会先备份下来</b>，演示结束时可以选择恢复。</p></div>':'');
 $('shFoot').innerHTML='<button class="btn ghost" id="dCancel">算了</button><button class="btn" id="dGo">开始演示</button>';
 $('dCancel').onclick=()=>{$('scrim').hidden=true;};
 $('dGo').onclick=()=>{$('scrim').hidden=true; runDemo();};
 $('scrim').hidden=false;
}
function demoEnd(finished){
 DEMO.on=false; $('demoBar').hidden=true;
 if(!DEMO.backup) return;
 $('shYl').textContent='演示结束';
 $('shTitle').className=''; $('shTitle').textContent=finished?'演示走完了七年':'演示已停止';
 $('shBody').innerHTML='<div class="lesson"><div class="lh">接下来</div><p>可以<b>接着这一局玩下去</b>，也可以<b>回到你自己原来的进度</b>。或者点「重开」从 2022 年干干净净地开始。</p></div>';
 $('shFoot').innerHTML='<button class="btn ghost" id="dRestore">恢复我原来的进度</button>'+
   (finished?'<button class="btn ghost" id="dScore">看战绩卡</button>':'')+
   '<button class="btn" id="dKeep">接着这局玩</button>';
 $('dRestore').onclick=()=>{
   const b=DEMO.backup; DEMO.backup=null;
   Object.keys(S).forEach(k=>{ delete S[k]; });
   Object.keys(b).forEach(k=>{ S[k]=b[k]; });
   PREV=null;PREVIN=null;LAST=null; saveNow(); $('scrim').hidden=true; renderYear();
 };
 if($('dScore')) $('dScore').onclick=shareCard;
 $('dKeep').onclick=()=>{ DEMO.backup=null; saveNow(); $('scrim').hidden=true; if(S.i<YEARS.length) renderYear(); };
 $('scrim').hidden=false;
}
async function runDemo(){
 DEMO.backup=JSON.parse(JSON.stringify(S));
 DEMO.on=true; DEMO.stop=false; DEMO.speed=1; $('demoSpeed').textContent='1×';
 $('demoBar').hidden=false;
 /* 从头开始 */
 Object.keys(FRESH).forEach(k=>{ S[k]=JSON.parse(JSON.stringify(FRESH[k])); });
 PREV=null;PREVIN=null;LAST=null; $('scrim').hidden=true; renderYear();
 await sleep(600);
 for(let y=0;y<YEARS.length;y++){
  if(DEMO.stop) return demoEnd(false);
  const Y=YEARS[S.i];
  say('<b>'+Y.era+'</b>　'+Y.tag, Y.y);
  await sleep(1500);
  /* 1 · 技术栈 */
  for(const k of Y.rec.tech){
   if(DEMO.stop) return demoEnd(false);
   const tt=TECH.filter(x=>x.k===k)[0];
   if(S.tech[k]||tt.from>Y.y||(tt.req&&!S.tech[tt.req])||S.eng<tt.cost) continue;
   S.eng-=tt.cost; S.tech[k]=true; S.newTech[k]=true;
   renderTech(); syncSelects(); refresh();
   flash(document.querySelector('[data-t="'+k+'"]'));
   say('解锁 <b>'+tt.n+'</b>　—　'+tt.desc, Y.y);
   await sleep(1400);
  }
  /* 2 · 电力 */
  if(DEMO.stop) return demoEnd(false);
  if(Y.rec.pw!=='none'){
   const po=PW.filter(x=>x.k===Y.rec.pw)[0];
   if(po && po.mw*po.px<=S.cash){
    S.pwKey=po.k; renderPower(); refresh();
    flash(document.querySelector('[data-pw="'+po.k+'"]'));
    say('电力选 <b>'+po.n+'</b>　+'+po.mw+' MW，<b>'+po.lead+' 年后到位</b>　—　电是唯一要提前几年下注的东西', Y.y);
    await sleep(1600);
   }
  }
  /* 3 · 换到当年最新的卡，并按最优配参数 */
  if(DEMO.stop) return demoEnd(false);
  const av=HW.filter(h=>h.from<=Y.y);
  const pick=av[av.length-1];
  if(S.buyKey!==pick.k){ S.buyKey=pick.k; if(!S.cfg[pick.k]) S.cfg[pick.k]=G.defCfg(); renderHw(); syncSelects(); refresh(); }
  flash(document.querySelector('[data-hw="'+pick.k+'"]'));
  say('本年最新的卡是 <b>'+pick.n+'</b>（'+(pick.bw/1e12).toFixed(2)+' TB/s · '+(pick.cap/1e9).toFixed(0)+' GB）', Y.y);
  await sleep(1300);
  if(DEMO.stop) return demoEnd(false);
  applyBest(); flash($('autoCfg'));
  const c=cur();
  say('给它配一套最优参数：<b>batch '+BATCH[c.batchI]+' · TP '+TPS[c.tpI]+'</b>　—　每一型卡都有自己的参数', Y.y);
  await sleep(1600);
  /* 4 · 下单，滑块渐进 */
  if(DEMO.stop) return demoEnd(false);
  const u=unitOf(S.buyKey), maxU=+$('buyN').max;
  say('下单买卡　—　看右边 <b>投资现金流 CFI</b> 怎么被吃掉', Y.y);
  for(let i=1;i<=5;i++){
   if(DEMO.stop) return demoEnd(false);
   S.buy[S.buyKey]=Math.round(maxU*i/5)*u.n; $('buyN').value=Math.round(maxU*i/5); refresh();
   await sleep(150);
  }
  flash($('buyN'));
  await sleep(1100);
  /* 5 · 结算 */
  if(DEMO.stop) return demoEnd(false);
  const rr=G.sim(opts());
  say(rr.capTok>=Y.demand? '产能盖住了本年需求，<b>结算</b>' : '产能只有需求的 <b>'+(rr.capTok/Y.demand*100).toFixed(0)+'%</b>，先这样结算', Y.y);
  await sleep(900);
  if($('btnGo').disabled){ say('这一年配置放不下，跳过结算', Y.y); await sleep(900); }
  else { flash($('btnGo')); commit(); await sleep(2400); }
  if(DEMO.stop) return demoEnd(false);
  if($('nx')) $('nx').click(); else $('scrim').hidden=true;
  await sleep(700);
  if(S.i>=YEARS.length) break;
 }
 DEMO.on=false; $('demoBar').hidden=true;
 await sleep(400);
 if(!DEMO.stop){ shareCard(); const old=$('scClose'); if(old) old.onclick=()=>demoEnd(true); }
}

/* ================= 帮助 ================= */
function help(){
 $('shYl').textContent='玩法';
 $('shTitle').className='';$('shTitle').textContent='你在运营一支推理团队';
 $('shBody').innerHTML=
  '<div class="lesson"><div class="lh">目标</div><p>七个回合＝ 2022 到 2028 七年。每年市场需求约 <b>×2.7</b>，价格约 <b>×0.68</b>。你要在 SLA（<code>TPOT ≤ 50 ms</code>、<code>TTFT ≤ 1 s</code>）之内尽可能多地吃下需求。<b>超了 SLA，产出直接打 0.6 折</b>——没有 SLA 约束的吞吐数字是假的。</p></div>'+
  '<div class="lesson win"><div class="lh">不用自己摸索</div><p>决策区顶上有个<b>教练面板</b>：说清这一年最要紧的是什么、给出一张实时打勾的目标清单、并且永远只给<b>一条</b>最要紧的下一步建议（该拉 TP 还是该解锁哪个技术，具体到名字）。选项上带 <b>本年推荐</b> 标的，照着点就行。<br>运行参数那一行有<b>「按当前最优自动配」</b>按钮——它会把 batch / TP / 精度扫一遍，挑出当前条件下每卡产出最高又不超 SLA 的组合。<b>先点它，再回头看右边四行为什么是这个数</b>，比自己瞎拨学得快。</p></div>'+
  '<div class="lesson"><div class="lh">四类决策</div><p><b>A 电力</b>：有 lead time，排队并网要等三年。这是唯一需要提前三年下注的东西。<br><b>B 硬件</b>：只能买当年已上市的。<br><b>C 技术栈</b>：花工程点，一次解锁永久生效，每年 +3 点。<br><b>D 运行参数</b>：batch / TP / 权重精度 / KV 精度，直接进公式，每年可自由改。</p></div>'+
  '<div class="lesson"><div class="lh">结算用的是真公式</div><p><code>bytes = P×w÷TP + B×L×kv×q÷TP</code>　<code>TPOT = max(bytes÷带宽, FLOP÷峰值)</code>　<code>吞吐 = batch÷TPOT</code>。硬件参数全部是真实规格。右侧「实时推演」在你按结算之前就把这几行算给你看——<b>先看懂那四行，再按按钮。</b></p></div>'+
  '<div class="lesson"><div class="lh">看不懂数字的时候</div><p>底部的<b>「原理小课堂」</b>有六课，每一课都<b>用你此刻的配置当例子</b>：peak 是哪三个数乘出来的、带宽为什么是堆栈加出来的、为什么 decode 在搬字节而不是算数、batch 的天花板为什么不是显存、TP 为什么不是拿来变快的、拐点为什么一代比一代高。<b>当成小白教程从第 1 课看起就行。</b></p></div>'+'<div class="lesson win"><div class="lh">先看一遍演示</div><p>底部<b>「演示一局」</b>会自动走完七年，每一步都在顶上说明在干什么、为什么。<b>大约 40 秒，可以 2×/4× 加速，随时停。</b>看完再自己玩，会快很多——你现在的进度会先备份，演示结束能恢复。</p></div>'+'<div class="lesson win"><div class="lh">技术栈可以随便试</div><p><b>本年刚解锁的</b>，再点一次就<b>撤销并退回工程点</b>（绿色高亮的那些）。<b>往年已固化的</b>，点一下变成<b>本年停用</b>（斜纹划掉），再点回来恢复——工程点不退，但可以随时对比「有它 vs 没它」：停用 FP8 量化看 TPOT 涨多少、停用 MLA 看 KV 涨多少，右边的公式链和财务表会立刻跟着变。<br>电力方案再点一次也能取消。<b>所有这些在按下结算之前都能反悔。</b></p></div>'+'<div class="lesson"><div class="lh">钱的账在哪看</div><p>底部<b>「财务报表」</b>随时打开：<b>资产负债表</b>（现金 + 机队净值 + 电力设施 = 负债 + 权益）和<b>现金流量表</b>（CFO / CFI / CFF），外加逐年明细。卡按 3 年直线折旧、电力设施按 10 年；现金不够会自动动用信贷，利率 8%。顶栏的<b>净资产</b>是这局的总分之一。</p></div>'+'<div class="lesson win"><div class="lh">进度会自动保存</div><p>每做一次决策就自动保存到<b>你的账号</b>，关掉页面、刷新都不会丢——下次打开会问你要不要接着玩。换设备登录同一个账号也能接着玩。想推倒重来，点底部的<b>「重开」</b>。</p></div>'+'<div class="lesson miss"><div class="lh">三个已知的坑</div><p><b>一、</b>batch=1 的 decode，读一遍 140 GB 权重只吐一个 token。第一年不解锁 continuous batching，你几乎什么都做不了。<br><b>二、</b>speculative decoding 和大 batch 互斥，越过拐点之后它是净亏损。<br><b>三、</b>电力有三年 lead time。2026 年发现缺电时再排队，就来不及了。</p></div>';
 annotate($('shBody'));
 $('shFoot').innerHTML='<button class="btn" id="cl">开始</button>';
 $('cl').onclick=()=>{$('scrim').hidden=true;};
 $('scrim').hidden=false;
}

/* ================= 绑定 ================= */
$('oBatch').addEventListener('input',e=>{cur().batchI=+e.target.value;refresh();save();});
$('oTp').addEventListener('input',e=>{cur().tpI=+e.target.value;refresh();save();});
$('oW').addEventListener('change',e=>{cur().w=parseFloat(e.target.value);S.wWant=cur().w;refresh();save();});
$('oKv').addEventListener('change',e=>{cur().kv=parseFloat(e.target.value);S.kvWant=cur().kv;refresh();save();});
$('buyN').addEventListener('input',e=>{S.buy[S.buyKey]=(+e.target.value)*unitOf(S.buyKey).n;refresh();save();});
$('btnGo').addEventListener('click',commit);
$('btnHelp').addEventListener('click',help);
$('btnLesson').addEventListener('click',()=>openLesson(lessonI));
$('btnFin').addEventListener('click',finance);
$('btnDemo').addEventListener('click',demoAsk);
$('demoStop').addEventListener('click',()=>{DEMO.stop=true;$('demoBar').hidden=true;demoEnd(false);});
$('demoSpeed').addEventListener('click',()=>{DEMO.speed=DEMO.speed>=4?1:DEMO.speed*2;$('demoSpeed').textContent=DEMO.speed+'×';});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&DEMO.on){DEMO.stop=true;} });
$('finMore').addEventListener('click',finance);
$('btnReset').addEventListener('click',resetGame);
[].forEach.call(document.querySelectorAll('.tabs'),bar=>{
  [].forEach.call(bar.children,b=>b.addEventListener('click',()=>{
    [].forEach.call(bar.children,x=>x.classList.toggle('on',x===b));
    const host=bar.parentNode;
    [].forEach.call(host.querySelectorAll('.pane'),p=>p.classList.toggle('on',p.id===b.dataset.p));
    const pb=host.querySelector('.pb'); if(pb)pb.scrollTop=0;
  }));
});
[].forEach.call(document.querySelectorAll('.stabs'),bar=>{
  [].forEach.call(bar.children,b=>b.addEventListener('click',()=>{
    [].forEach.call(bar.children,x=>x.classList.toggle('on',x===b));
    [].forEach.call(bar.parentNode.querySelectorAll('.spane'),p=>p.classList.toggle('on',p.id===b.dataset.p));
  }));
});
$('autoCfg').addEventListener('click',applyBest);
$('coachTog').addEventListener('click',()=>{coachOpen=!coachOpen;
  $('coachBody').hidden=!coachOpen; $('coachTog').textContent=coachOpen?'收起':'展开';});
$('scrim').addEventListener('click',e=>{if(e.target===$('scrim'))return;});

function g1New(){
  clearSave();
  Object.keys(FRESH).forEach(k=>{ S[k]=JSON.parse(JSON.stringify(FRESH[k])); });
  PREV=null; PREVIN=null; LAST=null; lessonI=0;
  renderYear();
}
window.__UI={annotate:annotate,fitStage:fitStage,
  addTerms:function(o){ for(const k in o) if(!TERMS[k]) TERMS[k]=o[k]; TKEYS=buildKeys(); },
  g1:{ peek:loadSave, newGame:g1New, state:S, years:YEARS, fM:fM, gn:gn }};

fitStage();
const __sv=loadSave();
if(__sv) applySave(__sv);
renderYear();
})();

(function(){
"use strict";
/* 预训练支线的数据也来自产品数据库 */
const D=window.__IE_DATA;
const TC=D.train_cards; const TCM={}; TC.forEach(c=>TCM[c.k]=c);
const FAB=D.fabrics; const FABM={}; FAB.forEach(f=>FABM[f.k]=f);
const SZ=D.config.SZ;
const ARCH=D.archs; const ARCHM={}; ARCH.forEach(a=>ARCHM[a.k]=a);
const ATTN=D.attentions; const ATTNM={}; ATTN.forEach(a=>ATTNM[a.k]=a);
const RECOMP=D.recomputes; const RECOMPM={}; RECOMP.forEach(r=>RECOMPM[r.k]=r);
const DQ=D.data_tiers; const DQM={}; DQ.forEach(d=>DQM[d.k]=d);
const RES=D.research; const RESM={}; RES.forEach(r=>RESM[r.k]=r);
const PY=D.pretrain_years;
const MILE={}; Object.keys(D.milestones).forEach(y=>{ MILE[+y]=D.milestones[y]; });
window.__PT_DATA={TC:TC,TCM:TCM,FAB:FAB,FABM:FABM,SZ:SZ,ARCH:ARCH,ARCHM:ARCHM,ATTN:ATTN,ATTNM:ATTNM,
 RECOMP:RECOMP,RECOMPM:RECOMPM,DQ:DQ,DQM:DQM,RES:RES,RESM:RESM,PY:PY,MILE:MILE};
})();


(function(){
"use strict";
const D=window.__PT_DATA;
const {TC,TCM,FAB,FABM,SZ,ARCH,ARCHM,ATTN,ATTNM,RECOMP,RECOMPM,DQ,DQM,RES,RESM,PY}=D;
const PUE=1.15, KWH=0.07, GBTOK=4e6, MTBF=45000, SECY=3.15e7;
const GOPT=[128,256,512,1024,2048,4096,8192,16384,32768,65536];
const MULT=[2,4,8,20,40,80,150,300,600];
const TPO=[1,2,4,8,16], PPO=[1,2,4,8,16,32], EPO=[1,8,16,32,64,128];
const CKPT=[0.25,0.5,1,2,4];
const PRICE=[0.25,0.4,0.6,0.8,1.0,1.3,1.7];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

const B2=window.__IE_DATA.config.start_bu2;
const PS={
 i:0, cash:B2.cash, capital:B2.cash, res:B2.res, oss:false,
 unlocked:{}, owned:{}, debt:0, retained:0,
 gpuCapex:0, gpuAccDep:0, cumRev:0, cumSpend:0, best:0, bestY:0, share:0, launched:0,
 cfg:{szI:2,arch:'dense',attn:'gqa',multI:4,dq:'raw',prec:'bf16',opt:'adamw',rec:'full',
      tpI:1,ppI:0,epI:0,cardK:'h800',gI:2,rent:true,ckI:2,prI:4,seq:4096},
 hist:[], fin:[], done:false
};
const FRESH=JSON.parse(JSON.stringify(PS));

function layersOf(Nact){ return clamp(Math.round(28+13*Math.log2(Math.max(Nact,7e9)/7e9)),24,96); }
function budgetDays(y){ return y>=2026?210:300; }
function maxG(y){ return {2023:4096,2024:8192,2025:16384,2026:32768,2027:65536,2028:65536}[y]||4096; }
function maxSzI(y){ return {2023:7,2024:8,2025:9,2026:10,2027:11,2028:11}[y]||7; }
function cardOk(c,y){ if(y<c.from||y>c.to) return false; if(c.ban&&c.ban.indexOf(y)>=0) return false; return true; }
function resOk(r,y){ return y>=r.from && (!r.req || PS.unlocked[r.req]); }

/* 参考推理卡（只读引用 BU-1 的那套公式，用来算「将来卖 token 的成本下限」） */
function servCard(y){ return y>=2027?TCM.r200 : y>=2025?TCM.b200 : TCM.h100; }

function evalPT(cfg,idx){
 const Y=PY[idx==null?PS.i:idx], U=PS.unlocked;
 const sz=SZ[cfg.szI], arch=ARCHM[cfg.arch], attn=ATTNM[cfg.attn], rc=RECOMPM[cfg.rec], dq=DQM[cfg.dq];
 const card=TCM[cfg.cardK], fab=FABM[PS.fabK||'ib400'];
 const Nact=sz*arch.act;

 /* ② token 预算与数据墙 */
 const mult=MULT[cfg.multI];
 const Draw=Nact*mult, cap=Y.dataCap;
 const Dwall = Draw<=cap ? Draw : cap*(1+0.45*Math.log(1+(Draw-cap)/cap));
 const tokEff = dq.q*(U.mtp?1.07:1)*(cfg.opt==='muon'?1.09:1);
 const Deff = Dwall*tokEff;

 /* ③ 训练算力 6ND */
 const C = 6*Nact*Draw*rc.tax*(cfg.attn==='mla'?1.03:1);

 /* ④ 集群有效算力 */
 const fp8 = cfg.prec==='fp8' && !!U.fp8 && card.f8>0;
 const peak = fp8?card.f8:card.f16;
 const G=GOPT[cfg.gI], tp=TPO[cfg.tpI], pp=PPO[cfg.ppI];
 const ep = arch.k==='dense'?1:EPO[cfg.epI];
 const shard=tp*pp*ep, DP=Math.max(1,Math.floor(G/shard));
 const base=arch.mfu;
 const tpPen = tp<=card.nvl ? 1-0.028*(tp-1)*(900/card.nvlbw) : 0.42;
 const mb = 8*(U.dpipe?2:1);
 const ppPen = pp===1?1:1-(pp-1)/(mb+pp-1);
 const epPen = ep===1?1:((ep<=card.nvl?0.96:(fab.bw>=800?0.90:fab.bw>=400?0.80:0.58))*(U.auxfree?1.05:1));
 const stepFlop=6*Nact*GBTOK*rc.tax;
 const stepCompute=stepFlop/(G*peak*base);
 const shardB=sz*2/shard;
 const arB=2*shardB*(DP-1)/Math.max(1,DP);
 const arT=arB/(fab.bw*1e9/8);
 const overlap=U.dpipe?0.45:0.85;
 const dpPen = DP<=1?1:stepCompute/(stepCompute+arT*overlap);
 const fp8Gain = fp8?1.10:1;
 const mfu = clamp(base*tpPen*ppPen*epPen*dpPen*fp8Gain,0.03,0.62);
 const effF = G*peak*mfu;

 /* ⑤ 理论时长 */
 const Ts=C/effF, Th=Ts/3600;

 /* ⑥ 可靠性长跑税 */
 const ck=CKPT[cfg.ckI];
 const mtbfC=MTBF/G, fails=Th/mtbfC;
 const restore=U.elastic?0.08:0.35;
 const lossPer=(U.elastic?ck*0.1:ck/2)+restore;
 const lostH=fails*lossPer;
 const ThR=Th+lostH, TdR=ThR/24;

 /* ⑦ 显存账 */
 const Lyr=layersOf(Nact), dmodel=Math.sqrt(Nact/(12*Lyr));
 const seqEff=U.longctx?Math.min(cfg.seq,4096):cfg.seq;
 const wb=fp8?1:2;
 const pmem=sz*wb/shard, gmem=sz*2/shard;
 const omem=sz*(cfg.opt==='muon'?8:12)/(shard*DP);
 const amem=1*seqEff*dmodel*Lyr*2*rc.act/(tp*pp);
 const mtot=(pmem+gmem+omem+amem)*1.08;
 const oom=mtot>card.cap;

 /* ⑧ 风险 */
 let risk=0; const rk=[];
 if(cfg.dq==='synth'){risk+=0.06;rk.push('合成数据分布塌缩 +6%');}
 if(!U.elastic&&G>=8192){risk+=0.05;rk.push('万卡以上无弹性容错 +5%');}
 if(fails>150&&ck>2){risk+=0.04;rk.push('故障多且 ckpt 间隔大 +4%');}
 if(ep>8&&!U.auxfree){risk+=0.05;rk.push('大 EP 无负载均衡方案 +5%');}
 if(mult>=300){risk+=0.03;rk.push('极端超训不稳 +3%');}
 risk=Math.min(0.35,risk);

 /* ⑨ 缩放定律 → 能力分 */
 const Neff=Math.exp(0.65*Math.log(Math.max(Nact,1e8))+0.35*Math.log(Math.max(sz,1e8)));
 const L=1.69+406.4/Math.pow(Neff,0.34)+410.7/Math.pow(Math.max(Deff,1e9),0.28);
 const raw=100*(2.35-L)/(2.35-Y.fronL);
 const score=clamp(raw*(1-risk*0.6),0,140);
 const gap=score-100;

 /* ⑩ 推理成本下限（引用 BU-1 的公式） */
 const sc=servCard(Y.y), stp=8, sB=64, sL=8192;
 const swB=Nact*1/stp;
 const skB=sB*sL*320*1024*attn.kv/stp;
 const sBytes=swB+skB;
 const stpot=sBytes/sc.bw*1000;
 const sPer=(sB*1000/stpot)/stp*0.5;
 const costFloor=sPer>0?((sc.px*1e6/3/SECY)+(sc.kw*PUE*KWH/3600))/sPer*1e6:0;

 /* 市场与收入 */
 const price=Y.refPrice*PRICE[cfg.prI];
 const w=Math.exp(gap*0.13)*Math.pow(Y.refPrice/price,0.9)*(PS.oss?1.45:1);
 const share=w/(w+Y.comp*5.5);
 const rev=Y.market*share*(PS.oss?0.55:1);
 const under=price<costFloor*1.15;

 /* 成本 */
 const gpuH=G*ThR;
 const capex=cfg.rent?0:G*card.px+G*fab.px;
 const rentC=cfg.rent?gpuH*card.rent/1e6:0;
 const elec=cfg.rent?0:G*card.kw*ThR*PUE*KWH/1e6;
 const dep=cfg.rent?0:(PS.gpuCapex+capex)/3;
 const dataC=dq.px*(0.5+0.5*Draw/8e12);
 const team=42+PS.i*14;
 const cashOut=rentC+elec+dataC+team+capex;
 const pl=rev-rentC-elec-dataC-team-dep;

 const feasible = !oom && TdR<=budgetDays(Y.y) && cashOut<=PS.cash+PS.debtRoom;
 return {Y:Y,sz:sz,arch:arch,attn:attn,rc:rc,dq:dq,card:card,fab:fab,Nact:Nact,mult:mult,
  Draw:Draw,cap:cap,Dwall:Dwall,tokEff:tokEff,Deff:Deff,C:C,fp8:fp8,peak:peak,G:G,tp:tp,pp:pp,ep:ep,
  shard:shard,DP:DP,base:base,tpPen:tpPen,ppPen:ppPen,epPen:epPen,dpPen:dpPen,fp8Gain:fp8Gain,mfu:mfu,
  effF:effF,Ts:Ts,Th:Th,mb:mb,stepCompute:stepCompute,arT:arT,shardB:shardB,arB:arB,
  ck:ck,mtbfC:mtbfC,fails:fails,lossPer:lossPer,lostH:lostH,ThR:ThR,TdR:TdR,
  Lyr:Lyr,dmodel:dmodel,seqEff:seqEff,pmem:pmem,gmem:gmem,omem:omem,amem:amem,mtot:mtot,oom:oom,
  risk:risk,rk:rk,L:L,raw:raw,score:score,gap:gap,Neff:Neff,
  sc:sc,swB:swB,skB:skB,sBytes:sBytes,stpot:stpot,sPer:sPer,costFloor:costFloor,
  price:price,share:share,rev:rev,under:under,gpuH:gpuH,capex:capex,rentC:rentC,elec:elec,dep:dep,
  dataC:dataC,team:team,cashOut:cashOut,pl:pl,feasible:feasible,budgetD:budgetDays(Y.y)};
}
PS.fabK='ib400'; PS.debtRoom=window.__IE_DATA.config.start_bu2.debtRoom;
window.__PT={PS:PS,FRESH:FRESH,evalPT:evalPT,GOPT:GOPT,MULT:MULT,TPO:TPO,PPO:PPO,EPO:EPO,CKPT:CKPT,PRICE:PRICE,
 layersOf:layersOf,budgetDays:budgetDays,maxG:maxG,maxSzI:maxSzI,cardOk:cardOk,resOk:resOk,servCard:servCard,clamp:clamp,
 PUE:PUE,KWH:KWH,GBTOK:GBTOK,MTBF:MTBF};
})();


(function(){
"use strict";
const D=window.__PT_DATA, P=window.__PT, UI=window.__UI;
const {TC,TCM,FAB,FABM,SZ,ARCH,ARCHM,ATTN,ATTNM,RECOMP,RECOMPM,DQ,DQM,RES,RESM,PY,MILE}=D;
const {PS,FRESH,evalPT,GOPT,MULT,TPO,PPO,EPO,CKPT,PRICE,layersOf,budgetDays,maxG,cardOk,resOk,clamp}=P;
const $=id=>document.getElementById(id);
const C=PS.cfg;

/* ---------- 名词 ---------- */
UI.addTerms(window.__IE_DATA.terms.bu2);

/* ---------- 格式化 ---------- */
const fT=x=>x>=1e12?(x/1e12).toFixed(x>=1e13?0:1)+'T':x>=1e9?(x/1e9).toFixed(x>=1e11?0:1)+'B':x>=1e6?(x/1e6).toFixed(1)+'M':x>=1e3?(x/1e3).toFixed(1)+'K':(''+Math.round(x));
const fM=m=>Math.abs(m)>=1000?(m<0?'-$':'$')+Math.abs(m/1000).toFixed(2)+'B':(m<0?'-$':'$')+Math.abs(m).toFixed(0)+'M';
const fM2=m=>Math.abs(m)>=1000?(m<0?'-$':'$')+Math.abs(m/1000).toFixed(2)+'B':(m<0?'-$':'$')+Math.abs(m).toFixed(1)+'M';
const fGB=b=>b>=1e9?(b/1e9).toFixed(1)+' GB':(b/1e6).toFixed(0)+' MB';
const fE=x=>{ if(x===0)return '0'; const e=Math.floor(Math.log10(Math.abs(x))); return (x/Math.pow(10,e)).toFixed(2)+'e'+e; };
const pc=x=>(x*100).toFixed(x<0.1?1:0)+'%';
const gn=n=>Math.round(n).toLocaleString('en-US');
const vr=(n,v,c)=>'<span class="vr'+(c?' '+c:'')+'">'+n+'<em>('+v+')</em></span>';

/* ---------- 骨架 ---------- */
function shell(){ return `
<header class="hud h2">
 <div class="hudin">
  <div class="brandbox">
   <div class="brand">基座<em>模型</em></div>
   <div class="yr" id="ptYr">2023 · 第 1 / 6 回合</div>
  </div>
  <div class="trackers">
   <div class="trk" id="ptTA">
    <div class="tl"><span class="nm">能力位次</span><b id="ptTAV">—</b></div>
    <div class="tb"><i id="ptTAB" style="width:0"></i></div>
    <div class="ts" id="ptTAS">—</div>
   </div>
   <div class="trk" id="ptTB">
    <div class="tl"><span class="nm">这一炉开得起来吗</span><b id="ptTBV">—</b></div>
    <div class="tb"><i id="ptTBB" style="width:0"></i></div>
    <div class="ts" id="ptTBS">—</div>
   </div>
  </div>
  <div class="stats">
   <div class="st"><span class="k">现金</span><span class="v tnum" id="ptCash">—</span></div>
   <div class="st"><span class="k">研究点</span><span class="v tnum" id="ptRes">—</span></div>
   <div class="st"><span class="k">最好能力分</span><span class="v tnum" id="ptBest">—</span></div>
   <div class="st"><span class="k">市场份额</span><span class="v tnum" id="ptShare">—<small>%</small></span></div>
   <div class="st"><span class="k">累计收入</span><span class="v tnum" id="ptRev">—</span></div>
   <div class="st"><span class="k">累计利润</span><span class="v tnum" id="ptProf">—</span></div>
   <div class="st"><span class="k">路线</span><span class="v tnum" id="ptOss">闭源</span></div>
  </div>
 </div>
</header>

<div class="band">
 <div class="pnl">
  <div class="ph"><h3>年度情报</h3><span class="tag" id="ptBriefTag">Briefing</span></div>
  <div class="pb tight">
   <div class="erarow"><span class="era" id="ptEra">—</span><span class="eratag" id="ptEraTag">—</span></div>
   <div id="ptBrief" class="cols2"></div>
   <div class="wl" id="ptWl"></div>
   <div id="ptEvt"></div>
  </div>
 </div>
 <div class="pnl coachpnl">
  <div class="ph"><h3>教练 · 这一炉该怎么配</h3><button class="tog" id="ptCoachTog">收起</button></div>
  <div class="pb tight">
   <div id="ptCoachBody">
    <p class="why" id="ptWhy"></p>
    <div class="ck" id="ptCk"></div>
   </div>
   <div class="nextup" id="ptNext"><span class="lbl">下一步</span><span id="ptNextT"></span></div>
  </div>
 </div>
</div>

<div class="grid g2 pt">
 <div class="col">
  <div class="pnl">
   <div class="ph"><span class="n">A</span><h3>模型设计</h3><span class="tag" id="ptSzTag">—</span></div>
   <div class="pb tight">
    <div class="fld"><label for="ptSz">总参数 <b id="ptSzV">34B</b></label><input type="range" id="ptSz" min="0" max="11" step="1" value="2"></div>
    <div class="opts o1" id="ptArch" style="margin-top:5px"></div>
    <div class="opts o3" id="ptAttn" style="margin-top:3px"></div>
    <div class="ptnote" id="ptDesignNote"></div>
   </div>
  </div>
  <div class="pnl">
   <div class="ph"><span class="n">B</span><h3>数据与 token 预算</h3><span class="tag" id="ptDataTag">—</span></div>
   <div class="pb tight">
    <div class="fld"><label for="ptMult">token / 激活参数 <b id="ptMultV">8×</b></label><input type="range" id="ptMult" min="0" max="8" step="1" value="4"></div>
    <div class="opts o1" id="ptDq" style="margin-top:5px"></div>
    <div class="ptnote" id="ptDataNote"></div>
   </div>
  </div>
  <div class="pnl grow">
   <div class="ph"><span class="n">D</span><h3>集群 · 互连 · 上市</h3><span class="tag" id="ptClTag">—</span></div>
   <div class="pb tight">
    <div class="opts o3" id="ptCards"></div>
    <div class="rowf r3" style="margin-top:5px">
     <div class="fld"><label for="ptG">卡数 <b id="ptGV">512</b></label><input type="range" id="ptG" min="0" max="9" step="1" value="2"></div>
     <div class="fld"><label for="ptCk">ckpt 间隔 <b id="ptCkV">1h</b></label><input type="range" id="ptCk" min="0" max="4" step="1" value="2"></div>
     <div class="fld"><label for="ptPr">定价 <b id="ptPrV">1.0×</b></label><input type="range" id="ptPr" min="0" max="6" step="1" value="4"></div>
    </div>
    <div class="opts o3" id="ptFab" style="margin-top:5px"></div>
    <div class="opts o4" id="ptMode" style="margin-top:3px"></div>
   </div>
  </div>
 </div>

 <div class="col">
  <div class="pnl">
   <div class="ph"><span class="n">C</span><h3>训练配方与并行切分</h3><button class="mini" id="ptRec">照教练配</button><button class="mini" id="ptAuto" style="margin-left:4px">只优化并行</button></div>
   <div class="pb tight">
    <div class="rowf r3">
     <div class="fld"><label for="ptTp">TP <b id="ptTpV">2</b></label><input type="range" id="ptTp" min="0" max="4" step="1" value="1"></div>
     <div class="fld"><label for="ptPp">PP <b id="ptPpV">1</b></label><input type="range" id="ptPp" min="0" max="5" step="1" value="0"></div>
     <div class="fld"><label for="ptEp">EP <b id="ptEpV">1</b></label><input type="range" id="ptEp" min="0" max="5" step="1" value="0"></div>
    </div>
    <div class="opts o3" id="ptPrec" style="margin-top:5px"></div>
    <div class="opts o3" id="ptRec" style="margin-top:3px"></div>
    <div class="ptnote" id="ptRecipeNote"></div>
   </div>
  </div>
  <div class="pnl">
   <div class="ph"><span class="n">F</span><h3>研究解锁 · 永久生效</h3><span class="tag" id="ptResTag">—</span></div>
   <div class="pb tight"><div class="opts" id="ptResOpts"></div></div>
  </div>
  <div class="pnl grow">
   <div class="ph"><h3>结构图 · 并行切分与显存</h3><span class="tag">数值标在图上</span></div>
   <div class="pb tight">
    <div id="ptStruct"></div>
    <div id="ptMile"></div>
   </div>
  </div>
 </div>

 <div class="col">
  <div class="pnl grow">
   <div class="ph"><h3>实时推演 · 预训练公式链</h3><span class="tag">开炉前预览</span></div>
   <div class="kpi">
    <div class="kb" id="ptK1"><span class="k">训练时长</span><span class="v tnum">—<small>天</small></span></div>
    <div class="kb" id="ptK2"><span class="k">这一炉成本</span><span class="v tnum">—</span></div>
    <div class="kb" id="ptK3"><span class="k">能力分</span><span class="v tnum">—</span></div>
    <div class="kb" id="ptK4"><span class="k">年收入</span><span class="v tnum">—</span></div>
   </div>
   <div class="pb">
    <div class="chgbar idle" id="ptChg">拨动任何一个控件，下面会标出<b>是哪个变量变了</b>，以及它把每一步推向了哪个方向。整条链和 BU-1 是同一套写法，只是换成了训练侧的账。</div>
    <div class="fmwrap">
     <div class="chain" id="ptChain"></div>
     <div class="rail">
      <div class="minih" style="border-top:none;margin-top:0;padding-top:0">变量表 · 谁决定它</div>
      <div id="ptVars"></div>
      <div class="minih">显存账 · 每卡</div>
      <div id="ptMem"></div>
      <div class="minih">财务 · 本炉结算后（预测）</div>
      <div id="ptFin"></div>
     </div>
    </div>
   </div>
  </div>
 </div>
</div>

<div class="actbar">
 <div class="msg" id="ptMsg">这是一条独立的业务线：自己的现金、自己的研究点、自己的报表。跟 BU-1 现在还不并表。</div>
 <span class="savetag" id="ptSave" hidden>已保存</span>
 <button class="btn ghost" id="ptReset">重开支线</button>
 <button class="btn ghost" id="ptBooks">BU-2 报表</button>
 <button class="btn ghost" id="ptLesson">预训练课堂</button>
 <button class="btn ghost" id="ptHelp">怎么玩</button>
 <button class="btn" id="ptGo">开炉训练 2023</button>
</div>`; }

$('bu2').innerHTML=shell();

/* ---------- 通用按钮 ---------- */
function ob(id,on,t,s,cls){
 return '<button class="opt'+(on?' on':'')+(cls?' '+cls:'')+'" data-v="'+id+'"><span class="t">'+t+'</span><span class="s">'+s+'</span></button>';
}
function bind(box,fn){
 $(box).addEventListener('click',e=>{ const b=e.target.closest('button.opt'); if(!b||b.disabled)return; fn(b.dataset.v,b); });
}
window.__PTUI={vr:vr,fT:fT,fM:fM,fM2:fM2,fGB:fGB,fE:fE,pc:pc,gn:gn,ob:ob,bind:bind,shellDone:true};
})();


(function(){
"use strict";
const D=window.__PT_DATA, P=window.__PT, UI=window.__UI, T=window.__PTUI;
const {TC,TCM,FAB,FABM,SZ,ARCH,ARCHM,ATTN,ATTNM,RECOMP,RECOMPM,DQ,DQM,RES,RESM,PY,MILE}=D;
const {PS,FRESH,evalPT,GOPT,MULT,TPO,PPO,EPO,CKPT,PRICE,maxG,cardOk,resOk,clamp}=P;
const {vr,fT,fM,fM2,fGB,fE,pc,gn,ob,bind}=T;
const $=id=>document.getElementById(id);
const C=PS.cfg;
let PREV=null, LASTCH='', coachOpen=true;

/* ================= 面板渲染 ================= */
function renderYear(){
 const Y=PY[PS.i];
 $('ptYr').textContent=Y.y+' · 第 '+(PS.i+1)+' / 6 回合';
 $('ptEra').textContent='第 '+(PS.i+1)+' 炉 · '+Y.y;
 $('ptEraTag').textContent=Y.tag;
 $('ptBriefTag').textContent=Y.y+' Briefing';
 $('ptBrief').innerHTML=Y.brief.map(b=>'<p>'+b+'</p>').join('');
 $('ptBrief').className='brief cols2';
 const mil=(MILE[Y.y]||[]).map(m=>'<span class="wr"><span class="k">'+m[0]+'</span><span class="v" style="font-weight:400;color:var(--txt60)">'+m[1]+'</span></span>').join('');
 $('ptWl').innerHTML=[
  ['可得高质数据',fT(Y.dataCap)+' token'],
  ['前沿线 L',Y.fronL.toFixed(3)],
  ['前沿对标',Y.fronRef],
  ['基座市场',fM(Y.market)+'/年'],
  ['参考价',''+Y.refPrice.toFixed(1)+' $/Mtok'],
  ['本年可用工期',P.budgetDays(Y.y)+' 天'],
  ['卡数上限',gn(maxG(Y.y))],
  ['总参数上限',fT(SZ[P.maxSzI(Y.y)])]
 ].map(w=>'<span class="wr"><span class="k">'+w[0]+'</span><span class="v">'+w[1]+'</span></span>').join('')+
 '<span class="wr" style="border:none;background:none;color:var(--txt40);padding-left:0">同期真实里程碑</span>'+mil;
 $('ptEvt').innerHTML=Y.evt?'<div class="evt"><div class="h">'+Y.evt.h+'</div><p>'+Y.evt.p+'</p></div>':'';
 UI.annotate($('ptBrief')); UI.annotate($('ptEvt'));
 $('ptGo').textContent='开炉训练 '+Y.y;
 renderRes(); renderAll();
}

function renderDesign(){
 const Y=PY[PS.i];
 const smax=P.maxSzI(Y.y); $('ptSz').max=smax; if(C.szI>smax)C.szI=smax;
 $('ptSz').value=C.szI; $('ptSzV').textContent=fT(SZ[C.szI]);
 $('ptArch').innerHTML=ARCH.map(a=>{
  const lock=a.req&&!PS.unlocked[a.req];
  return '<button class="opt'+(C.arch===a.k?' on':'')+(lock?' lock':'')+'" data-v="'+a.k+'"'+(lock?' disabled':'')+
   '><span class="t">'+a.n+' · 激活率 '+(a.act*100).toFixed(a.act<0.1?1:0)+'%</span><span class="s">'+(lock?'需研究 '+RESM[a.req].n:'MFU 基线 '+a.mfu.toFixed(2))+'</span></button>';
 }).join('');
 $('ptAttn').innerHTML=ATTN.map(a=>{
  const lock=a.req&&!PS.unlocked[a.req];
  return '<button class="opt'+(C.attn===a.k?' on':'')+(lock?' lock':'')+'" data-v="'+a.k+'"'+(lock?' disabled':'')+
   '><span class="t">'+a.n+'</span><span class="s">KV ×'+a.kv+'</span></button>';
 }).join('');
 $('ptSzTag').textContent='激活 '+fT(SZ[C.szI]*ARCHM[C.arch].act);
}

function renderData(){
 const Y=PY[PS.i];
 $('ptMult').value=C.multI; $('ptMultV').textContent=MULT[C.multI]+'×';
 $('ptDq').innerHTML=DQ.map(d=>{
  const lock=d.req&&!PS.unlocked[d.req];
  return '<button class="opt'+(C.dq===d.k?' on':'')+(lock?' lock':'')+'" data-v="'+d.k+'"'+(lock?' disabled':'')+
   '><span class="t">'+d.n+'</span><span class="s">'+(lock?'需研究':'效率 ×'+d.q.toFixed(2)+' · '+fM(d.px))+'</span></button>';
 }).join('');
}

function renderRes(){
 const Y=PY[PS.i];
 $('ptResTag').textContent='剩 '+PS.res+' 点';
 $('ptResOpts').innerHTML=RES.map(r=>{
  const own=!!PS.unlocked[r.k], ok=resOk(r,Y.y), afford=PS.res>=r.cost;
  const cls=own?'on':(!ok||!afford?'lock':'');
  const s=own?'已解锁':(!ok?(Y.y<r.from?r.from+' 起':'先解锁 '+RESM[r.req].n):(afford?r.cost+' 点':'点数不足'));
  return '<button class="opt'+(cls?' '+cls:'')+'" data-v="'+r.k+'"'+(own||!ok||!afford?' disabled':'')+
   ' title="'+r.desc+'"><span class="t">'+r.n+'</span><span class="s">'+s+'</span></button>';
 }).join('');
}

function renderRecipe(){
 const Y=PY[PS.i], arch=ARCHM[C.arch];
 $('ptTp').value=C.tpI; $('ptTpV').textContent=TPO[C.tpI];
 $('ptPp').value=C.ppI; $('ptPpV').textContent=PPO[C.ppI];
 $('ptEp').value=C.epI; $('ptEpV').textContent=arch.k==='dense'?'—':EPO[C.epI];
 $('ptEp').disabled=arch.k==='dense';
 const fp8ok=!!PS.unlocked.fp8 && TCM[C.cardK].f8>0;
 $('ptPrec').innerHTML=
  ob('bf16',C.prec==='bf16','BF16','稳，字节多')+
  '<button class="opt'+(C.prec==='fp8'?' on':'')+(fp8ok?'':' lock')+'" data-v="fp8"'+(fp8ok?'':' disabled')+
   '><span class="t">FP8 混合</span><span class="s">'+(fp8ok?'峰值×2 显存÷2':(PS.unlocked.fp8?'此卡无 FP8':'需研究'))+'</span></button>'+
  '<button class="opt'+(C.opt==='muon'?' on':'')+(PS.unlocked.muon?'':' lock')+'" data-v="muon"'+(PS.unlocked.muon?'':' disabled')+
   '><span class="t">优化器 '+(C.opt==='muon'?'Muon':'AdamW')+'</span><span class="s">'+(PS.unlocked.muon?(C.opt==='muon'?'8 B/参数 · 点击切回':'12 B/参数 · 点击换 Muon'):'需研究 Muon')+'</span></button>';
 $('ptRec').innerHTML=RECOMP.map(r=>ob(r.k,C.rec===r.k,r.n.replace('重计算','重算'),'算力 ×'+r.tax.toFixed(2)+' · 激活 ×'+r.act)).join('');
}

function renderCluster(){
 const Y=PY[PS.i];
 $('ptCards').innerHTML=TC.map(c=>{
  const ok=cardOk(c,Y.y);
  const ban=c.ban&&c.ban.indexOf(Y.y)>=0;
  return '<button class="opt'+(C.cardK===c.k?' on':'')+(ok?'':' lock')+'" data-v="'+c.k+'"'+(ok?'':' disabled')+
   ' title="'+c.note+'"><span class="t">'+c.n+'</span><span class="s">'+(ban?'本年禁运':ok?('$'+c.rent.toFixed(2)+'/卡时 · NVL'+c.nvl):(Y.y<c.from?c.from+' 起':'已停产'))+'</span></button>';
 }).join('');
 const gmax=GOPT.indexOf(maxG(Y.y));
 $('ptG').max=gmax; if(C.gI>gmax)C.gI=gmax;
 $('ptG').value=C.gI; $('ptGV').textContent=gn(GOPT[C.gI]);
 $('ptCk').value=C.ckI; $('ptCkV').textContent=CKPT[C.ckI]+'h';
 $('ptPr').value=C.prI; $('ptPrV').textContent=PRICE[C.prI].toFixed(2)+'×';
 $('ptFab').innerHTML=FAB.map(f=>ob(f.k,PS.fabK===f.k,f.n,f.bw+' Gb/s')).join('');
 $('ptMode').innerHTML=
  ob('rent',C.rent,'租算力','按卡时付')+
  ob('own',!C.rent,'自建','capex+折旧')+
  ob('oss',PS.oss,'开源权重','份额×1.45')+
  ob('closed',!PS.oss,'闭源 API','收入全额');
 $('ptClTag').textContent=gn(GOPT[C.gI])+' × '+TCM[C.cardK].n;
}

function renderAll(){ renderDesign(); renderData(); renderRecipe(); renderCluster(); refresh(); }

/* ================= 结构图 ================= */
function cells(n,cols,dim){
 let h='<div class="cells" style="grid-template-columns:repeat('+cols+',7px)">';
 for(let i=0;i<n;i++) h+='<i'+(dim&&i>=dim?' class="dim"':'')+'></i>';
 return h+'</div>';
}
function renderStruct(r){
 const cap=r.card.cap;
 const seg=[['p','参数',r.pmem],['g','梯度',r.gmem],['o','优化器',r.omem],['a','激活',r.amem]];
 const used=r.mtot;
 let bars='';
 seg.forEach(s=>{ const w=Math.max(0,Math.min(100,s[2]*1.08/cap*100)); bars+='<i class="'+s[0]+'" style="width:'+w+'%" title="'+s[1]+' '+fGB(s[2])+'"></i>'; });
 const cl=n=>Math.min(n,16);
 const h=`
 <div class="structbox" style="margin:-8px -10px 6px">
  <div class="sbh">一张卡上装了什么 · ${r.card.n} ${(cap/1e9).toFixed(0)} GB</div>
  <div class="mstack">${bars}</div>
  <div class="mlg">
   <span><em class="p"></em>参数 ${fGB(r.pmem)}</span>
   <span><em class="g"></em>梯度 ${fGB(r.gmem)}</span>
   <span><em class="o"></em>优化器 ${fGB(r.omem)}</span>
   <span><em class="a"></em>激活 ${fGB(r.amem)}</span>
   <span style="margin-left:auto;color:${r.oom?'var(--bad)':'var(--ok)'};font-weight:700">合计 ${fGB(used)} / ${(cap/1e9).toFixed(0)} GB</span>
  </div>
 </div>
 <div class="pmesh">
  <div class="pmg"><div class="h">TP <b>${r.tp}</b> 张量并行</div>${cells(Math.max(r.tp,1),Math.min(Math.max(r.tp,1),8))}
   <div class="ptrow">${r.tp<=r.card.nvl?'域内 NVLink '+r.card.nvlbw+' GB/s':'<span style="color:var(--bad)">已跨出 NVLink 域</span>'}</div></div>
  <div class="pmg"><div class="h">PP <b>${r.pp}</b> 流水线</div>${cells(Math.max(r.pp,1),Math.min(Math.max(r.pp,1),8))}
   <div class="ptrow">气泡 ${pc(1-r.ppPen)} · 微批 ${r.mb}</div></div>
  <div class="pmg"><div class="h">EP <b>${r.ep}</b> 专家并行</div>${cells(cl(Math.max(r.ep,1)),8)}
   <div class="ptrow">${r.ep===1?'稠密，无 EP':(r.ep<=r.card.nvl?'整个域内 all-to-all':'跨域 all-to-all，走 '+r.fab.bw+'G')}</div></div>
  <div class="pmg"><div class="h">DP <b>${gn(r.DP)}</b> 数据并行</div>${cells(cl(r.DP),8)}
   <div class="ptrow">all-reduce ${fGB(r.arB)} = ${(r.arT*1000).toFixed(0)} ms vs 计算 ${(r.stepCompute*1000).toFixed(0)} ms → 罚 ${r.dpPen.toFixed(2)}</div></div>
 </div>
 <div class="ptrow" style="margin-top:4px">
  <span class="pill">卡 <b>${gn(r.G)}</b></span>
  <span class="pill">切分 <b>${gn(r.shard)}</b></span>
  <span class="pill${r.mfu>=0.3?' ok':r.mfu>=0.18?'':' bad'}">MFU <b>${pc(r.mfu)}</b></span>
  <span class="pill${r.oom?' bad':' ok'}">显存 <b>${fGB(r.mtot)}</b>/${(cap/1e9).toFixed(0)}G</span>
 </div>`;
 $('ptStruct').innerHTML=h;
 $('ptMile').innerHTML='<div class="mile you" style="margin-top:4px"><span class="my">你这一炉</span><span class="mn">'+
  fT(r.sz)+(r.arch.k==='dense'?' 稠密':'-A'+fT(r.Nact))+' · '+fT(r.Draw)+' token · '+r.card.n+' ×'+gn(r.G)+
  '</span><span class="mv">'+r.score.toFixed(1)+' 分 · $'+r.costFloor.toFixed(2)+'/Mtok</span></div>';
}

/* ================= 公式链 ================= */
function row(nm,sym,sub,res,key){
 return '<div class="cr'+(key?' key':'')+'"><div class="nm">'+nm+'</div>'+
  (sym?'<div class="sym">'+sym+'</div>':'')+
  '<div class="sub">'+sub+'</div>'+(res?'<div class="res">'+res+'</div>':'')+'</div>';
}
function dchip(cur,prev,goodUp){
 if(prev==null||!isFinite(prev)||!isFinite(cur)||prev===cur) return '';
 const up=cur>prev, good=goodUp?up:!up;
 let txt;
 if(prev===0) txt='新增';
 else { const rr=cur/prev; txt=(up?'↑':'↓')+(up?rr:1/rr).toFixed(rr>10||rr<0.1?0:2)+'×'; }
 return '<span class="dlt '+(good?'good':'bad')+'">'+txt+'</span>';
}
function renderChain(r){
 const p=PREV;
 const Y=r.Y;
 let h='';
 h+='<div class="cg">① 规格 <span>总参数与激活参数是两笔账</span></div>';
 h+=row('激活参数 N_act','N_act = 总参数 × 激活率',
   vr('总参数',fT(r.sz),'m')+' × '+vr('激活率',pc(r.arch.act),'c')+' = <b>'+fT(r.Nact)+'</b>',
   '总参数决定容量，激活参数决定算力和推理成本');

 h+=row('层数与隐藏维','d = √(N_act ÷ (12 × 层数))',
   vr('层数',r.Lyr)+' · '+vr('d_model',gn(r.dmodel)),'激活显存只跟这两个数有关');
 h+='<div class="cg">② token 预算 <span>Chinchilla 与数据墙</span></div>';
 h+=row('训练 token D','D = N_act × 倍数',
   vr('N_act',fT(r.Nact),'c')+' × '+vr('倍数',r.mult+'×','s')+' = <b>'+fT(r.Draw)+'</b>',
   'Chinchilla 最优是 20×；再往上是「超训」，为的是把推理成本摊薄');
 h+=row('数据墙折扣','超出可得部分：D_wall = 可得 × (1 + 0.45·ln(1 + 超出/可得))',
   vr('可得高质',fT(r.cap))+' → 实计 <b>'+fT(r.Dwall)+'</b>'+(r.Draw>r.cap?' <span style="color:var(--bad)">超出 '+fT(r.Draw-r.cap)+'</span>':' <span style="color:var(--ok)">未触墙</span>'),'');
 h+=row('有效 token D_eff','D_eff = D_wall × 数据质量 × token 效率',
   vr('D_wall',fT(r.Dwall))+' × '+vr('数据质量',r.dq.q.toFixed(2),'s')+
   (PS.unlocked.mtp?' × '+vr('MTP','1.07','s'):'')+(C.opt==='muon'?' × '+vr('Muon','1.09','s'):''),
   '<b>'+fT(r.Deff)+'</b>'+dchip(r.Deff,p&&p.Deff,true));

 h+='<div class="cg">③ 训练算力 <span>6ND</span></div>';
 h+=row('总算力 C','C = 6 × N_act × D × 重计算税',
   '6 × '+vr('N_act',fT(r.Nact),'c')+' × '+vr('D',fT(r.Draw),'s')+' × '+vr('重计算税',r.rc.tax.toFixed(2),'m'),
   '<b>'+fE(r.C)+' FLOP</b>'+dchip(r.C,p&&p.C,false)+
   '<div class="sym" style="margin-top:1px">前向 2 次 + 反向 4 次 = 每参数每 token 6 次</div>');

 h+='<div class="cg">④ 集群有效算力 <span>MFU 是这一步的全部内容</span></div>';
 h+=row('集群峰值','峰值 = 卡数 × 单卡峰值',
   vr('卡数',gn(r.G),'m')+' × '+vr('单卡峰值',(r.peak/1e12).toFixed(0)+' TF/s '+(r.fp8?'FP8':'BF16'),'c'),
   '<b>'+fE(r.G*r.peak)+' FLOP/s</b>');
 h+=row('MFU 拆解','MFU = 基线 × TP罚 × PP罚 × EP罚 × DP罚 × FP8',
   vr('基线',r.base.toFixed(2))+' × '+vr('TP罚',r.tpPen.toFixed(2),r.tpPen<0.9?'m':'')+' × '+
   vr('PP罚',r.ppPen.toFixed(2),r.ppPen<0.9?'m':'')+' × '+vr('EP罚',r.epPen.toFixed(2),r.epPen<0.9?'m':'')+' × '+
   vr('DP罚',r.dpPen.toFixed(2),r.dpPen<0.9?'m':'')+(r.fp8?' × '+vr('FP8','1.10','s'):''),
   '<b>'+pc(r.mfu)+'</b>'+dchip(r.mfu,p&&p.mfu,true));
 h+=row('DP 罚是怎么来的','DP罚 = 单步计算 ÷ (单步计算 + all-reduce × 未重叠比例)',
   vr('梯度分片',fGB(r.shardB))+' → all-reduce '+vr('通信量',fGB(r.arB),'m')+' ÷ '+vr('网络',r.fab.bw+' Gb/s','c')+
   ' = '+vr('通信',(r.arT*1000).toFixed(0)+' ms','m')+' vs '+vr('计算',(r.stepCompute*1000).toFixed(0)+' ms','c'),'');
 h+='<div class="cg">⑤ 理论时长</div>';
 h+=row('理论用时','有效算力 = 峰值 × MFU；T = C ÷ 有效算力',
   vr('有效算力',fE(r.effF)+' F/s','c')+' ← 峰值 × MFU　　'+vr('C',fE(r.C))+' ÷ 它',
   '<b>'+(r.Th).toFixed(0)+' 小时 = '+(r.Th/24).toFixed(1)+' 天</b>');

 h+='<div class="cg">⑥ 长跑税 <span>集群越大越容易坏</span></div>';
 h+=row('集群 MTBF','集群 MTBF = 单卡 MTBF ÷ 卡数',
   vr('单卡 MTBF','45,000 h')+' ÷ '+vr('卡数',gn(r.G),'m'),'<b>'+r.mtbfC.toFixed(1)+' 小时坏一次</b>');
 h+=row('故障与损失','实际 = 理论 + 故障次数 × 每次损失',
   vr('故障次数',r.fails.toFixed(0)+' 次','m')+' × '+vr('每次损失',r.lossPer.toFixed(2)+' h','m')+
   ' = '+vr('浪费',r.lostH.toFixed(0)+' h','m')+
   '<div class="sym" style="margin-top:1px">每次损失 = ckpt('+r.ck+'h)'+(PS.unlocked.elastic?'×0.1':'÷2')+' + 恢复 '+(PS.unlocked.elastic?'0.08':'0.35')+'h</div>','');
 h+=row('实际训练时长','',
   vr('理论',(r.Th/24).toFixed(1)+' 天')+' + '+vr('长跑税',(r.lostH/24).toFixed(1)+' 天','m'),
   '<b>'+r.TdR.toFixed(1)+' 天</b>'+dchip(r.TdR,p&&p.TdR,false)+
   ' <span class="verd '+(r.TdR<=r.budgetD?'c':'m')+'">'+(r.TdR<=r.budgetD?'工期够':'超出 '+r.budgetD+' 天工期')+'</span>',true);

 h+='<div class="cg">⑦ 显存账 <span>装不下就得多切一刀</span></div>';
 h+=row('每卡占用','参数 + 梯度 + 优化器 + 激活，再留 8% 碎片',
   vr('参数',fGB(r.pmem),'m')+' + '+vr('梯度',fGB(r.gmem),'c')+' + '+vr('优化器',fGB(r.omem),'s')+' + '+vr('激活',fGB(r.amem),'k'),
   '<b>'+fGB(r.mtot)+'</b> / '+(r.card.cap/1e9).toFixed(0)+' GB '+
   '<span class="verd '+(r.oom?'m':'c')+'">'+(r.oom?'OOM':'放得下')+'</span>'+
   '<div class="sym" style="margin-top:1px">参数/梯度 ÷ '+gn(r.shard)+'，优化器再 ÷ DP '+gn(r.DP)+'（ZeRO-1），激活 ÷ TP×PP</div>',true);

 h+='<div class="cg">⑧ 这一炉的成本</div>';
 h+=row('算力开销','卡时 = 卡数 × 实际时长；'+(C.rent?'租赁 = 卡时 × 单价':'自建 = capex + 电费'),
   vr('卡数',gn(r.G),'m')+' × '+vr('小时',gn(r.ThR),'m')+' = '+vr('卡时',fT(r.gpuH),'c')+
   (C.rent?' × '+vr('单价','$'+r.card.rent.toFixed(2)+'/h','s'):'　'+vr('capex',fM2(r.capex),'m')+' + '+vr('电',fM2(r.elec),'s')),
   '<b>'+(C.rent?fM2(r.rentC):fM2(r.capex+r.elec)+'（折旧 '+fM2(r.dep)+'/年）')+'</b>');
 h+=row('本炉总支出','算力 + 数据 + 团队',
   (C.rent?vr('租赁',fM2(r.rentC),'m'):vr('capex',fM2(r.capex),'m')+' + '+vr('电',fM2(r.elec),'m'))+
   ' + '+vr('数据',fM2(r.dataC),'c')+' + '+vr('团队',fM2(r.team),'k'),
   '<b>'+fM2(r.cashOut)+'</b>'+dchip(r.cashOut,p&&p.cashOut,false)+
   ' <span class="verd '+(r.cashOut<=PS.cash?'c':'m')+'">现金 '+fM(PS.cash)+'</span>',true);

 h+='<div class="cg">⑨ 能力 <span>缩放定律</span></div>';
 h+=row('有效参数 N_eff','N_eff = N_act^0.65 × N_tot^0.35',
   vr('N_act',fT(r.Nact),'c')+'^0.65 × '+vr('N_tot',fT(r.sz),'m')+'^0.35',
   '<b>'+fT(r.Neff)+'</b>'+
   '<div class="sym" style="margin-top:1px">算力只认激活参数，容量还是认总参数 → MoE 的能力介于两者之间</div>');
h+=row('损失 L','L = E + A/N_eff^α + B/D_eff^β',
   vr('E','1.69')+' + 406.4/'+vr('N_eff',fT(r.Neff),'c')+'^0.34 + 410.7/'+vr('D_eff',fT(r.Deff),'s')+'^0.28',
   '<b>L = '+r.L.toFixed(4)+'</b>');
 h+=row('能力分','分 = 100 × (2.35 − L) ÷ (2.35 − 前沿线 L)，再乘风险折扣',
   '100 × (2.35 − '+vr('L',r.L.toFixed(4),'c')+') ÷ (2.35 − '+vr('前沿线 L',r.Y.fronL.toFixed(3),'s')+')'+
   (r.risk>0?' × '+vr('风险折',(1-r.risk*0.6).toFixed(2),'m'):''),
   '<b>'+r.score.toFixed(1)+'</b>'+dchip(r.score,p&&p.score,true)+
   (r.risk>0?'<div class="sym" style="margin-top:2px;color:var(--sig)">风险 '+pc(r.risk)+'：'+r.rk.join(' / ')+'</div>':''));
 h+=row('对比前沿线','100 分 = 正好追平当年前沿',
   vr('你',r.score.toFixed(1),'m')+' vs '+vr('前沿','100.0','c')+' · '+Y.fronRef,
   '<b style="color:'+(r.gap>=0?'var(--ok)':'var(--bad)')+'">'+(r.gap>=0?'+':'')+r.gap.toFixed(1)+'</b>'+
   ' <span class="verd '+(r.gap>=0?'c':'m')+'">'+(r.gap>=4?'领先一档':r.gap>=0?'追平前沿':r.gap>=-5?'差半档':'差一档以上')+'</span>',true);

 h+='<div class="cg">⑩ 市场 <span>能力差 × 价格 × 开源</span></div>';
 h+=row('推理成本下限','用 BU-1 那套公式反算：这个架构将来每卖 1M token 至少要花多少',
   '权重 '+vr('N_act × 1B(FP8) ÷ TP8',fGB(r.swB),'m')+' + KV '+vr('B64·8K·'+r.attn.n,fGB(r.skB),'c')+
   ' → '+vr('每卡吞吐',r.sPer.toFixed(0)+' tok/s'),
   '<b>$'+r.costFloor.toFixed(2)+' /Mtok</b>'+
   '<div class="sym" style="margin-top:1px">MLA 与细粒度 MoE 的全部价值：<b>不提高能力分，但决定你能开多低的价</b></div>');
 h+=row('定价','价格 = 参考价 × 你的档位',
   vr('参考价','$'+Y.refPrice.toFixed(1))+' × '+vr('档位',PRICE[C.prI].toFixed(2)+'×','s'),
   '<b>$'+r.price.toFixed(2)+' /Mtok</b>'+
   (r.under?' <span class="verd m">低于成本下限 ×1.15，卖越多亏越多</span>':' <span class="verd c">有毛利</span>'));
 h+=row('份额','w = e^(能力差×0.13) × (参考价/你的价)^0.9 × 开源系数；份额 = w/(w+竞争强度×5.5)',
   'e^('+vr('能力差',(r.gap>=0?'+':'')+r.gap.toFixed(1),'c')+'×0.13) × '+vr('价格比',(Y.refPrice/r.price).toFixed(2),'s')+'^0.9 × '+
   vr('开源',PS.oss?'1.45':'1.00','m')+'　÷ (w + '+vr('竞争强度',Y.comp.toFixed(2))+' × 5.5)',
   '<b>'+pc(r.share)+'</b>'+dchip(r.share,p&&p.share,true));
 h+=row('年收入','收入 = 基座市场 × 份额 × 开源折扣',
   vr('市场',fM(Y.market),'c')+' × '+vr('份额',pc(r.share),'m')+(PS.oss?' × '+vr('开源折','0.55','s'):''),
   '<b>'+fM2(r.rev)+'</b>'+dchip(r.rev,p&&p.rev,true),true);
 h+=row('本炉净利','净利 = 收入 − 算力 − 数据 − 团队 − 折旧',
   vr('收入',fM2(r.rev),'c')+' − '+vr('成本',fM2(r.rev-r.pl),'m'),
   '<b style="color:'+(r.pl>=0?'var(--ok)':'var(--bad)')+'">'+fM2(r.pl)+'</b>',true);

 $('ptChain').innerHTML=h;
 UI.annotate($('ptChain'));
}

/* ================= 右栏 ================= */
function renderVars(r){
 const rows=[
  ['N_tot','你选的总参数',fT(r.sz)],
  ['N_act','总参数 × 激活率',fT(r.Nact)],
  ['D','N_act × 倍数',fT(r.Draw)],
  ['D_eff','数据墙 + 质量后',fT(r.Deff)],
  ['C','6·N_act·D·税',fE(r.C)],
  ['G','你买/租的卡数',gn(r.G)],
  ['peak','卡型 + 精度',(r.peak/1e12).toFixed(0)+' TF/s'],
  ['MFU','并行 + 互连',pc(r.mfu)],
  ['T','C ÷ 有效算力',r.TdR.toFixed(1)+' 天'],
  ['N_eff','N_act^.65 × N_tot^.35',fT(r.Neff)],
  ['L','缩放定律',r.L.toFixed(3)],
  ['分','100 = 追平前沿',r.score.toFixed(1)],
  ['$/Mtok','推理成本下限','$'+r.costFloor.toFixed(2)]
 ];
 $('ptVars').innerHTML='<table class="vt"><tbody>'+rows.map(x=>'<tr><td>'+x[0]+'</td><td>'+x[1]+'</td><td>'+x[2]+'</td></tr>').join('')+'</tbody></table>';
 const cap=r.card.cap;
 const mrows=[['参数',r.pmem],['梯度',r.gmem],['优化器',r.omem],['激活',r.amem],['碎片 8%',r.mtot-(r.pmem+r.gmem+r.omem+r.amem)]];
 $('ptMem').innerHTML='<table class="ft"><tbody>'+
   mrows.map(x=>'<tr><td>'+x[0]+'</td><td>'+fGB(x[1])+'</td></tr>').join('')+
   '<tr class="tot"><td>合计</td><td class="'+(r.oom?'neg':'pos')+'">'+fGB(r.mtot)+'</td></tr>'+
   '<tr><td>卡容量</td><td>'+(cap/1e9).toFixed(0)+' GB</td></tr>'+
   '</tbody></table>';
 const f=[['收入',r.rev,'pos'],['算力',-(C.rent?r.rentC:r.elec),'neg'],['数据',-r.dataC,'neg'],['团队',-r.team,'neg']];
 if(!C.rent) f.push(['折旧',-r.dep,'acc']);
 $('ptFin').innerHTML='<table class="ft"><tbody>'+
  f.map(x=>'<tr><td>'+x[0]+'</td><td class="'+x[2]+'">'+fM2(x[1])+'</td></tr>').join('')+
  '<tr class="tot"><td>净利</td><td class="'+(r.pl>=0?'pos':'neg')+'">'+fM2(r.pl)+'</td></tr>'+
  '<tr class="gap"><td></td><td></td></tr>'+
  '<tr><td>期末现金</td><td>'+fM(PS.cash-r.cashOut+r.rev)+'</td></tr>'+
  '</tbody></table>';
}

/* ================= 刷新 ================= */
function kb(id,v,u,cls){
 const e=$(id); e.className='kb'+(cls?' '+cls:'');
 e.querySelector('.v').innerHTML=v+(u?'<small>'+u+'</small>':'');
}
function refresh(){
 const r=evalPT(C), Y=r.Y;
 /* trackers */
 const ratio=clamp(r.score/100,0,1.2);
 const ta=$('ptTA'); ta.className='trk '+(r.gap>=0?'ok':r.gap>=-5?'warn':'bad');
 $('ptTAV').textContent=r.score.toFixed(1)+' / 100';
 $('ptTAB').style.width=Math.min(100,ratio*100/1.2)+'%';
 $('ptTAS').textContent=(r.gap>=0?'领先前沿 +':'落后前沿 ')+r.gap.toFixed(1)+' 分 · 份额 '+pc(r.share)+' · 收入 '+fM2(r.rev);
 const okTime=r.TdR<=r.budgetD, okMem=!r.oom, okCash=r.cashOut<=PS.cash;
 const n=(okTime?1:0)+(okMem?1:0)+(okCash?1:0);
 const tb=$('ptTB'); tb.className='trk '+(n===3?'ok':n===2?'warn':'bad');
 $('ptTBV').textContent=n+' / 3';
 $('ptTBB').style.width=(n/3*100)+'%';
 $('ptTBS').textContent=(okMem?'显存✓':'显存 OOM')+' · '+(okTime?'工期✓ '+r.TdR.toFixed(0)+'天':'超期 '+r.TdR.toFixed(0)+'天')+' · '+(okCash?'现金✓':'现金不足 '+fM2(r.cashOut-PS.cash));
 /* hud */
 $('ptCash').textContent=fM(PS.cash);
 $('ptRes').textContent=PS.res;
 $('ptBest').textContent=PS.best?PS.best.toFixed(1):'—';
 $('ptShare').innerHTML=(PS.share*100).toFixed(1)+'<small>%</small>';
 $('ptRev').textContent=fM(PS.cumRev);
 $('ptProf').textContent=fM(PS.retained);
 $('ptOss').textContent=PS.oss?'开源':'闭源';
 /* kpi */
 kb('ptK1',r.TdR.toFixed(1),'天',okTime?(r.TdR<r.budgetD*0.6?'good':''):'bad');
 kb('ptK2',fM2(r.cashOut),'',okCash?'':'bad');
 kb('ptK3',r.score.toFixed(1),'',r.gap>=0?'good':r.gap>=-5?'warn':'bad');
 kb('ptK4',fM2(r.rev),'',r.rev>=r.cashOut?'good':'warn');
 renderChain(r); renderVars(r); renderStruct(r); coach(r);
 /* 变更条 */
 if(PREV&&LASTCH){
  const bits=[];
  const add=(k,lbl,fmt,goodUp)=>{ if(PREV[k]!==r[k]) bits.push(lbl+' '+fmt(PREV[k])+' → <b>'+fmt(r[k])+'</b>'); };
  add('mfu','MFU',pc); add('TdR','时长',x=>x.toFixed(1)+'天'); add('cashOut','成本',fM2);
  add('score','能力分',x=>x.toFixed(1)); add('rev','年收入',fM2);
  $('ptChg').className='chgbar';
  $('ptChg').innerHTML='刚刚改动：<b>'+LASTCH+'</b> · '+(bits.length?bits.join(' · '):'对结果没有影响');
 }
 PREV={Deff:r.Deff,C:r.C,mfu:r.mfu,TdR:r.TdR,cashOut:r.cashOut,score:r.score,rev:r.rev,share:r.share};
 window.__PTLAST=r;
 return r;
}
window.__PTR={refresh:refresh,renderAll:renderAll,renderYear:renderYear,renderRes:renderRes,
 renderCluster:renderCluster,renderRecipe:renderRecipe,renderDesign:renderDesign,renderData:renderData,
 setCh:v=>{LASTCH=v;},getCoachOpen:()=>coachOpen,setCoachOpen:v=>{coachOpen=v;},clearPrev:()=>{PREV=null;LASTCH='';}};

/* ================= 教练 ================= */
function coach(r){
 const Y=PY[PS.i];
 $('ptWhy').innerHTML=Y.rec.why;
 const ck=[];
 ck.push(['显存放得下',!r.oom,'不然这一炉根本开不起来']);
 ck.push(['工期 ≤ '+r.budgetD+' 天',r.TdR<=r.budgetD,'超期就是没训完']);
 ck.push(['现金够',r.cashOut<=PS.cash,'差 '+fM2(Math.max(0,r.cashOut-PS.cash))]);
 ck.push(['MFU ≥ 30%',r.mfu>=0.30,'并行/互连没配好']);
 ck.push(['追上前沿线（100 分）',r.gap>=0,'差 '+Math.abs(r.gap).toFixed(1)+' 分']);
 ck.push(['价格有毛利',!r.under,'低于推理成本下限']);
 (Y.rec.res||[]).forEach(k=>ck.push(['研究：'+RESM[k].n,!!PS.unlocked[k],RESM[k].cost+' 点']));
 $('ptCk').innerHTML=ck.map(c=>'<div class="'+(c[1]?'on':'off')+'"><span class="m">'+(c[1]?'✓':'○')+'</span>'+c[0]+
   (c[1]?'':'<span class="r">'+c[2]+'</span>')+'</div>').join('');
 let nx;
 if(r.oom) nx='<b>显存装不下</b>：把 TP 或 PP 调大（参数和梯度会被切得更碎），或者把重计算调到「全量」，再或者换显存更大的卡。';
 else if(r.TdR>r.budgetD) nx='<b>工期超了</b>：减 token 倍数、加卡、或者上 FP8（峰值直接翻倍）。也看一眼 MFU 是不是被某一项并行罚拖死了。';
 else if(r.cashOut>PS.cash) nx='<b>现金不够</b>：缩小规模或减 token，先活到下一年。';
 else if(r.mfu<0.30) nx='<b>MFU 只有 '+pc(r.mfu)+'</b>：看第 ④ 步里哪一项罚最低——TP 罚低就是超了 NVLink 域，PP 罚低就是气泡，DP 罚低就是网络太慢。';
 else if(r.gap<0) nx='<b>能力落后前沿 '+Math.abs(r.gap).toFixed(1)+' 分</b>（100 分 = 追平当年前沿）。能力分只由 N_eff 和 D_eff 决定：加总参数、加激活参数、加 token、提数据质量，四条路。';
 else if(r.under) nx='<b>定价低于成本下限</b>：要么把价格档位调回去，要么用 MLA / 细粒度 MoE 把成本下限压下来。';
 else nx='<b>这一炉可以开了。</b>'+(PS.res>0?'还有 '+PS.res+' 个研究点没花——研究是永久生效的，别攒着。':'');
 $('ptNext').className='nextup'+(r.feasible&&r.gap>=0&&!r.under?' done':'');
 $('ptNextT').innerHTML=nx;
 UI.annotate($('ptNextT'));
}
})();


(function(){
"use strict";
const D=window.__PT_DATA, P=window.__PT, UI=window.__UI, T=window.__PTUI, R=window.__PTR;
const {TC,TCM,FAB,FABM,SZ,ARCH,ARCHM,ATTN,ATTNM,RECOMP,RECOMPM,DQ,DQM,RES,RESM,PY,MILE}=D;
const {PS,FRESH,evalPT,GOPT,MULT,TPO,PPO,EPO,CKPT,PRICE,maxG,cardOk,resOk,clamp}=P;
const {fT,fM,fM2,fGB,fE,pc,gn}=T;
const $=id=>document.getElementById(id);
const C=PS.cfg;

/* ================= 存档 ================= */
const KEY='inference-economics-pt', VER=1;
let stim=null;
function saveNow(){ try{ window.__IE_STORE.set(KEY,JSON.stringify({v:VER,t:Date.now(),PS:PS}));
  const s=$('ptSave'); s.hidden=false; s.classList.add('on'); clearTimeout(stim); stim=setTimeout(()=>s.classList.remove('on'),1400);
 }catch(e){} }
let svT=null; function save(){ clearTimeout(svT); svT=setTimeout(saveNow,400); }
function loadSave(){ try{ const raw=window.__IE_STORE.get(KEY); if(!raw)return null; const o=JSON.parse(raw);
  if(!o||o.v!==VER||!o.PS) return null; return o.PS; }catch(e){ return null; } }
function applySave(o){ for(const k in o) PS[k]=o[k]; for(const k in o.cfg) C[k]=o.cfg[k]; }
function clearSave(){ try{ window.__IE_STORE.remove(KEY);}catch(e){} }

/* ================= 弹窗 ================= */
function sheet(yl,title,body,foot,cls){
 $('shYl').textContent=yl;
 $('shTitle').textContent=title; $('shTitle').className=cls||'';
 $('shBody').innerHTML=body; $('shFoot').innerHTML=foot||'';
 $('scrim').hidden=false;
 UI.annotate($('shBody'));
}
function closeSheet(){ $('scrim').hidden=true; }

/* ================= 控件 ================= */
function rng(id,fn,label){
 $(id).addEventListener('input',()=>{ fn(+$(id).value); R.setCh(label); sync(); });
}
function opts(box,fn){
 $(box).addEventListener('click',e=>{ const b=e.target.closest('button.opt'); if(!b||b.disabled)return; fn(b.dataset.v); });
}
function sync(){ R.renderAll(); save(); }

rng('ptSz',v=>{C.szI=v;},'总参数');
rng('ptMult',v=>{C.multI=v;},'token 倍数');
rng('ptTp',v=>{C.tpI=v;},'TP');
rng('ptPp',v=>{C.ppI=v;},'PP');
rng('ptEp',v=>{C.epI=v;},'EP');
rng('ptG',v=>{C.gI=v;},'卡数');
rng('ptCk',v=>{C.ckI=v;},'checkpoint 间隔');
rng('ptPr',v=>{C.prI=v;},'定价');
opts('ptArch',v=>{C.arch=v; if(v==='dense')C.epI=0; R.setCh('架构'); sync();});
opts('ptAttn',v=>{C.attn=v; R.setCh('注意力'); sync();});
opts('ptDq',v=>{C.dq=v; R.setCh('数据档位'); sync();});
opts('ptRec',v=>{C.rec=v; R.setCh('重计算'); sync();});
opts('ptCards',v=>{C.cardK=v; if(!(PS.unlocked.fp8&&TCM[v].f8>0))C.prec='bf16'; R.setCh('卡型'); sync();});
opts('ptFab',v=>{PS.fabK=v; R.setCh('互连'); sync();});
opts('ptPrec',v=>{ if(v==='muon'){C.opt=C.opt==='muon'?'adamw':'muon'; R.setCh('优化器');}
  else {C.prec=v; R.setCh('训练精度');} sync(); });
opts('ptMode',v=>{
  if(v==='rent'){C.rent=true;R.setCh('租算力');}
  else if(v==='own'){C.rent=false;R.setCh('自建集群');}
  else if(v==='oss'){PS.oss=true;R.setCh('开源路线');}
  else {PS.oss=false;R.setCh('闭源路线');}
  sync();});
opts('ptResOpts',v=>{
  const r=RESM[v]; if(PS.unlocked[v]||PS.res<r.cost||!resOk(r,PY[PS.i].y)) return;
  PS.res-=r.cost; PS.unlocked[v]=true;
  if(v==='fine'&&C.arch!=='moef'){} 
  R.setCh('研究：'+r.n); R.renderRes(); sync();
});
$('ptCoachTog').addEventListener('click',()=>{ const o=!R.getCoachOpen(); R.setCoachOpen(o);
  $('ptCoachBody').hidden=!o; $('ptCoachTog').textContent=o?'收起':'展开'; });

/* ---------- 照教练配 / 自动切分 ---------- */
function autoPar(){
 let best=null;
 for(let ti=0;ti<TPO.length;ti++) for(let pi=0;pi<PPO.length;pi++)
  for(let ei=0;ei<(C.arch==='dense'?1:EPO.length);ei++) for(const rc2 of ['none','sel','full']){
   const shard=TPO[ti]*PPO[pi]*(C.arch==='dense'?1:EPO[ei]);
   if(shard>GOPT[C.gI]) continue;
   const t={...C,tpI:ti,ppI:pi,epI:ei,rec:rc2};
   const r=evalPT(t);
   if(r.oom||r.TdR>r.budgetD) continue;
   const key=r.mfu*1000-r.TdR*0.05;
   if(!best||key>best.k) best={k:key,t:t};
  }
 if(best){ C.tpI=best.t.tpI; C.ppI=best.t.ppI; C.epI=best.t.epI; C.rec=best.t.rec; return true; }
 return false;
}
function applyRec(){
 const Y=PY[PS.i], rc=Y.rec.cfg; if(!rc) return;
 (Y.rec.res||[]).forEach(k=>{ const r=RESM[k];
   if(!PS.unlocked[k]&&PS.res>=r.cost&&resOk(r,Y.y)){ PS.res-=r.cost; PS.unlocked[k]=true; } });
 C.szI=Math.min(rc.szI,P.maxSzI(Y.y)); C.multI=rc.multI; C.rent=rc.rent!==false;
 C.arch=rc.arch;
 if(ARCHM[C.arch].req&&!PS.unlocked[ARCHM[C.arch].req]) C.arch=(Y.y>=2024?'moe8':'dense');
 C.attn=(ATTNM[rc.attn].req&&!PS.unlocked[ATTNM[rc.attn].req])?'gqa':rc.attn;
 C.dq=rc.dq;
 while(DQM[C.dq].req&&!PS.unlocked[DQM[C.dq].req]) C.dq=(C.dq==='synth'?'mix':C.dq==='mix'?'dedup':'raw');
 C.cardK=cardOk(TCM[rc.cardK],Y.y)?rc.cardK:((TC.filter(c=>cardOk(c,Y.y)).slice(-1)[0]||TCM.h800).k);
 C.prec=(rc.prec==='fp8'&&PS.unlocked.fp8&&TCM[C.cardK].f8>0)?'fp8':'bf16';
 C.opt=PS.unlocked.muon?'muon':'adamw';
 PS.fabK=rc.fab||'ib400';
 C.gI=Math.min(rc.gI,GOPT.indexOf(maxG(Y.y)));
 if(C.arch==='dense') C.epI=0;
 R.renderRes(); autoPar(); R.setCh('照教练配'); sync();
}
$('ptRec').addEventListener('click',applyRec);
window.__PTAPPLY=applyRec;

/* ---------- 自动配 ---------- */
$('ptAuto').addEventListener('click',()=>{ R.setCh(autoPar()?'自动配并行':'这个规模没有可行的切分'); sync(); });

/* ================= 结算 ================= */
function rankOf(x){ return x>=88?'S':x>=74?'A':x>=58?'B':x>=40?'C':'D'; }
function commit(){
 const r=evalPT(C), Y=r.Y;
 if(r.oom||r.TdR>r.budgetD||r.cashOut>PS.cash){
  const why=[];
  if(r.oom) why.push('<p><b>显存装不下。</b>每卡需要 '+fGB(r.mtot)+'，'+r.card.n+' 只有 '+(r.card.cap/1e9).toFixed(0)+' GB。把 TP / PP / EP 调大，或者把重计算调到「全量」。</p>');
  if(r.TdR>r.budgetD) why.push('<p><b>工期不够。</b>这一炉要 '+r.TdR.toFixed(0)+' 天，本年只有 '+r.budgetD+' 天。减 token、加卡，或者上 FP8。</p>');
  if(r.cashOut>PS.cash) why.push('<p><b>现金不够。</b>需要 '+fM2(r.cashOut)+'，只有 '+fM(PS.cash)+'。</p>');
  sheet(Y.y+' · 开不了炉','这一炉现在还开不起来',
   '<div class="lesson miss"><div class="lh">先解决这些</div>'+why.join('')+'</div>',
   '<button class="btn" id="ptX">知道了</button>','bad');
  $('ptX').onclick=closeSheet; return;
 }
 /* 记账 */
 PS.cash-=r.cashOut; PS.cash+=r.rev;
 if(!C.rent){ PS.gpuCapex+=r.capex; PS.gpuAccDep+=r.dep; }
 PS.retained+=r.pl; PS.cumRev+=r.rev; PS.cumSpend+=r.cashOut;
 PS.share=r.share; if(r.score>PS.best){PS.best=r.score; PS.bestY=Y.y;}
 PS.launched++;
 PS.res+=2+(PS.oss?1:0);
 PS.hist.push({y:Y.y,sz:r.sz,Nact:r.Nact,D:r.Draw,arch:r.arch.k,attn:r.attn.k,G:r.G,card:r.card.k,
   Td:r.TdR,mfu:r.mfu,score:r.score,gap:r.gap,cost:r.cashOut,rev:r.rev,pl:r.pl,share:r.share,
   floor:r.costFloor,price:r.price,oss:PS.oss});
 PS.fin.push({y:Y.y,rev:r.rev,compute:C.rent?r.rentC:r.elec,capex:r.capex,data:r.dataC,team:r.team,dep:C.rent?0:r.dep,pl:r.pl,cash:PS.cash});
 const lesson=afterLesson(r);
 const body=`
  <div class="ledger">
   <div class="lk">实际训练时长</div><div class="lv">${r.TdR.toFixed(1)} 天（其中长跑税 ${(r.lostH/24).toFixed(1)} 天）</div>
   <div class="lk">卡时</div><div class="lv">${fT(r.gpuH)} · ${gn(r.G)} × ${r.card.n}</div>
   <div class="lk">MFU</div><div class="lv">${pc(r.mfu)}</div>
   <div class="lk">这一炉花掉</div><div class="lv neg">${fM2(r.cashOut)}</div>
   <div class="lk">能力分 / 前沿线</div><div class="lv">${r.score.toFixed(1)} / 100（${r.gap>=0?'+':''}${r.gap.toFixed(1)}）· ${Y.fronRef}</div>
   <div class="lk">推理成本下限</div><div class="lv">$${r.costFloor.toFixed(2)} /Mtok · 你开价 $${r.price.toFixed(2)}</div>
   <div class="lk">市场份额</div><div class="lv">${pc(r.share)}</div>
   <div class="lk">年收入</div><div class="lv pos">${fM2(r.rev)}</div>
   <div class="lk">本炉净利</div><div class="lv ${r.pl>=0?'pos':'neg'}">${fM2(r.pl)}</div>
   <div class="lk">期末现金 / 研究点</div><div class="lv">${fM(PS.cash)} · ${PS.res} 点</div>
  </div>${lesson}`;
 PS.i++;
 const last=PS.i>=PY.length;
 sheet(Y.y+' · 出炉',(r.gap>=0?'训成了，而且追上了前沿':'训成了，但还差一档'),body,
  '<button class="btn" id="ptNx">'+(last?'看最终结果':'进入 '+PY[PS.i].y+' 年')+'</button>',
  r.gap>=0?'ok':'warn');
 $('ptNx').onclick=()=>{ closeSheet(); if(last){PS.done=true; sendRun2(); final();} else { R.clearPrev(); R.renderYear(); } saveNow(); };
 saveNow();
}

function afterLesson(r){
 const bits=[];
 if(r.mfu<0.25) bits.push(['miss','MFU 只有 '+pc(r.mfu),'你买的算力有四分之三在空转。看看第 ④ 步里哪一项罚最低：TP 罚低说明并行超出了 NVLink 域，PP 罚低是流水线气泡，DP 罚低是网络扛不住 all-reduce。<b>买卡是最贵的解法，调并行是免费的。</b>']);
 else if(r.mfu>=0.38) bits.push(['win','MFU '+pc(r.mfu),'并行切得不错。前沿团队公开的数字大多在 35%–45% 之间，你已经在这个区间里。']);
 if(r.lostH/r.ThR>0.12) bits.push(['miss','长跑税吃掉了 '+pc(r.lostH/r.ThR)+' 的时间','集群 MTBF = 单卡 MTBF ÷ 卡数，这是个除法，卡越多坏得越勤。把 checkpoint 间隔调小，或者去解锁弹性容错。']);
 if(r.Draw>r.cap) bits.push(['miss','你撞上了数据墙','要的 token 超过了当年可得的高质量数据，超出部分按对数递减计入（重复数据的边际收益）。<b>再多爬网页不解决问题</b>——要么提数据质量，要么去解锁合成数据管线。']);
 if(r.arch.k!=='dense'&&r.costFloor<1.2) bits.push(['win','推理成本下限压到了 $'+r.costFloor.toFixed(2)+'/Mtok','这就是 MLA + 细粒度 MoE 的全部价值：它不提高能力分，它让你能把价格打下去而不亏钱。DeepSeek-V2 当年做的就是这件事。']);
 if(r.arch.k==='dense'&&r.sz>=140e9) bits.push(['miss','稠密大模型的推理账','每 token 要读 '+fGB(r.swB*8)+' 的权重（TP=1 口径）。能力分也许够，但你卖 token 的成本下限被锁死在 $'+r.costFloor.toFixed(2)+'。Llama-3.1-405B 就卡在这里。']);
 if(r.under) bits.push(['miss','你在亏本卖','开价 $'+r.price.toFixed(2)+' 低于成本下限 $'+r.costFloor.toFixed(2)+' 的 1.15 倍。份额是买来的，但这笔生意每多卖一个 token 就多亏一点。']);
 if(!bits.length) bits.push(['','这一炉很平稳','没有明显的浪费。接下来能拉开差距的是研究解锁——它们永久生效，越早买越划算。']);
 return bits.slice(0,3).map(b=>'<div class="lesson '+b[0]+'"><div class="lh">'+b[1]+'</div><p>'+b[2]+'</p></div>').join('');
}

/* ================= 最终结算 ================= */
/* 六炉打完：把战绩写进产品数据库 */
function sendRun2(){
 try{ const prof=PS.retained, best=PS.best;
   const sc=clamp(prof/6000*45,0,45)+clamp((best-88)/14*35,0,35)+clamp(PS.share/0.30*20,0,20);
   window.__IE_STORE.run('bu2',{rank:rankOf(sc),score:Math.round(sc*10)/10,
     summary:{cumRev:PS.cumRev,profit:prof,best:best,bestY:PS.bestY,share:PS.share,oss:PS.oss,
              hist:PS.hist.map(h=>({y:h.y,score:h.score,pl:h.pl,floor:h.floor,arch:h.arch}))}});
 }catch(e){}
}
function final(){
 const prof=PS.retained, best=PS.best;
 const sc=clamp(prof/6000*45,0,45)+clamp((best-88)/14*35,0,35)+clamp(PS.share/0.30*20,0,20);
 const rk=rankOf(sc);
 const rows=PS.hist.map(h=>'<div class="trow"><span class="ty">'+h.y+'</span><span class="td">'+
   fT(h.sz)+(h.arch==='dense'?' 稠密':'-A'+fT(h.Nact))+' · '+fT(h.D)+' tok · '+gn(h.G)+'×'+TCM[h.card].n+' · MFU '+pc(h.mfu)+
   ' · $'+h.floor.toFixed(2)+'/Mtok</span><span class="tv '+(h.pl>=0?'ok':'bad')+'">'+h.score.toFixed(1)+' 分 · '+fM2(h.pl)+'</span></div>').join('');
 sheet('2028 · 支线结算','BU-2 六年 · '+rk+' 级',
  '<div class="rank rk '+rk+'">'+rk+'</div>'+
  '<div class="fgrid">'+
   [['累计收入',fM(PS.cumRev)],['累计利润',fM(prof)],['最好能力分',best.toFixed(1)+' ('+PS.bestY+')'],['最终份额',pc(PS.share)]]
   .map(x=>'<div class="c2b"><span class="k">'+x[0]+'</span><span class="v">'+x[1]+'</span></div>').join('')+'</div>'+
  '<div class="lesson"><div class="lh">这条支线到底在教什么</div>'+
  '<p>预训练的账和推理的账是<b>镜像</b>的。推理被 HBM 带宽卡住，看的是 MBU；训练被算力卡住，看的是 MFU。'+
  '推理里你想方设法减字节，训练里你想方设法减通信。</p>'+
  '<p>但两条线在一个地方合流：<b>你在训练时选的架构，决定了你将来每卖一个 token 要花多少钱。</b>'+
  'MLA 和细粒度 MoE 不会让模型更聪明，它们让同样聪明的模型便宜一个数量级——而价格决定份额，份额决定收入。'+
  '这就是 2024 年之后整个行业分叉的地方。</p></div>'+
  '<div class="trace">'+rows+'</div>',
  '<button class="btn ghost" id="ptAgain">再来一局</button><button class="btn" id="ptDone">收起</button>');
 $('ptDone').onclick=closeSheet;
 $('ptAgain').onclick=()=>{ reset(); closeSheet(); };
}
function reset(){ const f=JSON.parse(JSON.stringify(FRESH));
 for(const k in f) PS[k]=f[k]; for(const k in f.cfg) C[k]=f.cfg[k];
 PS.fabK='ib400'; PS.debtRoom=window.__IE_DATA.config.start_bu2.debtRoom; clearSave(); R.clearPrev(); R.renderYear(); }

/* ================= 报表 ================= */
$('ptBooks').addEventListener('click',()=>{
 if(!PS.fin.length){ sheet('BU-2','还没有第一炉','<p class="fnote2">先开一炉训练，报表会从那时开始记。</p>','<button class="btn" id="ptX2">好</button>');
   $('ptX2').onclick=closeSheet; return; }
 const yrs=PS.fin;
 const line=(k,f,cls)=>'<div class="fk3'+(cls==='grp'?' grp':cls==='ind'?' ind':'')+'">'+k+'</div>'+
   yrs.map(y=>'<div class="fv3'+(f(y)<0?' neg':f(y)>0?' pos':'')+'">'+fM2(f(y))+'</div>').join('');
 const hd='<div class="fk3 hd">项目</div>'+yrs.map(y=>'<div class="fv3 hd">'+y.y+'</div>').join('');
 const grid='grid-template-columns:1fr repeat('+yrs.length+',80px)';
 const body=`
 <div class="fsec"><div class="fh">利润表 <span>单位：百万美元</span></div>
  <div class="ftab3" style="${grid}">${hd}
   ${line('基座模型收入',y=>y.rev)}
   ${line('算力开销',y=>-y.compute)}
   ${line('数据与语料',y=>-y.data)}
   ${line('团队与评测',y=>-y.team)}
   ${line('折旧',y=>-y.dep)}
   ${line('净利',y=>y.pl)}
  </div></div>
 <div class="fsec"><div class="fh">现金 <span>期末余额</span></div>
  <div class="ftab3" style="${grid}">${hd}${line('期末现金',y=>y.cash)}</div></div>
 <p class="fnote2">这是 <b>BU-2 独立的账</b>。BU-1 的推理业务另有一本，两边现在不并表。
 合并之后真正有意思的一格是：你自己训的模型如果拿去替换 BU-1 正在服务的那个模型，
 <b>推理侧每 token 的字节数会直接改变</b>，成本、吞吐、能服务的需求全都跟着变。那是后面的高阶玩法。</p>`;
 sheet('BU-2','基座模型业务 · 报表',body,'<button class="btn" id="ptX3">收起</button>');
 $('ptX3').onclick=closeSheet;
});

/* ================= 课堂 ================= */
const LES=[
 {t:'参数都藏在哪：12·L·d²',b:`<p>在算任何账之前，先把一个 Transformer 的参数拆开。每一层只有两块东西带权重：</p>
 <div class="lz">
  <div class="lzr"><span>注意力</span><b>4d²</b><i>Q、K、V、O 四个 d×d 投影</i></div>
  <div class="lzr"><span>前馈 FFN</span><b>8d²</b><i>升维 d→4d 和降维 4d→d，各 4d²</i></div>
  <div class="lzr"><span>每层合计</span><b>12d²</b><i>归一化、偏置这些量级可忽略</i></div>
 </div>
 <div class="lzeq">N ≈ <b>12 × 层数 L × d²</b>　⇒　d = √( N ÷ (12 × L) )</div>
 <p>这条式子本局到处在用。反过来验一下：DeepSeek-V3 每个 token 激活 37B、61 层，代进去 d = √(3.7e10 ÷ 732) ≈ <b>7,107</b>，公开的真实值是 <b>7,168</b>。</p>
 <div class="lzgood">为什么要知道 d 和 L？因为<b>激活显存只跟它们有关</b>：每层要暂存的中间量 ∝ 微批 × 序列长 × d，和你有多少个专家、总参数多大都没关系。右边第 ⑦ 步的「激活」那一项就是这么来的。</div>
 <p>两个补充：<b>GQA</b> 把 K、V 的投影缩小（8 个 Q head 共享一组 KV，那两块从 d² 变成 d²/8）；<b>MoE</b> 把 FFN 那 8d² 复制 n 份，但每个 token 只走其中 k 份——这就是总参数和激活参数被拆开的地方。词嵌入 V×d 另算，12.8 万词表 × 7,168 ≈ 0.9B，大模型里已经是零头。</p>`},

 {t:'为什么是 6ND：一次完整的推导',b:`<p>拿最小的单元来数：一个 y = Wx，W 是 d×d。</p>
 <div class="lz">
  <div class="lzr"><span>前向</span><b>2 FLOP / 参数</b><i>每个权重做一次乘、一次加</i></div>
  <div class="lzr"><span>反向 · 对输入</span><b>2 FLOP / 参数</b><i>dx = Wᵀ·dy，又一次完整矩阵乘</i></div>
  <div class="lzr"><span>反向 · 对权重</span><b>2 FLOP / 参数</b><i>dW = dy·xᵀ，再一次</i></div>
 </div>
 <div class="lzeq">C ≈ <b>6 × N<sub>act</sub> × D</b>　FLOP</div>
 <p>注意是<b>激活参数</b>而不是总参数——没走到的专家不产生梯度，也不耗算力。V3 总参 671B、每 token 激活 37B，训练算力按 37B 算。</p>
 <div class="lzwarn"><b>被省略的那一项</b>：注意力里的 QKᵀ 和 AV 两个矩阵乘不含参数，每 token 额外 ≈ 12·L·s·d FLOP（含反向）。它相对 6·N·D 的比重约为 <b>s ÷ (12d)</b>。d=7,168 时 12d ≈ 86,000，所以 s=4K 的时候注意力只占 5%，可以忽略；但 s=128K 的时候它就是大头——<b>这也是为什么大家都用短序列预训练，最后一小段再外推到长上下文</b>。</div>
 <p>重计算的代价也从这里读出来：全量重算等于多做一次前向，+2ND，总量从 6ND 变 8ND，正好是本局里的 <b>×1.33</b>。</p>
 <div class="lzgood">换算一下 V3：C ≈ 6 × 37e9 × 14.8e12 ≈ <b>3.3e24 FLOP</b>。2,048 张 H800、FP8 峰值 1,979 TF/s、MFU 约 0.35 → 约 2,300 小时，和公开的 278.8 万卡时对得上。</div>`},

 {t:'缩放定律是怎么来的',b:`<p>大量实验拟合出来的经验式，形状非常干净：</p>
 <div class="lzeq">L(N, D) = <b>E</b> + <b>A / N<sup>α</sup></b> + <b>B / D<sup>β</sup></b>　　α ≈ 0.34，β ≈ 0.28</div>
 <div class="lz">
  <div class="lzr"><span>E</span><b>不可约熵</b><i>语言本身的随机性，再大的模型也降不下去</i></div>
  <div class="lzr"><span>A/N<sup>α</sup></span><b>容量不足的那部分</b><i>加参数买回来</i></div>
  <div class="lzr"><span>B/D<sup>β</sup></span><b>见得太少的那部分</b><i>加数据买回来</i></div>
 </div>
 <p>三项互相独立地衰减，所以只加参数不加数据，L 会卡在 E + B/D<sup>β</sup> 那条水平线上——<b>这就是 2022 年之前所有大模型的病</b>。</p>
 <p><b>Chinchilla 的推导</b>：在算力预算 C = 6ND 固定的条件下最小化 L。拉格朗日求导后得到</p>
 <div class="lzeq">N* ∝ C<sup>β/(α+β)</sup>　　D* ∝ C<sup>α/(α+β)</sup>　　指数 ≈ <b>0.45 / 0.55</b></div>
 <p>两个指数都接近 0.5，所以结论被通俗表述成「<b>参数和 token 等比例增长</b>」，拟合出来的最优比约为每参数 20 token。</p>
 <div class="lzwarn">但要记住它优化的目标：<b>训练算力最省</b>。而模型训一次要卖好几年，推理的总算力远超训练。把模型做小一点、训久一点，训练贵一些，之后每一个 token 都便宜——这是另一个目标函数，答案自然不同。下一课就讲这个。</div>`},

 {t:'Chinchilla 与「超训」',b:`<p>2023 年之后几乎所有人都<b>远远超过</b>了 20:1。Llama-3 用 15T token 同时训 8B / 70B / 405B，最小那个的比值上千。</p>
 <div class="lzeq">你真正要最小化的是：<b>训练成本 + 推理成本 × 服务年限 × 流量</b></div>
 <p>训练成本 ∝ N × D，推理成本 ∝ N（每吐一个 token 要把权重读一遍）。所以只要预期流量足够大，<b>把 N 压小、把 D 拉大</b>永远是划算的——多花的训练费是一次性的，省下的推理费是每天都在省。</p>
 <div class="lzgood">本局里这件事被拆成两个互不干扰的滑块：<b>token 倍数</b>往右拉，训练成本和能力分一起涨；而右边第 ⑩ 步的「<b>推理成本下限</b>」纹丝不动——它只跟激活参数和注意力结构有关。你可以亲手验证这个不对称。</div>
 <div class="lzwarn">代价有两个：一是训练时间变长，工期是硬约束；二是<b>数据墙</b>——高质量 token 是有限的，超过之后边际收益按对数递减。所以超训不是无限的，它在 2026 年前后撞墙。</div>`},

 {t:'MFU：训练侧的那把尺子',b:`<p>推理 decode 被 HBM 带宽卡住，所以看 <b>MBU</b>；训练是大矩阵乘，算术强度上千，牢牢在算力受限那一侧，所以看 <b>MFU</b>。</p>
 <div class="lzeq">MFU = <b>有效算力 ÷ 集群峰值算力</b></div>
 <p>前沿团队公开的 MFU 大多在 35%–45%。剩下那一半多全在通信和等待里，本局把它拆成四个乘数摆在第 ④ 步：</p>
 <div class="lz">
  <div class="lzr"><span>TP 张量并行</span><b>每层两次 all-reduce</b><i>通信最密，必须待在 NVLink 域内</i></div>
  <div class="lzr"><span>PP 流水线</span><b>气泡</b><i>(p−1)/m 的时间在空转</i></div>
  <div class="lzr"><span>EP 专家并行</span><b>all-to-all</b><i>最吃对分带宽，跨出机柜就崩</i></div>
  <div class="lzr"><span>DP 数据并行</span><b>梯度 all-reduce</b><i>通信量 = 2×参数字节，与数据量无关</i></div>
 </div>
 <p><b>哪一项最低就去改哪一项</b>——买卡是最贵的解法。接下来两课把这四项的字节数真算一遍。</p>`},

 {t:'通信量的量纲账：谁在发多少字节',b:`<p>记 b = 微批，s = 序列长，d = 隐藏维，L = 层数，N = 参数量，k = 每 token 选的专家数。四种并行每步发的字节数：</p>
 <div class="lz">
  <div class="lzr"><span>TP</span><b>≈ 4·L·b·s·d</b><i>每层两次 all-reduce（注意力后、FFN 后）</i></div>
  <div class="lzr"><span>PP</span><b>≈ (p−1)·b·s·d</b><i>只在段边界传一次激活</i></div>
  <div class="lzr"><span>EP</span><b>≈ 2·b·s·d·k</b><i>发过去、算完收回来</i></div>
  <div class="lzr"><span>DP</span><b>≈ 2·N</b><i>梯度 all-reduce，和 b、s 完全无关</i></div>
 </div>
 <p>代进真实数字：d = 7,168、s = 4,096、L = 61、b = 1、BF16。<b>TP 每步要发约 14 GB</b>。900 GB/s 的 NVLink 上是 16 ms；400 GB/s 的 H800 上是 <b>36 ms</b>。而这一步的计算大约几十毫秒——所以 TP 一旦跨出 NVLink 域（几十 GB/s 的网络），比例立刻反转，MFU 直接腰斩。</p>
 <div class="lzwarn">四项的性质完全不同：<b>TP 量最大、频率最高</b>（每层两次）；<b>DP 量也大但每步只有一次</b>，而且可以和反向传播重叠藏起来；<b>PP 最省字节</b>，代价换成了气泡；<b>EP 量中等但是 all-to-all</b>，吃的是对分带宽而不是点对点带宽。</div>
 <div class="lzgood">于是并行策略的选法有了物理依据：TP 只开到单节点/单 NVLink 域的大小，剩下的规模用 PP 和 EP 铺开，最外层才是 DP。H800 把 NVLink 砍半，动的正好是这套顺序里最贵的那一环——所以中国团队的方案全都在想办法把 TP 挪走。</div>`},

 {t:'流水线气泡：(p−1)/m',b:`<p>PP 把模型按层切成 p 段。第 1 段算完第一个微批才能交给第 2 段，所以开头有一段时间后面的卡全在等；结尾排空时前面的卡全在等。</p>
 <div class="lzeq">气泡比例 = <b>(p − 1) ÷ (m + p − 1)</b>　　m = 微批个数</div>
 <p>直觉：填充和排空各占 (p−1) 个微批的时间，稳态跑 m 个。<b>微批越多，气泡摊得越薄</b>。</p>
 <div class="lz">
  <div class="lzr"><span>GPipe</span><b>(p−1)/m</b><i>最朴素，激活要全存着，显存爆</i></div>
  <div class="lzr"><span>1F1B</span><b>气泡不变</b><i>一前一后交错，把激活峰值压下来</i></div>
  <div class="lzr"><span>交错式 1F1B</span><b>(p−1)/(m·v)</b><i>每张卡放 v 段不连续的层，气泡除以 v，通信次数乘以 v</i></div>
  <div class="lzr"><span>DualPipe</span><b>再减半</b><i>从流水线两端同时喂，并把 all-to-all 藏进计算；代价是参数存两份</i></div>
 </div>
 <p>本局取 m = 8，解锁 DualPipe 后 m = 16。所以 PP = 8 的气泡从 <b>7/15 = 47%</b> 降到 <b>7/23 = 30%</b>——第 ④ 步里「PP 罚」那个数就是 1 减去它。</p>
 <div class="lzwarn">这里有个隐藏的耦合：m 受全局 batch 限制（全局 batch = b·s·DP·m）。DP 开得越大，留给 m 的空间越小，<b>气泡就越大</b>。万卡以上这是真实的设计冲突，下一课讲全局 batch 为什么不能随便加。</div>`},

 {t:'全局 batch 与临界 batch size',b:`<p>为什么大家的全局 batch 都在 4M token 上下，不是 40M 也不是 400K？</p>
 <div class="lzeq">B<sub>crit</sub> ≈ <b>梯度噪声 ÷ 梯度信号</b>　（gradient noise scale）</div>
 <div class="lz">
  <div class="lzr"><span>B ≪ B<sub>crit</sub></span><b>加 batch 几乎白赚</b><i>噪声主导，样本翻倍、所需步数减半</i></div>
  <div class="lzr"><span>B ≫ B<sub>crit</sub></span><b>纯浪费算力</b><i>梯度已经很准了，再平均也不会更准，步数不再减少</i></div>
 </div>
 <p>B<sub>crit</sub> 会随训练进行而<b>变大</b>（后期梯度更小、相对噪声更大），所以很多团队采用 batch ramp-up：开头小、后面加。</p>
 <div class="lzwarn">对工程的意义：全局 batch = b · s · DP · m 是个<b>上限已定</b>的预算。你要铺 4 万张卡，DP 就得很大，b 和 m 就被挤小——微批小了气泡变大，微批小了每次矩阵乘也变瘦、算术强度下降。<b>这就是为什么十万卡集群的 MFU 天然比万卡低</b>，也是为什么大家宁可把规模花在 PP 和 EP 上，而不是无脑加 DP。</div>`},

 {t:'显存账：16 字节/参数的来历',b:`<p>混合精度训练的标准配方，每个参数身上挂着五样东西：</p>
 <div class="lz">
  <div class="lzr"><span>BF16 权重</span><b>2 字节</b><i>前向反向用的那份</i></div>
  <div class="lzr"><span>BF16 梯度</span><b>2 字节</b><i>和权重一样大</i></div>
  <div class="lzr"><span>FP32 主权重</span><b>4 字节</b><i>累加小更新用，BF16 精度不够</i></div>
  <div class="lzr"><span>Adam 一阶动量 m</span><b>4 字节</b><i>FP32</i></div>
  <div class="lzr"><span>Adam 二阶动量 v</span><b>4 字节</b><i>FP32</i></div>
 </div>
 <div class="lzeq">合计 <b>16 字节 / 参数</b>　（本局把后三项记作「优化器状态 12 字节」）</div>
 <p>670B 的模型就是 <b>10.7 TB</b>，其中 8 TB 是优化器相关。一张 H800 只有 80 GB——<b>至少要切 134 刀</b>，这还没算激活。</p>
 <div class="lz">
  <div class="lzr"><span>ZeRO-1</span><b>切优化器状态</b><i>12 字节那块除以 DP，性价比最高的一刀</i></div>
  <div class="lzr"><span>ZeRO-2</span><b>再切梯度</b><i>通信换显存</i></div>
  <div class="lzr"><span>ZeRO-3 / FSDP</span><b>连参数也切</b><i>用之前临时 all-gather 回来</i></div>
  <div class="lzr"><span>Muon</span><b>状态 ≈ 8 字节</b><i>只要一个动量矩阵，不要 v</i></div>
 </div>
 <div class="lzgood">激活是第四块，它不随参数量变，只随 b·s·d·L 变：<b>全量重算 k≈2、选择性重算 k≈8、不重算 k≈24</b>。所以长序列训练的第一反应永远是重计算，而不是加卡。</div>`},

 {t:'H800 与算法补偿',b:`<p>2023 年的出口管制画了一条非常具体的线：H800 的<b>算力与 H100 完全相同</b>，被砍的是卡间 NVLink，900 → 400 GB/s。</p>
 <p>结合前面那一课就知道谁受伤最重：<b>TP 每步要发 14 GB，而且每层两次</b>。带宽减半，这一项的时间直接翻倍。于是整条路线被逼着往两个方向走：</p>
 <div class="lzgood"><b>一，把并行挪出 TP。</b>更大的 PP 和 EP，再用 <b>DualPipe</b> 把通信藏进计算里。<br><br>
 <b>二，从根上减少要通信的东西。</b>细粒度 MoE 让每个 token 只走 5% 的参数，MLA 让 KV 小一个量级，FP8 让所有字节减半。</div>
 <p>这就是为什么 2024–2025 年最激进的架构创新集中出现在算力受限的一侧。<b>约束不是劣势的时候，它是设计压力。</b></p>`},

 {t:'长跑：可靠性就是算力',b:`<p>一次预训练要连续跑几十天。集群越大，坏得越勤，而且是个除法：</p>
 <div class="lzeq">集群 MTBF = <b>单卡 MTBF ÷ 卡数</b></div>
 <p>单卡 MTBF 按 45,000 小时算：2,048 张是 22 小时坏一次，16,384 张是 2.7 小时一次，<b>十万张卡是每 27 分钟一次</b>。Llama-3-405B 那次训练在 54 天里记录了 419 次中断，量级完全吻合。</p>
 <div class="lzeq">每次损失 ≈ <b>checkpoint 间隔 ÷ 2 + 恢复时间</b></div>
 <p>为什么是「÷2」：故障在两次存盘之间均匀发生，期望损失是半个间隔。</p>
 <div class="lzwarn">间隔调大省下的是存盘开销，赔进去的是每次故障的期望损失。在万卡规模上，<b>一个 checkpoint 策略的差别可以等于几千张卡</b>。异步 checkpoint（存盘不停机）+ 弹性容错（坏一个节点不用全体重启）就是花钱把这一项买掉。</div>
 <p>另一类故障是<b>损失尖峰</b>：loss 突然飙升且不回落。成因通常是数值不稳定或某批脏数据。标准做法是回滚到上一个 checkpoint、跳过那批数据再跑——所以 checkpoint 不只是防硬件坏，也是防训练本身发疯。</p>`},

 {t:'数据墙与合成数据',b:`<p>缩放定律里的 D 是<b>有效</b> token，不是你爬了多少网页。同一批数据重复训第二遍，边际收益远低于第一遍。</p>
 <div class="lz">
  <div class="lzr"><span>去重</span><b>MinHash / 精确去重</b><i>重复内容让模型记住而不是学会</i></div>
  <div class="lzr"><span>质量分类</span><b>fastText 打分</b><i>用高质量语料训一个分类器，反过来筛全网</i></div>
  <div class="lzr"><span>配比</span><b>代码 / 数学 / 多语</b><i>代码和数学会外溢到通用推理能力上</i></div>
 </div>
 <div class="lzwarn">超过当年可得的高质量 token 之后，本局把多出来的部分按<b>对数递减</b>计入：D<sub>wall</sub> = 可得 × (1 + 0.45·ln(1 + 超出/可得))。这是把「再多爬点网页」这条路堵死的那堵墙。</div>
 <p><b>合成与改写</b>是唯一的增量：把优质文档换成多种风格重写，或者让强模型生成解题过程。它有效，但反复自产自销会让分布收窄（塌缩）——所以它在本局里带 6% 的风险折扣，直接打在能力分上。</p>`},

 {t:'总参数 vs 激活参数：MoE 的数学',b:`<div class="lzeq"><b>总参数决定容量，激活参数决定成本。</b></div>
 <p>稠密模型里这两个数相等，所以要更聪明就必须更贵。MoE 把它们拆开：671B 的容量、37B 的算力。</p>
 <p><b>门控</b>：g(x) = softmax(W<sub>g</sub>·x)，取 top-k 个专家，输出是它们的加权和。</p>
 <div class="lz">
  <div class="lzr"><span>粗粒度</span><b>8 专家 top-2</b><i>组合数 C(8,2) = 28 种</i></div>
  <div class="lzr"><span>细粒度</span><b>256 专家 top-8</b><i>组合数 C(256,8) ≈ 4.5×10<sup>14</sup> 种</i></div>
 </div>
 <p>两者激活的参数量可以完全一样，但<b>能表达的组合差了十三个数量级</b>。把专家切小、选多个，等于用「组合」而不是「选择」来表达——这是细粒度 MoE 的全部道理。</p>
 <p><b>共享专家</b>：留 1–2 个永远激活的专家，承接所有 token 都需要的通用能力，其余专家才去做分化，避免每个专家都重复学一遍基础知识。</p>
 <div class="lzwarn"><b>负载均衡</b>是 MoE 的工程难点。不加约束时少数专家会被打爆，其余闲置。<br>· <b>容量因子 C</b>：每个专家最多收 C·(b·s·k/n) 个 token，超出的直接丢弃（token dropping），质量受损。<br>· <b>辅助损失</b>：往主任务里加一项均衡惩罚——有效，但它注入的梯度和主目标不同向，会伤害质量。<br>· <b>无辅助损失做法</b>：给每个专家一个可调<b>偏置</b>，只影响路由决策、不进反向传播。负载靠偏置调，梯度保持干净。这就是 V3 的做法。</div>`},

 {t:'MLA：低秩、以及「吸收」那一步',b:`<p>MHA 每个 token 要缓存 2·L·n<sub>h</sub>·d<sub>h</sub> 个数；GQA 把 n<sub>h</sub> 降到 n<sub>kv</sub>，砍 8 倍。MLA 换了个思路：</p>
 <div class="lzeq">c = <b>W<sub>DKV</sub> · x</b>　　（d<sub>c</sub> ≈ 512，而 n<sub>h</sub>·d<sub>h</sub> ≈ 8,192）</div>
 <p>只把这个低秩 latent <b>c</b> 缓存下来。要用的时候 K = W<sub>UK</sub>·c、V = W<sub>UV</sub>·c 升回去。</p>
 <div class="lzgood"><b>关键的一步是「吸收」。</b>注意力打分是 qᵀk = (W<sub>Q</sub>x)ᵀ(W<sub>UK</sub>c) = xᵀ·(W<sub>Q</sub>ᵀW<sub>UK</sub>)·c。括号里两个矩阵可以<b>离线乘好</b>合成一个。于是推理时根本不需要把 K 还原出来——省的不只是显存，还有那一次升维的算力。</div>
 <div class="lzwarn"><b>RoPE 和低秩不兼容</b>：位置编码要作用在还原后的 K 上，一旦加了旋转，上面那个矩阵就不能提前合并了。V3 的解法是<b>解耦 RoPE</b>——额外留一小块专门带位置信息的维度走常规路径，其余大部分仍然走低秩通道。</div>
 <p>结果：每 token 的 KV 从 320 KB 掉到约 9 KB。训练时只多算一点升降维（本局记作算力 ×1.03），<b>省下的全在推理侧</b>。而架构是训练时的一次性选择，成本是之后每一天的事——这就是第 ⑩ 步那一格存在的理由。</p>`},

 {t:'FP8 训练为什么不炸',b:`<p>FP8 有两种格式：E4M3（精度高、范围窄，±448）和 E5M2（范围宽、精度低）。对比一下 BF16 的 ±3×10<sup>38</sup>，直接拿整张量去量化必然溢出或下溢。三个补丁让它能用：</p>
 <div class="lz">
  <div class="lzr"><span>细粒度 scaling</span><b>分块各自缩放</b><i>激活按 1×128 的 tile、权重按 128×128 的 block，而不是整张量一个因子——一个离群值只污染一块</i></div>
  <div class="lzr"><span>高精度累加</span><b>FP32 收尾</b><i>张量核内部 FP8 相乘，每隔固定间隔把部分和搬到 CUDA 核做 FP32 累加，避免长链累加的误差堆积</i></div>
  <div class="lzr"><span>关键路径保精度</span><b>不是全都降</b><i>embedding、输出头、归一化、门控、优化器状态一律 BF16/FP32</i></div>
 </div>
 <div class="lzeq">收益：字节 <b>÷2</b>（显存和通信一起降）　+　张量核峰值 <b>×2</b></div>
 <p>这是本局里唯一一个<b>同时打两栏</b>的手段——右边第 ④ 步里它既进「单卡峰值」，又进 MFU 的一个乘数。</p>
 <div class="lzwarn">为什么 2024 年之前没人敢用：不是硬件不支持，是<b>没人确认过大规模长跑下它不发散</b>。V3 是第一个把 FP8 训练的完整配方和 671B 规模的验证一起公开的。工程上的「敢」往往比「能」更值钱。</div>`},

 {t:'Muon：把更新方向正交化',b:`<p>SGD 和 Adam 的更新都是<b>逐元素</b>的。但权重是矩阵，梯度矩阵通常被少数几个奇异方向主导——逐元素更新会沿这几个方向走很远，其他方向几乎不动。</p>
 <div class="lzeq">O = <b>NewtonSchulz5(M)</b>　　W ← W − η · O　　（M 是动量矩阵）</div>
 <p>Newton-Schulz 迭代把 M 的奇异值近似<b>全部拉成 1</b>，相当于取 M 的「正交极分解」。几何上：不再是沿梯度最陡的方向冲，而是<b>在谱范数意义下走一个单位步</b>，各方向均匀推进。</p>
 <div class="lz">
  <div class="lzr"><span>开销</span><b>≈ 1% 前向算力</b><i>迭代只用矩阵乘，5 次足够，可以用 BF16 做</i></div>
  <div class="lzr"><span>显存</span><b>≈ 8 字节/参数</b><i>只需要一个动量矩阵，不要 Adam 的 v</i></div>
  <div class="lzr"><span>适用范围</span><b>只用于二维权重</b><i>embedding、归一化增益等仍走 AdamW</i></div>
 </div>
 <div class="lzwarn">规模化的坑：更新方向被拉均匀之后，注意力的 logit 容易涨到发散。Kimi K2 的做法是 <b>MuonClip</b>——在 Q、K 的投影上做缩放钳制，把 logit 压回去。<b>任何优化器换代都要配一套稳定化手段</b>，这是从 1B 做到 1T 之间最容易翻车的地方。</div>
 <p>本局把它记作：优化器状态 12 → 8 字节/参数，token 效率 +9%。前者让你少切两刀，后者直接进 D<sub>eff</sub>。</p>`},

 {t:'训练与推理：同一张卡，两个瓶颈',b:`<p>这是两条业务线全部差异的根源，用算术强度一句话说清。</p>
 <div class="lzeq">算术强度 I = <b>FLOP ÷ 从 HBM 读的字节数</b>　　拐点 = 峰值算力 ÷ 带宽</div>
 <div class="lz">
  <div class="lzr"><span>训练一步</span><b>I ≈ 2·b·s</b><i>读一遍权重，给 b×s 个 token 用 → 几千，远在拐点右边</i></div>
  <div class="lzr"><span>prefill</span><b>I ≈ 2·s</b><i>同样远在右边，算力受限</i></div>
  <div class="lzr"><span>decode 一步</span><b>I ≈ 2·B</b><i>读一遍权重只产 B 个 token → 几十，在拐点左边</i></div>
 </div>
 <p>同一张卡、同一份权重，仅仅因为「一次处理多少 token」差了三个数量级，物理瓶颈就换了一边：</p>
 <div class="lzgood"><b>训练：算力受限。</b>看 MFU，优化方向是减通信、减气泡、提峰值（FP8）。<br><br><b>推理 decode：带宽受限。</b>看 MBU，优化方向是减字节——量化、MLA、MoE，以及用大 batch 把强度抬上去。</div>
 <div class="lzwarn">所以两个 BU 的「优化直觉」是互相不通用的。在 BU-1 里换更大带宽的卡立刻见效，在 BU-2 里带宽几乎无感；在 BU-2 里 FP8 让峰值翻倍是天大的事，在 BU-1 里 FP8 的主要价值是<b>字节减半</b>而不是算力翻倍。这也是为什么这两条线先各记各的账。</div>`},

 {t:'两条真实路线',b:`<div class="lz">
  <div class="lzr"><span>Llama-3.1</span><b>405B 稠密 · 15T token</b><i>16K H100 × 54 天 · 简单、好训、推理贵</i></div>
  <div class="lzr"><span>DeepSeek-V3</span><b>671B-A37B · 14.8T</b><i>MLA + 细粒度 MoE + FP8 + DualPipe · 278.8 万 H800 卡时 ≈ 557 万美元</i></div>
  <div class="lzr"><span>Kimi K2</span><b>1T-A32B · 15.5T</b><i>Muon 优化器 · 更省的优化器状态与更高的 token 效率</i></div>
 </div>
 <p>三者的能力分处在同一档，但<b>每卖一个 token 的成本差了一个数量级</b>。这就是 2024 年之后价格战的物理基础——它不是补贴，是架构。</p>
 <div class="lzgood">这条支线想让你亲手验证的就是这件事：<b>预训练阶段做的架构决定，会以「推理成本下限」的形式跟着你之后的每一年。</b>等到 BU-1 和 BU-2 并表的时候，这一格会直接改写推理机房的账。</div>`}
];
let li=0;
function openLesson(i){
 li=clamp(i,0,LES.length-1);
 const nav=LES.map((l,n)=>'<button class="lnav'+(n===li?' on':'')+'" data-i="'+n+'">'+(n+1)+'</button>').join('');
 sheet('预训练课堂 '+(li+1)+' / '+LES.length,LES[li].t,
  '<div class="lbody">'+LES[li].b+'</div>',
  '<div style="display:flex;gap:3px;margin-right:auto;flex-wrap:wrap;max-width:62%">'+nav+'</div>'+
  '<button class="btn ghost" id="ptLp">上一课</button><button class="btn" id="ptLn">'+(li===LES.length-1?'收起':'下一课')+'</button>');
 $('ptLp').onclick=()=>openLesson(li-1);
 $('ptLn').onclick=()=>{ if(li===LES.length-1) closeSheet(); else openLesson(li+1); };
 [].forEach.call($('shFoot').querySelectorAll('.lnav'),b=>b.onclick=()=>openLesson(+b.dataset.i));
}
$('ptLesson').addEventListener('click',()=>openLesson(li));

/* ================= 说明 ================= */
$('ptHelp').addEventListener('click',()=>{
 sheet('BU-2','怎么玩这条支线',
 `<p class="fnote2">2023 年，母公司在推理机房旁边给你开了一条新业务线：<b>自己做基座模型</b>。目标两个——把将来推理的成本压下去，以及把模型卖出去赚钱。
 这条线有自己的现金、自己的研究点、自己的报表，<b>暂时不与 BU-1 并表</b>。</p>
 <div class="lz">
  <div class="lzr"><span>每回合</span><b>一炉训练</b><i>2023 → 2028 共 6 炉</i></div>
  <div class="lzr"><span>左栏 A/B</span><b>模型与数据</b><i>决定能力分：只有 N_act 和 D_eff 进缩放定律</i></div>
  <div class="lzr"><span>中栏 C/D</span><b>配方与集群</b><i>决定时长与成本：并行、精度、卡型、互连</i></div>
  <div class="lzr"><span>左栏 F</span><b>研究解锁</b><i>永久生效，越早买越划算</i></div>
  <div class="lzr"><span>右栏</span><b>完整公式链</b><i>十步，每一步都写成「变量名(数值)」</i></div>
  <div class="lzr"><span>预训练课堂</span><b>18 节原理课</b><i>从 12Ld² 和 6ND 的推导，到 MoE 组合数、MLA 的「吸收」、FP8 为什么不炸</i></div>
 </div>
 <div class="lzwarn">三条硬约束，顶部第二个 tracker 会实时告诉你：<b>显存装得下</b>、<b>工期跑得完</b>、<b>现金付得起</b>。三个都过了才能开炉。</div>
 <div class="lzgood">如果不知道从哪下手：先按教练那一栏的清单走，并行切分点「自动配」，剩下的只调总参数和 token 倍数两个滑块，先把第一炉跑出来。</div>`,
 '<button class="btn ghost" id="ptH2">先看课堂</button><button class="btn" id="ptH1">开始</button>');
 $('ptH1').onclick=closeSheet;
 $('ptH2').onclick=()=>openLesson(0);
});
$('ptReset').addEventListener('click',()=>{
 sheet('BU-2','重开这条支线？','<p class="fnote2">BU-2 的进度会清空，BU-1 的推理业务不受影响。</p>',
  '<button class="btn ghost" id="ptRc">取消</button><button class="btn" id="ptRg">重开</button>');
 $('ptRc').onclick=closeSheet;
 $('ptRg').onclick=()=>{ reset(); closeSheet(); };
});
$('ptGo').addEventListener('click',commit);

/* ================= BU 切换 ================= */
function switchTo(id){
 $('bu1').hidden=(id!=='bu1'); $('bu2').hidden=(id!=='bu2');
 $('btab1').classList.toggle('on',id==='bu1');
 $('btab2').classList.toggle('on',id==='bu2');
 if(id==='bu2') R.refresh();
}
$('btab1').addEventListener('click',()=>switchTo('bu1'));
$('btab2').addEventListener('click',()=>switchTo('bu2'));
window.__BU={switchTo:switchTo, tabInfo:()=>tabInfo(),
  g2:{ peek:loadSave, newGame:reset, state:PS, years:PY, lesson:openLesson }};
function tabInfo(){
 try{ const g=window.__G; if(g) $('btab1s').textContent=g.YEARS[Math.min(g.S.i,6)].y+' · 第 '+(g.S.i+1)+'/7'; }catch(e){}
 $('btab2s').textContent=PS.done?'已完成':(PY[Math.min(PS.i,5)].y+' · 第 '+(PS.i+1)+'/6');
}
setInterval(tabInfo,900);

/* ================= 启动 ================= */
const sv=loadSave();
if(sv) applySave(sv);
PS.fabK=PS.fabK||'ib400'; PS.debtRoom=window.__IE_DATA.config.start_bu2.debtRoom;
R.renderYear();
tabInfo();
})();


(function(){
"use strict";
const $=id=>document.getElementById(id);
const UI=window.__UI, BU=window.__BU, G1=UI.g1, G2=BU.g2;

/* ---------- 封面 ---------- */
const COV1=`<svg viewBox="0 0 420 150" preserveAspectRatio="none" aria-hidden="true">
 <g stroke="#D3DAE1" stroke-width="1">
  <line x1="0" y1="34" x2="420" y2="34"/><line x1="0" y1="64" x2="420" y2="64"/><line x1="0" y1="94" x2="420" y2="94"/>
 </g>
 <path d="M26 104 L152 36 L398 36" fill="none" stroke="#9A2F66" stroke-width="2.4" stroke-linejoin="round"/>
 <line x1="152" y1="36" x2="152" y2="110" stroke="#AEBAC5" stroke-width="1" stroke-dasharray="3 3"/>
 <circle cx="152" cy="36" r="4.5" fill="#9A2F66"/>
 <text x="160" y="32" font-family="ui-monospace,monospace" font-size="9" fill="#4C5764">拐点</text>
 <text x="30" y="98" font-family="ui-monospace,monospace" font-size="9" fill="#7C8794">带宽受限</text>
 <text x="300" y="52" font-family="ui-monospace,monospace" font-size="9" fill="#7C8794">算力受限</text>
 <g>
  <rect x="240" y="82" width="150" height="8" rx="1" fill="#9A2F66" opacity=".8"/>
  <rect x="240" y="94" width="84" height="8" rx="1" fill="#0D6F86" opacity=".75"/>
  <rect x="240" y="106" width="46" height="8" rx="1" fill="#96660A" opacity=".75"/>
  <text x="240" y="126" font-family="ui-monospace,monospace" font-size="8.5" fill="#7C8794">权重 / KV / 激活</text>
 </g>
</svg>`;
const COV2=(()=>{
 let cells='';
 for(let r=0;r<4;r++) for(let c=0;c<22;c++){
  const on=(r*22+c)%7!==0;
  cells+=`<rect x="${20+c*13}" y="${16+r*13}" width="9" height="9" rx="1.5" fill="${on?'#0D6F86':'#AEBAC5'}" opacity="${on?(0.24+0.46*((r+c)%3)/2).toFixed(2):'0.4'}"/>`;
 }
 return `<svg viewBox="0 0 420 150" preserveAspectRatio="none" aria-hidden="true">${cells}
 <path d="M24 80 C 96 80, 118 108, 190 116 S 320 128, 398 131" fill="none" stroke="#9A2F66" stroke-width="2.4"/>
 <circle cx="398" cy="131" r="3.5" fill="#9A2F66"/>
 <text x="26" y="74" font-family="ui-monospace,monospace" font-size="9" fill="#4C5764">loss</text>
 <text x="316" y="124" font-family="ui-monospace,monospace" font-size="8.5" fill="#7C8794">E + A/N^α + B/D^β</text>
 </svg>`;
})();

/* ---------- 骨架 ---------- */
const wrap=document.createElement('div');
wrap.id='home'; wrap.className='home';
wrap.innerHTML=`
<div class="hmin">
 <div class="hmhead">
  <div class="hmt">推理<em>经济学</em></div>
  <div class="hmsub">两条业务线 · 同一套公式</div>
  <div class="hmtag" id="hmTag">进度自动保存到你的账号</div>
 </div>
 <div class="hmrow">
  <article class="tile t1" id="tile1" tabindex="0">
   <div class="cov cov1"><span class="covk">Roofline · 电力 · 折旧</span>${COV1}</div>
   <div class="tb2">
    <div class="tn"><span class="bn">BU-1</span>推理运营</div>
    <p class="ts2">2022 → 2028 · 七回合。买卡、排电、解锁推理栈、按卡型调 batch 与精度，用文档里那套真公式结算 <b>TPOT / goodput / $ 每百万 token</b>。</p>
    <div class="tmeta"><span>七回合</span><span>带宽受限那一侧</span><span>三表结算</span><span>可演示</span></div>
    <div class="tprog">
     <div class="tpl"><span id="s1k">尚未开始</span><b id="s1v">0 / 7</b></div>
     <div class="tpb"><i id="s1b" style="width:0"></i></div>
    </div>
    <div class="tacts" id="a1"></div>
   </div>
  </article>
  <article class="tile t2" id="tile2" tabindex="0">
   <div class="cov cov2"><span class="covk">6ND · MFU · 缩放定律</span>${COV2}</div>
   <div class="tb2">
    <div class="tn"><span class="bn">BU-2</span>基座模型 · 预训练</div>
    <p class="ts2">2023 → 2028 · 六回合。定架构与 token 预算、切并行、算显存与长跑税，用缩放定律推能力分，再反算<b>将来卖 token 的成本下限</b>。</p>
    <div class="tmeta"><span>六回合</span><span>算力受限那一侧</span><span>18 节原理课</span><span>独立记账</span></div>
    <div class="tprog">
     <div class="tpl"><span id="s2k">尚未开始</span><b id="s2v">0 / 6</b></div>
     <div class="tpb"><i id="s2b" style="width:0"></i></div>
    </div>
    <div class="tacts" id="a2"></div>
   </div>
  </article>
 </div>
 <div class="hmfoot">
  <button class="lnk" id="hmH1">BU-1 怎么玩</button>
  <button class="lnk" id="hmL1">推理原理小课堂</button>
  <button class="lnk" id="hmH2">BU-2 怎么玩</button>
  <button class="lnk" id="hmL2">预训练课堂 · 18 节</button>
  <button class="lnk" id="hmD">看一局自动演示</button>
  <span class="hmnote">存档跟着你的账号走，换设备登录也能接着玩。<br>两条线各自记账，互不影响。</span>
 </div>
</div>`;
document.body.appendChild(wrap);

/* ---------- 返回主菜单 ---------- */
const tabs=document.querySelector('.butabs');
if(tabs){ const b=document.createElement('button'); b.className='bhome'; b.id='btabHome';
  b.textContent='← 主菜单'; const tip=tabs.querySelector('.butip');
  tabs.insertBefore(b, tip||null); b.addEventListener('click',openHome); }

/* ---------- 数据 ---------- */
function pad(n){ return (n<10?'0':'')+n; }
function when(t){ const d=new Date(t);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
function info1(){
 const sv=G1.peek(), S=G1.state, Y=G1.years;
 const started = !!sv;
 let fleet=0; Object.keys(S.fleet||{}).forEach(k=>fleet+=S.fleet[k]);
 return {started:started, i:S.i, n:Y.length, y:Y[Math.min(S.i,Y.length-1)].y,
  line: started ? (Y[Math.min(S.i,Y.length-1)].y+' 年 · 现金 '+G1.fM(S.cash)+' · 机队 '+G1.gn(fleet)+' 张 · 电力 '+(S.power||0)+' MW')
                : '七回合从 2022 年开始',
  t: sv? sv.t : 0};
}
function info2(){
 const sv=G2.peek(), S=G2.state, Y=G2.years;
 const started = !!sv;
 return {started:started, i:S.i, n:Y.length, y:Y[Math.min(S.i,Y.length-1)].y,
  line: started ? (Y[Math.min(S.i,Y.length-1)].y+' 年 · 现金 $'+Math.round(S.cash)+'M · 研究点 '+S.res+(S.best?' · 最好能力分 '+S.best.toFixed(1):''))
                : '六回合从 2023 年开始',
  t: sv? (sv.t||0) : 0};
}
function bar(id,i,n){ $(id).style.width=Math.max(0,Math.min(100, i/n*100))+'%'; }

let confirming=0;
function renderTile(k){
 const d = k===1? info1() : info2();
 $('s'+k+'k').textContent=d.line;
 $('s'+k+'v').textContent=(d.i>=d.n? '已通关' : '第 '+(d.i+1)+' / '+d.n);
 bar('s'+k+'b', d.i, d.n);
 const acts=$('a'+k);
 if(confirming===k){
  acts.innerHTML='<span class="warnq">清空 BU-'+k+' 的存档，从头开始？</span>'+
   '<button class="btn ghost" data-x="cancel">取消</button><button class="btn" data-x="yes">确定</button>';
 } else if(!d.started && d.i===0){
  acts.innerHTML='<button class="btn" data-x="go">开始新游戏</button>';
 } else if(d.i>=d.n){
  acts.innerHTML='<button class="btn" data-x="go">查看结算</button>'+
   '<button class="btn ghost" data-x="new">再来一局</button>';
 } else {
  acts.innerHTML='<button class="btn" data-x="go">继续 '+d.y+' 年</button>'+
   '<button class="btn ghost" data-x="new">新游戏</button>';
 }
 if(d.t){ $('hmTag').textContent='上次游玩 '+when(Math.max(info1().t,info2().t)); }
}
function renderHome(){ confirming=0; renderTile(1); renderTile(2); }

function enter(bu){
 wrap.hidden=true;
 BU.switchTo(bu);
 UI.fitStage();
 if(BU.tabInfo) BU.tabInfo();
}
function openHome(){ renderHome(); wrap.hidden=false; window.scrollTo(0,0); }
window.__HOME={open:openHome, enter:enter};

function act(k,x){
 if(x==='go'){ enter(k===1?'bu1':'bu2'); return; }
 if(x==='new'){ confirming=k; renderTile(k); return; }
 if(x==='cancel'){ confirming=0; renderTile(k); return; }
 if(x==='yes'){
  confirming=0;
  if(k===1) G1.newGame(); else G2.newGame();
  renderHome();
  enter(k===1?'bu1':'bu2');
 }
}
[1,2].forEach(k=>{
 $('a'+k).addEventListener('click',e=>{ const b=e.target.closest('button[data-x]'); if(!b)return;
   e.stopPropagation(); act(k,b.dataset.x); });
 $('tile'+k).addEventListener('click',e=>{ if(e.target.closest('button'))return; if(confirming)return; enter(k===1?'bu1':'bu2'); });
 $('tile'+k).addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); enter(k===1?'bu1':'bu2'); } });
});
$('hmH1').onclick=()=>{ enter('bu1'); const b=$('btnHelp'); if(b) b.click(); };
$('hmL1').onclick=()=>{ enter('bu1'); const b=$('btnLesson'); if(b) b.click(); };
$('hmH2').onclick=()=>{ enter('bu2'); const b=$('ptHelp'); if(b) b.click(); };
$('hmL2').onclick=()=>{ enter('bu2'); const b=$('ptLesson'); if(b) b.click(); };
$('hmD').onclick =()=>{ enter('bu1'); const b=$('btnDemo'); if(b) b.click(); };

renderHome();
})();

