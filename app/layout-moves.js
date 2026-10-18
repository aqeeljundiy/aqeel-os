/* ---------- small moves from the agreed layout (18 Oct) that need no page of their own ---------- */
// pictures are chosen in one place: Models and accounts › Pictures (the image tool group on Skills leads there)
{const base=ACT['ts-setup'];ACT['ts-setup']=a=>{if(a.dataset.name==='image_gen'&&route().page?.id==='skills'){S.tab.models='Pictures';go('/models/models');return}return base(a)}}
