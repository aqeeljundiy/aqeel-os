// Speech to text for the message box. Your voice is recorded here and transcribed on your AI box with Whisper
// (the same kind of model the Claude and ChatGPT apps use): it understands mixed languages and needs no picking.
// If the box cannot transcribe, the browser's own dictation is used instead. Nothing is sent until you press Send.
const Voice={
 on:false,busy:false,rec:null,stream:null,chunks:[],t0:0,timer:null,mode:store.get('voiceMode','box'),
 btn(){const label=this.busy?'Transcribing…':this.on?'Stop and transcribe':'Dictate';
  return `<button class="ghost icon mic ${this.on?'rec':''} ${this.busy?'busy':''}" data-act="mic" title="${label}" aria-label="${label}" aria-pressed="${this.on}" ${this.busy?'disabled':''}>${this.busy?'<span class="spinner"></span>':icon('mic',18)}</button>${this.on?`<span class="mic-time" aria-live="polite">${this.clock()}</span>`:''}`},
 clock(){const s=Math.floor((Date.now()-this.t0)/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0')},
 toggle(){if(this.busy)return;this.on?this.stop():this.start()},
 async start(){
  if(this.mode==='browser')return this.startBrowser();
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return this.startBrowser();
  try{this.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}
  catch(e){return toast(e.name==='NotAllowedError'?'Microphone access was blocked. Allow it in the browser’s site settings.':'No microphone found.','err')}
  const type=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported?.(t))||'';
  this.chunks=[];this.rec=new MediaRecorder(this.stream,type?{mimeType:type}:undefined);
  this.rec.ondataavailable=e=>{if(e.data?.size)this.chunks.push(e.data)};
  this.rec.onstop=()=>this.transcribe();
  this.rec.start(1000);this.on=true;this.t0=Date.now();this.paint();
  this.timer=setInterval(()=>{const t=$('.mic-time');if(t)t.textContent=this.clock();if(Date.now()-this.t0>5*60e3)this.stop()},500)},   // at most 5 minutes per recording
 stop(){if(this.recB){try{this.recB.stop()}catch{}return}clearInterval(this.timer);try{this.rec?.stop()}catch{}this.stream?.getTracks().forEach(t=>t.stop());this.on=false;this.paint()},
 async transcribe(){const blob=new Blob(this.chunks,{type:this.rec?.mimeType||'audio/webm'});this.rec=null;this.stream=null;
  if(blob.size<1500)return toast('Didn’t hear anything. Try again.','err');
  this.busy=true;this.paint();
  try{const data_url=await new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result);r.onerror=no;r.readAsDataURL(blob)});
   const r=await post(H,'/audio/transcribe?profile=default',{data_url,mime_type:blob.type.split(';')[0]});
   const text=String(r.transcript||'').trim();if(!text){toast('Didn’t catch any words. Try again a little closer to the microphone.','err');return}
   const ta=$('#msg');if(ta){const sep=ta.value&&!/\s$/.test(ta.value)?' ':'';ta.value+=sep+text;ta.dispatchEvent(new Event('input'));ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length)}}
  catch(e){if(/No STT provider|not available|unavailable/i.test(e.message)){this.mode='browser';toast('Transcription on the box isn’t ready yet; using the browser’s dictation for now.','err')}else fail(e)}
  finally{this.busy=false;this.paint()}},
 // fallback: the browser's own live dictation (Chrome, Edge, Safari)
 startBrowser(){const R=window.SpeechRecognition||window.webkitSpeechRecognition;if(!R)return toast('This browser can’t do dictation. Use Chrome, Edge or Safari.','err');
  const ta=$('#msg');if(!ta)return;const rec=new R();rec.interimResults=true;rec.continuous=true;rec.lang=navigator.language||'en-US';
  const base=ta.value&&!/\s$/.test(ta.value)?ta.value+' ':ta.value;let fin='';
  rec.onresult=e=>{let mid='';for(let i=e.resultIndex;i<e.results.length;i++){const x=e.results[i];if(x.isFinal)fin+=x[0].transcript;else mid+=x[0].transcript}const b=$('#msg');if(b){b.value=base+fin+mid;b.dispatchEvent(new Event('input'))}};
  rec.onend=()=>{this.recB=null;this.on=false;this.paint()};rec.onerror=()=>{};
  try{rec.start()}catch(e){return toast(e.message,'err')}this.recB=rec;this.on=true;this.t0=Date.now();this.paint()},
 paint(){const b=$('#voiceSlot');if(b)b.innerHTML=this.btn()},
};
ACT['mic']=()=>Voice.toggle();
