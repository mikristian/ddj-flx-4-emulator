#!/usr/bin/env node
/* Dependency-free DOM and WebSocket contract checks. No real network/hardware. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const failures = [];
let passes = 0;
function check(name, fn) {
  try { fn(); passes++; console.log('PASS ' + name); }
  catch (error) { failures.push(name + ': ' + error.message); console.error('FAIL ' + name + ': ' + error.message); }
}
class Element {
  constructor(tagName='DIV') {
    this.tagName=tagName.toUpperCase(); this.children=[]; this.listeners={}; this.attrs={};
    this.dataset={}; this.values={}; this.style={setProperty:(k,v)=>{this.values[k]=v;}};
    this.className=''; this.textContent=''; this.hidden=false; this.disabled=false;
    this.classList={
      contains:c=>this.className.split(/\s+/).includes(c),
      add:c=>{if(!this.classList.contains(c))this.className+=' '+c;},
      remove:c=>{this.className=this.className.split(/\s+/).filter(x=>x!==c).join(' ');},
      toggle:(c,on)=>{if(on===undefined)on=!this.classList.contains(c);on?this.classList.add(c):this.classList.remove(c);}
    };
  }
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){
    const all=[];
    const walk=x=>{for(const child of x.children||[]){all.push(child);walk(child);}};
    walk(this);
    return all.filter(el=>{
      if(selector.startsWith('.'))return !!el.classList?.contains(selector.slice(1));
      const terms=[...selector.matchAll(/\[data-([\w-]+)="([^"]+)"\]/g)];
      return terms.length>0&&terms.every(([,k,v])=>el.dataset[k.replace(/-([a-z])/g,(_,l)=>l.toUpperCase())]===v);
    });
  }
  getBoundingClientRect(){return {left:0,top:0,width:200,height:200};}
  setPointerCapture(id){this.pointer=id;}
  fire(type,props={}){
    const e={type,button:0,pointerId:1,clientX:100,clientY:100,deltaY:0,key:'',code:'',repeat:false,
      currentTarget:this,target:this,preventDefault(){this.defaultPrevented=true;},...props};
    for(const fn of this.listeners[type]||[])fn(e);
    return e;
  }
}
const ids=['hotspots','hardware','toast','rbStatus','midiStatus','routeStatus','connectRB','routeSelector','toggleCompanion','companionPanel','samplerApps','flxAudioCheck','flxAudioStatus'];
const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
for(const key of ['rbStatus','midiStatus'])nodes[key].className='signal';
const document={getElementById:id=>nodes[id]||null,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
const window=new Element('window');
const wsInstances=[];
class WebSocketMock {
  static OPEN=1; static CONNECTING=0;
  constructor(url){this.url=url;this.readyState=0;this.sent=[];wsInstances.push(this);}
  send(payload){this.sent.push(JSON.parse(payload));}
  open(){this.readyState=1;this.onopen?.();}
  message(data){this.onmessage?.({data:JSON.stringify(data)});}
  close(){this.readyState=3;this.onclose?.();}
}
const calls=[];
const fetchMock=async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;
  calls.push({url,body});
  const response=url==='/api/status'?{ok:true,ableton_midi_available:true,rekordbox_connected:false}:
    url==='/api/samplers'?{ok:true,samplers:[]}:{ok:true};
  return {ok:true,json:async()=>response};
};
const timers=[];
vm.runInNewContext(source,{document,window,WebSocket:WebSocketMock,fetch:fetchMock,
  setTimeout:fn=>{timers.push(fn);return 1;},setInterval:()=>1,console}, {filename:'ui/app.js'});
const hotspots=nodes.hotspots.children;
const label=name=>hotspots.find(el=>el.title===name||el.getAttribute('aria-label')===name);
const commands=()=>wsInstances[0].sent.filter(c=>c.type==='control');
const last=()=>commands().at(-1);
const startCount=()=>commands().length;
async function run(){
  // Allow the initial mocked /api/status fetch to resolve before MIDI routing checks.
  for(let i=0;i<8;i++)await Promise.resolve();
function click(name){const el=label(name);assert.ok(el,'missing '+name);el.fire('click');return el;}
function pointer(name,points){
  const el=label(name);assert.ok(el,'missing '+name);
  for(const [type,x,y,id] of points)el.fire(type,{clientX:x,clientY:y,pointerId:id||1});
  return el;
}
check('hotspot catalog: transport, mixer, modes, pads, loops, FX',()=>{
  assert.ok(hotspots.length>=68,'controller is missing physical hotspots: '+hotspots.length);
  for(const deck of [1,2]){
    for(const title of ['CUE','PLAY'])assert.ok(label('Deck '+deck+' '+title));
    for(const action of ['loop_in','loop_out','four_beat','loop_half','loop_double','sync'])assert.ok(label('Deck '+deck+' '+action));
    for(const mode of ['hotcue','padfx1','beatjump','sampler'])assert.ok(label('Deck '+deck+' '+mode+' mode'));
    for(let i=1;i<=8;i++)assert.ok(label('Deck '+deck+' performance pad '+i));
    for(const band of ['high','mid','low','cfx'])assert.ok(label('Channel '+deck+' '+band));
    assert.ok(label('Deck '+deck+' jog scratch wheel'));
    assert.ok(label('Deck '+deck+' tempo'));
    assert.ok(label('Channel '+deck+' fader'));
    assert.ok(label('Deck '+deck+' SHIFT — access supported secondary pad modes'));
    assert.ok(label('Channel '+deck+' HEADPHONES CUE (not mapped)'));
    assert.ok(label('Channel '+deck+' TRIM (visual only)'));
  }
  for(const title of ['Crossfader','FX level','FX on off','FX beat up','FX beat down','Select FX (wheel or arrows)','Beat FX target: unit 1, unit 2 or both','Browse library / press to select','Browser BACK','Load deck 1','Load deck 2','Smart Fader','Smart CFX','Smart CFX select','MIC LEVEL (visual only)','HEADPHONES MIX (visual only)','HEADPHONES LEVEL (visual only)','MASTER LEVEL (visual only)','MASTER CUE (not mapped)'])assert.ok(label(title),title);
});
check('offline controls never emit WS events',()=>{click('Deck 1 PLAY');assert.equal(commands().length,0);});
wsInstances[0].open();
check('status request protocol and real application verification',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(wsInstances[0].sent[0])),{type:'status_request'});
  click('Deck 1 PLAY');assert.equal(commands().length,0);
  wsInstances[0].message({action:'controller_status',status:{rekordbox_running:true}});
  click('Deck 1 PLAY');assert.deepEqual(JSON.parse(JSON.stringify(last())),{type:'control',action:'play',deck:1});
});
check('transport and loop payloads for each deck',()=>{
  for(const deck of [1,2]){
    for(const [title,action] of [['CUE','cue'],['PLAY','play']]){click('Deck '+deck+' '+title);assert.equal(last().action,action);assert.equal(last().deck,deck);}
    for(const control of ['loop_in','loop_out','four_beat','loop_half','loop_double','sync']){click('Deck '+deck+' '+control);assert.equal(last().action,'deck_button');assert.equal(last().control,control);assert.equal(last().deck,deck);}
    click('Load deck '+deck);assert.equal(last().action,'browser_load');assert.equal(last().deck,deck);
  }
});
check('pads honor chosen deck and performance mode',()=>{
  for(const deck of [1,2])for(const mode of ['hotcue','padfx1','beatjump','sampler']){
    click('Deck '+deck+' '+mode+' mode');
    for(let index=0;index<8;index++){click('Deck '+deck+' performance pad '+(index+1));assert.deepEqual(JSON.parse(JSON.stringify(last())),{type:'control',action:'performance_pad',deck,mode,pad:index});}
  }
});
check('SHIFT + BEAT JUMP selects mapped beatloop independently for both decks',()=>{
  for(const deck of [1,2]){
    const shift=label('Deck '+deck+' SHIFT — access supported secondary pad modes');
    assert.notEqual(shift.getAttribute('aria-pressed'),'true','SHIFT should default off');
    shift.fire('click');
    assert.equal(shift.getAttribute('aria-pressed'),'true');
    click('Deck '+deck+' beatjump mode');
    for(let index=0;index<8;index++){
      click('Deck '+deck+' performance pad '+(index+1));
      assert.deepEqual(JSON.parse(JSON.stringify(last())),{type:'control',action:'performance_pad',deck,mode:'beatloop',pad:index});
    }
    shift.fire('click');
    assert.equal(shift.getAttribute('aria-pressed'),'false');
    click('Deck '+deck+' beatjump mode');
    click('Deck '+deck+' performance pad 1');
    assert.equal(last().mode,'beatjump','unshifted beat jump must revert to normal mode');
  }
});
check('knob drag, wheel, keyboard stay in 0..1 and use backend fields',()=>{
  for(const deck of [1,2])for(const band of ['high','mid','low','cfx']){
    const name='Channel '+deck+' '+band;const el=pointer(name,[['pointerdown',80,80],['pointermove',80,50],['pointerup',80,50]]);
    assert.equal(last().action,band==='cfx'?'cfx':'eq');assert.equal(last().deck,deck);
    if(band!=='cfx')assert.equal(last().band,band);
    el.fire('wheel',{deltaY:-1});el.fire('keydown',{key:'ArrowDown'});
    assert.ok(last().value>=0&&last().value<=1);
    assert.ok(el.dataset.value!==undefined);
    assert.match(String(el.values['--turn']),/^-?\d+(?:\.\d+)?deg$/,'knob visual rotation missing');
  }
  const fx=label('FX level');fx.fire('wheel',{deltaY:-1});assert.equal(last().action,'fx_level');assert.equal(last().unit,1);
  assert.match(String(fx.values['--turn']),/deg$/,'FX level knob visual rotation missing');
});
check('vertical and horizontal fader pointer positions and keys',()=>{
  for(const deck of [1,2])for(const name of ['Deck '+deck+' tempo','Channel '+deck+' fader']){
    const el=pointer(name,[['pointerdown',50,100],['pointermove',50,0],['pointerup',50,0]]);
    assert.equal(last().action,name.includes('tempo')?'tempo':'channel_fader');
    assert.equal(last().deck,deck);assert.equal(last().value,1);
    el.fire('keydown',{key:'ArrowDown'});assert.equal(last().value,.975);
    assert.equal(Number(el.values['--value']),.975,'fader thumb visual value must follow keyboard');
  }
  const cf=pointer('Crossfader',[['pointerdown',0,100],['pointermove',200,100],['pointerup',200,100]]);
  assert.equal(last().action,'crossfader');assert.equal(last().value,1);
  cf.fire('keydown',{key:'ArrowLeft'});assert.equal(last().value,.975);
  assert.equal(Number(cf.values['--value']),.975,'crossfader thumb visual value must follow keyboard');
});
check('fader click is safe and keeps slider visual value finite',()=>{
  for(const name of ['Deck 1 tempo','Deck 2 tempo','Channel 1 fader','Channel 2 fader','Crossfader']){
    const el=click(name);
    assert.ok(Number.isFinite(Number(el.values['--value'])),'no numeric fader visual value: '+name);
  }
});
check('faders ignore unrelated pointer IDs',()=>{
  for(const name of ['Deck 1 tempo','Channel 2 fader','Crossfader']){
    const el=label(name);
    el.fire('pointerdown',{pointerId:60,clientX:20,clientY:150});
    const before=commands().length,vis=el.values['--value'];
    el.fire('pointermove',{pointerId:61,clientX:190,clientY:1});
    el.fire('pointerup',{pointerId:61});
    assert.equal(commands().length,before,'unrelated pointer changed '+name);
    assert.equal(el.values['--value'],vis,'unrelated pointer shifted thumb: '+name);
    el.fire('pointermove',{pointerId:60,clientX:120,clientY:10});
    assert.equal(commands().length,before+1,'owning pointer unable to drag '+name);
    el.fire('pointerup',{pointerId:60});
  }
});
check('jog touch/rotation/release payload',()=>{
  for(const deck of [1,2]){
    pointer('Deck '+deck+' jog scratch wheel',[['pointerdown',200,100],['pointermove',100,200],['pointerup',100,200]]);
    const tail=commands().slice(-3);assert.deepEqual(tail.map(x=>x.action),['jog_touch','jog_rotate','jog_touch']);
    assert.equal(tail[0].touched,true);assert.equal(tail[2].touched,false);
    assert.equal(tail[1].deck,deck);assert.equal(tail[1].mode,'scratch');assert.ok(Math.abs(tail[1].delta)<=18);
    assert.match(String(label('Deck '+deck+' jog scratch wheel').values['--jog-angle']),/deg$/,'jog visual must rotate');
  }
});
check('jog ignores unrelated pointer motion and up',()=>{
  const deck=1,name='Deck 1 jog scratch wheel';
  const el=label(name),before=startCount();
  const initialAngle=el.values['--jog-angle'];
  el.fire('pointerdown',{pointerId:14,clientX:200,clientY:100});
  el.fire('pointermove',{pointerId:15,clientX:100,clientY:200});
  el.fire('pointerup',{pointerId:15});
  assert.deepEqual(commands().slice(before).map(x=>x.action),['jog_touch']);
  assert.equal(el.values['--jog-angle'],initialAngle,'unrelated pointer rotated jog artwork');
  el.fire('pointerup',{pointerId:14});
  assert.equal(last().action,'jog_touch');assert.equal(last().touched,false);
});
check('FX and Smart CFX overlays match photo-space physical coordinates',()=>{
  const center=(el,axis,size)=>Math.round((parseFloat(el.values[axis])+parseFloat(el.values[size])/2)*(axis==='--x'?1630:921)/100);
  const x=el=>center(el,'--x','--w');
  const y=el=>center(el,'--y','--h');
  const fx=label('Select FX (wheel or arrows)');
  const fxOn=label('FX on off'),beat=label('FX beat down'),beatUp=label('FX beat up'),level=label('FX level');
  const smart=label('Smart CFX'),smartSelect=label('Smart CFX select'),smartFader=label('Smart Fader');
  for(const item of [fx,fxOn,beat,beatUp,level,smart,smartSelect,smartFader]){
    assert.ok(item,'physical FX button missing');
  }
  for(const item of [smart,smartSelect,smartFader])
    assert.ok(x(item)>=590&&x(item)<=670,'Smart CFX family must center at x590..670: '+item.title+' x='+x(item));
  for(const item of [fx,fxOn,beat,beatUp,level])
    assert.ok(x(item)>=960&&x(item)<=1050,'Beat FX family must center at x960..1050: '+item.title+' x='+x(item));
  assert.ok(Math.abs(x(smart)-622)<=12&&Math.abs(y(smart)-477)<=12,'Smart CFX must center near (622,477)');
  assert.ok(Math.abs(x(smartSelect)-622)<=12&&Math.abs(y(smartSelect)-518)<=12,'Smart CFX select must center near (622,518)');
  assert.ok(Math.abs(x(smartFader)-622)<=12&&Math.abs(y(smartFader)-764)<=12,'Smart Fader must center near (622,764)');
  assert.ok(y(beat)>y(fx),'beat arrow should sit beneath FX selection');
  assert.ok(y(level)>y(beat),'FX level must sit below beat arrows');
  assert.ok(y(fxOn)>y(level),'FX on/off must sit below level');
  assert.ok(y(smartSelect)>y(smart),'Smart CFX select must sit below Smart CFX');
  assert.ok(y(smartFader)>y(smartSelect),'Smart Fader must sit below Smart CFX select');
});
check('browser scrolling, press, FX buttons and selector',()=>{
  const browse=label('Browse library / press to select');
  browse.fire('wheel',{deltaY:30});assert.equal(last().action,'browser_rotate');assert.equal(last().delta,1);
  browse.fire('keydown',{key:'ArrowUp'});assert.equal(last().delta,-1);
  browse.fire('click');assert.equal(last().action,'browser_press');
  click('Browser BACK');assert.equal(last().action,'browser_back');
  for(const [name,action] of [['FX beat down','fx_beat'],['FX beat up','fx_beat'],['FX on off','fx_toggle'],['Smart CFX','smart_cfx'],['Smart CFX select','smart_cfx_select'],['Smart Fader','smart_fader']]){click(name);assert.equal(last().action,action);}
  const fx=label('Select FX (wheel or arrows)');fx.fire('wheel',{deltaY:-1});assert.equal(last().action,'fx_select');assert.equal(last().direction,-1);
  const before=startCount();
  const event=fx.fire('keydown',{key:'ArrowDown'});
  assert.equal(event.defaultPrevented,true,'keyboard FX selector must intercept arrows');
  assert.equal(startCount(),before+1,'FX selector arrow must emit a new command');
  assert.equal(last().action,'fx_select');assert.equal(last().direction,-1);
  const beforeDrag=startCount();
  fx.fire('pointerdown',{pointerId:77,clientX:100,clientY:100});
  fx.fire('pointermove',{pointerId:77,clientX:100,clientY:80});
  fx.fire('pointerup',{pointerId:77});
  assert.equal(startCount(),beforeDrag+1,'dragging FX selector must emit a command');
  assert.equal(last().action,'fx_select');assert.equal(last().direction,-1);
});
check('Beat FX unit target cycles 1, 2, both and mirrors only targeted FX commands',()=>{
  const target=label('Beat FX target: unit 1, unit 2 or both');
  assert.equal(target.dataset.unit,'1');
  const testFX=(name,action,units)=>{
    const before=startCount();
    click(name);
    const events=commands().slice(before);
    assert.deepEqual(events.map(c=>c.action),units.map(()=>action),name+' actions');
    assert.deepEqual(events.map(c=>c.unit),units,name+' targets');
  };
  testFX('FX beat up','fx_beat',[1]);
  target.fire('click');assert.equal(target.dataset.unit,'2');
  testFX('FX beat down','fx_beat',[2]);
  testFX('FX on off','fx_toggle',[2]);
  target.fire('click');assert.equal(target.dataset.unit,'3');
  testFX('FX beat up','fx_beat',[1,2]);
  testFX('FX on off','fx_toggle',[1,2]);
  const before=startCount();
  label('FX level').fire('wheel',{deltaY:-1});
  assert.deepEqual(commands().slice(before).map(c=>[c.action,c.unit]),[['fx_level',1],['fx_level',2]]);
  const selector=label('Select FX (wheel or arrows)');
  const beforeSelect=startCount();selector.fire('keydown',{key:'ArrowRight'});
  assert.deepEqual(commands().slice(beforeSelect).map(c=>[c.action,c.unit,c.direction]),[['fx_select',1,1],['fx_select',2,1]]);
  target.fire('click');assert.equal(target.dataset.unit,'1','unit target must wrap to 1');
  testFX('FX beat down','fx_beat',[1]);
});
check('visual-only audio knobs and unmapped cue buttons never transmit controls or MIDI',()=>{
  const knobs=[
    'Channel 1 TRIM (visual only)','Channel 2 TRIM (visual only)',
    'MIC LEVEL (visual only)','HEADPHONES MIX (visual only)',
    'HEADPHONES LEVEL (visual only)','MASTER LEVEL (visual only)'
  ];
  for(const name of knobs){
    const el=label(name);
    assert.ok(el,name);
    assert.match(el.getAttribute('aria-description')||name,/visual|not mapped|MIDI/i);
    const before=startCount(),midiBefore=calls.filter(c=>c.url==='/api/ableton/notes').length;
    el.fire('pointerdown',{pointerId:8,clientX:70,clientY:100});
    el.fire('pointermove',{pointerId:8,clientX:70,clientY:30});
    el.fire('pointerup',{pointerId:8});
    el.fire('wheel',{deltaY:-1});
    el.fire('keydown',{key:'ArrowUp'});
    assert.equal(commands().length,before,name+' unexpectedly transmitted a Rekordbox control');
    assert.equal(calls.filter(c=>c.url==='/api/ableton/notes').length,midiBefore,name+' unexpectedly transmitted a MIDI note');
    assert.match(String(el.values['--turn']),/deg$/);
    assert.notEqual(el.values['--turn'],'0deg',name+' should turn locally');
  }
  for(const name of ['Channel 1 HEADPHONES CUE (not mapped)','Channel 2 HEADPHONES CUE (not mapped)','MASTER CUE (not mapped)']){
    const before=startCount(),midiBefore=calls.filter(c=>c.url==='/api/ableton/notes').length;
    click(name);
    assert.equal(startCount(),before,name+' should not emit a Rekordbox control');
    assert.equal(calls.filter(c=>c.url==='/api/ableton/notes').length,midiBefore,name+' should not send MIDI');
  }
});
check('keyboard shortcuts, focus safety, deck two shifted pad',()=>{
  const before=startCount();window.fire('keydown',{code:'Space',key:' ',target:new Element('INPUT')});assert.equal(startCount(),before);
  window.fire('keydown',{code:'Space',key:' '});assert.equal(last().action,'play');assert.equal(last().deck,1);
  window.fire('keydown',{code:'Enter',key:'Enter'});assert.equal(last().deck,2);
  window.fire('keydown',{key:'3',code:'Digit3',shiftKey:true});assert.equal(last().action,'performance_pad');assert.equal(last().deck,2);assert.equal(last().pad,2);
});
check('sampler pad MIDI routes and note payloads',()=>{
  const route=nodes.routeSelector;
  for(const [name,ch,note] of [['maschine',0,36],['vintage',1,36],['asr10',2,60]]){
    route.value=name;route.fire('change');
    const before=commands().length;
    click('Deck 1 performance pad 1');
    assert.equal(commands().length,before);
    const sent=calls.filter(call=>call.url==='/api/ableton/notes').at(-1);assert.ok(sent,'MIDI request absent');
    assert.equal(sent.body.channel,ch);assert.equal(sent.body.note,note);
    assert.equal(sent.body.velocity,110);
  }
});
check('TRIM indicates visual-only operation',()=>{
  for(const deck of [1,2])assert.match(label('Channel '+deck+' TRIM (visual only)').getAttribute('aria-description'),/visually adjustable|no verified/i);
});
console.log('\n'+passes+' passed, '+failures.length+' failed');
if(failures.length)process.exitCode=1;
}
run().catch(error=>{console.error(error);process.exitCode=1;});
