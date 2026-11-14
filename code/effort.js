// the effort a model starts on: its own default, else Medium, else the first that is not None (owner, 15 Nov 2026: "effort by default is
// none"; None turns thinking off, and it was picked only because aqeelOS models list it first). The person's own pick is kept as before.
export const startEffort=m=>{const l=m?.efforts||[];return m?.defaultEffort&&l.includes(m.defaultEffort)?m.defaultEffort:l.includes('medium')?'medium':l.find(e=>e&&e!=='none')||l[0]||''};
