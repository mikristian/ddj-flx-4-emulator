import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";

const WS_URL = "ws://127.0.0.1:18765";
const canvas = document.getElementById("threeCanvas");
const hoverLabel = document.getElementById("hoverLabel");
const logEl = document.getElementById("log");
const wsDot = document.getElementById("wsDot");
const wsStatus = document.getElementById("wsStatus");
const midiDot = document.getElementById("midiDot");
const midiStatus = document.getElementById("midiStatus");
const rbDot = document.getElementById("rbDot");
const rbStatus = document.getElementById("rbStatus");
const depthFill = document.getElementById("depthFill");
const depthValue = document.getElementById("depthValue");
const fxToggleBtn = document.getElementById("fxToggle");

const uiState = {
  playing: {1:false, 2:false},
  jogTouched: {1:false, 2:false},
  shiftHeld: {1:false, 2:false},
  padMode: "hotcue",
  fxUnit: 1,
  fxDepth: .5,
  fxOn: false,
  smartCfx: false,
  smartFader: false,
  fxStep: 0,
  fxBeatStep: 0
};
const feedbackUi={
  hotcuePads:{1:Array(8).fill(false),2:Array(8).fill(false)},
  hotcueMode:{1:false,2:false}
};
const transportClock={
  1:{trackId:null,elapsed:0,startedAt:null},
  2:{trackId:null,elapsed:0,startedAt:null}
};

let ws;
let sendTimer = null;
let statusTimer = null;
let pendingRuntimeState=null;
let controllerVisualReady=false;
let lastControllerStatus=null;
let sessionCapture=false;
let sessionEvents=[];
function logLine(text){
  const d=document.createElement("div");
  const t=new Date().toLocaleTimeString();
  d.innerHTML="<b>"+t+"</b> "+text;
  logEl.prepend(d);
  while(logEl.children.length>80) logEl.removeChild(logEl.lastChild);
  if(sessionCapture){
    sessionEvents.unshift({time:new Date().toISOString(),text:String(text)});
    sessionEvents=sessionEvents.slice(0,300);
    renderSessionEvents();
  }
}
function sendControl(action, payload={}){
  // A sampler companion route diverts only intentional pad strikes to Ableton
  // MIDI. Rekordbox transport and mixing continue over the existing bridge.
  if(action==="performance_pad" && typeof window.flx4RoutePad==="function"
     && window.flx4RoutePad(payload.deck,payload.pad)) return true;
  if(!ws || ws.readyState!==WebSocket.OPEN) return;
  ws.send(JSON.stringify({type:"control",action,...payload}));
  if(sessionCapture){
    sessionEvents.unshift({time:new Date().toISOString(),text:`TX ${action} ${Object.keys(payload).length?JSON.stringify(payload):""}`.trim()});
    sessionEvents=sessionEvents.slice(0,300);renderSessionEvents();
  }
}
function connectWS(){
  ws=new WebSocket(WS_URL);
  ws.onopen=()=>{
    wsDot.classList.add("good");
    wsStatus.textContent="CONNECTED";
    logLine("WebSocket connected");
    ws.send(JSON.stringify({type:"status_request"}));
    clearInterval(statusTimer);
    statusTimer=setInterval(()=>{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"status_request"}))},2500);
  };
  ws.onclose=()=>{
    clearInterval(statusTimer);statusTimer=null;
    wsDot.classList.remove("good");
    wsStatus.textContent="RECONNECTING";
    setTimeout(connectWS,1200);
  };
  ws.onerror=()=>ws.close();
  ws.onmessage=e=>{
    let m; try{m=JSON.parse(e.data)}catch{return}
    applyEvent(m);
  };
}
connectWS();

function applyEvent(e){
  switch(e.action){
    case "controller_status":{
      const ok=!!(e.status?.tx_port_open??e.status?.connected);
      const previousStatus=lastControllerStatus;
      lastControllerStatus=e.status||null;
      midiDot.classList.toggle("good",ok);
      const feedbackCount=Number(e.status?.feedback_messages)||0;
      const capability=e.status?.feedback_capability||"";
      midiStatus.textContent=ok?(e.status?.rekordbox_two_way_live?"2-WAY VERIFIED":e.status?.rekordbox_two_way_verified?"2-WAY PROOF":feedbackCount>0||capability==="live"?"RX LIVE":"TX OPEN") : "OFFLINE";
      if(previousStatus&&previousStatus.physical_flx4_visible!==e.status?.physical_flx4_visible){
        logLine(e.status?.physical_flx4_visible?"Physical DDJ-FLX4 detected by CoreMIDI":"Physical DDJ-FLX4 no longer visible to CoreMIDI");
      }
      const rb=!!e.status?.rekordbox_running;
      rbDot?.classList.toggle("good",rb);
      if(rbStatus)rbStatus.textContent=rb?"ONLINE":"OFFLINE";
      updateMidiDiagnostics(e.status||{});
      if(e.runtime_state){pendingRuntimeState=e.runtime_state;if(controllerVisualReady)applyRuntimeSnapshot(e.runtime_state)}
      break;
    }
    case "feedback_loaded":{
      const deck=Number(e.deck)||1;
      const card=document.querySelector(`.deck-${deck===1?"a":"b"}`);
      card?.classList.toggle("feedback-loaded",!!e.on);
      if(e.on){libraryState.loadedMidi[deck]=true;logLine(`Rekordbox feedback: deck ${deck} load confirmed`)}
      break;
    }
    case "feedback_loop":{
      const deck=Number(e.deck)||1;
      document.querySelector(`.deck-${deck===1?"a":"b"}`)?.classList.toggle("feedback-loop",!!e.on);
      logLine(`Rekordbox feedback: deck ${deck} loop ${e.on?"active":"off"}`);
      break;
    }
    case "feedback_vinyl":{
      const deck=Number(e.deck)||1;
      document.querySelector(`.deck-${deck===1?"a":"b"}`)?.classList.toggle("feedback-vinyl",!!e.on);
      logLine(`Rekordbox feedback: deck ${deck} vinyl ${e.on?"on":"off"}`);
      break;
    }
    case "feedback_play":{
      const deck=Number(e.deck)||1;uiState.playing[deck]=!!e.on;setTransportPlaying(deck,uiState.playing[deck]);setDeckState(deck);setPersistentGlow(`play-${deck}`,!!e.on,0xa9c900);
      break;
    }
    case "feedback_cue":{
      const deck=Number(e.deck)||1;document.querySelector(`.deck-${deck===1?"a":"b"}`)?.classList.toggle("feedback-cue",!!e.on);setPersistentGlow(`cue-${deck}`,!!e.on,0xff8a1f);
      break;
    }
    case "feedback_sync":{
      const deck=Number(e.deck)||1;document.querySelector(`.deck-${deck===1?"a":"b"}`)?.classList.toggle("feedback-sync",!!e.on);setPersistentGlow(`sync-${deck}`,!!e.on,0x56b6f2);
      break;
    }
    case "feedback_headphone":{
      const deck=Number(e.deck)||1;document.querySelector(`.deck-${deck===1?"a":"b"}`)?.classList.toggle("feedback-headphone",!!e.on);
      break;
    }
    case "feedback_hotcue_mode":{
      const deck=Number(e.deck)||1;feedbackUi.hotcueMode[deck]=!!e.on;refreshCuePadStates();
      break;
    }
    case "feedback_hotcue_pad":{
      const deck=Number(e.deck)||1,pad=Number(e.pad)||0;if(pad>=0&&pad<8)feedbackUi.hotcuePads[deck][pad]=!!e.on;refreshCuePadStates();
      break;
    }
    case "feedback_smart_cfx":
      uiState.smartCfx=!!e.on;document.getElementById("smartCfx").classList.toggle("active",uiState.smartCfx);setPersistentGlow("smart-cfx",uiState.smartCfx,0xff8a1f);break;
    case "feedback_smart_fader":
      uiState.smartFader=!!e.on;document.getElementById("smartFader").classList.toggle("active",uiState.smartFader);setPersistentGlow("smart-fader",uiState.smartFader,0xff8a1f);break;
    case "feedback_fx_on":
      if(Number(e.unit)===uiState.fxUnit){uiState.fxOn=!!e.on;updateFxUI();setPersistentGlow("fx-toggle",uiState.fxOn,0xff8a1f)}break;
    case "feedback_channel_level":{
      const deck=Number(e.deck)||1,m=document.getElementById(`deck${deck}Level`);if(m)m.style.width=`${Math.max(0,Math.min(1,Number(e.value)||0))*100}%`;break;
    }
    // Read-only physical DDJ-FLX4 mirror events. These never send MIDI back
    // to Rekordbox; they only keep the Three.js/software surface aligned with
    // the real controller while genuine Rekordbox feedback owns toggle truth.
    case "hardware_crossfader":
      setControlValue("crossfader",Number(e.value));
      syncSoftwareMixer("crossfader",0,Number(e.value));
      break;
    case "hardware_channel_fader":
      setControlValue(`channel-fader-${Number(e.deck)||1}`,Number(e.value));
      syncSoftwareMixer("channel_fader",Number(e.deck)||1,Number(e.value));
      break;
    case "hardware_tempo":
      setControlValue(`tempo-${Number(e.deck)||1}`,Number(e.value));
      break;
    case "hardware_eq":
      setControlValue(`eq-${Number(e.deck)||1}-${String(e.band)}`,Number(e.value));
      syncSoftwareMixer("eq",Number(e.deck)||1,Number(e.value),String(e.band));
      break;
    case "hardware_cfx":
      setControlValue(`cfx-${Number(e.deck)||1}`,Number(e.value));
      syncSoftwareMixer("cfx",Number(e.deck)||1,Number(e.value));
      break;
    case "hardware_fx_level":
      if(Number(e.unit)===Number(uiState.fxUnit||1)){
        uiState.fxDepth=Number(e.value);setControlValue("fx-level",uiState.fxDepth);updateDepthUI();
      }
      break;
    case "hardware_jog_rotate":{
      const jog=controlsById.get(`jog-${Number(e.deck)||1}`);
      if(jog)rotateJogVisual(jog,(Number(e.delta)||0)*.015);
      break;
    }
    case "hardware_jog_touch":
      uiState.jogTouched[Number(e.deck)||1]=!!e.touched;
      break;
    case "hardware_browser_rotate":{
      const delta=Number(e.delta)||0,browse=controlsById.get("browse");
      if(browse)browse.rotation.y+=delta*.18;
      if(delta&&libraryState.browseLinked&&browserMirrorSafe())moveBrowserSelection(delta);
      break;
    }
    case "hardware_button":{
      if(!e.pressed)break;
      const control=String(e.control||"");
      const deck=Number(e.deck)||0,unit=Number(e.unit)||0;
      const ids={
        play:deck?`play-${deck}`:null,cue:deck?`cue-${deck}`:null,sync:deck?`sync-${deck}`:null,
        headphone:deck?`headphone-${deck}`:null,smart_cfx:"smart-cfx",smart_cfx_select:"smart-cfx-select",
        smart_fader:"smart-fader",browser_press:"browse",browser_back:"browse-back",
        load:deck?`load-${deck}`:null,related:"related",switch_window:"switch-window",
        fx_toggle:"fx-toggle",fx_beat_down:"fx-beat-down",fx_beat_up:"fx-beat-up",
        fx_select_next:"fx-next",fx_select_prev:"fx-prev"
      };
      const id=ids[control];if(id)flashControl(id);
      if(libraryState.browseLinked&&browserMirrorSafe()){
        if(control==="browser_back")setLibraryView("browse");
        else if(control==="related")setLibraryView("related");
        else if(control==="switch_window")toggleLibrary();
        else if(control==="load"&&deck){
          libraryState.loadedMidi[deck]=true;
          loadSelectedToDeck(deck,false);
        }
      }
      if(unit&&control.startsWith("fx_"))logLine(`Physical FLX4 · FX${unit} ${control.replaceAll("_"," ")}`);
      break;
    }
    case "hardware_pad":
      if(e.pressed)flashControl(`pad-${Number(e.deck)||1}-${Number(e.pad)||0}`);
      break;
    case "hardware_pad_mode":
      if(e.pressed){
        const mode=String(e.mode||"");
        const btn=document.querySelector(`#padModeButtons button[data-mode="${mode}"]`);
        if(btn){
          uiState.padMode=mode;
          document.querySelectorAll("#padModeButtons button").forEach(x=>x.classList.toggle("active",x===btn));
          const status=document.getElementById("padModeStatus");
          if(status)status.textContent=`${btn.textContent} mode · physical Deck ${Number(e.deck)||1}`;
          refreshCuePadStates();
        }
      }
      break;
    case "play":
      uiState.playing[e.deck]=!uiState.playing[e.deck];
      setTransportPlaying(e.deck,uiState.playing[e.deck]);
      setDeckState(e.deck);
      flashControl("play-"+e.deck);
      logLine("Deck "+e.deck+" play/pause");
      break;
    case "cue":
      uiState.playing[e.deck]=false;
      setTransportPlaying(e.deck,false);resetTransport(e.deck);
      setDeckState(e.deck);
      flashControl("cue-"+e.deck);
      logLine("Deck "+e.deck+" cue");
      break;
    case "crossfader":
      setControlValue("crossfader",e.value);
      syncSoftwareMixer("crossfader",0,e.value);
      break;
    case "channel_fader":
      setControlValue("channel-fader-"+e.deck,e.value);
      syncSoftwareMixer("channel_fader",e.deck,e.value);
      break;
    case "tempo":
      setControlValue("tempo-"+e.deck,e.value);
      break;
    case "deck_button":
      flashControl(e.control+"-"+e.deck);
      logLine("Deck "+e.deck+" "+String(e.control).replaceAll("_"," "));
      break;
    case "jog_rotate":{
      const jog=controlsById.get("jog-"+e.deck);
      if(jog) rotateJogVisual(jog,(e.delta||0)*.015);
      break;
    }
    case "jog_touch":
      uiState.jogTouched[e.deck]=!!e.touched;
      break;
    case "browser_rotate":{
      moveBrowserSelection(e.delta||1);
      const browse=controlsById.get("browse");if(browse){browse.rotation.y+=(e.delta||1)*.18;}
      break;
    }
    case "browser_press":
      flashControl("browse");
      break;
    case "browser_back":
      setLibraryView("browse");
      break;
    case "browser_load":
      if(libraryState.browseLinked&&browserMirrorSafe()){
        libraryState.loadedMidi[Number(e.deck)||1]=true;
        loadSelectedToDeck(Number(e.deck)||1,false);
      }else{
        libraryState.loadedMidi[Number(e.deck)||1]=false;
        logLine(`LOAD ${e.deck}: Rekordbox command sent · dashboard cursor is not aligned`);
      }
      flashControl("load-"+e.deck);
      break;
    case "browser_related":
      setLibraryView("related");
      break;
    case "browser_switch_window":
      toggleLibrary();
      break;
    case "eq":
      setControlValue("eq-"+e.deck+"-"+e.band,e.value);
      syncSoftwareMixer("eq",e.deck,e.value,e.band);
      break;
    case "cfx":
      setControlValue("cfx-"+e.deck,e.value);
      syncSoftwareMixer("cfx",e.deck,e.value);
      break;
    case "fx_level":
      uiState.fxDepth=e.value;
      updateDepthUI();
      setControlValue("fx-level",e.value);
      break;
    case "fx_toggle":
      uiState.fxOn=!uiState.fxOn;
      updateFxUI();
      flashControl("fx-toggle");
      break;
    case "fx_select":
      uiState.fxStep += e.direction||1;
      document.getElementById("fxStep").textContent="SELECT "+(uiState.fxStep>=0?"+":"")+uiState.fxStep;
      flashControl(e.direction>=0?"fx-next":"fx-prev");
      break;
    case "fx_beat":
      uiState.fxBeatStep += e.direction||1;
      document.getElementById("fxBeat").textContent="BEAT STEP "+(uiState.fxBeatStep>=0?"+":"")+uiState.fxBeatStep;
      flashControl(e.direction>=0?"fx-beat-up":"fx-beat-down");
      break;
    case "smart_cfx":
      uiState.smartCfx=!uiState.smartCfx;
      document.getElementById("smartCfx").classList.toggle("active",uiState.smartCfx);
      flashControl("smart-cfx");
      break;
    case "smart_cfx_select":
      flashControl("smart-cfx-select");
      break;
    case "smart_fader":
      uiState.smartFader=!uiState.smartFader;
      document.getElementById("smartFader").classList.toggle("active",uiState.smartFader);
      flashControl("smart-fader");
      break;
    case "performance_pad":
      flashControl("pad-"+e.deck+"-"+e.pad);
      logLine("Deck "+e.deck+" "+e.mode+" pad "+(e.pad+1));
      break;
    case "semantic_cue":
      document.getElementById("cueBanner").textContent=String(e.cue).toUpperCase();
      break;
    case "error":
      logLine("ERROR: "+e.message);
      break;
  }
}
function setDeckState(deck){
  document.getElementById("deck"+deck+"State").textContent=uiState.playing[deck]?"PLAYING":"PAUSED";
}
function transportElapsed(deck){
  const s=transportClock[deck];if(!s)return 0;
  return s.elapsed+(s.startedAt!==null?(performance.now()-s.startedAt)/1000:0);
}
function setTransportPlaying(deck,on){
  const s=transportClock[deck];if(!s)return;
  const now=performance.now();
  if(on){if(s.startedAt===null)s.startedAt=now}
  else if(s.startedAt!==null){s.elapsed+=(now-s.startedAt)/1000;s.startedAt=null}
}
function resetTransport(deck){
  const s=transportClock[deck];if(!s)return;
  s.elapsed=0;s.startedAt=uiState.playing[deck]?performance.now():null;
  updateTransportReadout(deck);
}
function ensureTransportTrack(deck,track){
  const s=transportClock[deck],id=track?.id?String(track.id):null;if(!s)return;
  if(s.trackId!==id){s.trackId=id;s.elapsed=0;s.startedAt=uiState.playing[deck]?performance.now():null}
}
function updateTransportReadout(deck){
  const el=document.getElementById(`deck${deck}Time`),track=currentDeckTrack(deck);if(!el)return;
  const total=Math.max(0,Number(track?.length)||0),elapsed=Math.max(0,Math.min(total||Infinity,transportElapsed(deck)));
  el.textContent=total?`${fmtTime(elapsed)} / ${fmtTime(total)}`:fmtTime(elapsed);
  el.title=lastControllerStatus?.feedback_messages>0?"Transport follows Rekordbox feedback state":"Estimated from bridge Play/Pause/Cue events";
}
function updateDepthUI(){
  depthFill.style.width=(uiState.fxDepth*100)+"%";
  depthValue.textContent=Math.round(uiState.fxDepth*100)+"%";
}
function updateFxUI(){
  fxToggleBtn.classList.toggle("active",uiState.fxOn);
}
function shiftActive(){return !!(uiState.shiftHeld[1]||uiState.shiftHeld[2])}
updateDepthUI();

