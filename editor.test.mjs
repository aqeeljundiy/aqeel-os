import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize,languageOf} from './editor.js';
const join=t=>t.map(x=>x[1]).join('');
test('tokenizer keeps every character and finds the main token kinds',()=>{
 const js='const x = "hi"; // note\nfunction f(a){return a+1}';const t=tokenize(js,'js');assert.equal(join(t),js);
 assert.ok(t.some(([c,s])=>c==='k'&&s==='const'));assert.ok(t.some(([c,s])=>c==='s'&&s==='"hi"'));assert.ok(t.some(([c,s])=>c==='c'&&s==='// note'));assert.ok(t.some(([c,s])=>c==='f'&&s==='f'));
 const css='.a{color:#fff;margin:4px}/* c */';assert.equal(join(tokenize(css,'css')),css);
 const html='<a href="x">hi</a><!-- c -->';const h=tokenize(html,'html');assert.equal(join(h),html);assert.ok(h.some(([c,s])=>c==='s'&&s==='"x"'));
 const json='{"a":1,"b":[true,null,"s"]}';assert.equal(join(tokenize(json,'json')),json);
 assert.equal(languageOf('src/app.TSX'),'js');assert.equal(languageOf('notes.txt'),null);
});
