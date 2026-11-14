/* Companion for the EXISTING MASCHINE LAB, Vintage and ASR-10 apps.
   The controller scene remains the exact original photo-textured Three.js rig.
   It only intercepts virtual performance-pad strikes while a sampler MIDI
   target is explicitly chosen. Other FLX4 buttons stay on rekordbox. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const labels = {
    rekordbox: "Rekordbox",
    maschine: "MASCHINE LAB",
    vintage: "Vintage Sampler Lab",
    asr10: "ASR-10 Sampler Lab"
  };
  // MIDI channels are 0-based on the wire: channel 1=Maschine, 2=Vintage,
  // 3=ASR-10. In Ableton, set the instrument MIDI track input channel
  // individually so instruments don't all play simultaneously.
  const channels = {maschine:0, vintage:1, asr10:2};
  // MASCHINE LAB and Vintage Sampler use notes 36..51 for their 16 pads.
  // ASR-10 is a keyboard instrument with a default root of MIDI note 60.
  // Its route plays semitones 60..75 until that instrument's zones change.
  const baseNotes = {maschine:36, vintage:36, asr10:60};
  let route = "rekordbox";
  let midiReady = false;
  let lastAppStatus = [];
  function statusText(text) { $("flxRouteStatus").textContent = text; }
  function openPanel(open) {
    $("flxSamplerCompanion").hidden = !open;
    $("flxSamplerOpen").setAttribute("aria-expanded",String(open));
    $("flxSamplerOpen").textContent = open ? "SAMPLER APPS / MINIMIZE" : "SAMPLER APPS / ABLETON";
  }
  $("flxSamplerOpen").addEventListener("click", () => {
    openPanel($("flxSamplerCompanion").hidden);
    if (!$("flxSamplerCompanion").hidden) refresh();
  });
  $("flxSamplerClose").addEventListener("click", () => openPanel(false));

  async function post(path,data) {
    const response = await fetch(path, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(data),
    });
    const body=await response.json();
    if (!response.ok) throw new Error(body.error||"HTTP "+response.status);
    return body;
  }
  function routeMessage(){
    if(route==="rekordbox")return "3D performance pads control rekordbox; existing samplers can still play separately.";
    return labels[route] + " selected: 3D performance pads → Ableton MIDI channel "
           +(channels[route]+1)+" · notes "+baseNotes[route]+"–"+(baseNotes[route]+15)+". "
           +(midiReady?"Virtual MIDI output available; enable its input in Ableton.":"MIDI output unavailable.");
  }
  function setRoute(next){
    if(next!=="rekordbox"&&!Object.hasOwn(channels,next)) return;
    route=next;
    document.querySelectorAll("[data-flx-route]").forEach(el=>{
      const selected=el.dataset.flxRoute===route;
      el.classList.toggle("selected",selected);
      el.setAttribute("aria-pressed",String(selected));
    });
    statusText(routeMessage());
  }
  document.querySelectorAll("[data-flx-route]").forEach(b=>b.addEventListener("click",()=>setRoute(b.dataset.flxRoute)));
  setRoute("rekordbox");

  // Only intercept the exact same 3D hardware performance-pad actions.
  // Default routes to rekordbox. Selecting a sampler sends MIDI through the
  // virtual Ableton device and leaves deck transport/mixer controls untouched.
  window.flx4RoutePad = (deck,pad) => {
    if(route==="rekordbox")return false;
    const d=Number(deck),p=Number(pad);
    if((d!==1&&d!==2)||!Number.isInteger(p)||p<0||p>7)return true;
    if(!midiReady) { statusText("Ableton MIDI unavailable. Open the sampler standalone, or configure the virtual MIDI input in Live."); return true; }
    const note=baseNotes[route]+(d-1)*8+p;
    post("/api/ableton/notes",{
      note,velocity:110,duration_ms:450,channel:channels[route]
    }).then(()=>{
      statusText(labels[route]+" · MIDI CH "+(channels[route]+1)+" · note "+note+" sent to Ableton.");
    }).catch(err=>{
      statusText("Ableton MIDI note failed: "+err.message);
      midiReady=false;
    });
    return true;
  };

  async function refresh(){
    try{
      const [samplersResponse,midiResponse]=await Promise.all([
        fetch("/api/samplers",{cache:"no-store"}),
        fetch("/api/status",{cache:"no-store"}),
      ]);
      if(!samplersResponse.ok || !midiResponse.ok)throw new Error("Backend unavailable");
      lastAppStatus=(await samplersResponse.json()).samplers||[];
      const midi=await midiResponse.json();
      midiReady=!!midi.ableton_midi_available;
      $("flxAbletonStatus").textContent=midiReady
        ? "CoreMIDI output available: "+(midi.ableton_midi_port||"FLX4 Live 2D to Ableton")
          +" · enable Track and choose the matching input channel in Ableton"
        : "No virtual MIDI output: "+(midi.ableton_midi_error||"Offline");
      statusText(routeMessage());
      renderApps();
    }catch(error){
      $("flxAbletonStatus").textContent="Companion bridge unavailable: "+error.message;
      statusText("Open the native FLX4 Live 2D app to restore MIDI routing.");
    }
  }
  function renderApps(){
    const wrap=$("flxSamplerApps");
    wrap.replaceChildren();
    for(const sampler of lastAppStatus){
      if(!Object.hasOwn(labels,sampler.id)||sampler.id==="rekordbox")continue;
      const row=document.createElement("div");row.className="companion-app";
      const detail=document.createElement("div");
      const name=document.createElement("div");name.className="name";name.textContent=sampler.name||labels[sampler.id];
      const status=document.createElement("div");status.className="detail";
      status.textContent=sampler.running?"RUNNING":sampler.installed?"INSTALLED · READY":"NOT INSTALLED";
      detail.append(name,status);
      const btn=document.createElement("button");
      btn.type="button";btn.textContent=sampler.running?"FOCUS APP":"OPEN APP";
      btn.disabled=!sampler.installed;
      btn.addEventListener("click",async()=>{
        btn.disabled=true;
        try{
          await post("/api/samplers/open",{id:sampler.id});
          statusText("Opened "+labels[sampler.id]+". Set its audio output, or load its plugin in Ableton to hear it with rekordbox.");
          await refresh();
        }catch(err){statusText("Could not open "+labels[sampler.id]+": "+err.message);}
        finally{btn.disabled=false;}
      });
      row.append(detail,btn);wrap.append(row);
    }
    if(!wrap.childElementCount)wrap.textContent="No sampler apps detected.";
  }

  $("flxConnectRB").addEventListener("click",async()=>{
    const button=$("flxConnectRB");button.disabled=true;
    try{
      await post("/api/rekordbox/connect",{});
      statusText("Rekordbox control bridge started. Continue using the existing controller mapping.");
    }catch(err){statusText("Could not connect rekordbox: "+err.message);}
    finally{button.disabled=false;}
  });
  $("flxAudioCheck").addEventListener("click",async()=>{
    const button=$("flxAudioCheck");button.disabled=true;
    $("flxAudioStatus").textContent="Checking available CoreAudio devices…";
    try{
      const res=await fetch("/api/audio-devices",{cache:"no-store"});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error||"HTTP "+res.status);
      $("flxAudioStatus").textContent=data.ddj_flx4_present
        ? "DDJ-FLX4 audio interface detected. Select its output in Ableton or the sampler audio settings to hear it through the DJ hardware."
        : "DDJ-FLX4 audio interface not currently detected. Available outputs: "+(data.device_names||[]).slice(0,8).join(", ")+". Reconnect the FLX4 and choose a compatible output in Ableton or the sampler.";
    }catch(err){$("flxAudioStatus").textContent="Audio inventory unavailable: "+err.message;}
    finally{button.disabled=false;}
  });
  // The DJ runtime is not started automatically. Read-only status checks
  // do not disturb rekordbox deck playback or device configuration.
  refresh();
  setInterval(()=>{if(!$("flxSamplerCompanion").hidden)refresh();},15000);
})();