// UI side-panel controls
document.querySelectorAll(".route").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".route").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  uiState.fxUnit=Number(btn.dataset.unit);
  logLine("Beat FX routing → unit "+uiState.fxUnit);
}));
document.querySelector('[data-action="fx-select-prev"]').onclick=()=>sendControl("fx_select",{unit:uiState.fxUnit,direction:-1});
document.querySelector('[data-action="fx-select-next"]').onclick=()=>sendControl("fx_select",{unit:uiState.fxUnit,direction:1});
document.querySelector('[data-action="fx-beat-down"]').onclick=()=>sendControl("fx_beat",{unit:uiState.fxUnit,direction:-1});
document.querySelector('[data-action="fx-beat-up"]').onclick=()=>sendControl("fx_beat",{unit:uiState.fxUnit,direction:1});
fxToggleBtn.onclick=()=>sendControl("fx_toggle",{unit:uiState.fxUnit});
document.getElementById("smartCfx").onclick=()=>sendControl("smart_cfx");
document.getElementById("smartCfxSelect").onclick=()=>sendControl("smart_cfx_select");
document.getElementById("smartFader").onclick=()=>sendControl("smart_fader");
document.querySelectorAll("#padModeButtons button").forEach(btn=>btn.onclick=()=>{
  uiState.padMode=btn.dataset.mode;
  document.querySelectorAll("#padModeButtons button").forEach(x=>x.classList.toggle("active",x===btn));
  document.getElementById("padModeStatus").textContent=btn.textContent+" mode routes all 8 physical pads.";
  refreshCuePadStates();
  logLine("Performance pads → "+btn.textContent);
});

// Rekordbox-style software panels. These reuse the same verified runtime
// controls/data as the 3D surface instead of maintaining a second state model.
const softwarePanelDock=document.getElementById("softwarePanelDock");
const softwarePanelToggles={
  mixpoint:document.getElementById("mixPointPanelToggle"),
  sampler:document.getElementById("samplerPanelToggle"),
  mixer:document.getElementById("mixerPanelToggle"),
  record:document.getElementById("recordPanelToggle"),
  midi:document.getElementById("midiPanelToggle")
};
let rekordboxControllerSettings=null;
async function loadControllerSettings(){
  try{
    const res=await fetch(`/api/controller-settings?t=${Date.now()}`,{cache:"no-store"});
    const data=await res.json();rekordboxControllerSettings=data;
    const mix=data.mix_point||{},sampler=data.sampler||{},fx=data.beat_fx||{};
    const mixEl=document.getElementById("mixPointConfigStatus");
    if(mixEl)mixEl.textContent=`MIX POINT ${mix.enabled?"ENABLED":"DISABLED"} · GRID ${mix.show_beat_grid?"ON":"OFF"} · TIME SCALE ${mix.show_time_scale?"ON":"OFF"} · AUTO ${mix.auto_changed?"ON":"OFF"}`;
    const samplerEl=document.getElementById("samplerConfigStatus");
    if(samplerEl)samplerEl.textContent=`${sampler.slots||8} SLOTS · QUANTIZE ${sampler.quantize?"ON":"OFF"} · SYNC ${sampler.sync?"ON":"OFF"} · ${sampler.master_bpm?Number(sampler.master_bpm).toFixed(1):"—"} BPM`;
    const fxEl=document.getElementById("fxConfigStatus"),u1=fx.unit1||{},u2=fx.unit2||{},merge=Array.isArray(fx.merge_fx)?fx.merge_fx:[];
    if(fxEl)fxEl.textContent=`SAVED · FX1 ID ${u1.effect_id??"—"} / BEAT IDX ${u1.beat_index??"—"} · FX2 ID ${u2.effect_id??"—"} / BEAT IDX ${u2.beat_index??"—"}${merge.length?` · MERGE: ${merge.join(" / ")}`:""}`;
  }catch(err){
    const mixEl=document.getElementById("mixPointConfigStatus"),samplerEl=document.getElementById("samplerConfigStatus"),fxEl=document.getElementById("fxConfigStatus");
    if(mixEl)mixEl.textContent="REKORDBOX SETTINGS UNAVAILABLE";if(samplerEl)samplerEl.textContent="SAMPLER SETTINGS UNAVAILABLE";if(fxEl)fxEl.textContent="FX SETTINGS UNAVAILABLE";
  }
}
function setSoftwarePanel(name=null){
  document.querySelectorAll(".software-panel[data-software-panel]").forEach(p=>p.classList.toggle("active",p.dataset.softwarePanel===name));
  Object.entries(softwarePanelToggles).forEach(([key,btn])=>btn?.classList.toggle("active",key===name));
  document.getElementById("linkTopToggle")?.classList.toggle("active",name==="mixpoint");
  document.getElementById("padTopToggle")?.classList.toggle("active",name==="sampler");
  document.getElementById("setBuilderButton")?.classList.toggle("active",name==="setplan");
  if(name==="sampler"){syncSamplerPanel();refreshSamplerSets(false)}
  if(name==="mixpoint")updateMixPointPanel();
  if(name==="setplan")loadSetPlan(false);
  if(name==="midi"&&lastControllerStatus)updateMidiDiagnostics(lastControllerStatus);
}
Object.entries(softwarePanelToggles).forEach(([name,btn])=>btn?.addEventListener("click",()=>{
  const open=document.querySelector(`.software-panel[data-software-panel="${name}"]`)?.classList.contains("active");
  setSoftwarePanel(open?null:name);
}));
document.querySelectorAll(".software-close").forEach(btn=>btn.addEventListener("click",()=>setSoftwarePanel(null)));
document.getElementById("linkTopToggle")?.addEventListener("click",()=>setSoftwarePanel(document.querySelector('.software-panel[data-software-panel="mixpoint"]')?.classList.contains("active")?null:"mixpoint"));
document.getElementById("padTopToggle")?.addEventListener("click",()=>setSoftwarePanel(document.querySelector('.software-panel[data-software-panel="sampler"]')?.classList.contains("active")?null:"sampler"));
document.getElementById("setBuilderButton")?.addEventListener("click",()=>setSoftwarePanel(document.querySelector('.software-panel[data-software-panel="setplan"]')?.classList.contains("active")?null:"setplan"));

const setPlanState={sourceId:null,length:6,data:null,loading:false,error:""};
function setPlanBaseTrack(){
  return libraryState.collection.find(t=>String(t.id)===String(libraryState.selected)) || currentDeckTrack(libraryState.activeDeck||1) || libraryState.queue[0] || null;
}
function renderSetPlan(){
  const rows=document.getElementById("setPlanRows"),status=document.getElementById("setPlanStatus"),source=document.getElementById("setPlanSource"),append=document.getElementById("setPlanAppend");
  if(!rows||!status||!source||!append)return;
  const base=setPlanBaseTrack();source.textContent=base?`${base.title||"Track"} · ${base.camelot||base.key||"—"} · ${base.bpm?Number(base.bpm).toFixed(1):"—"} BPM`:"SELECT A SOURCE TRACK";
  append.disabled=!(setPlanState.data?.tracks?.length>1)&&!setPlanState.loading;
  if(setPlanState.loading){status.textContent="ANALYZING PHRASE-AWARE SET…";rows.innerHTML=`<div class="setplan-loading"><i></i><span>Chaining real Rekordbox phrase grids and Mix Picks…</span></div>`;append.disabled=true;return;}
  if(setPlanState.error){status.textContent=`ERROR · ${setPlanState.error}`;rows.innerHTML=`<div class="setplan-loading error"><span>${esc(setPlanState.error)}</span></div>`;append.disabled=true;return;}
  const data=setPlanState.data;if(!data){status.textContent="Ready.";rows.innerHTML=`<div class="setplan-loading"><span>Choose a source track and build a read-only set plan.</span></div>`;append.disabled=true;return;}
  status.textContent=`${data.count||0}/${data.requested_length||setPlanState.length} TRACKS · ${data.stopped_reason?`STOPPED: ${String(data.stopped_reason).toUpperCase()}`:"COMPLETE"}`;
  const transitions=Array.isArray(data.transitions)?data.transitions:[];
  rows.innerHTML=(data.tracks||[]).map((t,i)=>{
    const edge=i>0?transitions[i-1]?.plan:null,sg=edge?.suggestion||null,confidence=edge?.confidence||"low";
    const mult=Number(edge?.tempo_multiplier)||1,stylePct=Math.round((Number(edge?.style_similarity)||0)*100);
    const edgeHtml=edge?`<div class="setplan-transition ${esc(confidence)}"><span>${String(confidence).toUpperCase()} · ${sg?`${Number(sg.from_bars)||0}/${Number(sg.to_bars)||0} BARS`:"NO PHRASE GRID"}</span><b>${sg?`${fmtTime(Number(sg.from_start_sec)||0)} → ${fmtTime(Number(sg.to_start_sec)||0)}`:"MANUAL"}</b><em>Δ ${Number(edge.bpm_delta||0).toFixed(2)} BPM${Math.abs(mult-1)>.001?` · ×${mult}`:""}${Number.isFinite(Number(edge.incoming_tempo_percent_to_match))?` · IN ${Number(edge.incoming_tempo_percent_to_match)>=0?"+":""}${Number(edge.incoming_tempo_percent_to_match).toFixed(2)}%`:""} · STYLE ${stylePct}%</em></div>`:"";
    return `${edgeHtml}<div class="setplan-track" data-set-track-id="${esc(t.id)}"><span>${String(i+1).padStart(2,"0")}</span>${t.artwork?`<img src="${esc(t.artwork)}" alt="" />`:`<i></i>`}<div><strong>${esc(t.title||"Untitled")}</strong><small>${esc(t.artist||"Unknown artist")}</small></div><div><b>${esc(t.camelot||t.key||"—")}</b><small>${t.bpm?Number(t.bpm).toFixed(1):"—"}</small></div></div>`;
  }).join("");
  append.disabled=false;
}
async function loadSetPlan(force=false){
  const base=setPlanBaseTrack(),length=Math.max(2,Math.min(12,Number(document.getElementById("setPlanLength")?.value)||6));
  if(!base?.id){setPlanState.data=null;setPlanState.error="Select a track or load a deck first";setPlanState.loading=false;renderSetPlan();return;}
  if(!force&&setPlanState.data&&String(setPlanState.sourceId)===String(base.id)&&setPlanState.length===length){renderSetPlan();return;}
  setPlanState.sourceId=String(base.id);setPlanState.length=length;setPlanState.loading=true;setPlanState.error="";setPlanState.data=null;renderSetPlan();
  try{
    const res=await fetch(`/api/set-plan?id=${encodeURIComponent(base.id)}&length=${length}`,{cache:"no-store"});const data=await res.json();
    if(data.error)throw new Error(data.error);
    if(String(setPlanState.sourceId)!==String(base.id)||setPlanState.length!==length)return;
    setPlanState.data=data;setPlanState.loading=false;renderSetPlan();
  }catch(err){
    if(String(setPlanState.sourceId)!==String(base.id)||setPlanState.length!==length)return;
    setPlanState.loading=false;setPlanState.error=String(err?.message||err);renderSetPlan();
  }
}
document.getElementById("setPlanRebuild")?.addEventListener("click",()=>loadSetPlan(true));
document.getElementById("setPlanLength")?.addEventListener("change",()=>loadSetPlan(true));
document.getElementById("setPlanAppend")?.addEventListener("click",()=>{
  const tracks=Array.isArray(setPlanState.data?.tracks)?setPlanState.data.tracks:[];if(!tracks.length)return;
  const transitions=Array.isArray(setPlanState.data?.transitions)?setPlanState.data.transitions:[],planId=`set-${Date.now().toString(36)}`;
  tracks.forEach((raw,i)=>{
    const id=String(raw.id||"");if(!id)return;
    const edge=i>0?transitions[i-1]?.plan:null,sg=edge?.suggestion||null;
    libraryState.queuePlanMeta[id]={
      planId,order:i+1,total:tracks.length,
      confidence:edge?.confidence||"",
      fromBars:sg?Number(sg.from_bars)||0:0,toBars:sg?Number(sg.to_bars)||0:0,
      fromSec:sg?Number(sg.from_start_sec)||0:null,toSec:sg?Number(sg.to_start_sec)||0:null,
      bpmDelta:edge?Number(edge.bpm_delta)||0:null,
    };
  });
  const byId=new Map(libraryState.collection.map(t=>[String(t.id),t])),seen=new Set(libraryState.queue.map(t=>String(t.id)));let added=0;
  for(const raw of tracks){const id=String(raw.id||"");if(!id||seen.has(id))continue;const t=byId.get(id)||raw;libraryState.queue.push(t);seen.add(id);added++}
  if(added){persistDashboardQueue();renderQueue();updateDeckPreviews();if(libraryState.view==="queue")renderCollection();}
  const status=document.getElementById("setPlanStatus");if(status)status.textContent=`APPENDED ${added} NEW TRACK${added===1?"":"S"} · EXISTING Q PRESERVED`;
  logLine(`AI Set Builder appended ${added} track${added===1?"":"s"} to dashboard Q`);
});

function updateMidiDiagnostics(status={}){
  const source=document.getElementById("diagMidiSource"),sourceState=document.getElementById("diagMidiSourceState");
  const feedback=document.getElementById("diagMidiFeedback"),feedbackState=document.getElementById("diagMidiFeedbackState");
  const mapping=document.getElementById("diagMidiMapping"),mappingPath=document.getElementById("diagMidiMappingPath");
  const rb=document.getElementById("diagRekordbox"),last=document.getElementById("diagFeedbackLast"),note=document.getElementById("diagMidiNote");
  const flx4=document.getElementById("diagPhysicalFlx4"),physicalPorts=document.getElementById("diagPhysicalMidiPorts");
  const execution=document.getElementById("diagExecutionProof"),executionEvidence=document.getElementById("diagExecutionEvidence");
  const twoWay=document.getElementById("diagTwoWayProof"),twoWayEvidence=document.getElementById("diagTwoWayEvidence");
  const autoAttach=document.getElementById("diagAutoAttach"),autoAttachDetail=document.getElementById("diagAutoAttachDetail");
  const endpointHealth=document.getElementById("diagEndpointHealth"),endpointDetail=document.getElementById("diagEndpointDetail");
  const physicalMirror=document.getElementById("diagPhysicalMirror"),physicalMirrorDetail=document.getElementById("diagPhysicalMirrorDetail");
  const count=Number(status.feedback_messages)||0,armed=!!status.feedback_connected,online=!!status.rekordbox_running;
  const txOpen=!!(status.tx_port_open??status.connected);
  if(source){source.textContent=status.resolved_port||status.requested_port||"—";source.className=txOpen?"ok":"warn"}
  if(sourceState)sourceState.textContent=txOpen?`TX PORT OPEN${status.is_virtual?" · VIRTUAL":""} · EXECUTION NOT IMPLIED`:"TX PORT OFFLINE";
  if(feedback){feedback.textContent=status.feedback_port||status.requested_port||"—";feedback.className=armed?"ok":"warn"}
  if(feedbackState)feedbackState.textContent=count>0?`RX LIVE · ${count} MESSAGE${count===1?"":"S"}`:armed?"RX DESTINATION ARMED · WAITING FOR REKORDBOX OUT":"RX DESTINATION OFFLINE";
  if(mapping){mapping.textContent=status.mapping_verified?"VERIFIED":"UNVERIFIED";mapping.className=status.mapping_verified?"ok":"warn"}
  if(mappingPath)mappingPath.textContent=status.mapping_path||"—";
  if(rb){rb.textContent=online?"ONLINE":"OFFLINE";rb.className=online?"ok":"warn"}
  if(last)last.textContent=status.feedback_last_at?`LAST RX · ${new Date(Number(status.feedback_last_at)*1000).toLocaleTimeString()}`:"NO REAL RX YET";
  if(flx4){flx4.textContent=status.physical_flx4_visible?"ENUMERATED":"NOT ENUMERATED";flx4.className=status.physical_flx4_visible?"ok":"warn"}
  if(physicalPorts){
    const ports=[...(status.physical_midi_inputs||[]),...(status.physical_midi_outputs||[])];
    physicalPorts.textContent=ports.length?[...new Set(ports)].join(" · "):"NO NON-VIRTUAL MIDI ENDPOINTS";
  }
  if(execution){execution.textContent=status.rekordbox_control_execution_confirmed?"CONFIRMED":"UNVERIFIED";execution.className=status.rekordbox_control_execution_confirmed?"ok":"warn"}
  if(executionEvidence)executionEvidence.textContent=status.rekordbox_control_execution_evidence||"NO REKORDBOX UI EXECUTION PROOF";
  if(twoWay){twoWay.textContent=status.rekordbox_two_way_verified?"VERIFIED":"INCOMPLETE";twoWay.className=status.rekordbox_two_way_verified?"ok":"warn"}
  if(twoWayEvidence){
    const p=status.rekordbox_two_way_proof;
    const v=status.rekordbox_two_way_proof_validation;
    twoWayEvidence.textContent=status.rekordbox_two_way_verified&&p
      ?`${p.proof_method==="same-control-round-trip"?"SAME-CONTROL ROUND TRIP":"COMMAND + FEEDBACK"} · ${p.verified_at||"VERIFIED"}${v?.valid?" · HASHES VALID":""}${v?.reconnect_ok===true?" · RECONNECT VALID":""}`
      :v?.errors?.length?`PROOF INVALID · ${v.errors.join(" · ")}`:"BOTH DIRECTIONS REQUIRE INDEPENDENT PROOF";
  }
  if(autoAttach){
    const a=status.rekordbox_bridge_health||status.rekordbox_auto_attach||{};
    autoAttach.textContent=a.success?"HEALTHY":a.result==="waiting_for_feedback"?"SETTLING":a.attempted?"ATTEMPTED":"IDLE";
    autoAttach.className=a.success?"ok":a.result==="waiting_for_feedback"||a.attempted?"warn":"";
  }
  if(autoAttachDetail){
    const a=status.rekordbox_bridge_health||status.rekordbox_auto_attach||{};
    autoAttachDetail.textContent=a.result?String(a.result).toUpperCase().replaceAll("_"," "):"PASSIVE HEALTH MONITOR";
  }
  if(endpointHealth||endpointDetail){
    const ins=status.available_inputs||[],outs=status.available_outputs||[];
    const counts={
      ci:ins.filter(x=>String(x).includes("Claude Virtual Controller")).length,
      co:outs.filter(x=>String(x).includes("Claude Virtual Controller")).length,
      fi:ins.filter(x=>String(x).includes("DDJ-FLX4")).length,
      fo:outs.filter(x=>String(x).includes("DDJ-FLX4")).length,
    };
    const clean=counts.ci===1&&counts.co===1&&counts.fi===1&&counts.fo===1;
    if(endpointHealth){endpointHealth.textContent=clean?"CLEAN":"CHECK";endpointHealth.className=clean?"ok":"warn"}
    if(endpointDetail)endpointDetail.textContent=`CLAUDE ${counts.ci}/${counts.co} · FLX4 ${counts.fi}/${counts.fo} · IN/OUT`;
  }
  if(physicalMirror||physicalMirrorDetail){
    const pm=status.physical_controller_monitor||{},decoded=Number(pm.decoded_messages)||0,raw=Number(pm.messages)||0;
    if(physicalMirror){
      physicalMirror.textContent=pm.connected?(decoded>0?"LIVE":"ARMED"):"OFFLINE";
      physicalMirror.className=pm.connected?"ok":"warn";
    }
    if(physicalMirrorDetail){
      const last=pm.last_at?` · LAST ${new Date(Number(pm.last_at)*1000).toLocaleTimeString()}`:"";
      const action=pm.last_event?.action?` · ${String(pm.last_event.action).replace("hardware_","").toUpperCase()}`:"";
      physicalMirrorDetail.textContent=pm.connected?`${decoded} DECODED / ${raw} RAW${action}${last}`:(pm.error||"DDJ-FLX4 INPUT NOT OPEN");
    }
  }
  if(note){
    note.classList.toggle("live",!!status.rekordbox_two_way_verified);
    note.textContent=status.rekordbox_two_way_verified
      ?`Two-way Rekordbox control is independently verified. RX is currently live with ${count} message${count===1?"":"s"} received this runtime session.`
      :count>0
      ?`Rekordbox MIDI OUT is live (${count} messages), but command execution still requires independent application-level proof.`
      :armed&&online&&!status.physical_flx4_visible
        ?`Virtual TX/RX ports are healthy, but no physical FLX4 is visible and rekordbox has sent 0 feedback messages. Current UI inspection also shows MIDI disabled; connect a supported unlock device or use an already-authorized eligible plan before native MIDI Learn/routing can be verified.`
      :armed&&online
        ?`CoreMIDI TX/RX ports are open, but rekordbox has sent 0 feedback messages. Port readiness does not prove rekordbox is accepting virtual-controller commands; MIDI Learn/device activation must be available in rekordbox for native control.`
        :armed
          ?"Feedback destination is armed; Rekordbox is currently offline."
          :"Feedback destination is not available.";
  }
}

