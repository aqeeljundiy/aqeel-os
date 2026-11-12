// The engine settings an AGENT may change (security audit CR-2 / CR-3, 12 Nov 2026).
//
// The engine runs as the box's own user, and many of its settings are code: an app started by a command (mcp_servers),
// a voice provider of type "command" (run with shell=True), hooks, quick commands, the terminal backend, approvals. So
// what an agent may write through its own tools (my_settings, manage_agent part settings, undo_my_change) is an exact
// list of keys, each with the plain value it takes. No object or list is ever written, and no key that names a
// command, a path, an address, a provider module or an environment variable. Everything else is the main agent's or a
// person's to change (Edit agent, or report_bottleneck).
const BOOL=v=>typeof v==='boolean'||v==='true'||v==='false';
const oneOf=(...l)=>v=>typeof v==='string'&&l.includes(v);
const word=(re,max=80)=>v=>typeof v==='string'&&v.length<=max&&re.test(v);
const num=(lo,hi)=>v=>(typeof v==='number'||typeof v==='string'&&/^-?\d+(\.\d+)?$/.test(v))&&+v>=lo&&+v<=hi;
// a voice or model NAME: letters, digits and . _ : + - with single slashes inside (org/model); never a path, an address or a flag
const NAME=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:+ -]{0,79}(\/[A-Za-z0-9][A-Za-z0-9._:+ -]{0,79})?$/.test(v)&&!v.includes('..')&&!v.includes('://');
const LANG=v=>v===''||word(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/,12)(v)||v==='auto';
// the engine's built-in voice services that take no local file (piper, neutts and kittentts load model files: not here)
export const TTS_BUILTIN=['edge','elevenlabs','openai','minimax','xai','mistral','gemini','deepinfra'];
export const STT_BUILTIN=['local','groq','openai','mistral','elevenlabs','xai','deepgram','none'];
const RULES={
 timezone:v=>v===''||word(/^[A-Za-z][A-Za-z0-9_+-]{0,31}(\/[A-Za-z0-9_+-]{1,32}){0,2}$/,80)(v),
 'stt.enabled':BOOL,'stt.echo_transcripts':BOOL,'stt.language':LANG,'stt.provider':oneOf(...STT_BUILTIN),'stt.local.model':word(/^[a-z0-9][a-z0-9._-]{0,39}$/,40),'stt.local.language':LANG,
 'tts.provider':oneOf(...TTS_BUILTIN),'tts.enabled':BOOL,'tts.auto':BOOL,
 ...Object.fromEntries(TTS_BUILTIN.flatMap(p=>[['tts.'+p+'.voice',NAME],['tts.'+p+'.voice_id',NAME],['tts.'+p+'.model',NAME],['tts.'+p+'.language',LANG],['tts.'+p+'.speed',num(0.25,4)]])),
};
// display.<one word>: how replies look. Booleans, small numbers and short plain words only.
const DISPLAY=/^display\.[a-z][a-z0-9_]{0,39}$/,NOT_DISPLAY=/command|cmd|exec|shell|script|hook|path|dir|file|url|uri|host|addr|module|plugin|provider|env|editor|pager|browser|skin|theme|import/;
const displayValue=v=>BOOL(v)||num(0,100000)(v)||word(/^[a-z0-9][a-z0-9_-]{0,31}$/,32)(v)||v==='';

// null when an agent may write this key with this value, else the reason in a sentence
export function ownSettingProblem(key,value){
 key=String(key??'');if(value===null||value===undefined)value='';
 if(typeof value==='object')return 'Only a plain value (text, a number, true or false) can be set this way, never a list or a group of settings.';
 if(Object.hasOwn(RULES,key))return RULES[key](value)?null:'That is not a value '+key+' takes.';
 if(DISPLAY.test(key)&&!NOT_DISPLAY.test(key))return displayValue(value)?null:'display settings take true, false, a number or one short word.';
 return 'Not one of the settings an agent changes: '+OWN_SETTINGS_HELP}
export const ownSettingOk=(key,value)=>ownSettingProblem(key,value)===null;
// may this key be READ by an agent through its settings tool (same list; values are plain)
export const ownSettingKey=key=>{key=String(key??'');return Object.hasOwn(RULES,key)||DISPLAY.test(key)&&!NOT_DISPLAY.test(key)};
export const OWN_SETTINGS_HELP='timezone; stt.language ("" = detect each time, "id", "en"), stt.enabled, stt.echo_transcripts, stt.provider ('+STT_BUILTIN.join(', ')+'); tts.provider ('+TTS_BUILTIN.join(', ')+') and tts.<provider>.voice, voice_id, model, language or speed; display.<name> (true, false, a number or one short word). Anything else goes through report_bottleneck.';
