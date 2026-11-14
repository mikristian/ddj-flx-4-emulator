/* FLX4 LIVE: standalone frontend; all audio playback stays inside the browser. */
(() => {
  "use strict";
  const $ = (selector,root=document) => root.querySelector(selector);
  const $$ = (selector,root=document) => [...root.querySelectorAll(selector)];
  const endpoint = "ws://127.0.0.1:18765";
  const demoFiles = [
    "01_kick.wav","02_kick_punch.wav","03_snare.wav","04_snare_tight.wav",
    "05_clap.wav","06_hat_closed.wav","07_hat_open.wav","08_shaker.wav",
    "09_rim.wav","10_tom_low.wav","11_tom_mid.wav","12_tom_high.wav",
    "13_cowbell.wav","14_crash.wav","15_bongo.wav","16_stab.wav"
  ];
  const samples = Array.from({length:16},() => ({name:"EMPTY SLOT",blob:null,buffer:null,volume:0.8,sources:new Set()}));
  const modes = {1:"hotcue",2:"hotcue"};
  let ws, reconnectTimer, statusTimer, audio, fxUnit=1, database, rekordboxRunning=false;
  const output = $("#audioOutput");
  const log = message => { $("#toast").textContent=message; };
  function signal(id,good,text) {
    const el=$("#"+id); el.classList.toggle("good",Boolean(good));el.classList.toggle("pending",good===null);
    el.lastChild.textContent=text;
  }
  function sendControl(action,payload={}) {
    if (!ws || ws.readyState!==WebSocket.OPEN) { log("Rekordbox control unavailable. Use CONNECT REKORDBOX to start its bridge."); return false; }
    if (!rekordboxRunning) { log("Rekordbox app is offline or unverified. Control was not sent."); return false; }
    ws.send(JSON.stringify({type:"control",action,...payload}));
    return true;
  }
  function showRekordboxStatus(running) {
    rekordboxRunning=running===true;
    const live=ws?.readyState===WebSocket.OPEN;
    signal("rbStatus",live&&rekordboxRunning,live?(rekordboxRunning?"REKORDBOX · ONLINE":"BRIDGE LIVE / REKORDBOX OFFLINE"):"REKORDBOX · OFFLINE");
    $("#rbDetail").textContent=live?(rekordboxRunning?"App running · control bridge connected":"Bridge connected · Rekordbox app offline or unverified"):"WebSocket disconnected · port 18765";
  }
  function connectSocket() {
    if(ws && (ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING)) return;
    ws=new WebSocket(endpoint);
    ws.addEventListener("open",()=>{
      showRekordboxStatus(false);
      ws.send(JSON.stringify({type:"status_request"}));
      clearInterval(statusTimer);
      statusTimer=setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"status_request"}));},3000);
    });
    ws.addEventListener("message",event=>{
      try {
        const message=JSON.parse(event.data);
        if(message.action==="controller_status") showRekordboxStatus(message.status?.rekordbox_running===true);
        const deck=Number(message.deck);
        if ((deck===1||deck===2) && typeof message.title==="string")
          $("#deck"+deck+"Label").textContent=message.title.slice(0,35);
      } catch {/* ignore unrecognized runtime messages */}
    });
    ws.addEventListener("close",()=>{
      showRekordboxStatus(false);
      clearInterval(statusTimer);
      clearTimeout(reconnectTimer);
      reconnectTimer=setTimeout(connectSocket,2000);
    });
    ws.addEventListener("error",()=>ws.close());
  }
  async function status() {
    try {
      const response=await fetch("/api/status",{cache:"no-store"});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const state=await response.json();
      const midi=Boolean(state.ableton_midi_available ?? state.midi?.available);
      const port=state.ableton_midi_port||state.midi?.port||"";
      signal("midiStatus",midi,midi?"ABLETON MIDI · READY":"ABLETON MIDI · OFFLINE");
      $("#midiDetail").textContent=midi?(port||"Available virtual MIDI port"):(state.ableton_midi_error||state.midi?.detail||"No available MIDI output");
      if(midi) $("#enableMidi").disabled=false;
      if(state.rekordbox_connected && (!ws||ws.readyState===WebSocket.CLOSED)) connectSocket();
    }catch(error) {
      signal("midiStatus",false,"ABLETON MIDI · OFFLINE");
      $("#midiDetail").textContent="Bridge API offline: "+error.message;
    }
  }
  async function bridgePost(path,body={}) {
    const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!response.ok) throw new Error("Bridge returned "+response.status);
    return response.json();
  }
  $("#connectRB").addEventListener("click",async()=>{
    $("#connectRB").disabled=true;
    try { await bridgePost("/api/rekordbox/connect");log("Runtime connection requested. Waiting for Rekordbox application status.");connectSocket();await status(); }
    catch(error){log("Unable to launch Rekordbox control: "+error.message);}
    finally{$("#connectRB").disabled=false;}
  });
  function flash(el) {el.classList.add("fired");setTimeout(()=>el.classList.remove("fired"),130);}
  function renderChannel(deck) {
    const node=$('[data-mix-channel="'+deck+'"]');
    node.innerHTML='<strong>CH '+deck+'</strong>'+
      ["high","mid","low"].map(band=>'<label>'+band.toUpperCase()+'<input type="range" min="0" max="1" step=".001" value=".5" data-action="eq" data-band="'+band+'" data-deck="'+deck+'" aria-label="Channel '+deck+' '+band+' EQ"></label>').join("")+
      '<label>CFX<input type="range" min="0" max="1" step=".001" value=".5" data-action="cfx" data-deck="'+deck+'" aria-label="Channel '+deck+' color FX"></label>'+
      '<label class="fader">CH FADER<input type="range" min="0" max="1" step=".001" value=".78" data-action="channel_fader" data-deck="'+deck+'" aria-label="Channel '+deck+' fader"></label>';
  }
  renderChannel(1);renderChannel(2);
  function renderPads() {
    for(const deck of [1,2]) {
      const target=$("#pads"+deck), mode=modes[deck];
      target.replaceChildren();
      for(let pad=0;pad<8;pad++){
        const slot=(deck-1)*8+pad;
        const item=document.createElement("button");
        item.className="pad"+(mode==="drums"?" drum":"")+(mode==="drums"&&samples[slot].blob?" loaded":"");
        item.setAttribute("aria-label",mode==="drums"?"Play local sample "+(slot+1):"Deck "+deck+" "+mode+" pad "+(pad+1));
        const first=document.createElement("span"),second=document.createElement("span");
        first.className="number";first.textContent=String(pad+1).padStart(2,"0");
        second.className="pad-title";second.textContent=mode==="drums"?samples[slot].name:mode.toUpperCase();
        item.append(first,second);
        item.addEventListener("click",()=>{flash(item);if(mode==="drums")playSample(slot);else sendControl("performance_pad",{deck,mode,pad});});
        target.append(item);
      }
      $$('.modes[data-modes="'+deck+'"] button').forEach(button=>button.classList.toggle("selected",button.dataset.mode===mode));
    }
  }
  $$(".modes button").forEach(button=>button.addEventListener("click",()=>{
    modes[Number(button.closest(".modes").dataset.modes)]=button.dataset.mode;renderPads();
    log(button.dataset.mode==="drums"?"DRUMS mode: local audio on pads, optional Ableton MIDI.":"Rekordbox "+button.dataset.mode.toUpperCase()+" performance pad mode.");
  }));
  // Native browser range inputs send only normalized values supported by the runtime.
  let rangeQueue=new Map(),rangeFrame=0;
  function flushRanges(){
    for(const {action,payload} of rangeQueue.values()) sendControl(action,payload);
    rangeQueue.clear();rangeFrame=0;
  }
  document.addEventListener("input",event=>{
    const el=event.target;if(!(el instanceof HTMLInputElement)||!el.dataset.action)return;
    const action=el.dataset.action;
    const payload={value:Number(el.value)};
    if(el.dataset.deck)payload.deck=Number(el.dataset.deck);
    if(el.dataset.band)payload.band=el.dataset.band;
    if(action==="fx_level")payload.unit=fxUnit;
    rangeQueue.set(action+":"+(payload.deck||0)+":"+(payload.band||""),{action,payload});
    if(!rangeFrame)rangeFrame=requestAnimationFrame(flushRanges);
  });
  document.addEventListener("change",event=>{
    const el=event.target;
    if(el instanceof HTMLInputElement&&el.dataset.action) {
      const payload={value:Number(el.value)};
      if(el.dataset.deck)payload.deck=Number(el.dataset.deck);
      if(el.dataset.band)payload.band=el.dataset.band;
      if(el.dataset.action==="fx_level")payload.unit=fxUnit;
      sendControl(el.dataset.action,payload);
    }
  });
  $$("button[data-action]").forEach(button=>button.addEventListener("click",()=>{
    const action=button.dataset.action,payload={};
    if(button.dataset.deck)payload.deck=Number(button.dataset.deck);
    if(button.dataset.control)payload.control=button.dataset.control;
    if(button.dataset.direction)payload.direction=Number(button.dataset.direction);
    if(action.startsWith("fx_"))payload.unit=fxUnit;
    sendControl(action,payload);flash(button);
  }));
  $$("[data-fxunit]").forEach(button=>button.addEventListener("click",()=>{
    fxUnit=Number(button.dataset.fxunit);$$("[data-fxunit]").forEach(item=>item.classList.toggle("selected",item===button));
  }));
  const browse=$("#browseKnob");
  browse.addEventListener("wheel",event=>{event.preventDefault();sendControl("browser_rotate",{delta:event.deltaY>0?1:-1});},{passive:false});
  let suppressBrowseClick=false;
  browse.addEventListener("click",()=>{
    if(suppressBrowseClick){suppressBrowseClick=false;return;}
    sendControl("browser_press");
  });
  browse.addEventListener("keydown",event=>{
    if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();sendControl("browser_rotate",{delta:event.key==="ArrowDown"?1:-1});}
    else if(event.key==="Enter"||event.key===" "){event.preventDefault();sendControl("browser_press");}
  });
  let browseStart=null;
  browse.addEventListener("pointerdown",event=>{browseStart={y:event.clientY,lastY:event.clientY,moved:false};});
  browse.addEventListener("pointermove",event=>{
    if(!browseStart||event.buttons!==1)return;
    const offset=event.clientY-browseStart.lastY;
    if(Math.abs(offset)>=7){sendControl("browser_rotate",{delta:offset>0?1:-1});browseStart.lastY=event.clientY;browseStart.moved=true;}
  });
  browse.addEventListener("pointerup",()=>{
    if(browseStart?.moved){suppressBrowseClick=true;setTimeout(()=>{suppressBrowseClick=false;},100);}
    browseStart=null;
  });
  $$("[data-jog]").forEach(jog=>{
    const deck=Number(jog.dataset.jog);let previous=null;
    const angle=event=>{const rect=jog.getBoundingClientRect(),x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;return Math.atan2(y,x);};
    jog.addEventListener("pointerdown",event=>{if(event.button!==0)return;event.preventDefault();previous=angle(event);jog.setPointerCapture(event.pointerId);sendControl("jog_touch",{deck,touched:true});});
    jog.addEventListener("pointermove",event=>{
      if(previous===null)return;
      const next=angle(event);let diff=next-previous;
      while(diff>Math.PI)diff-=Math.PI*2;while(diff< -Math.PI)diff+=Math.PI*2;
      if(Math.abs(diff)>.002){const delta=Math.max(-18,Math.min(18,Math.round(diff*34)));if(delta)sendControl("jog_rotate",{deck,mode:"scratch",delta});previous=next;}
    });
    const release=()=>{if(previous!==null){previous=null;sendControl("jog_touch",{deck,touched:false});}};
    jog.addEventListener("pointerup",release);jog.addEventListener("pointercancel",release);jog.addEventListener("lostpointercapture",release);
    jog.addEventListener("keydown",event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();sendControl("jog_rotate",{deck,mode:"scratch",delta:event.key==="ArrowRight"?2:-2});});
  });
  function ensureAudioContext() {
    if(!audio) {
      const Ctx=window.AudioContext||window.webkitAudioContext;
      if(!Ctx)throw new Error("Browser does not support WebAudio");
      audio=new Ctx();
    }
    return audio;
  }
  async function initAudio() {
    const context=ensureAudioContext();
    if(audio.state==="suspended")await audio.resume();
    if(!output.dataset.devicesChecked){output.dataset.devicesChecked="true";audioDevices();}
    return context;
  }
  async function decode(blob){
    // Decoding files and restoring saved samples should work before the first
    // user gesture. WebKit can keep audio.resume() pending until a click.
    const context=ensureAudioContext();
    return context.decodeAudioData(await blob.arrayBuffer());
  }
  function stopSample(index) {
    const item=samples[index];
    for(const source of item.sources){try{source.stop();}catch{}}
    item.sources.clear();
  }
  function playSample(index) {
    const item=samples[index];
    if(item.buffer) {
      initAudio().then(context=>{
        const source=context.createBufferSource(),gain=context.createGain();
        source.buffer=item.buffer;gain.gain.value=item.volume;
        source.connect(gain);gain.connect(context.destination);
        item.sources.add(source);
        source.addEventListener("ended",()=>{item.sources.delete(source);source.disconnect();gain.disconnect();});
        source.start();
        const button=$('[data-slot-trigger="'+index+'"]');if(button)flash(button);
      }).catch(error=>log("Could not play sample: "+error.message));
    } else if(!$("#enableMidi").checked) {
      log("Sample "+(index+1)+" is empty. Import audio or load the demo kit.");
      return;
    }
    // MIDI-only pad playing is useful with an Ableton Drum Rack even before
    // any local audio files have been imported.
    if($("#enableMidi").checked) {
      bridgePost("/api/ableton/notes",{note:36+index,velocity:Math.max(1,Math.round(item.volume*127)),duration_ms:250})
        .catch(error=>{log("Local sample played; Ableton MIDI failed: "+error.message);});
    }
  }
  function renderSamples() {
    const root=$("#sampleGrid");root.replaceChildren();
    samples.forEach((item,index)=>{
      const el=document.createElement("div");el.className="sample-slot"+(item.blob?" loaded":"");
      const play=document.createElement("button");play.className="sample-trigger";play.dataset.slotTrigger=index;
      const number=document.createElement("strong");number.textContent=String(index+1).padStart(2,"0");
      const title=document.createElement("small");title.textContent=item.name;title.title=item.name;
      play.append(number,title);play.addEventListener("click",()=>playSample(index));
      const actions=document.createElement("div");actions.className="slot-actions";
      const pick=document.createElement("button");pick.className="pick";pick.textContent="LOAD";pick.title="Replace this slot";
      pick.addEventListener("click",()=>chooseFile(index));
      const stop=document.createElement("button");stop.className="stop";stop.textContent="STOP";stop.title="Stop this slot";
      stop.addEventListener("click",()=>stopSample(index));
      actions.append(pick,stop);
      const volume=document.createElement("input");volume.type="range";volume.min="0";volume.max="1";volume.step=".01";volume.value=item.volume;volume.setAttribute("aria-label","Sample "+(index+1)+" volume");
      volume.addEventListener("input",()=>{item.volume=Number(volume.value);saveSlot(index).catch(()=>{});});
      el.append(play,actions,volume);root.append(el);
    });
  }
  async function openDatabase() {
    if(!window.indexedDB)throw new Error("IndexedDB unavailable");
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open("FLX4LiveDrumSamples",1);
      request.onupgradeneeded=()=>{request.result.createObjectStore("slots",{keyPath:"index"});};
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>resolve(request.result);
    });
  }
  function dbTransaction(type,callback){
    if(!database)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const tx=database.transaction("slots",type),store=tx.objectStore("slots");
      callback(store);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
  }
  async function saveSlot(index){
    const item=samples[index];
    return dbTransaction("readwrite",store=>store.put({index,name:item.name,blob:item.blob,volume:item.volume}));
  }
  async function importFile(file,index){
    if(index<0||index>=samples.length)return;
    let decoded;
    try{decoded=await decode(file);}catch(error){log(file.name+" could not be decoded: "+error.message);return false;}
    stopSample(index);
    samples[index].blob=file;samples[index].buffer=decoded;samples[index].name=file.name;
    try{await saveSlot(index);}catch(error){log("Sample loaded but browser storage failed: "+error.message);}
    renderSamples();renderPads();
    return true;
  }
  function chooseFile(index){
    const chooser=document.createElement("input");chooser.type="file";chooser.accept="audio/*,.wav,.mp3,.aiff,.aif,.ogg,.flac";
    chooser.addEventListener("change",()=>{if(chooser.files?.[0])importFile(chooser.files[0],index);},{once:true});chooser.click();
  }
  $("#importSamples").addEventListener("click",()=>$("#files").click());
  $("#loadDemoKit").addEventListener("click",async()=>{
    const button=$("#loadDemoKit");
    button.disabled=true;
    let loaded=0;
    const failures=[];
    try {
      for(const [index,name] of demoFiles.entries()){
        try{
          const response=await fetch("./sounds/"+name);
          if(!response.ok)throw new Error("HTTP "+response.status);
          const file=new File([await response.blob()],name,{type:"audio/wav"});
          if(await importFile(file,index))loaded++;
          else failures.push(name);
        }catch(error){failures.push(name+" ("+error.message+")");}
        log("Loading demo kit: "+(index+1)+"/16 · "+loaded+" loaded");
      }
      log("Demo kit: "+loaded+"/16 samples loaded"+(failures.length?"; failed: "+failures.join(", "):"; saved in browser storage where available.") );
    }finally{button.disabled=false;}
  });
  $("#files").addEventListener("change",async event=>{
    const files=[...event.target.files].slice(0,16);
    for(let index=0;index<files.length;index++)await importFile(files[index],index);
    event.target.value="";
    log(files.length+" sample file(s) processed. Stored in this browser when storage is available.");
  });
  $("#stopAll").addEventListener("click",()=>{samples.forEach((_,index)=>stopSample(index));log("All local sampler voices stopped.");});
  $("#enableMidi").addEventListener("change",event=>log(event.target.checked?"Drum notes will also be sent to Ableton MIDI output.":"Local sampler only. Ableton MIDI send disabled."));
  async function audioDevices() {
    if(!navigator.mediaDevices?.enumerateDevices||!audio?.setSinkId) {
      $("#outputHint").textContent="This browser uses the system default audio output.";
      return;
    }
    try{
      const devices=(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==="audiooutput");
      output.replaceChildren(new Option("System default",""));
      devices.forEach((device,index)=>output.add(new Option(device.label||"Audio output "+(index+1),device.deviceId)));
      $("#outputHint").textContent="Selection affects local samples only.";
    }catch(error){$("#outputHint").textContent="Output enumeration unavailable: "+error.message;}
  }
  output.addEventListener("change",async()=>{
    try{const ctx=await initAudio();if(typeof ctx.setSinkId!=="function")throw new Error("Unsupported in this browser");await ctx.setSinkId(output.value||"");log("Local sampler audio output updated.");}
    catch(error){log("Could not change output: "+error.message);output.value="";}
  });
  async function restoreSamples(){
    try{
      database=await openDatabase();
      const records=await new Promise((resolve,reject)=>{
        const tx=database.transaction("slots","readonly"),request=tx.objectStore("slots").getAll();
        request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      });
      for(const record of records){
        if(!Number.isInteger(record.index)||record.index<0||record.index>15)continue;
        const item=samples[record.index];item.volume=Number.isFinite(record.volume)?record.volume:0.8;
        if(record.blob) {
          try{item.buffer=await decode(record.blob);item.blob=record.blob;item.name=record.name||"SAMPLE";}
          catch{/* corrupted/unsupported saved sample is skipped */}
        }
      }
      log(records.length?"Restored "+records.filter(r=>r.blob).length+" saved samples.":"Import files to create a persistent local drum kit.");
    }catch(error){log("Sample storage unavailable; imports last only for this session: "+error.message);}
    renderSamples();renderPads();audioDevices();
  }
  renderPads();renderSamples();connectSocket();status();setInterval(status,5000);
  restoreSamples();
})();