function renderSessionEvents(){
  const el=document.getElementById("recordEvents");if(!el)return;
  el.innerHTML=sessionEvents.map(e=>`<div><b>${new Date(e.time).toLocaleTimeString()}</b>${String(e.text).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}</div>`).join("");
  const status=document.getElementById("sessionCaptureStatus");if(status)status.textContent=sessionCapture?`CAPTURING · ${sessionEvents.length} EVENTS`:sessionEvents.length?`PAUSED · ${sessionEvents.length} EVENTS`:"IDLE · local event trace only";
}
document.getElementById("sessionCaptureToggle")?.addEventListener("click",e=>{
  sessionCapture=!sessionCapture;e.currentTarget.classList.toggle("active",sessionCapture);e.currentTarget.textContent=sessionCapture?"STOP CAPTURE":"START CAPTURE";
  if(sessionCapture)sessionEvents.unshift({time:new Date().toISOString(),text:"Session capture started"});
  else sessionEvents.unshift({time:new Date().toISOString(),text:"Session capture stopped"});
  sessionEvents=sessionEvents.slice(0,300);renderSessionEvents();
});
document.getElementById("sessionCaptureClear")?.addEventListener("click",()=>{sessionEvents=[];renderSessionEvents()});

const softwareSamplerPads=document.getElementById("softwareSamplerPads");
let samplerSetsLastAt=0;
let activeSamplerSetId=null;
async function refreshSamplerSets(force=false){
  const now=Date.now();if(!force&&now-samplerSetsLastAt<15000)return;
  try{
    const res=await fetch(`/api/sampler-sets${force?`?t=${now}`:""}`,{cache:"no-store"});const data=await res.json();
    libraryState.samplerSets=Array.isArray(data.sets)?data.sets:[];samplerSetsLastAt=now;renderSamplerLibrary();renderSoftwareSamplerPads();
  }catch(err){logLine(`Sampler refresh error: ${err.message||err}`)}
}
function bindSoftwareSamplerPads(){
  if(!softwareSamplerPads)return;
  softwareSamplerPads.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
    const deck=libraryState.activeDeck||1,pad=Number(btn.dataset.samplerPad)||0;
    uiState.padMode="sampler";
    document.querySelectorAll("#padModeButtons button").forEach(x=>x.classList.toggle("active",x.dataset.mode==="sampler"));
    sendControl("performance_pad",{deck,mode:"sampler",pad});flashSoftwarePad(btn);syncSamplerPanel();
  }));
}
if(softwareSamplerPads){
  softwareSamplerPads.innerHTML=Array.from({length:8},(_,i)=>`<button data-sampler-pad="${i}"><b>PAD ${i+1}</b><span>UNASSIGNED</span></button>`).join("");
  bindSoftwareSamplerPads();
}
function flashSoftwarePad(btn){btn.classList.add("active");setTimeout(()=>btn.classList.remove("active"),150)}
function syncSamplerPanel(){
  const label=document.getElementById("samplerDeckLabel");if(label)label.textContent=`DECK ${libraryState.activeDeck||1}`;
}
document.getElementById("samplerRefresh")?.addEventListener("click",()=>refreshSamplerSets(true));
function selectedSamplerSet(){
  const sets=Array.isArray(libraryState.samplerSets)?libraryState.samplerSets:[];
  if(!sets.length)return null;
  let set=sets.find(x=>String(x.id)===String(activeSamplerSetId));
  if(!set){set=sets[0];activeSamplerSetId=String(set.id)}
  return set;
}
function renderSoftwareSamplerPads(){
  if(!softwareSamplerPads)return;
  const set=selectedSamplerSet(),slots=new Map((set?.tracks||[]).map(x=>[Number(x.slot)||0,x.track||null]));
  softwareSamplerPads.innerHTML=Array.from({length:8},(_,i)=>{
    const track=slots.get(i+1),title=track?.title||"Empty";
    return `<button data-sampler-pad="${i}" title="${esc(title)}"><b>PAD ${i+1}</b><span>${esc(title)}</span></button>`;
  }).join("");
  bindSoftwareSamplerPads();
}
function renderSamplerLibrary(){
  const root=document.getElementById("samplerLibrary");if(!root)return;
  const sets=Array.isArray(libraryState.samplerSets)?libraryState.samplerSets:[];
  const active=selectedSamplerSet();
  root.innerHTML=`<small>SAMPLER LIBRARY · READ ONLY · SELECT BANK BELOW</small>`+(sets.length?sets.map(set=>`<section class="sampler-kit${String(active?.id)===String(set.id)?" active":""}"><button class="sampler-kit-head" data-sampler-set-id="${esc(set.id)}"><strong>${esc(set.name||"Sampler Set")}</strong><span>${Number(set.count)||0} SAMPLES</span></button><div class="sampler-kit-slots">${(set.tracks||[]).slice(0,16).map(x=>`<div class="sampler-kit-slot"><b>SLOT ${Number(x.slot)||0}</b><span>${esc(x.track?.title||"Empty")}</span></div>`).join("")}</div></section>`).join(""):`<div class="queue-foot">No saved sampler kits found.</div>`);
  root.querySelectorAll(".sampler-kit-head").forEach(btn=>btn.addEventListener("click",()=>{
    activeSamplerSetId=String(btn.dataset.samplerSetId||"");renderSamplerLibrary();renderSoftwareSamplerPads();
  }));
}

document.querySelectorAll(".mixer-channel").forEach(channel=>{
  const deck=Number(channel.dataset.mixDeck);
  channel.querySelectorAll("input[data-mix-control]").forEach(input=>input.addEventListener("input",()=>{
    const control=input.dataset.mixControl,value=Number(input.value);
    if(control==="eq")sendControl("eq",{deck,band:input.dataset.band,value});
    else if(control==="cfx")sendControl("cfx",{deck,value});
    else if(control==="channel_fader")sendControl("channel_fader",{deck,value});
  }));
});
document.getElementById("softwareCrossfader")?.addEventListener("input",e=>sendControl("crossfader",{value:Number(e.currentTarget.value)}));
function syncSoftwareMixer(control,deck,value,band=null){
  if(control==="crossfader"){
    const x=document.getElementById("softwareCrossfader");if(x)x.value=String(value);return;
  }
  const channel=document.querySelector(`.mixer-channel[data-mix-deck="${deck}"]`);if(!channel)return;
  let input;
  if(control==="eq")input=channel.querySelector(`input[data-mix-control="eq"][data-band="${band}"]`);
  else input=channel.querySelector(`input[data-mix-control="${control}"]`);
  if(input)input.value=String(value);
}

