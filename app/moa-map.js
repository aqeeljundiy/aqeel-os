// Team of models: a saved advisor or answer model is {provider, model}. When its provider is not signed in here but a
// sign-in the install does have offers the same model, the team should use that (12 Nov 2026: the owner's "claude-team" pointed
// at the plain API provider and showed every advisor as "not signed in", though his Claude subscription has the same models).
// Plain functions, loaded by the page before people.js and by scripts/moa-map.test.mjs.
// models: the signed-in, working models, [{id, provider}], in the order the app prefers them.
function moaModelNorm(id){return String(id||'').toLowerCase().split('/').pop().replace(/[._]/g,'-').replace(/-(\d{8}|latest)$/,'')}
function moaFamily(id){const m=/haiku|sonnet|opus/.exec(String(id||'').toLowerCase());return m?m[0]:''}
// "claude-sonnet-4-5" → [4,5], "claude-3-5-haiku-20241022" → [3,5]: the version without a date stamp
function moaVersion(id){return (moaModelNorm(id).match(/\d+/g)||[]).filter(n=>n.length<6).map(Number)}
function moaNewer(a,b){const x=moaVersion(a),y=moaVersion(b);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d}return 0}
// → {provider, model, changed, missing}. changed: a signed-in equivalent stands in for what was saved;
// missing: nothing signed in offers it (provider and model stay as saved, and the page says which sign-in it needs)
function moaEquivalent(saved,models){const s=saved||{},ms=models||[];
 if(!s.model)return {provider:s.provider||'',model:'',changed:false,missing:false};
 if(ms.some(m=>m.provider===s.provider&&m.id===s.model))return {provider:s.provider,model:s.model,changed:false,missing:false};
 const use=m=>({provider:m.provider,model:m.id,changed:true,missing:false});
 // the same model through another sign-in: the same id, or the same name written another way (a provider prefix, dots, a date stamp)
 const same=ms.find(m=>m.id===s.model)||ms.find(m=>moaModelNorm(m.id)===moaModelNorm(s.model));if(same)return use(same);
 // the current version of the same family (Haiku, Sonnet, Opus): the newest one a sign-in offers
 const fam=moaFamily(s.model);
 if(fam){const best=ms.filter(m=>moaFamily(m.id)===fam).reduce((b,m)=>!b||moaNewer(m.id,b.id)>0?m:b,null);if(best)return use(best)}
 return {provider:s.provider||'',model:s.model,changed:false,missing:true}}
// a whole team rewritten onto the signed-in models; n = how many entries changed, missing = entries nothing signed in offers
function moaFixTeam(preset,models){let n=0,missing=0;const fix=s=>{if(!s||!s.model)return s;const r=moaEquivalent(s,models);if(r.missing)missing++;if(!r.changed)return s;n++;return {...s,provider:r.provider,model:r.model}};
 const out={...preset,reference_models:(preset?.reference_models||[]).map(fix),aggregator:fix(preset?.aggregator)};return {preset:out,changed:n,missing}}
