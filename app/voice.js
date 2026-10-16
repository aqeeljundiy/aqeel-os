// Speech to text for the message box: the browser's own speech recognition (Chrome, Edge, Safari).
// Words appear live in the box; nothing is sent until you press Send.
const Voice={
 lang:store.get('voiceLang','en-US'),
 LANGS:[['en-US','English'],['id-ID','Bahasa Indonesia']],
 rec:null,on:false,base:'',
 supported(){return !!(window.SpeechRecognition||window.webkitSpeechRecognition)},
 btn(){const label=this.on?'Stop dictation':'Dictate ('+this.LANGS.find(l=>l[0]===this.lang)[1]+')';
  return `<button class="ghost icon mic ${this.on?'rec':''}" data-act="mic" title="${label}" aria-label="${label}" aria-pressed="${this.on}">${icon('mic',18)}</button><button class="ghost lang-pick" data-menu="voice-lang" title="Dictation language" aria-label="Dictation language">${this.lang==='id-ID'?'ID':'EN'}</button>`},
 toggle(){this.on?this.stop():this.start()},
 start(){
  if(!this.supported())return toast('This browser can’t do dictation. Use Chrome, Edge or Safari.','err');
  const ta=$('#msg');if(!ta)return;const R=window.SpeechRecognition||window.webkitSpeechRecognition;const rec=new R();
  rec.lang=this.lang;rec.interimResults=true;rec.continuous=true;rec.maxAlternatives=1;
  this.base=ta.value&&!/\s$/.test(ta.value)?ta.value+' ':ta.value;let finalText='';
  rec.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const r=e.results[i];if(r.isFinal)finalText+=r[0].transcript;else interim+=r[0].transcript}
   const box=$('#msg');if(!box)return;box.value=this.base+finalText+interim;box.dispatchEvent(new Event('input'));box.scrollTop=box.scrollHeight};
  rec.onerror=e=>{const msg={'not-allowed':'Microphone access was blocked. Allow it in the browser’s site settings.','service-not-allowed':'Microphone access was blocked. Allow it in the browser’s site settings.','no-speech':'Didn’t hear anything. Try again.','audio-capture':'No microphone found.','network':'Dictation needs an internet connection.'}[e.error];if(msg)toast(msg,'err');this.finish()};
  rec.onend=()=>this.finish();
  try{rec.start()}catch(e){return toast(e.message,'err')}
  this.rec=rec;this.on=true;this.paint();ta.focus();
 },
 stop(){try{this.rec?.stop()}catch{}},
 finish(){this.rec=null;if(!this.on)return;this.on=false;this.paint();$('#msg')?.focus()},
 setLang(l){this.lang=l;store.set('voiceLang',l);if(this.on){this.stop();setTimeout(()=>this.start(),300)}else this.paint()},
 paint(){const b=$('#voiceSlot');if(b)b.innerHTML=this.btn()},
};
ACT['mic']=()=>Voice.toggle();
