/* Photo-aligned, fully flat DDJ-FLX4 live controller. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const layer = $('hotspots');
  if (!layer || !$('hardware')) return;
  const W=1630,H=921, url='ws://127.0.0.1:18765';
  const state={ws:null,running:false,midi:false,route:'rekordbox',
    mode:{1:'hotcue',2:'hotcue'},shift:{1:false,2:false},fxUnit:1};
  const clamp=n=>Math.max(0,Math.min(1,n));
  const inform=s=>{if($('toast'))$('toast').textContent=s;};
  function status(id,message,ok){const el=$(id);if(!el)return;
    // Retain the physical status LED when changing its text; replacing the
    // entire contents would erase the dot on first connection check.
    if(el.classList.contains('signal')){const led=el.querySelector('.signal-dot')||document.createElement('span');led.className='signal-dot';led.setAttribute('aria-hidden','true');el.replaceChildren(led,document.createTextNode(message));}
    else el.textContent=message;
    el.classList.toggle('good',ok);el.classList.toggle('offline',!ok);}
  function redrawStatus(){
    const live=state.running&&state.ws?.readyState===WebSocket.OPEN;
    status('rbStatus',live?'REKORDBOX · ONLINE':state.ws?.readyState===WebSocket.OPEN?'BRIDGE LIVE / REKORDBOX OFFLINE':'REKORDBOX · OFFLINE',!!live);
    status('midiStatus',state.midi?'MIDI OUTPUT · READY':'MIDI OUTPUT · OFFLINE',state.midi);
    status('routeStatus',state.route==='rekordbox'?(live?'Rekordbox control ready':'Rekordbox unavailable'):(state.midi?'MIDI output available; select your sampler input':'MIDI unavailable'),state.route==='rekordbox'?!!live:state.midi);
  }
  function control(action,payload={}){
    if(!state.running||state.ws?.readyState!==WebSocket.OPEN){inform('Rekordbox offline or unverified; command not sent.');return false;}
    state.ws.send(JSON.stringify({type:'control',action,...payload}));return true;
  }
  function fxControl(action,payload={}){
    // The physical FLX4 has a 1 / 2 / 1&2 Beat FX assignment switch.
    // On 1&2 send matching verified MIDI commands to both supported units.
    const units=state.fxUnit===3?[1,2]:[state.fxUnit];
    let sent=false;
    for(const unit of units)sent=control(action,{...payload,unit})||sent;
    return sent;
  }
  async function api(path,body){
    const res=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false)throw new Error(data.error||'HTTP '+res.status);
    return data;
  }
  async function refreshStatus(){
    try{const data=await api('/api/status');state.midi=data.ableton_midi_available===true;
      if(data.rekordbox_connected&&state.ws?.readyState!==WebSocket.OPEN)connect();
    }catch{state.midi=false;}redrawStatus();
  }
  function connect(){
    if(state.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(state.ws.readyState))return;
    const ws=new WebSocket(url);state.ws=ws;
    ws.onopen=()=>{state.running=false;redrawStatus();ws.send(JSON.stringify({type:'status_request'}));};
    ws.onmessage=event=>{try{const data=JSON.parse(event.data);
      if(data.action==='controller_status'||data.type==='controller_status'){
        state.running=data.status?.rekordbox_running===true;redrawStatus();
      }
    }catch{/* ignore unrelated runtime events */}};
    ws.onclose=()=>{if(state.ws!==ws)return;state.running=false;redrawStatus();setTimeout(connect,2500);};
    ws.onerror=()=>ws.close();
  }
  function flash(el){el.classList.add('fired');setTimeout(()=>el.classList.remove('fired'),140);}
  function hit(label,x,y,w,h,kind,click,data={}){
    const el=document.createElement('button');el.type='button';el.className='hotspot '+kind;
    el.title=label;el.setAttribute('aria-label',label);
    for(const [k,v] of Object.entries(data))el.dataset[k]=String(v);
    for(const [key,value] of Object.entries({'--x':(x-w/2)/W*100+'%','--y':(y-h/2)/H*100+'%','--w':w/W*100+'%','--h':h/H*100+'%'}))el.style.setProperty(key,value);
    if(click)el.addEventListener('click',()=>{click(el);flash(el);});
    layer.append(el);return el;
  }
  const btn=(label,x,y,w,h,action,payload={})=>hit(label,x,y,w,h,'',()=>control(action,payload));
  function drag(el,onMove){
    let last=null;
    el.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;ev.preventDefault();last={id:ev.pointerId,x:ev.clientX,y:ev.clientY};el.setPointerCapture(ev.pointerId);});
    el.addEventListener('pointermove',ev=>{if(!last||last.id!==ev.pointerId)return;
      const dx=ev.clientX-last.x,dy=ev.clientY-last.y;last.x=ev.clientX;last.y=ev.clientY;
      if(Math.abs(dx)+Math.abs(dy)>0)onMove(dx,dy,ev);
    });
    const end=ev=>{if(last?.id===ev.pointerId)last=null;};
    el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);el.addEventListener('lostpointercapture',end);
  }
  function knob(label,x,y,action,payload={},r=24){
    let value=.5;const el=hit(label,x,y,r*2,r*2,'knob-hotspot',null);
    el.setAttribute('role','slider');el.setAttribute('aria-orientation','vertical');
    el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax','100');
    const change=n=>{
      value=clamp(n);el.dataset.value=value.toFixed(3);
      el.style.setProperty('--turn',(value-.5)*270+'deg');
      el.setAttribute('aria-valuenow',Math.round(value*100));
      if(action==='fx_level')fxControl(action,{value});
      else if(action)control(action,{...payload,value});
      else inform(label+' moves locally; no verified rekordbox MIDI mapping for this control.');
    };
    el.dataset.value='0.500';
    el.style.setProperty('--turn','0deg');
    el.setAttribute('aria-valuenow','50');
    drag(el,(_dx,dy)=>change(value-dy/150));
    el.addEventListener('wheel',ev=>{ev.preventDefault();change(value+(ev.deltaY<0?.025:-.025));},{passive:false});
    el.addEventListener('keydown',ev=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key))return;ev.preventDefault();change(value+(['ArrowUp','ArrowRight'].includes(ev.key)?.025:-.025));});
    return el;
  }
  function fader(label,x,y,w,h,action,payload={},horizontal=false){
    let value=action==='channel_fader'?.78:.5,active=null;
    const el=hit(label,x,y,w,h,'fader-hotspot',null,{orientation:horizontal?'horizontal':'vertical'});
    el.setAttribute('role','slider');el.setAttribute('aria-orientation',horizontal?'horizontal':'vertical');
    el.setAttribute('aria-valuemin','0');el.setAttribute('aria-valuemax','100');
    const update=v=>{value=clamp(v);el.dataset.value=value.toFixed(3);el.style.setProperty('--value',value);
      el.style.setProperty('--thumb-position',(horizontal?9+82*value:10+80*(1-value))+'%');
      el.setAttribute('aria-valuenow',Math.round(value*100));control(action,{...payload,value});};
    el.dataset.value=value.toFixed(3);
    el.style.setProperty('--value',String(value));
    el.style.setProperty('--thumb-position',(horizontal?9+82*value:10+80*(1-value))+'%');
    el.setAttribute('aria-valuenow',Math.round(value*100));
    const position=ev=>{
      const r=el.getBoundingClientRect();
      // The single movable thumb travels inside the track's 10–90% travel
      // (9–91% on the crossfader). Mouse position and visual cap match.
      update(horizontal?(ev.clientX-r.left-r.width*.09)/(r.width*.82)
        :1-(ev.clientY-r.top-r.height*.10)/(r.height*.80));
    };
    el.addEventListener('pointerdown',ev=>{if(ev.button!==0)return;ev.preventDefault();active=ev.pointerId;el.setPointerCapture(active);position(ev);});
    el.addEventListener('pointermove',ev=>{if(active===ev.pointerId)position(ev);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,ev=>{if(active===ev.pointerId)active=null;});
    el.addEventListener('keydown',ev=>{
      const keys=horizontal?['ArrowLeft','ArrowRight','Home','End']:['ArrowUp','ArrowDown','Home','End'];
      if(!keys.includes(ev.key))return;
      ev.preventDefault();
      update(ev.key==='Home'?0:ev.key==='End'?1:value+(['ArrowUp','ArrowRight'].includes(ev.key)?.025:-.025));
    });
    if(!horizontal)el.addEventListener('wheel',ev=>{ev.preventDefault();update(value+(ev.deltaY<0?.02:-.02));},{passive:false});
    return el;
  }
  function jog(deck,x,y){
    const el=hit('Deck '+deck+' jog scratch wheel',x,y,444,444,'jog-hotspot',null,{deck});
    let angle=null,pointer=null,rotation=0;
    const rotate=degrees=>{
      rotation=(rotation+degrees)%360;
      el.style.setProperty('--jog-angle',rotation+'deg');
      el.dataset.rotation=rotation.toFixed(2);
      el.setAttribute('aria-valuenow',String(Math.round(((rotation+540)%360)-180)));
    };
    el.style.setProperty('--jog-angle','0deg');
    el.setAttribute('role','slider');
    el.setAttribute('aria-valuemin','-180');
    el.setAttribute('aria-valuemax','180');
    el.setAttribute('aria-valuenow','0');
    const angleAt=ev=>{const r=el.getBoundingClientRect();return Math.atan2(ev.clientY-r.top-r.height/2,ev.clientX-r.left-r.width/2);};
    el.addEventListener('pointerdown',ev=>{
      if(ev.button!==0||pointer!==null)return;
      ev.preventDefault();pointer=ev.pointerId;angle=angleAt(ev);
      el.classList.add('pressed');el.setPointerCapture(pointer);
      control('jog_touch',{deck,touched:true});
    });
    el.addEventListener('pointermove',ev=>{
      if(angle===null||ev.pointerId!==pointer)return;
      const next=angleAt(ev);let diff=next-angle;
      while(diff>Math.PI)diff-=2*Math.PI;
      while(diff< -Math.PI)diff+=2*Math.PI;
      angle=next;rotate(diff*180/Math.PI);
      const delta=Math.max(-18,Math.min(18,Math.round(diff*34)));
      if(delta)control('jog_rotate',{deck,mode:'scratch',delta});
    });
    const release=ev=>{
      if(pointer===null||ev.pointerId!==pointer)return;
      pointer=null;angle=null;el.classList.remove('pressed');
      control('jog_touch',{deck,touched:false});
    };
    for(const type of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(type,release);
    el.addEventListener('keydown',ev=>{
      if(!['ArrowLeft','ArrowRight'].includes(ev.key))return;
      ev.preventDefault();const delta=ev.key==='ArrowRight'?5:-5;
      rotate(delta*2.4);control('jog_rotate',{deck,mode:'scratch',delta});
    });
    el.addEventListener('wheel',ev=>{
      ev.preventDefault();const delta=ev.deltaY>0?-3:3;
      rotate(delta*2.2);control('jog_rotate',{deck,mode:'pitch',delta});
    },{passive:false});
  }
  async function pad(deck,index,el){
    if(state.route==='rekordbox')return control('performance_pad',{deck,mode:state.mode[deck],pad:index});
    if(!state.midi){inform('Companion MIDI output unavailable.');return;}
    const channel={maschine:0,vintage:1,asr10:2}[state.route];
    if(channel===undefined)return;
    const note=(state.route==='asr10'?60:36)+(deck-1)*8+index;
    try{await api('/api/ableton/notes',{note,channel,velocity:110,duration_ms:400});inform('MIDI '+note+' sent to '+state.route.toUpperCase()+' route (channel '+(channel+1)+').');}
    catch(error){inform('MIDI failed: '+error.message);}
  }
  function build(){
    for(const deck of [1,2]){
      const left=deck===1;
      const coords=left?[[77,108],[163,108],[250,110],[487,111]]:[[1142,108],[1230,108],[1312,109],[1552,109]];
      ['loop_in','loop_out','four_beat','sync'].forEach((name,i)=>btn('Deck '+deck+' '+name,...coords[i],65,47,'deck_button',{deck,control:name}));
      // Physical CUE/LOOP CALL previous/next arrows have working half/double
      // loop commands in the existing verified rekordbox MIDI mapping.
      const loopX=left?[336,406]:[1407,1478];
      btn('Deck '+deck+' loop_half',loopX[0],109,43,40,'deck_button',{deck,control:'loop_half'});
      btn('Deck '+deck+' loop_double',loopX[1],109,43,40,'deck_button',{deck,control:'loop_double'});
      jog(deck,left?277:1349,384);
      btn('Deck '+deck+' CUE',left?77:1140,720,78,66,'cue',{deck});
      btn('Deck '+deck+' PLAY',left?77:1140,left?827:825,80,72,'play',{deck});
      hit('Deck '+deck+' SHIFT — access supported secondary pad modes',
        left?77:1140,635,43,41,'mode-hotspot',el=>{
          state.shift[deck]=!state.shift[deck];
          el.classList.toggle('selected',state.shift[deck]);
          el.setAttribute('aria-pressed',String(state.shift[deck]));
          inform('Deck '+deck+' SHIFT '+(state.shift[deck]?'ON: choose BEAT JUMP for BEAT LOOP':'OFF')+'.');
        });
      fader('Deck '+deck+' tempo',left?487:1554,736,43,180,'tempo',{deck});
      const xs=left?[170,246,320,394]:[1236,1311,1385,1459];
      for(let i=0;i<8;i++)hit('Deck '+deck+' performance pad '+(i+1),xs[i%4],i<4?758:834,67,60,'pad-hotspot',el=>pad(deck,i,el),{deck,pad:i});
      ['hotcue','padfx1','beatjump','sampler'].forEach((mode,i)=>{
        const modeButton=hit('Deck '+deck+' '+mode+' mode',xs[i],680,59,32,'mode-hotspot',el=>{
          const target=state.shift[deck]&&mode==='beatjump'?'beatloop':mode;
          state.mode[deck]=target;
          layer.querySelectorAll('[data-mode-deck="'+deck+'"]').forEach(node=>{
            const selected=node===el;
            node.classList.toggle('selected',selected);
            node.setAttribute('aria-pressed',String(selected));
          });
          inform('Deck '+deck+': '+target.toUpperCase()+' pads '+(target==='beatloop'?'(SHIFT+BEAT JUMP)':'')+'.');
        },{modeDeck:deck,mode});
        const selected=mode==='hotcue';
        modeButton.classList.toggle('selected',selected);
        modeButton.setAttribute('aria-pressed',String(selected));
      });
      const x=left?747:880;
      for(const [label,y] of [['high',227],['mid',310],['low',394],['cfx',477]]){
        const action=label==='high'||label==='mid'||label==='low'?'eq':label;
        knob('Channel '+deck+' '+label,x,y,action,action==='eq'?{deck,band:label}:{deck});
      }
      // These real hardware controls have no proven counterpart in the
      // installed virtual MIDI map. They turn and respond locally, but never
      // send a guessed audio command to rekordbox.
      const trim=knob('Channel '+deck+' TRIM (visual only)',x,145,null,{deck});
      trim.title='TRIM turns locally; no verified rekordbox MIDI assignment';
      trim.setAttribute('aria-description','Visually adjustable only. No verified TRIM MIDI mapping.');
      hit('Channel '+deck+' HEADPHONES CUE (not mapped)',x,562,50,36,'',()=>{
        inform('Channel '+deck+' headphone CUE needs MIDI Learn in rekordbox; no command sent.');
      });
      fader('Channel '+deck+' fader',x,696,42,158,'channel_fader',{deck});
    }
    btn('Load deck 1',706,77,58,42,'browser_load',{deck:1});
    btn('Load deck 2',925,77,58,42,'browser_load',{deck:2});
    btn('Browser BACK',815,124,54,23,'browser_back');
    const browse=hit('Browse library / press to select',815,75,52,65,'knob-hotspot',null);
    let moved=false,suppress=false;
    browse.addEventListener('pointerdown',()=>{moved=false;});
    drag(browse,(_dx,dy)=>{if(Math.abs(dy)<1)return;moved=true;control('browser_rotate',{delta:dy>0?1:-1});});
    browse.addEventListener('click',()=>{if(!moved&&!suppress)control('browser_press');suppress=false;});
    browse.addEventListener('wheel',ev=>{ev.preventDefault();control('browser_rotate',{delta:ev.deltaY>0?1:-1});},{passive:false});
    browse.addEventListener('keydown',ev=>{if(['ArrowUp','ArrowDown'].includes(ev.key)){ev.preventDefault();control('browser_rotate',{delta:ev.key==='ArrowDown'?1:-1});}});
    // Respond to photo-visible mic, monitor and master knobs without
    // pretending to change the system audio device or rekordbox's master.
    for(const [name,x,y] of [
      ['MIC LEVEL (visual only)',622,311],
      ['HEADPHONES MIX (visual only)',622,575],
      ['HEADPHONES LEVEL (visual only)',622,664],
      ['MASTER LEVEL (visual only)',1007,145]
    ])knob(name,x,y,null);
    hit('MASTER CUE (not mapped)',1007,228,55,29,'',()=>{
      inform('MASTER CUE is not mapped in the current virtual rekordbox MIDI controller.');
    });
    fader('Crossfader',815,862,196,82,'crossfader',{},true);
    const fxUnit=hit('Beat FX target: unit 1, unit 2 or both',1007,393,64,42,'mode-hotspot',el=>{
      state.fxUnit=state.fxUnit===3?1:state.fxUnit+1;
      const label=state.fxUnit===3?'1 + 2':String(state.fxUnit);
      el.dataset.unit=String(state.fxUnit);
      el.setAttribute('aria-label','Beat FX target '+label);
      el.setAttribute('aria-pressed',String(state.fxUnit!==1));
      el.classList.toggle('selected',state.fxUnit!==1);
      inform('BEAT FX now assigned to deck '+label+'.');
    });
    fxUnit.dataset.unit='1';
    let movedFX=false;
    const fxSelector=hit('Select FX (wheel or arrows)',1007,478,55,56,'knob-hotspot',null);
    fxSelector.addEventListener('pointerdown',()=>{movedFX=false;});
    fxSelector.addEventListener('click',()=>{if(!movedFX)fxControl('fx_select',{direction:1});flash(fxSelector);});
    drag(fxSelector,(_dx,dy)=>{if(Math.abs(dy)>1){movedFX=true;fxControl('fx_select',{direction:dy>0?1:-1});}});
    fxSelector.addEventListener('wheel',ev=>{ev.preventDefault();fxControl('fx_select',{direction:ev.deltaY>0?1:-1});},{passive:false});
    fxSelector.addEventListener('keydown',ev=>{
      if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(ev.key))return;
      ev.preventDefault();
      fxControl('fx_select',{direction:['ArrowUp','ArrowRight'].includes(ev.key)?1:-1});
    });
    hit('FX beat down',982,562,36,38,'',()=>fxControl('fx_beat',{direction:-1}));
    hit('FX beat up',1032,562,36,38,'',()=>fxControl('fx_beat',{direction:1}));
    knob('FX level',1007,665,'fx_level',{unit:1},29);
    hit('FX on off',1007,762,64,48,'',()=>fxControl('fx_toggle'));
    // These three buttons are on the left edge of the centre mixer strip.
    // The earlier approximate coordinates sat on top of EQ knobs/faders.
    btn('Smart CFX',622,477,48,48,'smart_cfx');
    btn('Smart CFX select',622,518,48,24,'smart_cfx_select');
    btn('Smart Fader',622,764,48,48,'smart_fader');
  }
  async function samplers(){
    const root=$('samplerApps');if(!root)return;
    try{const data=await api('/api/samplers');root.replaceChildren();
      for(const app of data.samplers||[]){
        const b=document.createElement('button');b.type='button';b.className='sampler-app';
        b.textContent=app.name+' · '+(app.running?'RUNNING':app.installed?'OPEN':'NOT INSTALLED');b.disabled=!app.installed;
        b.addEventListener('click',async()=>{b.disabled=true;try{await api('/api/samplers/open',{id:app.id});inform('Opened '+app.name);await samplers();}catch(error){inform('Open failed: '+error.message);}finally{b.disabled=false;}});
        root.append(b);
      }
    }catch(error){root.textContent='Sampler status unavailable: '+error.message;}
  }
  function bind(){
    $('connectRB')?.addEventListener('click',async ev=>{ev.currentTarget.disabled=true;
      try{await api('/api/rekordbox/connect',{});connect();inform('Runtime requested; checking actual Rekordbox application status.');await refreshStatus();}
      catch(error){inform('Connection failed: '+error.message);}finally{ev.currentTarget.disabled=false;}
    });
    const sel=$('routeSelector');if(sel){sel.value='rekordbox';sel.addEventListener('change',()=>{if(!['rekordbox','maschine','vintage','asr10'].includes(sel.value))return;state.route=sel.value;redrawStatus();inform('Pads routed to '+sel.value.toUpperCase());});}
    $('toggleCompanion')?.addEventListener('click',()=>{
      const panel=$('companionPanel');if(!panel)return;
      panel.hidden=!panel.hidden;$('toggleCompanion').setAttribute('aria-expanded',String(!panel.hidden));
      if(!panel.hidden)samplers();
    });
    $('flxAudioCheck')?.addEventListener('click',async()=>{
      try{const data=await api('/api/audio-devices');const names=Array.isArray(data.device_names)?data.device_names:[];
        const detected=data.ddj_flx4_present===true;
        status('flxAudioStatus',detected?'DDJ-FLX4 audio detected. Choose your preferred output in Ableton, rekordbox or the sampler.':'FLX4 audio not detected. '+(names.length?('Available devices: '+names.slice(0,5).join(', ')):data.guidance||'Check connection and audio settings.'),detected);
      }catch(error){status('flxAudioStatus','Audio inventory unavailable: '+error.message,false);}
    });
    window.addEventListener('keydown',ev=>{
      if(ev.repeat||ev.metaKey||ev.ctrlKey||ev.altKey||ev.target?.isContentEditable||['INPUT','SELECT','TEXTAREA'].includes(ev.target?.tagName))return;
      const keys={Space:['play',{deck:1}],KeyQ:['cue',{deck:1}],Enter:['play',{deck:2}],KeyP:['cue',{deck:2}]};
      if(keys[ev.code]){ev.preventDefault();control(...keys[ev.code]);return;}
      if(/^[1-8]$/.test(ev.key)){ev.preventDefault();const deck=ev.shiftKey?2:1,p=Number(ev.key)-1;const el=layer.querySelector('[data-deck="'+deck+'"][data-pad="'+p+'"]');if(el){flash(el);pad(deck,p,el);}}
    });
  }
  build();bind();redrawStatus();connect();refreshStatus();samplers();
  setInterval(refreshStatus,10000);
  setInterval(()=>{if(state.ws?.readyState===WebSocket.OPEN)state.ws.send(JSON.stringify({type:'status_request'}));},3000);
})();