function phraseTimelineHtml(track){
  const phrases=Array.isArray(track?._analysis?.phrases)?track._analysis.phrases:[];if(!phrases.length)return "";
  const total=Math.max(1,phrases.reduce((m,p)=>Math.max(m,Number(p.end_beat)||0),0));
  return phrases.map(p=>`<i title="Phrase ${Number(p.index)||0} · kind ${Number(p.kind)||0}" style="flex:${Math.max(1,(Number(p.end_beat)||0)-(Number(p.start_beat)||0))} 1 0"></i>`).join("");
}
const transitionPlanCache=new Map();
const transitionPlanPending=new Map();
function renderBackendTransitionPlan(plan){
  const box=document.getElementById("mixPointSuggestion");if(!box||!plan)return;
  const title=box.querySelector("strong"),detail=box.querySelector("span"),suggestion=plan.suggestion;
  box.classList.remove("high","medium","low");
  if(!suggestion){title.textContent="—";detail.textContent="No phrase-aligned transition found";return;}
  const confidence=["high","medium","low"].includes(plan.confidence)?plan.confidence:"low";
  box.classList.add(confidence);
  title.textContent=`D1 ${fmtTime(Number(suggestion.from_start_sec)||0)} → D2 ${fmtTime(Number(suggestion.to_start_sec)||0)}`;
  const tempo=Number(plan.incoming_tempo_percent_to_match),tempoText=Number.isFinite(tempo)?` · incoming ${tempo>=0?"+":""}${tempo.toFixed(2)}%`:"";
  const mult=Number(plan.tempo_multiplier)||1,multText=Math.abs(mult-1)>.001?` · BPM ×${mult}`:"";
  const style=Number(plan.style_similarity),styleText=Number.isFinite(style)?` · style ${Math.round(style*100)}%`:"";
  const cueText=suggestion.from_hot_cue||suggestion.to_hot_cue?" · cue-aligned":"";
  detail.textContent=`${confidence.toUpperCase()} confidence · ${Number(suggestion.from_bars)||0}/${Number(suggestion.to_bars)||0} bars · ${Number(plan.bpm_delta||0).toFixed(2)} BPM Δ · ${plan.harmonic?"harmonic":"non-harmonic"}${multText}${tempoText}${styleText}${cueText}`;
}
function updateTransitionSuggestion(a,b){
  const box=document.getElementById("mixPointSuggestion");if(!box)return;
  const title=box.querySelector("strong"),detail=box.querySelector("span");
  box.classList.remove("high","medium","low");
  const fromId=String(a?.id||""),toId=String(b?.id||"");if(!fromId||!toId)return;
  const key=`${fromId}>${toId}`;
  if(transitionPlanCache.has(key)){renderBackendTransitionPlan(transitionPlanCache.get(key));return;}
  title.textContent="ANALYZING…";
  detail.textContent="Canonical plan · real Rekordbox phrase / cue analysis";
  if(transitionPlanPending.has(key))return;
  const pending=fetch(`/api/transition-plan?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,{cache:"no-store"})
    .then(r=>r.json()).then(data=>{
      transitionPlanCache.set(key,data);
      const currentA=currentDeckTrack(1),currentB=currentDeckTrack(2);
      if(String(currentA?.id||"")===fromId&&String(currentB?.id||"")===toId)renderBackendTransitionPlan(data);
    }).catch(()=>{
      const currentA=currentDeckTrack(1),currentB=currentDeckTrack(2);
      if(String(currentA?.id||"")===fromId&&String(currentB?.id||"")===toId){title.textContent="PLAN UNAVAILABLE";detail.textContent="Could not read the transition-plan endpoint";}
    }).finally(()=>transitionPlanPending.delete(key));
  transitionPlanPending.set(key,pending);
}
function updateMixPointPanel(){
  for(const deck of [1,2]){
    const t=currentDeckTrack(deck),root=document.getElementById(`mixPointDeck${deck}`);if(!root)continue;
    root.querySelector("strong").textContent=t?.title||"—";
    root.querySelector("em").textContent=t?`${t.camelot||t.key||"—"} · ${t.bpm?Number(t.bpm).toFixed(1):"—"} BPM · ${t?._analysis?.phrases?.length||0} PHRASES`:"—";
    root.querySelector(".phrase-timeline").innerHTML=phraseTimelineHtml(t);
    const phrases=Array.isArray(t?._analysis?.phrases)?t._analysis.phrases:[];
    const valid=phrases.filter(p=>Number.isFinite(Number(p.start_sec)));
    const boundaries=(deck===1?valid.slice(-4):valid.slice(0,4)).map(p=>fmtTime(Number(p.start_sec))).join(" · ");
    const timeEl=root.querySelector(".mixpoint-times");if(timeEl)timeEl.textContent=boundaries?`${deck===1?"LATE":"EARLY"} PHRASE STARTS · ${boundaries}`:"NO PHRASE GRID";
    const cues=Array.isArray(t?._cues?.cues)?t._cues.cues.filter(c=>c.hot_cue).slice(0,5):[];
    const cueText=cues.map(c=>`${c.label} ${fmtTime(Number(c.in_ms||0)/1000)}`).join(" · ");
    const cueEl=root.querySelector(".mixpoint-cues");if(cueEl)cueEl.textContent=cueText?`HOT CUES · ${cueText}`:"NO SAVED HOT CUES";
  }
  const a=currentDeckTrack(1),b=currentDeckTrack(2),headline=document.getElementById("mixCompatibility"),detail=document.getElementById("mixCompatibilityDetail");
  if(!headline||!detail)return;
  if(!a||!b){headline.textContent="—";detail.textContent="Select/load two analyzed tracks";const box=document.getElementById("mixPointSuggestion");if(box){box.classList.remove("high","medium","low");box.querySelector("strong").textContent="—";box.querySelector("span").textContent="Waiting for two analyzed tracks";}return;}
  const harmonic=camelotCompatible(a.camelot||a.key,b.camelot||b.key),bpmA=Number(a.bpm)||0,bpmB=Number(b.bpm)||0,diff=bpmA&&bpmB?Math.abs(bpmB-bpmA):0;
  const phraseA=a?._analysis?.phrases?.length||0,phraseB=b?._analysis?.phrases?.length||0;
  headline.textContent=harmonic?"HARMONIC LINK":diff<=4?"TEMPO LINK":"MANUAL LINK";
  detail.textContent=`${a.camelot||a.key||"—"} → ${b.camelot||b.key||"—"} · ${diff.toFixed(1)} BPM Δ · ${phraseA}/${phraseB} phrase regions`;
  updateTransitionSuggestion(a,b);
}
document.getElementById("mixPointSwap")?.addEventListener("click",()=>{
  libraryState.activeDeck=libraryState.activeDeck===1?2:1;
  document.querySelectorAll(".deck-card").forEach((c,i)=>c.classList.toggle("active-target",i===libraryState.activeDeck-1));syncSamplerPanel();updateMixPointPanel();updateMasterPhase();
});

// Waveform canvases
const CUE_COLORS=["#ff8a1f","#39a7ff","#55d56b","#b574ff","#3bd8d0","#ff67a8","#f4d14e","#ff5656","#dfe7ef"];
const PHRASE_COLORS=["#24536f","#67452a","#3a5c45","#5a3d67","#285e68","#68552b","#453f6e","#6a3e47"];
function cueColor(cue){const slot=Number(cue?.slot)||0;return slot>0?CUE_COLORS[(slot-1)%CUE_COLORS.length]:"#d7dde1"}
function drawWave(canvas, hueA, hueB, seedText="", waveData=null, cueData=null, durationSec=0, analysisData=null){
  const dpr=Math.max(1,window.devicePixelRatio||1);
  const rect=canvas.getBoundingClientRect();
  canvas.width=Math.floor(rect.width*dpr); canvas.height=Math.floor(rect.height*dpr);
  const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle="#07090b";ctx.fillRect(0,0,w,h);
  // Rekordbox song-structure analysis when available; neutral fallback otherwise.
  const realPhrases=Array.isArray(analysisData?.phrases)?analysisData.phrases:[];
  const duration=Math.max(0,Number(durationSec)||0);
  if(realPhrases.length&&duration>0){
    for(const phrase of realPhrases){
      if(!Number.isFinite(Number(phrase.start_sec))||!Number.isFinite(Number(phrase.end_sec)))continue;
      const a=Math.max(0,Math.min(1,Number(phrase.start_sec)/duration));
      const b=Math.max(a,Math.min(1,Number(phrase.end_sec)/duration));
      const color=PHRASE_COLORS[Math.abs(Number(phrase.kind)||0)%PHRASE_COLORS.length];
      ctx.globalAlpha=.14;ctx.fillStyle=color;ctx.fillRect(w*a,0,Math.max(1,w*(b-a)),h);
      ctx.globalAlpha=.8;ctx.fillRect(w*a,0,Math.max(1,w*(b-a)),2);ctx.globalAlpha=1;
    }
  }else{
    const phrases=[[0,.18,"rgba(32,100,145,.10)"],[.18,.42,"rgba(203,111,28,.08)"],[.42,.72,"rgba(43,130,176,.08)"],[.72,1,"rgba(203,111,28,.08)"]];
    for(const [a,b,c] of phrases){ctx.fillStyle=c;ctx.fillRect(w*a,0,w*(b-a),h)}
  }
  ctx.lineWidth=1;
  const realBeats=Array.isArray(analysisData?.beats)?analysisData.beats:[];
  if(realBeats.length&&duration>0){
    const pxPerBeat=w/realBeats.length;
    for(const beat of realBeats){
      const beatNo=Number(beat.beat)||0;
      if(beatNo!==1&&pxPerBeat<4)continue;
      const x=w*Math.max(0,Math.min(1,Number(beat.time)/duration));
      ctx.strokeStyle=beatNo===1?"rgba(101,137,161,.32)":"rgba(42,58,69,.22)";
      ctx.beginPath();ctx.moveTo(x,beatNo===1?2:8);ctx.lineTo(x,h);ctx.stroke();
    }
  }else{
    for(let x=0;x<w;x+=24){ctx.strokeStyle=x%96===0?"#26343e":"#121a20";ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
  }
  ctx.strokeStyle="#111a20";ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
  const mid=h/2;
  if(waveData?.heights?.length){
    const hs=waveData.heights,cs=waveData.colors||[];
    for(let x=0;x<w;x+=1){
      const idx=Math.min(hs.length-1,Math.floor(x/w*hs.length));
      const amp=2+Math.max(0,Math.min(1,Number(hs[idx])||0))*h*.43;
      const rgb=cs[idx];ctx.strokeStyle=rgb?`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`:(x<w/2?hueA:hueB);
      ctx.beginPath();ctx.moveTo(x,mid-amp);ctx.lineTo(x,mid+amp);ctx.stroke();
    }
  }else{
    let seed=hashText(seedText||"rekordbox");
    for(let x=0;x<w;x+=2){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const jitter=((seed>>>24)/255-.5)*.30;
      const n=(Math.sin(x*.071)+Math.sin(x*.017+1.7)+Math.sin(x*.193+0.4))/3+jitter;
      const env=.20+.80*Math.abs(Math.sin(x*.009+0.8));
      const amp=Math.min(h*.44,(4+h*.34*Math.abs(n)*env));
      const grad=ctx.createLinearGradient(0,mid-amp,0,mid+amp);
      grad.addColorStop(0,hueA);grad.addColorStop(.5,"#dcecff");grad.addColorStop(1,hueB);
      ctx.strokeStyle=grad;ctx.beginPath();ctx.moveTo(x,mid-amp);ctx.lineTo(x,mid+amp);ctx.stroke();
    }
  }
  // Actual Rekordbox memory/hot cues, positioned from djmdCue millisecond data.
  const cues=Array.isArray(cueData?.cues)?cueData.cues:[];
  const durationMs=Math.max(1,Number(durationSec||0)*1000);
  for(const cue of cues){
    if(!Number.isFinite(Number(cue.in_ms))||durationMs<=1)continue;
    const p=Math.max(0,Math.min(1,Number(cue.in_ms)/durationMs)),x=w*p,c=cueColor(cue),l=String(cue.label||"M");
    ctx.fillStyle=c;ctx.globalAlpha=.95;ctx.beginPath();ctx.moveTo(x-4,1);ctx.lineTo(x+4,1);ctx.lineTo(x,8);ctx.closePath();ctx.fill();
    ctx.font="600 6px ui-monospace,monospace";ctx.fillText(l,x+5,7);
    if(cue.loop&&Number(cue.out_ms)>Number(cue.in_ms)){
      const x2=w*Math.max(0,Math.min(1,Number(cue.out_ms)/durationMs));ctx.globalAlpha=.20;ctx.fillRect(x,0,Math.max(1,x2-x),h);ctx.globalAlpha=.95;
    }
  }
  ctx.globalAlpha=1;
  ctx.strokeStyle="#eef6fb";ctx.globalAlpha=.85;ctx.beginPath();ctx.moveTo(w*.50,1);ctx.lineTo(w*.50,h-1);ctx.stroke();ctx.globalAlpha=1;
}
function redrawWaves(){
  const s=window.__libraryState||{},q=s.queue||[];
  const d1=s.loaded?.[1]||q[0]||s.collection?.[0];
  const d2=s.loaded?.[2]||q[1]||s.collection?.[1];
  drawWave(document.getElementById("wave1"),"#ff7c24","#008cff",d1?.title||"deck1",d1?._wave||null,d1?._cues||null,d1?.length||0,d1?._analysis||null);
  drawWave(document.getElementById("wave2"),"#26a8ff","#ff7a2d",d2?.title||"deck2",d2?._wave||null,d2?._cues||null,d2?.length||0,d2?._analysis||null);
}
window.addEventListener("resize",redrawWaves); requestAnimationFrame(redrawWaves);

// Rekordbox-style collection + Automix queue browser
const libraryState={collection:[],queue:[],queuePlanMeta:{},search:"",filter:"all",selected:null,view:"browse",displayMode:"list",artworkLimit:180,advanced:{bpmMin:0,bpmMax:0,camelot:"",rating:0},totalCount:0,playlists:[],histories:[],samplerSets:[],customRows:[],customTitle:"",customTotal:0,mixPicks:[],mixPicksSource:null,mixPicksLoading:false,mixPicksError:"",loaded:{1:null,2:null},loadedMidi:{1:false,2:false},activeDeck:1,sortKey:"",sortDir:1,browseLinked:false};
window.__libraryState=libraryState;
const QUEUE_STORAGE_KEY="rekordbox-live-mcp-queue-v1";
const QUEUE_PLAN_STORAGE_KEY="rekordbox-live-mcp-queue-plan-v1";
const trackRowsEl=document.getElementById("trackRows");
const queueRowsEl=document.getElementById("queueRows");
const librarySearch=document.getElementById("librarySearch");
const collectionCount=document.getElementById("collectionCount");
const trackCount=document.getElementById("trackCount");
const queueCount=document.getElementById("queueCount");
const librarySource=document.getElementById("librarySource");
const collectionTitle=document.getElementById("collectionTitle");
const playlistList=document.getElementById("playlistList");
const historyList=document.getElementById("historyList");
const trackTableEl=document.getElementById("trackTable");
const artworkGridEl=document.getElementById("artworkGrid");
const advancedFilterBar=document.getElementById("advancedFilterBar");
const filterBpmMin=document.getElementById("filterBpmMin");
const filterBpmMax=document.getElementById("filterBpmMax");
const filterCamelot=document.getElementById("filterCamelot");
const filterRating=document.getElementById("filterRating");
let artObserver=null,waveObserver=null;
const TRACK_ROW_H=27,TRACK_WINDOW=220,TRACK_OVERSCAN=36;
let trackScrollTimer=null;
const artworkJobs=[];let artworkActive=0;
const miniWaveJobs=[];let miniWaveActive=0;

function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmtTime(sec){sec=Number(sec)||0;const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,"0")}`}
function hashText(s){let h=2166136261;for(const c of String(s)){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0}
function waveHtml(track){
  let n=hashText((track.title||"")+(track.artist||""));const bars=[];
  for(let i=0;i<27;i++){n=(Math.imul(n,1664525)+1013904223)>>>0;const h=3+(n%12);bars.push(`<i style="height:${h}px"></i>`)}
  return `<div class="mini-wave" data-wave-id="${esc(track.id)}">${bars.join("")}</div>`;
}
async function hydrateMiniWave(el){
  const id=el.dataset.waveId;if(!id||el.dataset.loaded)return;el.dataset.loaded="loading";
  try{
    const res=await fetch(`/api/waveform?id=${encodeURIComponent(id)}&points=27`);const data=await res.json();
    if(data.heights?.length){
      const bars=[...el.querySelectorAll("i")];bars.forEach((bar,i)=>{
        const h=data.heights[Math.min(i,data.heights.length-1)]||0;bar.style.height=`${Math.max(2,Math.round(h*15))}px`;
        const c=data.colors?.[Math.min(i,(data.colors?.length||1)-1)];if(c)bar.style.background=`rgb(${c[0]},${c[1]},${c[2]})`;
      });
      el.dataset.loaded="1";
    }else el.dataset.loaded="empty";
  }catch{el.dataset.loaded="error"}
}
function queueMiniWave(el){
  if(el.dataset.queued||el.dataset.loaded)return;el.dataset.queued="1";miniWaveJobs.push(el);pumpMiniWaves();
}
function pumpMiniWaves(){
  while(miniWaveActive<3&&miniWaveJobs.length){
    const el=miniWaveJobs.shift();miniWaveActive++;
    hydrateMiniWave(el).finally(()=>{miniWaveActive--;delete el.dataset.queued;pumpMiniWaves()});
  }
}
function queueArtwork(img){
  if(img.dataset.artQueued||img.dataset.artLoaded||!img.dataset.art)return;
  img.dataset.artQueued="1";artworkJobs.push(img);pumpArtwork();
}
function pumpArtwork(){
  while(artworkActive<4&&artworkJobs.length){
    const img=artworkJobs.shift();
    if(!img?.isConnected){delete img?.dataset?.artQueued;continue}
    artworkActive++;
    const done=()=>{artworkActive--;delete img.dataset.artQueued;pumpArtwork()};
    fetch(img.dataset.art,{cache:"force-cache"}).then(r=>{
      if(!r.ok)throw new Error(`artwork ${r.status}`);return r.blob();
    }).then(blob=>{
      if(!img.isConnected){done();return}
      const url=URL.createObjectURL(blob);img.src=url;img.dataset.artLoaded="1";
      img.addEventListener("load",()=>URL.revokeObjectURL(url),{once:true});done();
    }).catch(()=>{img.dataset.artLoaded="error";done()});
  }
}
function filterCollection(){
  const q=libraryState.search.trim().toLowerCase();
  return libraryState.collection.filter(t=>{
    if(q && !`${t.title} ${t.artist} ${t.album} ${t.genre} ${t.key} ${t.bpm}`.toLowerCase().includes(q))return false;
    const f=libraryState.filter;
    if(f==="house" && !/house|dance|edm/i.test(`${t.genre} ${t.path}`))return false;
    if(f==="hip-hop" && !/hip.?hop|rap|trap/i.test(`${t.genre} ${t.path}`))return false;
    if(f==="electronic" && !/electro|techno|garage|dnb|drum|bass|edm|house/i.test(`${t.genre} ${t.path}`))return false;
    if(f==="recent"){
      const ts=Date.parse(t.date||"");if(!Number.isFinite(ts)||Date.now()-ts>1000*60*60*24*45)return false;
    }
    const bpm=Number(t.bpm)||0,a=libraryState.advanced;
    if(a.bpmMin&&(!bpm||bpm<a.bpmMin))return false;
    if(a.bpmMax&&(!bpm||bpm>a.bpmMax))return false;
    if(a.camelot&&String(t.camelot||"").toUpperCase()!==a.camelot)return false;
    if(a.rating&&(Number(t.rating)||0)<a.rating)return false;
    return true;
  });
}
const KEY_TO_CAMELOT={
  "Abm":"1A","G#m":"1A","Ebm":"2A","D#m":"2A","Bbm":"3A","A#m":"3A","Fm":"4A","Cm":"5A","Gm":"6A","Dm":"7A","Am":"8A","Em":"9A","Bm":"10A","F#m":"11A","Gbm":"11A","C#m":"12A","Dbm":"12A",
  "B":"1B","F#":"2B","Gb":"2B","Db":"3B","C#":"3B","Ab":"4B","G#":"4B","Eb":"5B","D#":"5B","Bb":"6B","A#":"6B","F":"7B","C":"8B","G":"9B","D":"10B","A":"11B","E":"12B"
};
function camelotCompatible(a,b){
  const norm=v=>/^\d{1,2}[AB]$/i.test(String(v||""))?String(v).toUpperCase():KEY_TO_CAMELOT[v];
  const ca=norm(a),cb=norm(b);if(!ca||!cb)return false;
  const na=parseInt(ca),nb=parseInt(cb),la=ca.slice(-1),lb=cb.slice(-1);
  const prev=na===1?12:na-1,next=na===12?1:na+1;
  return cb===ca || (nb===na&&lb!==la) || (lb===la&&(nb===prev||nb===next));
}
function relatedRows(){
  const base=libraryState.collection.find(t=>String(t.id)===String(libraryState.selected))||libraryState.queue[0];
  if(!base)return [];
  const bpm=Number(base.bpm)||0;
  return libraryState.collection.filter(t=>String(t.id)!==String(base.id)&&!t.is_sampler).map(t=>{
    const tb=Number(t.bpm)||0, harmonic=camelotCompatible(base.camelot||base.key,t.camelot||t.key), signed=bpm&&tb?tb-bpm:999,diff=Math.abs(signed);
    const bpmClose=diff<=Math.max(3,bpm*.06),bucket=harmonic&&bpmClose?0:harmonic?1:bpmClose?2:3;
    return {t:{...t,_relation:{harmonic,bpmClose,bpmDelta:signed,baseKey:base.camelot||base.key||"",baseBpm:bpm}},score:bucket*100+diff};
  }).filter(x=>x.score<312).sort((a,b)=>a.score-b.score).map(x=>x.t).slice(0,120);
}
function displayRows(){
  let rows;
  if(libraryState.view==="playlist"||libraryState.view==="history_session") rows=[...libraryState.customRows];
  else if(libraryState.view==="queue") rows=[...libraryState.queue];
  else if(libraryState.view==="related") rows=relatedRows();
  else if(libraryState.view==="mixpicks") rows=[...libraryState.mixPicks];
  else if(libraryState.view==="history") rows=libraryState.collection.filter(t=>(t.plays||0)>0).sort((a,b)=>(b.plays||0)-(a.plays||0));
  else rows=filterCollection();
  const q=libraryState.search.trim().toLowerCase();
  if(q&&libraryState.view!=="browse")rows=rows.filter(t=>`${t.title} ${t.artist} ${t.album} ${t.genre} ${t.key} ${t.bpm}`.toLowerCase().includes(q));
  if(libraryState.view!=="browse"){
    const a=libraryState.advanced;
    rows=rows.filter(t=>{
      const bpm=Number(t.bpm)||0;
      if(a.bpmMin&&(!bpm||bpm<a.bpmMin))return false;
      if(a.bpmMax&&(!bpm||bpm>a.bpmMax))return false;
      if(a.camelot&&String(t.camelot||"").toUpperCase()!==a.camelot)return false;
      if(a.rating&&(Number(t.rating)||0)<a.rating)return false;
      return true;
    });
  }
  if(libraryState.sortKey){
    const key=libraryState.sortKey,dir=libraryState.sortDir;
    rows=[...rows].sort((a,b)=>{
      let av=a?.[key],bv=b?.[key];
      if(key==="bpm"||key==="length"){av=Number(av)||0;bv=Number(bv)||0;return (av-bv)*dir}
      return String(av||"").localeCompare(String(bv||""),undefined,{numeric:true,sensitivity:"base"})*dir;
    });
  }
  return rows;
}
function viewTitle(){
  if(libraryState.view==="playlist"||libraryState.view==="history_session")return libraryState.customTitle||(libraryState.view==="playlist"?"Playlist":"History");
  if(libraryState.view==="related"){
    const base=libraryState.collection.find(t=>String(t.id)===String(libraryState.selected))||libraryState.queue[0];
    if(base)return `Related Tracks · ${base.camelot||base.key||"—"} · ${base.bpm?Number(base.bpm).toFixed(1):"—"} BPM`;
  }
  if(libraryState.view==="mixpicks"){
    const base=libraryState.mixPicksSource;
    return base?`Mix Picks · ${base.title||"Track"} · ${base.camelot||base.key||"—"} · ${base.bpm?Number(base.bpm).toFixed(1):"—"} BPM`:`Mix Picks`;
  }
  return {browse:"Collection",queue:"Automix / Queue",related:"Related Tracks",mixpicks:"Mix Picks",history:"History / Most Played"}[libraryState.view]||"Collection";
}
function setLibraryView(view){
  if(view!==libraryState.view)invalidateBrowseLink("Rekordbox cursor lock cleared: browser view changed");
  libraryState.view=view;
  trackRowsEl.scrollTop=0;
  document.querySelectorAll(".browser-tabs [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.querySelectorAll(".media-item[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  if(view==="mixpicks")loadMixPicks(false);else renderCollection();
}
function mixPickBaseTrack(){
  return libraryState.collection.find(t=>String(t.id)===String(libraryState.selected)) || currentDeckTrack(libraryState.activeDeck||1) || libraryState.queue[0] || null;
}
async function loadMixPicks(force=false){
  const base=mixPickBaseTrack();
  if(!base?.id){libraryState.mixPicks=[];libraryState.mixPicksSource=null;libraryState.mixPicksError="Select a track or load a deck first";libraryState.mixPicksLoading=false;renderCollection();return;}
  if(!force&&String(libraryState.mixPicksSource?.id||"")===String(base.id)&&libraryState.mixPicks.length){renderCollection();return;}
  libraryState.mixPicksSource=base;libraryState.mixPicks=[];libraryState.mixPicksLoading=true;libraryState.mixPicksError="";renderCollection();
  try{
    const res=await fetch(`/api/transition-candidates?id=${encodeURIComponent(base.id)}&limit=16`,{cache:"no-store"});
    const data=await res.json();
    if(data.error)throw new Error(data.error);
    if(String(libraryState.mixPicksSource?.id||"")!==String(base.id))return;
    libraryState.mixPicks=Array.isArray(data.tracks)?data.tracks:[];libraryState.mixPicksLoading=false;libraryState.mixPicksError="";renderCollection();
  }catch(err){
    if(String(libraryState.mixPicksSource?.id||"")!==String(base.id))return;
    libraryState.mixPicks=[];libraryState.mixPicksLoading=false;libraryState.mixPicksError=String(err?.message||err);renderCollection();
  }
}
function selectedTrack(){
  return libraryState.collection.find(t=>String(t.id)===String(libraryState.selected)) || displayRows().find(t=>String(t.id)===String(libraryState.selected)) || null;
}
function moveBrowserSelection(delta){
  const rows=displayRows();if(!rows.length)return;
  let idx=rows.findIndex(t=>String(t.id)===String(libraryState.selected));
  const step=Math.max(-63,Math.min(63,Math.trunc(Number(delta)||1)));
  if(idx<0)idx=step>0?-1:rows.length;
  idx=Math.max(0,Math.min(rows.length-1,idx+step));
  libraryState.selected=rows[idx].id;renderCollection(true);
}
function browserMirrorSafe(){
  const a=libraryState.advanced;
  return libraryState.view==="browse"&&libraryState.filter==="all"&&!libraryState.search.trim()&&!libraryState.sortKey&&!a.bpmMin&&!a.bpmMax&&!a.camelot&&!a.rating;
}
function setBrowseLinked(linked,reason=""){
  libraryState.browseLinked=!!linked;
  const el=document.getElementById("browserLinkState"),btn=document.getElementById("browserAlign");
  if(el){el.textContent=linked?"RB CURSOR LOCKED":"RB CURSOR UNLINKED";el.classList.toggle("linked",!!linked);if(reason)el.title=reason;}
  if(btn){btn.textContent=linked?"UNLINK RB":"ALIGN RB";btn.classList.toggle("active",!!linked);}
  if(reason)logLine(reason);
}
function invalidateBrowseLink(reason){
  if(libraryState.browseLinked)setBrowseLinked(false,reason||"Rekordbox browser cursor unlinked");
}
function sendBrowseDelta(delta){
  let left=Math.trunc(Number(delta)||0);
  while(left!==0){const step=Math.max(-63,Math.min(63,left));sendControl("browser_rotate",{delta:step});left-=step;}
}
function selectTrackWithBrowserMirror(id,loadDeck=null){
  const rows=displayRows(),target=rows.findIndex(t=>String(t.id)===String(id)),current=rows.findIndex(t=>String(t.id)===String(libraryState.selected));
  if(libraryState.browseLinked&&browserMirrorSafe()&&target>=0&&current>=0){
    sendBrowseDelta(target-current);
    if(loadDeck)sendControl("browser_load",{deck:loadDeck});
    return true;
  }
  libraryState.selected=id;renderCollection(true);
  if(loadDeck){
    const t=selectedTrack();if(t){libraryState.loaded[loadDeck]=t;libraryState.loadedMidi[loadDeck]=false;updateDeckPreviews();logLine(`Deck ${loadDeck} preview ← ${t.title} · align the Rekordbox cursor to enable exact MIDI LOAD`);}
  }
  return false;
}
function loadSelectedToDeck(deck,sendMidi=true){
  const t=selectedTrack();if(!t)return;
  if(sendMidi&&!(libraryState.browseLinked&&browserMirrorSafe())){
    libraryState.loaded[deck]=t;libraryState.loadedMidi[deck]=false;updateDeckPreviews();
    logLine(`Deck ${deck} preview ← ${t.title} · ALIGN RB before native LOAD`);
    return;
  }
  libraryState.loaded[deck]=t;libraryState.loadedMidi[deck]=!sendMidi;updateDeckPreviews();
  if(sendMidi)sendControl("browser_load",{deck});
  logLine(`Load ${deck} ← ${t.title}`);
}
function renderPlaylists(){
  playlistList.innerHTML=libraryState.playlists.map(p=>`<button class="playlist-link" data-playlist-id="${esc(p.id)}"><span>${esc(p.name)}</span><i>${Number(p.count)||0}</i></button>`).join("");
  playlistList.querySelectorAll(".playlist-link").forEach(btn=>btn.addEventListener("click",()=>loadPlaylist(btn.dataset.playlistId,btn.querySelector("span").textContent)));
}
function renderHistories(){
  historyList.innerHTML=libraryState.histories.slice(0,16).map(h=>{
    const date=String(h.date||"").slice(0,10);
    return `<button class="history-link" data-history-id="${esc(h.id)}"><span><b>${esc(date||"History")}</b><em>${esc(h.name||"History")}</em></span><i>${Number(h.count)||0}</i></button>`;
  }).join("");
  historyList.querySelectorAll(".history-link").forEach(btn=>btn.addEventListener("click",()=>loadHistory(btn.dataset.historyId,btn.querySelector("em")?.textContent||"History")));
}
async function loadPlaylist(id,name){
  invalidateBrowseLink("Rekordbox cursor lock cleared: dashboard playlist changed");
  playlistList.querySelectorAll(".playlist-link").forEach(b=>b.classList.toggle("active",b.dataset.playlistId===String(id)));
  libraryState.view="playlist";libraryState.customRows=[];libraryState.customTitle=name||"Playlist";libraryState.customTotal=0;
  document.querySelectorAll(".browser-tabs [data-view]").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".media-item[data-view]").forEach(b=>b.classList.remove("active"));
  collectionTitle.textContent=libraryState.customTitle;trackCount.textContent="Loading…";
  try{
    const res=await fetch(`/api/playlist?id=${encodeURIComponent(id)}&limit=10000`,{cache:"no-store"});const data=await res.json();
    libraryState.customRows=Array.isArray(data.tracks)?data.tracks:[];libraryState.customTitle=data.name||name||"Playlist";libraryState.customTotal=Number(data.count)||libraryState.customRows.length;libraryState.view="playlist";
    renderCollection();
  }catch(err){libraryState.customRows=[];libraryState.customTitle=name||"Playlist";renderCollection();logLine(`Playlist error: ${err.message||err}`)}
}
async function loadHistory(id,name){
  historyList.querySelectorAll(".history-link").forEach(b=>b.classList.toggle("active",b.dataset.historyId===String(id)));
  libraryState.view="history_session";libraryState.customRows=[];libraryState.customTitle=name||"History";libraryState.customTotal=0;
  document.querySelectorAll(".browser-tabs [data-view]").forEach(b=>b.classList.remove("active"));document.querySelectorAll(".media-item[data-view]").forEach(b=>b.classList.remove("active"));
  collectionTitle.textContent=libraryState.customTitle;trackCount.textContent="Loading…";
  try{
    const res=await fetch(`/api/history?id=${encodeURIComponent(id)}&limit=2000`,{cache:"no-store"});const data=await res.json();
    libraryState.customRows=Array.isArray(data.tracks)?data.tracks:[];
    const date=String(data.date||"").slice(0,10);
    libraryState.customTitle=`History · ${date||data.name||name||"Session"}`;
    libraryState.customTotal=Number(data.count)||libraryState.customRows.length;libraryState.view="history_session";
    renderCollection();
  }catch(err){libraryState.customRows=[];libraryState.customTitle=name||"History";renderCollection();logLine(`History error: ${err.message||err}`)}
}
function renderArtworkGrid(rows,ensureSelected=false){
  if(waveObserver)waveObserver.disconnect();
  const oldScroll=artworkGridEl.scrollTop;
  if(!rows.length){
    artworkGridEl.innerHTML=emptyCollectionHtml();
    bindCollectionEmptyReset(artworkGridEl);
    artworkGridEl.scrollTop=0;
    return;
  }
  const limit=Math.min(rows.length,Math.max(60,libraryState.artworkLimit||180));
  const visible=rows.slice(0,limit);
  artworkGridEl.innerHTML=visible.map(t=>{
    const selected=String(libraryState.selected)===String(t.id)?" selected":"";
    const art=t.artwork?`<img data-art="${esc(t.artwork)}" alt="" />`:`<div class="track-art-fallback"></div>`;
    return `<article class="art-card${selected}" draggable="true" data-track-id="${esc(t.id)}">
      <div class="art-card-cover">${art}</div>
      <div class="art-card-info"><strong>${esc(t.title||"Untitled")}</strong><span>${esc(t.artist||t.album||"Unknown artist")}</span><div class="art-card-meta"><b>${esc(t.camelot||t.key||"—")}</b><span>${t.bpm?Number(t.bpm).toFixed(1)+" BPM":"—"}</span><span>${fmtTime(t.length)}</span></div></div>
      <button class="queue-add" data-q-id="${esc(t.id)}">+Q</button>
    </article>`;
  }).join("")+(limit<rows.length?`<button class="art-grid-more" id="artGridMore">LOAD MORE · ${rows.length-limit} REMAINING</button>`:"");

  artworkGridEl.querySelectorAll(".art-card").forEach(card=>{
    card.addEventListener("click",e=>{if(e.target.closest(".queue-add"))return;selectTrackWithBrowserMirror(card.dataset.trackId,null)});
    card.addEventListener("dblclick",()=>selectTrackWithBrowserMirror(card.dataset.trackId,libraryState.activeDeck));
    card.addEventListener("dragstart",e=>{e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("application/x-rekordbox-track",card.dataset.trackId);card.classList.add("dragging")});
    card.addEventListener("dragend",()=>card.classList.remove("dragging"));
  });
  artworkGridEl.querySelectorAll(".queue-add").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();addToLocalQueue(btn.dataset.qId)}));
  document.getElementById("artGridMore")?.addEventListener("click",()=>{libraryState.artworkLimit+=180;renderCollection()});

  if(artObserver)artObserver.disconnect();
  artObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){if(!entry.isIntersecting)continue;queueArtwork(entry.target);artObserver.unobserve(entry.target)}
  },{root:artworkGridEl,rootMargin:"160px 0px"});
  artworkGridEl.querySelectorAll("img[data-art]").forEach(img=>artObserver.observe(img));

  artworkGridEl.scrollTop=oldScroll;
  if(ensureSelected&&libraryState.selected){
    const card=artworkGridEl.querySelector(`.art-card[data-track-id="${CSS.escape(String(libraryState.selected))}"]`);
    if(card)card.scrollIntoView({block:"nearest"});
  }
}
function emptyCollectionHtml(){
  const bits=[];
  if(libraryState.search.trim())bits.push(`search “${esc(libraryState.search.trim())}”`);
  const a=libraryState.advanced;
  if(a.bpmMin||a.bpmMax)bits.push(`BPM ${a.bpmMin||"—"}–${a.bpmMax||"—"}`);
  if(a.camelot)bits.push(`Camelot ${esc(a.camelot)}`);
  if(a.rating)bits.push(`${a.rating}+ ★`);
  if(libraryState.filter!=="all")bits.push(esc(libraryState.filter));
  const context=bits.length?bits.join(" · "):"the current view";
  return `<div class="collection-empty"><b>NO MATCHING TRACKS</b><span>No tracks match ${context}.</span><button data-empty-reset>RESET FILTERS</button></div>`;
}
function bindCollectionEmptyReset(root){
  root.querySelector("[data-empty-reset]")?.addEventListener("click",()=>{
    librarySearch.value="";libraryState.search="";libraryState.filter="all";
    document.querySelectorAll(".filter-item").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));
    filterBpmMin.value="";filterBpmMax.value="";filterCamelot.value="";filterRating.value="0";
    libraryState.advanced={bpmMin:0,bpmMax:0,camelot:"",rating:0};
    trackRowsEl.scrollTop=0;artworkGridEl.scrollTop=0;renderCollection();
  });
}
function renderCollection(ensureSelected=false){
  const rows=displayRows();
  const a=libraryState.advanced,hasClientFilter=!!(libraryState.search.trim()||a.bpmMin||a.bpmMax||a.camelot||a.rating||libraryState.sortKey);
  const sourceTotal=!hasClientFilter&&(libraryState.view==="playlist"||libraryState.view==="history_session")&&libraryState.customTotal>rows.length?libraryState.customTotal:rows.length;
  trackCount.textContent=libraryState.view==="mixpicks"&&libraryState.mixPicksLoading?"Analyzing phrase grid…":`${sourceTotal} Tracks`;
  collectionCount.textContent=libraryState.totalCount||libraryState.collection.length||"—";collectionTitle.textContent=viewTitle();
  if(libraryState.view==="mixpicks"&&libraryState.mixPicksLoading){
    trackTableEl.classList.remove("hidden");artworkGridEl.classList.add("hidden");
    trackRowsEl.innerHTML=`<div class="mixpicks-loading"><b>ANALYZING REKORDBOX PHRASE DATA</b><span>Prefiltering by Camelot/BPM, then scoring real beat-grid, phrase, and hot-cue transition points…</span><i></i></div>`;
    return;
  }
  if(libraryState.view==="mixpicks"&&libraryState.mixPicksError){
    trackTableEl.classList.remove("hidden");artworkGridEl.classList.add("hidden");
    trackRowsEl.innerHTML=`<div class="mixpicks-loading error"><b>MIX PICKS UNAVAILABLE</b><span>${esc(libraryState.mixPicksError)}</span></div>`;
    return;
  }
  const artworkMode=libraryState.displayMode==="artwork";
  trackTableEl.classList.toggle("hidden",artworkMode);
  artworkGridEl.classList.toggle("hidden",!artworkMode);
  document.getElementById("listViewButton")?.classList.toggle("active",!artworkMode);
  document.getElementById("artworkViewButton")?.classList.toggle("active",artworkMode);
  if(artworkMode){renderArtworkGrid(rows,ensureSelected);return;}
  if(!rows.length){trackRowsEl.innerHTML=emptyCollectionHtml();bindCollectionEmptyReset(trackRowsEl);trackRowsEl.scrollTop=0;return;}
  let targetScroll=trackRowsEl.scrollTop;
  const selectedIndex=rows.findIndex(t=>String(t.id)===String(libraryState.selected));
  if(ensureSelected&&selectedIndex>=0){
    const y=selectedIndex*TRACK_ROW_H,h=Math.max(120,trackRowsEl.clientHeight||260);
    if(y<targetScroll||y+TRACK_ROW_H>targetScroll+h)targetScroll=Math.max(0,y-h*.45);
  }
  let start=Math.max(0,Math.floor(targetScroll/TRACK_ROW_H)-TRACK_OVERSCAN);
  start=Math.min(start,Math.max(0,rows.length-TRACK_WINDOW));
  const visibleRows=rows.slice(start,start+TRACK_WINDOW);
  const topSpace=start*TRACK_ROW_H,bottomSpace=Math.max(0,(rows.length-start-visibleRows.length)*TRACK_ROW_H);
  trackRowsEl.innerHTML=`<div class="track-spacer" style="height:${topSpace}px"></div>`+visibleRows.map((t,i)=>{
    const selected=libraryState.selected===t.id?" selected":"";
    const art=t.artwork?`<img data-art="${esc(t.artwork)}" alt="" />`:`<div class="track-art-fallback"></div>`;
    const rel=t._relation,tr=t._transition,ts=tr?.suggestion||null;
    const shownDelta=rel&&Number.isFinite(rel.bpmDelta)?(Math.abs(rel.bpmDelta)<.05?0:rel.bpmDelta):null;
    const transitionBadge=tr?`<em class="mix-badge transition ${esc(tr.confidence||"low")}" title="${ts?`D1 ${fmtTime(Number(ts.from_start_sec)||0)} → D2 ${fmtTime(Number(ts.to_start_sec)||0)} · incoming tempo ${Number(tr.incoming_tempo_percent_to_match||0)>=0?"+":""}${Number(tr.incoming_tempo_percent_to_match||0).toFixed(2)}% · BPM ×${Number(tr.tempo_multiplier)||1} · style ${Math.round((Number(tr.style_similarity)||0)*100)}%`:"No phrase-aligned plan"}">AI ${(tr.confidence||"low").toUpperCase()} · ${ts?`${Number(ts.from_bars)||0}/${Number(ts.to_bars)||0}B`:"NO GRID"} · Δ${Number(tr.bpm_delta||0).toFixed(1)}</em>`:"";
    const mixBadge=transitionBadge||(rel?`<em class="mix-badge ${rel.harmonic?"harmonic":rel.bpmClose?"tempo":""}">${rel.harmonic?"HARMONIC":"TEMPO"} ${shownDelta!==null?`${shownDelta>=0?"+":""}${shownDelta.toFixed(1)}`:""}</em>`:"");
    return `<div class="track-row${selected}" draggable="true" data-track-id="${esc(t.id)}">
      <span class="row-index">${String(start+i+1).padStart(2,"0")}</span>
      <span>${waveHtml(t)}</span>
      <span class="track-art">${art}</span>
      <span class="track-title"><span>${esc(t.title)}</span>${mixBadge}</span>
      <span>${esc(t.artist||"—")}</span>
      <span>${esc(t.genre||"—")}</span>
      <span class="track-bpm">${t.bpm?Number(t.bpm).toFixed(1):"—"}</span>
      <span class="track-key" title="${esc(t.key||"")}">${esc(t.camelot||t.key||"—")}</span>
      <span class="track-time">${fmtTime(t.length)}</span>
      <span><button class="queue-add" data-q-id="${esc(t.id)}">+Q</button></span>
    </div>`
  }).join("")+`<div class="track-spacer" style="height:${bottomSpace}px"></div>`;
  trackRowsEl.querySelectorAll(".track-row").forEach(row=>{
    row.addEventListener("click",e=>{if(e.target.closest(".queue-add"))return;selectTrackWithBrowserMirror(row.dataset.trackId,null)});
    row.addEventListener("dblclick",()=>selectTrackWithBrowserMirror(row.dataset.trackId,libraryState.activeDeck));
    row.addEventListener("dragstart",e=>{e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("application/x-rekordbox-track",row.dataset.trackId);row.classList.add("dragging")});
    row.addEventListener("dragend",()=>row.classList.remove("dragging"));
  });
  trackRowsEl.querySelectorAll(".queue-add").forEach(btn=>btn.addEventListener("click",e=>{e.stopPropagation();addToLocalQueue(btn.dataset.qId)}));
  if(artObserver)artObserver.disconnect();
  artObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const img=entry.target;queueArtwork(img);
      artObserver.unobserve(img);
    }
  },{root:trackRowsEl,rootMargin:"80px 0px"});
  trackRowsEl.querySelectorAll("img[data-art]").forEach(img=>artObserver.observe(img));
  if(waveObserver)waveObserver.disconnect();
  waveObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){if(!entry.isIntersecting)continue;queueMiniWave(entry.target);waveObserver.unobserve(entry.target)}
  },{root:trackRowsEl,rootMargin:"120px 0px"});
  trackRowsEl.querySelectorAll(".mini-wave[data-wave-id]").forEach(el=>waveObserver.observe(el));
  trackRowsEl.scrollTop=targetScroll;
}
function renderQueue(){
  queueCount.textContent=libraryState.queue.length;
  queueRowsEl.innerHTML=libraryState.queue.map((t,i)=>{
    const pm=libraryState.queuePlanMeta?.[String(t.id)],confidence=pm?.confidence||"";
    const planBadge=pm?`<em class="queue-plan-badge ${esc(confidence||"source")}" title="${pm.fromSec!==null&&pm.fromSec!==undefined?`Planned transition ${fmtTime(Number(pm.fromSec)||0)} → ${fmtTime(Number(pm.toSec)||0)} · Δ ${Number(pm.bpmDelta||0).toFixed(2)} BPM`:"AI set source"}">AI SET ${Number(pm.order)||1}/${Number(pm.total)||1}${confidence?` · ${confidence.toUpperCase()}${pm.fromBars?` ${pm.fromBars}/${pm.toBars}B`:""}`:""}</em>`:"";
    return `<div class="queue-row" draggable="true" data-queue-index="${i}">
      <span class="queue-no">${String(i+1).padStart(2,"0")}</span>
      ${t.artwork?`<img class="queue-art" data-art="${esc(t.artwork)}" alt="" />`:`<div class="track-art-fallback"></div>`}
      <div class="queue-info"><strong>${esc(t.title)}</strong><span>${esc(t.artist||t.album||"Unknown artist")}${planBadge}</span></div>
      <div class="queue-meta"><b title="${esc(t.key||"")}">${esc(t.camelot||t.key||"—")}</b><span>${t.bpm?Number(t.bpm).toFixed(1):"—"}</span><button class="queue-remove" data-remove-index="${i}" title="Remove from dashboard queue">×</button></div>
    </div>`;
  }).join("") || `<div class="queue-row"><span class="queue-no">—</span><div class="queue-info"><strong>No queued tracks</strong><span>Double-click a Collection track</span></div><div></div></div>`;
  queueRowsEl.querySelectorAll(".queue-row[data-queue-index]").forEach(row=>{
    row.addEventListener("click",()=>{
      const t=libraryState.queue[Number(row.dataset.queueIndex)];if(!t)return;
      libraryState.selected=t.id;
      queueRowsEl.querySelectorAll(".queue-row").forEach(x=>x.classList.toggle("selected",x===row));
    });
    row.addEventListener("dblclick",()=>{
      const t=libraryState.queue[Number(row.dataset.queueIndex)];if(!t)return;
      selectTrackWithBrowserMirror(t.id,libraryState.activeDeck);
    });
    row.addEventListener("dragstart",e=>{
      const item=libraryState.queue[Number(row.dataset.queueIndex)];
      e.dataTransfer.effectAllowed="copyMove";e.dataTransfer.setData("application/x-rekordbox-queue-index",row.dataset.queueIndex);
      if(item?.id)e.dataTransfer.setData("application/x-rekordbox-track",String(item.id));
      row.classList.add("dragging");
    });
    row.addEventListener("dragend",()=>row.classList.remove("dragging"));
    row.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="move"});
    row.addEventListener("drop",e=>{
      e.preventDefault();e.stopPropagation();
      const to=Number(row.dataset.queueIndex),fromRaw=e.dataTransfer.getData("application/x-rekordbox-queue-index");
      if(fromRaw!==""){
        const from=Number(fromRaw);if(!Number.isInteger(from)||!Number.isInteger(to)||from===to)return;
        const [item]=libraryState.queue.splice(from,1);libraryState.queue.splice(to,0,item);
      }else{
        const id=e.dataTransfer.getData("application/x-rekordbox-track"),item=libraryState.collection.find(t=>String(t.id)===String(id));
        if(!item||!Number.isInteger(to))return;libraryState.queue.splice(to,0,item);
      }
      persistDashboardQueue();renderQueue();updateDeckPreviews();if(libraryState.view==="queue")renderCollection();
    });
  });
  queueRowsEl.querySelectorAll(".queue-remove").forEach(btn=>btn.addEventListener("click",e=>{
    e.stopPropagation();
    const i=Number(btn.dataset.removeIndex);if(!Number.isInteger(i)||i<0||i>=libraryState.queue.length)return;
    const [removed]=libraryState.queue.splice(i,1);if(removed)delete libraryState.queuePlanMeta[String(removed.id)];persistDashboardQueue();renderQueue();updateDeckPreviews();if(libraryState.view==="queue")renderCollection();
    if(removed)logLine(`Removed ${removed.title} from dashboard Q`);
  }));
  queueRowsEl.querySelectorAll("img[data-art]").forEach(img=>queueArtwork(img));
}
function persistDashboardQueue(){
  try{
    const ids=libraryState.queue.map(t=>String(t.id)).filter(Boolean),keep=new Set(ids),meta={};
    for(const [id,value] of Object.entries(libraryState.queuePlanMeta||{})){if(keep.has(String(id)))meta[String(id)]=value}
    libraryState.queuePlanMeta=meta;
    localStorage.setItem(QUEUE_STORAGE_KEY,JSON.stringify(ids));
    localStorage.setItem(QUEUE_PLAN_STORAGE_KEY,JSON.stringify(meta));
  }catch{}
  const source=document.getElementById("queueSourceLabel");if(source)source.textContent="AUTOMIX + DASHBOARD Q · SAVED";
}
function restoreDashboardQueue(automix=[]){
  let saved=[];try{saved=JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY)||"[]")}catch{saved=[]}
  let savedPlan={};try{savedPlan=JSON.parse(localStorage.getItem(QUEUE_PLAN_STORAGE_KEY)||"{}")||{}}catch{savedPlan={}}
  const byId=new Map(libraryState.collection.map(t=>[String(t.id),t]));
  const restored=[];const seen=new Set();
  for(const id of Array.isArray(saved)?saved:[]){const t=byId.get(String(id));if(t&&!seen.has(String(id))){restored.push(t);seen.add(String(id))}}
  for(const t of automix){const id=String(t.id);if(!seen.has(id)){restored.push(t);seen.add(id)}}
  libraryState.queue=restored.length?restored:[...automix];
  libraryState.queuePlanMeta={};for(const [id,value] of Object.entries(savedPlan)){if(seen.has(String(id))&&value&&typeof value==="object")libraryState.queuePlanMeta[String(id)]=value}
  const source=document.getElementById("queueSourceLabel");if(source)source.textContent=saved.length?"AUTOMIX + DASHBOARD Q · SAVED":"AUTOMIX + DASHBOARD Q";
}
function renderDeckCueStrip(deck,t){
  const el=document.getElementById(`deck${deck}Cues`);if(!el)return;
  const cues=Array.isArray(t?._cues?.cues)?t._cues.cues:[];
  el.innerHTML=cues.filter(c=>c.hot_cue||c.memory_cue).slice(0,8).map(c=>{
    const color=cueColor(c),klass=c.memory_cue?" memory":"";
    return `<i class="cue-chip${klass}${c.loop?" loop":""}" style="background:${esc(color)}" title="${esc(c.comment||`${c.label} · ${(Number(c.in_ms)/1000).toFixed(2)}s`)}">${esc(c.label||"M")}</i>`;
  }).join("");
}
function currentDeckTrack(deck){
  const idx=Number(deck)-1;return libraryState.loaded[deck]||libraryState.queue[idx]||libraryState.collection[idx]||null;
}
function refreshCuePadStates(){
  if(!controllerVisualReady)return;
  for(const deck of [1,2]){
    const t=currentDeckTrack(deck),cues=Array.isArray(t?._cues?.cues)?t._cues.cues:[];
    const bySlot=new Map(cues.filter(c=>c.hot_cue&&Number(c.slot)>=1&&Number(c.slot)<=8).map(c=>[Number(c.slot),c]));
    for(let i=0;i<8;i++){
      const g=controlsById.get(`pad-${deck}-${i}`),target=g?.userData?.flashTarget;if(!target?.material)continue;
      const cue=uiState.padMode==="hotcue"?bySlot.get(i+1):null;
      const rx=!!feedbackUi.hotcuePads[deck]?.[i];
      target.material.opacity=rx?0.52:cue?0.22:0;
      if(target.material.color)target.material.color.set(rx?0x62b8f5:cue?cueColor(cue):0xff7a18);
    }
  }
}
function updateDeckPreviews(){
  const picks=[libraryState.loaded[1]||libraryState.queue[0]||libraryState.collection[0],libraryState.loaded[2]||libraryState.queue[1]||libraryState.collection[1]];
  picks.forEach((t,i)=>{
    const deck=i+1;if(!t)return;
    const title=document.getElementById(`deck${deck}Title`),artist=document.getElementById(`deck${deck}Artist`),art=document.getElementById(`deck${deck}Art`);
    const isLoaded=!!libraryState.loaded[deck],midiLoaded=!!libraryState.loadedMidi[deck];
    title.textContent=t.title||`DECK ${deck}`;artist.textContent=(t.artist||"Unknown artist")+(isLoaded?(midiLoaded?" · LOADED / REKORDBOX":" · PREVIEW ONLY"):" · QUEUE PREVIEW");
    document.getElementById(`deck${deck}Bpm`).textContent=t.bpm?`${Number(t.bpm).toFixed(1)} BPM`:"— BPM";
    document.getElementById(`deck${deck}Key`).textContent=t.camelot?(t.camelot+" · "+(t.key||"")):(t.key||"—");
    ensureTransportTrack(deck,t);updateTransportReadout(deck);
    renderDeckCueStrip(deck,t);
    if(t.artwork){art.src=t.artwork;art.style.visibility="visible"}else{art.removeAttribute("src");art.style.visibility="hidden"}
    if(t.id&&!(t._wave&&t._cues&&t._analysis)&&!t._detailLoading){
      t._detailLoading=true;
      fetch(`/api/track-detail?id=${encodeURIComponent(t.id)}&points=420`).then(r=>r.json()).then(data=>{
        t._wave=data.waveform||{heights:[],colors:[]};
        t._cues=data.cues||{cues:[],count:0};
        t._analysis=data.analysis||{beats:[],phrases:[],mood:null};
        t._detailLoading=false;renderDeckCueStrip(deck,t);refreshCuePadStates();updateMixPointPanel();redrawWaves();
      }).catch(()=>{t._detailLoading=false});
    }
  });
  updateMasterPhase();
  syncSamplerPanel();updateMixPointPanel();refreshCuePadStates();
  redrawWaves();
}
function updateMasterPhase(){
  const masterDeck=libraryState.activeDeck||1,master=currentDeckTrack(masterDeck),other=currentDeckTrack(masterDeck===1?2:1);
  const masterBpm=Number(master?.bpm)||0,otherBpm=Number(other?.bpm)||0;
  const clock=document.getElementById("masterClock");if(clock)clock.textContent=masterBpm?masterBpm.toFixed(1):"—";
  const bars=[...document.querySelectorAll("#phaseMeter i")];if(!bars.length)return;
  bars.forEach(x=>x.classList.remove("hot"));
  let idx=3;
  if(masterBpm&&otherBpm){const delta=otherBpm-masterBpm;idx=Math.max(0,Math.min(bars.length-1,Math.round(3.5+delta/3)));}
  bars[idx]?.classList.add("hot");
  const meter=document.getElementById("phaseMeter");if(meter)meter.title=masterBpm&&otherBpm?`Deck ${masterDeck} master · ${masterBpm.toFixed(1)} BPM · other deck ${(otherBpm-masterBpm)>=0?"+":""}${(otherBpm-masterBpm).toFixed(1)} BPM`:`Deck ${masterDeck} master`;
}
function addToLocalQueue(id){
  const t=libraryState.collection.find(x=>String(x.id)===String(id));if(!t)return;
  if(!libraryState.queue.some(x=>String(x.id)===String(t.id)))libraryState.queue.push(t);
  persistDashboardQueue();renderQueue();updateDeckPreviews();logLine(`Queued ${t.title}`);
}
async function loadLibrary(force=false){
  librarySource.textContent="READING REKORDBOX…";
  try{
    const res=await fetch(`/api/library${force?`?force=1&t=${Date.now()}`:""}`,{cache:"no-store"});
    const data=await res.json();
    if(force){libraryState.mixPicks=[];libraryState.mixPicksSource=null;libraryState.mixPicksLoading=false;libraryState.mixPicksError=""}
    libraryState.collection=Array.isArray(data.collection)?data.collection:[];
    const automix=Array.isArray(data.queue)&&data.queue.length?data.queue:libraryState.collection.slice(0,8);
    restoreDashboardQueue(automix);
    libraryState.totalCount=Number(data.count)||libraryState.collection.length;
    libraryState.playlists=Array.isArray(data.playlists)?data.playlists:[];renderPlaylists();
    libraryState.histories=Array.isArray(data.histories)?data.histories:[];renderHistories();
    libraryState.samplerSets=Array.isArray(data.sampler_sets)?data.sampler_sets:[];renderSamplerLibrary();renderSoftwareSamplerPads();
    librarySource.textContent=data.source==="rekordbox-master-db"?"REKORDBOX MASTER.DB · READ ONLY":"LIBRARY OFFLINE";
    renderQueue();updateDeckPreviews();
    if(libraryState.view==="mixpicks")loadMixPicks(true);else renderCollection();
  }catch(err){
    librarySource.textContent="LIBRARY OFFLINE";trackRowsEl.innerHTML=`<div class="queue-foot">${esc(err.message||err)}</div>`;
  }
}
for(const letter of ["A","B"]){for(let n=1;n<=12;n++){const o=document.createElement("option");o.value=`${n}${letter}`;o.textContent=`${n}${letter}`;filterCamelot.appendChild(o)}}
function advancedFiltersChanged(){
  invalidateBrowseLink("Rekordbox cursor lock cleared: advanced filter changed");
  libraryState.advanced.bpmMin=Math.max(0,Number(filterBpmMin.value)||0);
  libraryState.advanced.bpmMax=Math.max(0,Number(filterBpmMax.value)||0);
  libraryState.advanced.camelot=String(filterCamelot.value||"").toUpperCase();
  libraryState.advanced.rating=Math.max(0,Number(filterRating.value)||0);
  libraryState.artworkLimit=180;trackRowsEl.scrollTop=0;artworkGridEl.scrollTop=0;renderCollection();
}
filterBpmMin.addEventListener("input",advancedFiltersChanged);filterBpmMax.addEventListener("input",advancedFiltersChanged);filterCamelot.addEventListener("change",advancedFiltersChanged);filterRating.addEventListener("change",advancedFiltersChanged);
document.getElementById("clearAdvancedFilters").addEventListener("click",()=>{
  filterBpmMin.value="";filterBpmMax.value="";filterCamelot.value="";filterRating.value="0";advancedFiltersChanged();
});
document.getElementById("listViewButton").addEventListener("click",()=>{libraryState.displayMode="list";renderCollection(true)});
document.getElementById("artworkViewButton").addEventListener("click",()=>{libraryState.displayMode="artwork";libraryState.artworkLimit=Math.max(180,libraryState.artworkLimit||0);renderCollection(true)});
document.getElementById("filterViewButton").addEventListener("click",e=>{
  advancedFilterBar.classList.toggle("open");e.currentTarget.classList.toggle("active",advancedFilterBar.classList.contains("open"));
});
librarySearch.addEventListener("input",()=>{invalidateBrowseLink("Rekordbox cursor lock cleared: dashboard search changed");libraryState.search=librarySearch.value;trackRowsEl.scrollTop=0;renderCollection()});
document.querySelectorAll(".track-head [data-sort]").forEach(cell=>cell.addEventListener("click",()=>{
  invalidateBrowseLink("Rekordbox cursor lock cleared: dashboard sort changed");
  const key=cell.dataset.sort;
  if(libraryState.sortKey===key)libraryState.sortDir*=-1;else{libraryState.sortKey=key;libraryState.sortDir=1}
  trackRowsEl.scrollTop=0;
  document.querySelectorAll(".track-head [data-sort]").forEach(x=>{
    const active=x===cell;x.classList.toggle("sorted",active);
    if(active){x.dataset.dir=libraryState.sortDir>0?"asc":"desc";x.setAttribute("aria-sort",libraryState.sortDir>0?"ascending":"descending")}
    else{x.removeAttribute("data-dir");x.removeAttribute("aria-sort")}
  });
  renderCollection();
}));
trackRowsEl.addEventListener("scroll",()=>{clearTimeout(trackScrollTimer);trackScrollTimer=setTimeout(()=>renderCollection(false),45)});
document.querySelectorAll(".browser-tabs [data-view],.media-item[data-view]").forEach(btn=>btn.addEventListener("click",()=>setLibraryView(btn.dataset.view)));
document.querySelectorAll(".filter-item").forEach(btn=>btn.addEventListener("click",()=>{
  invalidateBrowseLink("Rekordbox cursor lock cleared: dashboard filter changed");document.querySelectorAll(".filter-item").forEach(x=>x.classList.toggle("active",x===btn));libraryState.filter=btn.dataset.filter;trackRowsEl.scrollTop=0;renderCollection();
}));
document.getElementById("libraryRefresh").addEventListener("click",async()=>{await loadLibrary(true);loadControllerSettings()});
document.getElementById("browserAlign").addEventListener("click",()=>{
  if(libraryState.browseLinked){setBrowseLinked(false,"Rekordbox browser cursor manually unlinked");return;}
  const t=selectedTrack();
  if(!t){logLine("Select the same track here and in Rekordbox before ALIGN RB");return;}
  if(!browserMirrorSafe()){logLine("ALIGN RB requires unfiltered, unsorted Collection view");return;}
  setBrowseLinked(true,`Rekordbox cursor aligned at ${t.title}`);
});
document.getElementById("queueSelectedButton").addEventListener("click",()=>{const t=selectedTrack();if(t)addToLocalQueue(t.id)});
function toggleLibrary(){
  const shell=document.querySelector(".app-shell");shell.classList.toggle("library-collapsed");
  const hidden=shell.classList.contains("library-collapsed");document.getElementById("libraryCollapse").textContent=hidden?"SHOW":"HIDE";
  document.getElementById("libraryTopToggle").classList.toggle("active",!hidden);setTimeout(resize,40);
}
document.getElementById("libraryCollapse").addEventListener("click",toggleLibrary);
document.getElementById("libraryTopToggle").addEventListener("click",toggleLibrary);
const layoutModes=["hybrid","controller","library"];
let layoutModeIndex=0;
function applyLayoutMode(mode){
  const shell=document.querySelector(".app-shell"),btn=document.getElementById("layoutModeButton");
  shell.classList.remove("layout-controller","layout-library");
  if(mode==="controller")shell.classList.add("layout-controller");
  if(mode==="library")shell.classList.add("layout-library");
  if(btn)btn.innerHTML=`${mode.toUpperCase()} <span>⌄</span>`;
  setTimeout(resize,50);
}
document.getElementById("layoutModeButton")?.addEventListener("click",()=>{
  layoutModeIndex=(layoutModeIndex+1)%layoutModes.length;applyLayoutMode(layoutModes[layoutModeIndex]);
});
document.getElementById("fxPanelToggle").addEventListener("click",()=>{
  const stage=document.querySelector(".main-stage");stage.classList.toggle("fx-hidden");
  document.getElementById("fxPanelToggle").classList.toggle("active",!stage.classList.contains("fx-hidden"));
  setTimeout(resize,40);
});
const queuePanelEl=document.querySelector(".queue-panel");
queuePanelEl.addEventListener("dragenter",e=>{if(e.dataTransfer.types.includes("application/x-rekordbox-track"))queuePanelEl.classList.add("drop-ready")});
queuePanelEl.addEventListener("dragover",e=>{if(e.dataTransfer.types.includes("application/x-rekordbox-track")){e.preventDefault();e.dataTransfer.dropEffect="copy";queuePanelEl.classList.add("drop-ready")}});
queuePanelEl.addEventListener("dragleave",e=>{if(!queuePanelEl.contains(e.relatedTarget))queuePanelEl.classList.remove("drop-ready")});
queuePanelEl.addEventListener("drop",e=>{queuePanelEl.classList.remove("drop-ready");const id=e.dataTransfer.getData("application/x-rekordbox-track");if(id){e.preventDefault();addToLocalQueue(id)}});
for(const deck of [1,2]){
  const card=document.querySelector(`.deck-${deck===1?"a":"b"}`);
  card.classList.toggle("active-target",deck===libraryState.activeDeck);
  card.addEventListener("click",()=>{
    libraryState.activeDeck=deck;
    document.querySelectorAll(".deck-card").forEach((c,i)=>c.classList.toggle("active-target",i===deck-1));
    syncSamplerPanel();updateMixPointPanel();updateMasterPhase();
  });
  card.addEventListener("dragover",e=>{if(e.dataTransfer.types.includes("application/x-rekordbox-track")){e.preventDefault();card.classList.add("drop-ready")}});
  card.addEventListener("dragleave",()=>card.classList.remove("drop-ready"));
  card.addEventListener("drop",e=>{
    const id=e.dataTransfer.getData("application/x-rekordbox-track");card.classList.remove("drop-ready");if(!id)return;e.preventDefault();
    selectTrackWithBrowserMirror(id,deck);
  });
}
window.addEventListener("keydown",e=>{
  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)return;
  const key=e.key.toLowerCase();
  if(key==="q"){const t=selectedTrack();if(t){e.preventDefault();addToLocalQueue(t.id)}}
  else if(e.key==="ArrowDown"){e.preventDefault();sendControl("browser_rotate",{delta:1})}
  else if(e.key==="ArrowUp"){e.preventDefault();sendControl("browser_rotate",{delta:-1})}
  else if(e.key==="Enter"){e.preventDefault();sendControl(e.shiftKey?"browser_back":"browser_press")}
  else if(e.key==="Backspace"||e.key==="Escape"){e.preventDefault();sendControl("browser_back")}
  else if(e.key==="1"){e.preventDefault();if(e.shiftKey)sendControl("browser_related");else{const t=selectedTrack();if(t)selectTrackWithBrowserMirror(t.id,1)}}
  else if(e.key==="2"){e.preventDefault();if(e.shiftKey)sendControl("browser_switch_window");else{const t=selectedTrack();if(t)selectTrackWithBrowserMirror(t.id,2)}}
});
loadLibrary();loadControllerSettings();

