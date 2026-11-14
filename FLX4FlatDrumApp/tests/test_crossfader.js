// Deterministic regression test of crossfader drag/orientation, without a DJ device.
// Run: node FLX4FlatDrumApp/tests/test_crossfader.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname,'../ui/app.js'),'utf8');
const start = script.indexOf('  function fader(');
const end = script.indexOf('  function jog(',start);
assert.ok(start>=0 && end>start, 'Cannot locate the real fader implementation');
const sends=[];
let last;
const source=script.slice(start,end)+'\nfader;';
const fader=vm.runInNewContext(source,{
  clamp:n=>Math.max(0,Math.min(1,n)),
  control:(name,data)=>sends.push({name,data}),
  hit:(_label,_x,_y,_w,_h,_kind,_click,data)=>{
    const handlers={};
    const props={};
    last={handlers,props,attributes:{},dataset:{...data},style:{
      setProperty:(key,value)=>{props[key]=value;}
    },setAttribute:(key,value)=>{last.attributes[key]=value;},
    addEventListener:(key,cb)=>{handlers[key]=cb;},
    getBoundingClientRect:()=>({left:100,top:100,width:200,height:82}),
    setPointerCapture:()=>{}};
    return last;
  }
});
const cross=fader('Crossfader',815,862,196,82,'crossfader',{},true);
assert.equal(cross.dataset.orientation,'horizontal');
assert.equal(cross.attributes['aria-orientation'],'horizontal');
assert.equal(cross.props['--thumb-position'],'50%');
const pointer=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
cross.handlers.pointerdown(pointer(118,125));
assert.equal(sends.at(-1).data.value,0,'leftmost crossfader value');
assert.equal(cross.props['--thumb-position'],'9%');
cross.handlers.pointermove(pointer(264,890));
const val=sends.at(-1).data.value;
assert.ok(val>.88 && val<.90,'horizontal drag updates even when moving vertically');
assert.ok(Number(cross.props['--thumb-position'].replace('%',''))>81);
const before=sends.length;
cross.handlers.keydown({key:'ArrowUp',preventDefault(){}});
cross.handlers.keydown({key:'ArrowDown',preventDefault(){}});
assert.equal(sends.length,before,'up/down keys must not move horizontal crossfader');
cross.handlers.keydown({key:'ArrowLeft',preventDefault(){}});
assert.ok(sends.at(-1).data.value<val,'left arrow decreases crossfader');
cross.handlers.keydown({key:'End',preventDefault(){}});
assert.equal(sends.at(-1).data.value,1);
assert.equal(cross.props['--thumb-position'],'91%');
cross.handlers.keydown({key:'Home',preventDefault(){}});
assert.equal(sends.at(-1).data.value,0);
assert.equal(cross.props['--thumb-position'],'9%');
const vertical=fader('Channel fader',0,0,30,160,'channel_fader',{deck:1},false);
assert.equal(vertical.dataset.orientation,'vertical');
assert.equal(vertical.attributes['aria-orientation'],'vertical');
vertical.handlers.pointerdown(pointer(200,120));
assert.ok(sends.at(-1).data.value>.70);
console.log('PASS: horizontal crossfader pointer/keyboard/track; vertical channel faders unchanged');
