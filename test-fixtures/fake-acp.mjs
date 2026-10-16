// A stand-in Gemini CLI for tests: speaks enough ACP to exercise the client (permission, tools, plan, messages).
let buf='',next=100;const out=o=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...o})+'\n');const waiting=new Map();
const ask=(method,params)=>new Promise(r=>{const id=next++;waiting.set(id,r);out({id,method,params})});
const update=(sessionId,u)=>out({method:'session/update',params:{sessionId,update:u}});
process.stdin.on('data',async d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){const m=JSON.parse(buf.slice(0,i));buf=buf.slice(i+1);
 if(m.id!==undefined&&!m.method){waiting.get(m.id)?.(m.result);continue}
 if(m.method==='initialize')out({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}},authMethods:[{id:'oauth-personal',name:'Google'}]}});
 else if(m.method==='authenticate')out({id:m.id,result:{}});
 else if(m.method==='session/new')out({id:m.id,result:{sessionId:'sess-1',models:{availableModels:[{modelId:'gemini-test-pro',name:'Test Pro'}]}}});
 else if(m.method==='session/load')out({id:m.id,result:{}});
 else if(m.method==='session/cancel'){process.stdout.write('');}
 else if(m.method==='session/prompt'){const s=m.params.sessionId,text=m.params.prompt[0].text;
  update(s,{sessionUpdate:'plan',entries:[{content:'Edit page',status:'in_progress',priority:'high'}]});
  update(s,{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'thinking'}});
  update(s,{sessionUpdate:'tool_call',toolCallId:'t1',title:'Write index.html',kind:'edit',status:'pending',locations:[{path:process.cwd()+'/index.html'}]});
  const perm=await ask('session/request_permission',{sessionId:s,toolCall:{toolCallId:'t1',title:'Write index.html',kind:'edit'},options:[{optionId:'ok',name:'Allow',kind:'allow_once'},{optionId:'always',name:'Always',kind:'allow_always'},{optionId:'no',name:'Reject',kind:'reject_once'}]});
  update(s,{sessionUpdate:'tool_call_update',toolCallId:'t1',status:perm.outcome.optionId==='no'?'failed':'completed'});
  update(s,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Permission: '+perm.outcome.optionId+'. '}});
  update(s,{sessionUpdate:'agent_message_chunk',content:{type:'text',text:(text.includes('PLAN MODE')?'planned':'done')}});
  out({id:m.id,result:{stopReason:'end_turn',_meta:{quota:{token_count:{input_tokens:120,output_tokens:30}}}}})}
}});