// THREE scene
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.12;

const scene=new THREE.Scene();
scene.background=new THREE.Color(0x060708);
scene.fog=new THREE.Fog(0x060708,55,105);

const camera=new THREE.PerspectiveCamera(31,1,.1,180);
// Fixed elevated view includes the entire physical controller in the compact
// native window while preserving the original photo textures and real depth.
camera.position.set(0,54,20);

const controls=new OrbitControls(camera,canvas);
controls.enableDamping=true;
controls.dampingFactor=.07;
controls.target.set(0,0,0);
controls.minDistance=28;controls.maxDistance=75;
controls.maxPolarAngle=Math.PI*.48;
// Preserve every texture, mesh, lighting rig and live 3D hardware control.
// Only lock the camera so the board cannot be spun/rotated/panned by gestures.
controls.enableRotate=false;
controls.enablePan=false;
controls.enableZoom=false;

scene.add(new THREE.HemisphereLight(0xaabbd0,0x080808,1.65));
const key=new THREE.DirectionalLight(0xffffff,2.65);key.position.set(-22,34,28);key.castShadow=true;key.shadow.mapSize.set(2048,2048);scene.add(key);
const rim=new THREE.PointLight(0xff7d1f,8,60,2);rim.position.set(20,8,-17);scene.add(rim);
const blueLight=new THREE.PointLight(0x268dff,4,50,2);blueLight.position.set(-20,10,-17);scene.add(blueLight);

const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,90),new THREE.MeshStandardMaterial({color:0x050607,roughness:.66,metalness:.15}));
floor.rotation.x=-Math.PI/2;floor.position.y=-3.12;floor.receiveShadow=true;scene.add(floor);
const grid=new THREE.GridHelper(100,50,0x20262c,0x0e1216);grid.position.y=-3.09;grid.material.opacity=.22;grid.material.transparent=true;scene.add(grid);

const materials={
  body:new THREE.MeshPhysicalMaterial({color:0x111315,roughness:.66,metalness:.28,clearcoat:.18}),
  inset:new THREE.MeshStandardMaterial({color:0x090a0c,roughness:.72,metalness:.32}),
  metal:new THREE.MeshPhysicalMaterial({color:0x25282c,roughness:.32,metalness:.88,clearcoat:.38}),
  ring:new THREE.MeshStandardMaterial({color:0x41464c,roughness:.28,metalness:.92}),
  white:new THREE.MeshStandardMaterial({color:0xdde2e7,roughness:.5,metalness:.05}),
  orange:new THREE.MeshStandardMaterial({color:0xff7f16,emissive:0xff5a00,emissiveIntensity:.75,roughness:.38}),
  green:new THREE.MeshStandardMaterial({color:0xb8d500,emissive:0x8fb000,emissiveIntensity:.6}),
  darkButton:new THREE.MeshStandardMaterial({color:0x15191d,roughness:.55,metalness:.22}),
  red:new THREE.MeshStandardMaterial({color:0xff4a35,emissive:0xaa1200,emissiveIntensity:.4})
};

const controller=new THREE.Group(); controller.rotation.x=0; scene.add(controller);
// The official low-front image shows a ~39.6 mm chassis band; the remaining
// height up to the official 59.2 mm comes from raised jogs/knobs/faders.
const body=new THREE.Mesh(new RoundedBoxGeometry(48.2,3.96,27.28,8,.82),materials.body);
body.position.y=-.88;body.castShadow=true;body.receiveShadow=true;controller.add(body);
const topPanel=new THREE.Mesh(new RoundedBoxGeometry(47.92,.22,27.0,7,.68),materials.inset);
topPanel.position.y=1.17;controller.add(topPanel);

// A high-resolution, straight-on FLX4 face reference is used as the panel skin.
// All live 3D controls below sit on top of this skin, preserving the real printed
// legends, panel divisions, branding and spacing while still giving controls depth.
const faceTexture=new THREE.TextureLoader().load("./assets/pioneer-ddj-flx4-panel-clean.png");
faceTexture.colorSpace=THREE.SRGBColorSpace;
faceTexture.anisotropy=8;
const faceMaterial=new THREE.MeshBasicMaterial({map:faceTexture,toneMapped:false,transparent:true,alphaTest:.02});
const face=new THREE.Mesh(new THREE.PlaneGeometry(48.18,27.25),faceMaterial);
face.rotation.x=-Math.PI/2;face.position.y=1.292;controller.add(face);

// Official Pioneer front/rear bands are applied directly to the chassis, so
// angled views retain the exact headphone jack, USB-C, RCA, mic and branding.
function addChassisBand(url,z,flip=false){
  const t=new THREE.TextureLoader().load(url);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  const m=new THREE.MeshBasicMaterial({map:t,transparent:true,alphaTest:.02,toneMapped:false,side:THREE.DoubleSide});
  const p=new THREE.Mesh(new THREE.PlaneGeometry(48.2,3.96),m);
  p.position.set(0,-.88,z);if(flip)p.rotation.y=Math.PI;controller.add(p);return p;
}
addChassisBand("./assets/pioneer-ddj-flx4-front-band.png",13.655,false);
addChassisBand("./assets/pioneer-ddj-flx4-rear-band.png",-13.655,true);

// Low-profile rubber feet remain true 3D; I/O itself comes from the official bands.
for(const x of [-20.5,20.5]) for(const z of [-11.4,11.4]){
  const foot=new THREE.Mesh(new THREE.CylinderGeometry(.72,.72,.26,32),new THREE.MeshStandardMaterial({color:0x030404,roughness:.95}));
  foot.position.set(x,-2.98,z);controller.add(foot);
}

const interactive=[];
const controlsById=new Map();

function labelTexture(text,color="#d9dde1",bg=null,size=46){
  const c=document.createElement("canvas");c.width=512;c.height=128;
  const ctx=c.getContext("2d");
  if(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height)}
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle=color;ctx.font="700 "+size+"px Arial";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText(text,c.width/2,c.height/2);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
function addLabel(){ return new THREE.Group(); }
function registerHit(mesh, owner, id, meta){
  mesh.userData.owner=owner;mesh.userData.id=id;mesh.userData.meta=meta||{};
  interactive.push(mesh);controlsById.set(id,owner);
}
function makeButton(id,label,x,z,w=1.65,d=1.0,meta={},mat=materials.darkButton){
  const g=new THREE.Group();g.position.set(x,1.38,z);controller.add(g);
  const base=new THREE.Mesh(new RoundedBoxGeometry(w,.34,d,3,.11),mat.clone());
  base.castShadow=true;g.add(base);registerHit(base,g,id,{type:"button",label,...meta});
  g.userData.baseY=g.position.y;g.userData.value=0;g.userData.kind="button";
  return g;
}
function makeRoundButton(id,label,x,z,r=.72,meta={},accent=0xff8a1f){
  const g=new THREE.Group();g.position.set(x,1.39,z);controller.add(g);
  const bezel=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.30,48),new THREE.MeshStandardMaterial({color:0x111417,metalness:.42,roughness:.44}));
  const ring=new THREE.Mesh(new THREE.TorusGeometry(r*.70,.045,10,48),new THREE.MeshStandardMaterial({color:accent,emissive:accent,emissiveIntensity:.12,roughness:.5}));
  ring.rotation.x=Math.PI/2;ring.position.y=.18;
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(r*.63,r*.63,.18,48),new THREE.MeshStandardMaterial({color:0x1b1f22,roughness:.47,metalness:.2}));cap.position.y=.16;
  g.add(bezel,ring,cap);registerHit(cap,g,id,{type:"button",label,...meta});
  g.userData.baseY=g.position.y;g.userData.value=0;g.userData.kind="button";g.userData.flashTarget=ring;g.userData.flashAccent=accent;return g;
}
function makeHitArea(id,label,x,z,w=1.6,d=.7,meta={}){
  const g=new THREE.Group();g.position.set(x,1.43,z);controller.add(g);
  const hit=new THREE.Mesh(new THREE.BoxGeometry(w,.16,d),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  g.add(hit);registerHit(hit,g,id,{type:"button",label,...meta});g.userData.baseY=g.position.y;g.userData.kind="button";return g;
}
function makePhotoCircleButton(id,label,x,z,r=.7,meta={},accent=0xff861d){
  const g=new THREE.Group();g.position.set(x,1.325,z);controller.add(g);
  const hit=new THREE.Mesh(new THREE.CylinderGeometry(r,r,.07,48),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  const glowMat=new THREE.MeshBasicMaterial({color:accent,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const glow=new THREE.Mesh(new THREE.TorusGeometry(r*.79,.055,10,48),glowMat);glow.rotation.x=Math.PI/2;glow.position.y=.055;
  g.add(hit,glow);registerHit(hit,g,id,{type:"button",label,...meta});
  g.userData.kind="button";g.userData.baseY=g.position.y;g.userData.flashTarget=glow;g.userData.flashAccent=accent;g.userData.flashOverlay=true;return g;
}
function makePhotoPad(id,deck,index,x,z,w=2.3,d=1.65){
  const g=new THREE.Group();g.position.set(x,1.325,z);controller.add(g);
  const hit=new THREE.Mesh(new THREE.BoxGeometry(w,.06,d),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  const glowMat=new THREE.MeshBasicMaterial({color:0xff7a18,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
  const glow=new THREE.Mesh(new RoundedBoxGeometry(w,.025,d,3,.11),glowMat);glow.position.y=.045;
  g.add(hit,glow);registerHit(hit,g,id,{type:"pad",label:"PERFORMANCE PAD "+(index+1),deck,pad:index});
  g.userData.kind="pad";g.userData.flashTarget=glow;g.userData.flashAccent=0xff7a18;g.userData.flashOverlay=true;return g;
}
function makeKnob(id,label,x,z,meta={},value=.5,r=.55){
  const g=new THREE.Group();g.position.set(x,1.42,z);controller.add(g);
  const baseMat=new THREE.MeshStandardMaterial({color:0x111315,metalness:.05,roughness:.60});
  const base=new THREE.Mesh(new THREE.CylinderGeometry(r*.86,r,0.48,24),baseMat);base.castShadow=true;g.add(base);
  // FLX4 knobs use a fluted plastic grip. Small dark ribs keep that silhouette
  // visible in oblique views without making the model excessively heavy.
  const ribMat=new THREE.MeshStandardMaterial({color:0x060708,metalness:0,roughness:.78});
  for(let i=0;i<16;i++){
    const a=i/16*Math.PI*2;
    const rib=new THREE.Mesh(new THREE.BoxGeometry(.045,.32,r*.20),ribMat);
    rib.position.set(Math.sin(a)*r*.88,0,Math.cos(a)*r*.88);rib.rotation.y=a;g.add(rib);
  }
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(r*.61,r*.68,.18,32),new THREE.MeshStandardMaterial({color:0x202326,metalness:.08,roughness:.48}));cap.position.y=.31;g.add(cap);
  const tick=new THREE.Mesh(new THREE.BoxGeometry(.07,.045,r*.52),materials.white);tick.position.set(0,.425,-r*.24);g.add(tick);
  registerHit(cap,g,id,{type:"knob",label,...meta});
  g.userData.kind="knob";g.userData.value=value;setKnobVisual(g,value);
  return g;
}
function setKnobVisual(g,v){g.userData.value=v;g.rotation.y=(-.75+1.5*v)*Math.PI}
function makeVerticalFader(id,label,x,z,len=4.7,meta={},value=.72){
  const g=new THREE.Group();g.position.set(x,1.35,z);controller.add(g);
  const track=new THREE.Mesh(new RoundedBoxGeometry(.28,.18,len,3,.07),materials.inset);g.add(track);
  const cap=new THREE.Mesh(new RoundedBoxGeometry(.92,.38,.58,3,.12),new THREE.MeshStandardMaterial({color:0x15181a,metalness:.08,roughness:.55}));cap.position.y=.22;g.add(cap);
  for(const dz of [-.14,0,.14]){const groove=new THREE.Mesh(new THREE.BoxGeometry(.70,.025,.035),new THREE.MeshBasicMaterial({color:0x34383c}));groove.position.set(0,.205,dz);cap.add(groove)}
  registerHit(cap,g,id,{type:"v-fader",label,len,...meta});
  g.userData.kind="v-fader";g.userData.len=len;setVFaderVisual(g,value);
  return g;
}
function setVFaderVisual(g,v){g.userData.value=v;g.children[1].position.z=(.5-v)*(g.userData.len-.6)}
function makeHorizontalFader(id,label,x,z,len=5.8,meta={},value=.5){
  const g=new THREE.Group();g.position.set(x,1.35,z);controller.add(g);
  const track=new THREE.Mesh(new RoundedBoxGeometry(len,.18,.28,3,.07),materials.inset);g.add(track);
  const cap=new THREE.Mesh(new RoundedBoxGeometry(.58,.38,.92,3,.12),new THREE.MeshStandardMaterial({color:0x15181a,metalness:.08,roughness:.55}));cap.position.y=.22;g.add(cap);
  registerHit(cap,g,id,{type:"h-fader",label,len,...meta});
  g.userData.kind="h-fader";g.userData.len=len;setHFaderVisual(g,value);
  return g;
}
function setHFaderVisual(g,v){g.userData.value=v;g.children[1].position.x=(v-.5)*(g.userData.len-.6)}
function makeJog(deck,x,z){
  const g=new THREE.Group();g.position.set(x,1.36,z);controller.add(g);
  // The FLX4 finger-grip housing is fixed. Only the inner platter is a rotor.
  // This is intentionally split so playback can never look like a rolling tire.
  const housing=new THREE.Mesh(new THREE.CylinderGeometry(7.24,7.28,.50,160),new THREE.MeshPhysicalMaterial({color:0x0d0f11,metalness:.62,roughness:.38,clearcoat:.16}));
  housing.castShadow=true;g.add(housing);
  const fixedLip=new THREE.Mesh(new THREE.TorusGeometry(7.10,.075,12,160),new THREE.MeshStandardMaterial({color:0x252a2e,metalness:.72,roughness:.30}));
  fixedLip.rotation.x=Math.PI/2;fixedLip.position.y=.285;g.add(fixedLip);
  const housingTexture=new THREE.TextureLoader().load(deck===1?"./assets/pioneer-jog-housing-left.png":"./assets/pioneer-jog-housing-right.png");
  housingTexture.colorSpace=THREE.SRGBColorSpace;housingTexture.anisotropy=16;
  const housingPhoto=new THREE.Mesh(new THREE.CircleGeometry(7.12,160),new THREE.MeshBasicMaterial({map:housingTexture,transparent:true,toneMapped:false,alphaTest:.02,depthWrite:false}));
  housingPhoto.rotation.x=-Math.PI/2;housingPhoto.position.y=.326;g.add(housingPhoto);

  const rotor=new THREE.Group();rotor.position.set(0,.01,0);g.add(rotor);
  // Pioneer specifies the FLX4 jog wheel at 111.6 mm. The photographed fixed
  // finger-grip housing is larger; keep a hidden under-rotor filling that
  // housing opening, but make the visible rotating platter exactly 111.6 mm.
  const platterR=5.58;
  const rotorBase=new THREE.Mesh(new THREE.CylinderGeometry(5.96,5.96,.24,160),new THREE.MeshPhysicalMaterial({color:0x171a1c,metalness:.44,roughness:.43,clearcoat:.10}));
  rotorBase.position.y=.205;rotor.add(rotorBase);
  const topDisc=new THREE.Mesh(new THREE.CircleGeometry(platterR,160),new THREE.MeshPhysicalMaterial({color:0x262a2d,metalness:.32,roughness:.50,clearcoat:.07}));
  topDisc.rotation.x=-Math.PI/2;topDisc.position.y=.337;rotor.add(topDisc);
  for(const [radius,tube,color,metal] of [[5.40,.046,0x676d72,.78],[4.95,.025,0x15181a,.55],[3.39,.046,0x8b9195,.82],[2.29,.043,0x959a9e,.84]]){
    const ring=new THREE.Mesh(new THREE.TorusGeometry(radius,tube,10,160),new THREE.MeshStandardMaterial({color,metalness:metal,roughness:.31}));
    ring.rotation.x=Math.PI/2;ring.position.y=.348;rotor.add(ring);
  }
  const tickMat=new THREE.MeshStandardMaterial({color:0xcdd1d4,metalness:.45,roughness:.38});
  for(let i=0;i<48;i++){
    const a=i/48*Math.PI*2,r=2.83;
    const tick=new THREE.Mesh(new THREE.BoxGeometry(i%4===0?.080:.046,.018,i%4===0?.36:.24),tickMat);
    tick.position.set(Math.sin(a)*r,.354,Math.cos(a)*r);tick.rotation.y=-a;rotor.add(tick);
  }
  const logoTexture=new THREE.TextureLoader().load("./assets/pioneer-jog-center.png");logoTexture.colorSpace=THREE.SRGBColorSpace;logoTexture.anisotropy=16;
  const logo=new THREE.Mesh(new THREE.CircleGeometry(1.61,96),new THREE.MeshBasicMaterial({map:logoTexture,transparent:true,toneMapped:false,alphaTest:.02}));
  logo.rotation.x=-Math.PI/2;logo.position.y=.360;rotor.add(logo);
  const indexMark=new THREE.Mesh(new THREE.BoxGeometry(.12,.020,.54),new THREE.MeshBasicMaterial({color:0xf2f4f5}));
  indexMark.position.set(0,.362,-4.80);rotor.add(indexMark);
  const hit=new THREE.Mesh(new THREE.CylinderGeometry(7.08,7.08,.04,96),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
  hit.position.y=.37;g.add(hit);registerHit(hit,g,"jog-"+deck,{type:"jog",label:"JOG WHEEL DECK "+deck,deck});
  g.userData.kind="jog";g.userData.rotor=rotor;g.userData.spinAngle=0;return g;
}
function rotateJogVisual(g,deltaRadians){
  if(!g)return;
  const rotor=g.userData.rotor||g;
  g.userData.spinAngle=THREE.MathUtils.euclideanModulo((g.userData.spinAngle||0)+deltaRadians,Math.PI*2);
  rotor.rotation.y=g.userData.spinAngle;
}

// Deck construction. Positions are traced from the real top-panel photograph,
// not mirrored mathematically: Pioneer keeps transport controls on the left
// side of each deck and the tempo fader on the right side of each deck.
function buildDeck(deck){
  const left=deck===1;
  const jogX=left?-15.7611:15.7315;
  makeJog(deck,jogX,-1.9232);

  const topXs=left?[-21.70,-18.72,-15.55,-13.05,-11.18,-9.46]:[9.05,12.02,15.20,17.70,19.57,21.28];
  makePhotoCircleButton("loop_in-"+deck,"IN",topXs[0],-10.92,.54,{action:"deck_button",control:"loop_in",deck});
  makePhotoCircleButton("loop_out-"+deck,"OUT",topXs[1],-10.92,.54,{action:"deck_button",control:"loop_out",deck});
  makePhotoCircleButton("four_beat-"+deck,"4 BEAT / EXIT",topXs[2],-10.92,.49,{action:"deck_button",control:"four_beat",deck},0x9ba2a8);
  makePhotoCircleButton("loop_half-"+deck,"CUE / LOOP ◀",topXs[3],-10.92,.44,{action:"deck_button",control:"loop_half",deck},0x9ba2a8);
  makePhotoCircleButton("loop_double-"+deck,"CUE / LOOP ▶",topXs[4],-10.92,.44,{action:"deck_button",control:"loop_double",deck},0x9ba2a8);
  makePhotoCircleButton("sync-"+deck,"BEAT SYNC / MASTER",topXs[5],-10.92,.50,{action:"deck_button",control:"sync",deck});

  const transportX=left?-21.78:9.15;
  makeHitArea("shift-"+deck,"SHIFT",transportX,6.18,1.34,.55,{type:"shift",deck});
  makePhotoCircleButton("cue-"+deck,"CUE",transportX,8.52,1.02,{action:"cue",deck},0xff8a1f);
  makePhotoCircleButton("play-"+deck,"PLAY / PAUSE",transportX,11.08,1.08,{action:"play",deck},0xa9c900);

  const padXs=left?[-19.58,-16.98,-14.38,-11.78]:[11.22,13.82,16.42,19.02];
  const modeLabels=["HOT CUE","PAD FX1","BEAT JUMP","SAMPLER"];
  const modes=["hotcue","padfx1","beatjump","sampler"];
  for(let i=0;i<4;i++) makeHitArea("mode-"+deck+"-"+modes[i],modeLabels[i],padXs[i],6.43,2.08,.55,{type:"mode",mode:modes[i],deck});
  for(let row=0;row<2;row++) for(let col=0;col<4;col++){
    const idx=row*4+col;
    makePhotoPad("pad-"+deck+"-"+idx,deck,idx,padXs[col],8.72+row*2.40,2.42,1.72);
  }
  makeVerticalFader("tempo-"+deck,"TEMPO",left?-9.48:22.03,8.95,6.20,{action:"tempo",deck},.5);
}
buildDeck(1);buildDeck(2);

// Mixer channels
function buildChannel(deck,x){
  makeKnob("trim-"+deck,"TRIM",x,-9.55,{visualOnly:true},.5,.48);
  makeKnob("eq-"+deck+"-high","HI",x,-7.05,{action:"eq",deck,band:"high"},.5,.50);
  makeKnob("eq-"+deck+"-mid","MID",x,-4.65,{action:"eq",deck,band:"mid"},.5,.50);
  makeKnob("eq-"+deck+"-low","LOW",x,-2.24,{action:"eq",deck,band:"low"},.5,.50);
  makeKnob("cfx-"+deck,"CFX",x,.40,{action:"cfx",deck},.5,.54);
  makeHitArea("channel-cue-"+deck,"CHANNEL CUE",x,3.08,1.25,.62,{visualOnly:true});
  makeVerticalFader("channel-fader-"+deck,"CH "+deck,x,7.76,6.05,{action:"channel_fader",deck},.78);
}
buildChannel(1,-1.96);buildChannel(2,1.96);

// Mixer meters
for(let col=0;col<2;col++){
  const x=col===0?-.58:.58;
  for(let i=0;i<9;i++){
    const color=i<5?0x54e65b:i<7?0xffcf2d:0xff4233;
    const mat=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.55});
    const led=new THREE.Mesh(new RoundedBoxGeometry(.24,.10,.42,2,.04),mat);
    led.position.set(x,1.42,-6.55+i*.57);controller.add(led);
  }
}
makeHorizontalFader("crossfader","CROSSFADER",0,11.62,5.35,{action:"crossfader"},.5);

// Left utility strip
makeKnob("mic-level","MIC LEVEL",-5.63,-7.58,{visualOnly:true},.35,.46);
makeHitArea("smart-cfx","SMART CFX",-5.63,-1.95,1.75,.70,{action:"smart_cfx"});
makeKnob("headphone-mix","MIX",-5.63,2.30,{visualOnly:true},.5,.46);
makeKnob("headphone-level","PHONES LEVEL",-5.63,5.28,{visualOnly:true},.55,.46);
makeHitArea("smart-fader","SMART FADER",-5.63,8.75,2.00,.75,{action:"smart_fader"});

// Right master + Beat FX strip
makeKnob("master-level","MASTER LEVEL",5.62,-9.55,{visualOnly:true},.62,.54);
makeHitArea("master-cue","MASTER CUE",5.62,-7.04,1.28,.62,{visualOnly:true});
makeHitArea("fx-channel","FX CH SELECT 1 / 2 / 1&2",5.62,-4.70,1.60,.72,{visualOnly:true});
makeHitArea("fx-prev","FX SELECT ◀",5.02,-3.12,1.08,.62,{action:"fx_select",direction:-1});
makeHitArea("fx-next","FX SELECT ▶",6.22,-3.12,1.08,.62,{action:"fx_select",direction:1});
makeHitArea("fx-beat-down","BEAT ◀",5.02,-1.54,1.08,.62,{action:"fx_beat",direction:-1});
makeHitArea("fx-beat-up","BEAT ▶",6.22,-1.54,1.08,.62,{action:"fx_beat",direction:1});
makeKnob("fx-level","LEVEL / DEPTH",5.62,3.25,{action:"fx_level"},.5,.66);
makeRoundButton("fx-toggle","BEAT FX ON / OFF",5.62,8.72,.65,{action:"fx_toggle"},0xff8a1f);
// Smart CFX preset stepping remains available in the side UI/MCP, but there is
// no invented extra physical button here; the 3D face stays faithful to FLX4.

// Browser section remains visually faithful to the reference skin; invisible
// hit regions can be added later if browsing is exposed over MIDI/MCP. The
// encoder/load caps are raised because they are prominent in Pioneer's angle view.
makeKnob("browse","BROWSE",0,-11.18,{type:"browser"},.5,.43);
makeButton("load-1","LOAD 1",-1.86,-11.16,1.25,.48,{action:"browser_load",deck:1});
makeButton("load-2","LOAD 2",1.86,-11.16,1.25,.48,{action:"browser_load",deck:2});


controllerVisualReady=true;
if(pendingRuntimeState)applyRuntimeSnapshot(pendingRuntimeState);
refreshCuePadStates();

// Interaction
const raycaster=new THREE.Raycaster();
const pointer=new THREE.Vector2();
let hoverHit=null,drag=null,lastSend=0;
function pointerNDC(ev){const r=canvas.getBoundingClientRect();pointer.x=((ev.clientX-r.left)/r.width)*2-1;pointer.y=-((ev.clientY-r.top)/r.height)*2+1}
function hitTest(ev){pointerNDC(ev);raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(interactive,false)[0]||null}
function setCursor(hit){canvas.style.cursor=hit?(["knob","v-fader","h-fader","browser"].includes(hit.object.userData.meta.type)?"ns-resize":"pointer"):"grab"}
canvas.addEventListener("pointermove",ev=>{
  if(drag){handleDrag(ev);return}
  const hit=hitTest(ev);hoverHit=hit;setCursor(hit);
  hoverLabel.textContent=hit?hit.object.userData.meta.label:"DDJ-FLX4";
});
canvas.addEventListener("pointerleave",()=>{hoverLabel.textContent="DDJ-FLX4";canvas.style.cursor="grab"});
canvas.addEventListener("pointerdown",ev=>{
  const hit=hitTest(ev);if(!hit)return;
  const owner=hit.object.userData.owner,meta=hit.object.userData.meta,id=hit.object.userData.id;
  if(meta.type==="jog"){
    const local=owner.worldToLocal(hit.point.clone());
    drag={id,owner,meta,startX:ev.clientX,startY:ev.clientY,startValue:owner.userData.value||0,lastX:ev.clientX,lastY:ev.clientY,lastAngle:Math.atan2(local.z,local.x),hitObject:hit.object};
    controls.enabled=false;canvas.setPointerCapture(ev.pointerId);
    sendControl("jog_touch",{deck:meta.deck,touched:true});
    return;
  }
  if(meta.type==="shift"){
    uiState.shiftHeld[meta.deck]=true;drag={id,owner,meta,startX:ev.clientX,startY:ev.clientY,moved:false};controls.enabled=false;canvas.setPointerCapture(ev.pointerId);return;
  }
  if(meta.type==="button"||meta.type==="pad"){
    triggerDiscrete(id,owner,meta);
  }else if(["knob","v-fader","h-fader","browser"].includes(meta.type)){
    drag={id,owner,meta,startX:ev.clientX,startY:ev.clientY,startValue:owner.userData.value,lastX:ev.clientX,lastY:ev.clientY,moved:false};
    controls.enabled=false;canvas.setPointerCapture(ev.pointerId);
  }
});
canvas.addEventListener("pointerup",ev=>{if(drag){if(drag.meta.type==="jog")sendControl("jog_touch",{deck:drag.meta.deck,touched:false});if(drag.meta.type==="browser"&&!drag.moved)sendControl(shiftActive()?"browser_back":"browser_press");if(drag.meta.type==="shift")uiState.shiftHeld[drag.meta.deck]=false;drag=null;controls.enabled=true;try{canvas.releasePointerCapture(ev.pointerId)}catch{}}});
canvas.addEventListener("wheel",ev=>{
  const hit=hitTest(ev);if(!hit||hit.object.userData.id!=="browse")return;
  ev.preventDefault();sendControl("browser_rotate",{delta:ev.deltaY>0?1:-1});
},{passive:false});
function triggerDiscrete(id,owner,meta){
  if(meta.visualOnly){flash(owner);return}
  if(meta.type==="pad"){
    sendControl("performance_pad",{deck:meta.deck,mode:uiState.padMode,pad:meta.pad});return;
  }
  if(meta.type==="mode"){
    uiState.padMode=meta.mode;
    document.querySelectorAll("#padModeButtons button").forEach(b=>b.classList.toggle("active",b.dataset.mode===uiState.padMode));
    document.getElementById("padModeStatus").textContent=uiState.padMode.toUpperCase()+" mode routes all 8 physical pads.";
    flash(owner);return;
  }
  const payload={};
  if(meta.deck) payload.deck=meta.deck;
  if(meta.direction) payload.direction=meta.direction;
  if(meta.control) payload.control=meta.control;
  if(meta.action?.startsWith("fx_")) payload.unit=uiState.fxUnit;
  if(meta.action==="browser_load"&&shiftActive()) sendControl(meta.deck===1?"browser_related":"browser_switch_window");
  else if(meta.action) sendControl(meta.action,payload);
  flash(owner);
}
function flash(owner){
  const y=owner.position.y;owner.position.y=y-.10;
  const target=owner.userData.flashTarget;
  if(target?.material){
    const mat=target.material;
    const oldColor=mat.color?.clone?.();
    const oldEmissive=mat.emissive?.clone?.();
    const oldIntensity=mat.emissiveIntensity;
    const oldOpacity=mat.opacity;
    if(mat.color&&owner.userData.flashAccent)mat.color.set(owner.userData.flashAccent);
    if(mat.emissive&&owner.userData.flashAccent)mat.emissive.set(owner.userData.flashAccent);
    if("emissiveIntensity" in mat)mat.emissiveIntensity=.65;
    if(owner.userData.flashOverlay)mat.opacity=.82;
    setTimeout(()=>{if(oldColor)mat.color.copy(oldColor);if(oldEmissive)mat.emissive.copy(oldEmissive);if(oldIntensity!==undefined)mat.emissiveIntensity=oldIntensity;if(oldOpacity!==undefined)mat.opacity=oldOpacity;},120);
  }
  setTimeout(()=>owner.position.y=y,90);
}
function setPersistentGlow(id,on,color=null){
  const g=controlsById.get(id),target=g?.userData?.flashTarget;if(!target?.material)return;
  if(color!==null&&target.material.color)target.material.color.set(color);
  target.material.opacity=on?0.46:0;
}
function handleDrag(ev){
  const {owner,meta,startX,startY,startValue,id}=drag;
  if(meta.type==="shift")return;
  if(meta.type==="jog"){
    pointerNDC(ev);raycaster.setFromCamera(pointer,camera);
    const hits=raycaster.intersectObject(drag.hitObject,false);if(!hits.length)return;
    const local=owner.worldToLocal(hits[0].point.clone());
    const angle=Math.atan2(local.z,local.x);
    let dAngle=angle-drag.lastAngle;
    while(dAngle>Math.PI)dAngle-=Math.PI*2;
    while(dAngle<-Math.PI)dAngle+=Math.PI*2;
    if(Math.abs(dAngle)>.002){
      const delta=Math.max(-18,Math.min(18,Math.round(dAngle*34)));
      if(delta!==0)sendControl("jog_rotate",{deck:meta.deck,mode:"scratch",delta});
      drag.lastAngle=angle;drag.lastX=ev.clientX;drag.lastY=ev.clientY;
    }
    return;
  }
  if(meta.type==="browser"){
    const dx=ev.clientX-drag.lastX,dy=drag.lastY-ev.clientY;
    const amount=Math.abs(dy)>=Math.abs(dx)?dy:dx;
    if(Math.abs(amount)>=4){
      sendControl("browser_rotate",{delta:amount>0?1:-1});drag.lastX=ev.clientX;drag.lastY=ev.clientY;drag.moved=true;
    }
    return;
  }
  let v=startValue;
  if(meta.type==="knob"||meta.type==="v-fader") v=THREE.MathUtils.clamp(startValue+(startY-ev.clientY)/180,0,1);
  else v=THREE.MathUtils.clamp(startValue+(ev.clientX-startX)/220,0,1);
  if(meta.type==="knob") setKnobVisual(owner,v);
  if(meta.type==="v-fader") setVFaderVisual(owner,v);
  if(meta.type==="h-fader") setHFaderVisual(owner,v);
  owner.userData.value=v;
  if(meta.action){
    const now=performance.now();
    if(now-lastSend>30){
      lastSend=now;
      const payload={value:v};
      if(meta.deck) payload.deck=meta.deck;
      if(meta.band) payload.band=meta.band;
      if(meta.action==="fx_level") payload.unit=uiState.fxUnit;
      sendControl(meta.action,payload);
      if(id==="fx-level"){uiState.fxDepth=v;updateDepthUI()}
    }
  }
}
function setControlValue(id,value){
  const g=controlsById.get(id);if(!g)return;
  if(g.userData.kind==="knob")setKnobVisual(g,value);
  if(g.userData.kind==="v-fader")setVFaderVisual(g,value);
  if(g.userData.kind==="h-fader")setHFaderVisual(g,value);
}
function applyRuntimeSnapshot(s){
  if(!s)return;
  for(const deck of [1,2]){
    const d=String(deck);
    if(s.playing&&d in s.playing){uiState.playing[deck]=!!s.playing[d];setTransportPlaying(deck,uiState.playing[deck]);setDeckState(deck)}
    if(s.channel_fader&&d in s.channel_fader){setControlValue(`channel-fader-${deck}`,Number(s.channel_fader[d]));syncSoftwareMixer("channel_fader",deck,Number(s.channel_fader[d]))}
    if(s.tempo&&d in s.tempo)setControlValue(`tempo-${deck}`,Number(s.tempo[d]));
    if(s.cfx&&d in s.cfx){setControlValue(`cfx-${deck}`,Number(s.cfx[d]));syncSoftwareMixer("cfx",deck,Number(s.cfx[d]))}
    for(const band of ["high","mid","low"]){if(s.eq?.[d]&&band in s.eq[d]){setControlValue(`eq-${deck}-${band}`,Number(s.eq[d][band]));syncSoftwareMixer("eq",deck,Number(s.eq[d][band]),band)}}
  }
  if(s.crossfader!==undefined){setControlValue("crossfader",Number(s.crossfader));syncSoftwareMixer("crossfader",0,Number(s.crossfader))}
  const unit=String(uiState.fxUnit||1);
  if(s.fx_level?.[unit]!==undefined){uiState.fxDepth=Number(s.fx_level[unit]);setControlValue("fx-level",uiState.fxDepth);updateDepthUI()}
  if(s.fx_on?.[unit]!==undefined){uiState.fxOn=!!s.fx_on[unit];updateFxUI()}
  if(s.smart_cfx!==undefined){uiState.smartCfx=!!s.smart_cfx;document.getElementById("smartCfx").classList.toggle("active",uiState.smartCfx)}
  if(s.smart_fader!==undefined){uiState.smartFader=!!s.smart_fader;document.getElementById("smartFader").classList.toggle("active",uiState.smartFader)}
  if(s.semantic_cue)document.getElementById("cueBanner").textContent=String(s.semantic_cue).toUpperCase();
  const haveFeedback=Number(lastControllerStatus?.feedback_messages||0)>0;
  for(const deck of [1,2]){
    const d=String(deck),card=document.querySelector(`.deck-${deck===1?"a":"b"}`);
    if(haveFeedback){
      if(s.feedback_loaded?.[d]!==undefined)card?.classList.toggle("feedback-loaded",!!s.feedback_loaded[d]);
      if(s.feedback_loop?.[d]!==undefined)card?.classList.toggle("feedback-loop",!!s.feedback_loop[d]);
      if(s.feedback_vinyl?.[d]!==undefined)card?.classList.toggle("feedback-vinyl",!!s.feedback_vinyl[d]);
      if(s.feedback_play?.[d]!==undefined)setPersistentGlow(`play-${deck}`,!!s.feedback_play[d],0xa9c900);
      if(s.feedback_cue?.[d]!==undefined){card?.classList.toggle("feedback-cue",!!s.feedback_cue[d]);setPersistentGlow(`cue-${deck}`,!!s.feedback_cue[d],0xff8a1f)}
      if(s.feedback_sync?.[d]!==undefined){card?.classList.toggle("feedback-sync",!!s.feedback_sync[d]);setPersistentGlow(`sync-${deck}`,!!s.feedback_sync[d],0x56b6f2)}
      if(s.feedback_headphone?.[d]!==undefined)card?.classList.toggle("feedback-headphone",!!s.feedback_headphone[d]);
      if(s.feedback_hotcue_mode?.[d]!==undefined)feedbackUi.hotcueMode[deck]=!!s.feedback_hotcue_mode[d];
      if(Array.isArray(s.feedback_hotcue_pad?.[d]))feedbackUi.hotcuePads[deck]=s.feedback_hotcue_pad[d].slice(0,8).map(Boolean);
      if(s.feedback_channel_level?.[d]!==undefined){const meter=document.getElementById(`deck${deck}Level`);if(meter)meter.style.width=`${Math.max(0,Math.min(1,Number(s.feedback_channel_level[d])||0))*100}%`}
    }
  }
  if(haveFeedback&&s.feedback_smart_cfx!==undefined){uiState.smartCfx=!!s.feedback_smart_cfx;document.getElementById("smartCfx").classList.toggle("active",uiState.smartCfx);setPersistentGlow("smart-cfx",uiState.smartCfx,0xff8a1f)}
  if(haveFeedback&&s.feedback_smart_fader!==undefined){uiState.smartFader=!!s.feedback_smart_fader;document.getElementById("smartFader").classList.toggle("active",uiState.smartFader);setPersistentGlow("smart-fader",uiState.smartFader,0xff8a1f)}
  if(haveFeedback&&s.feedback_fx_on?.[unit]!==undefined){uiState.fxOn=!!s.feedback_fx_on[unit];updateFxUI();setPersistentGlow("fx-toggle",uiState.fxOn,0xff8a1f)}
  refreshCuePadStates();
}
function flashControl(id){const g=controlsById.get(id);if(g)flash(g)}

// camera views
function tweenCamera(to,target=new THREE.Vector3(0,0,0),ms=450){
  const from=camera.position.clone(),t0=performance.now();
  const tick=()=>{const p=Math.min(1,(performance.now()-t0)/ms);const e=1-Math.pow(1-p,3);camera.position.lerpVectors(from,to,e);controls.target.lerp(target,.18);if(p<1)requestAnimationFrame(tick)};tick();
}
document.getElementById("angleView").onclick=()=>tweenCamera(new THREE.Vector3(-24,28,42),new THREE.Vector3(0,-.35,0));
document.getElementById("topView").onclick=()=>tweenCamera(new THREE.Vector3(0,52,.1));
document.getElementById("frontView").onclick=()=>tweenCamera(new THREE.Vector3(0,4.5,45),new THREE.Vector3(0,-.25,0));
document.getElementById("rearView").onclick=()=>tweenCamera(new THREE.Vector3(0,4.5,-45),new THREE.Vector3(0,-.25,0));
document.getElementById("resetView").onclick=()=>{controls.target.set(0,0,0);tweenCamera(new THREE.Vector3(0,46,18))};
document.getElementById("focusView").onclick=()=>{
  const stage=document.querySelector(".main-stage");stage.classList.toggle("hardware-focus");
  document.getElementById("focusView").classList.toggle("active",stage.classList.contains("hardware-focus"));
  if(stage.classList.contains("hardware-focus"))setSoftwarePanel(null);
  setTimeout(resize,40);
};

// animation + resize
const clock=new THREE.Clock();
const JOG_PLAY_RAD_PER_SEC=Math.PI*2*(33.333/60);
let lastTransportPaint=0;
function resize(){
  const r=canvas.getBoundingClientRect();
  renderer.setSize(r.width,r.height,false);
  camera.aspect=r.width/r.height;camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);resize();
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta();
  for(const deck of [1,2]){
    const jog=controlsById.get("jog-"+deck);
    if(jog&&uiState.playing[deck]&&!uiState.jogTouched[deck])rotateJogVisual(jog,dt*JOG_PLAY_RAD_PER_SEC);
  }
  const now=performance.now();
  if(now-lastTransportPaint>200){lastTransportPaint=now;updateTransportReadout(1);updateTransportReadout(2)}
  controls.update();renderer.render(scene,camera);
}
animate();
