// One line-icon set for every toolbar (24px grid, drawn with currentColor). icon('back') returns an <svg>.
const PATHS={
 back:'<path d="M15 6l-6 6 6 6"/>',
 forward:'<path d="M9 6l6 6-6 6"/>',
 reload:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
 pick:'<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
 camera:'<path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
 rotate:'<rect x="8" y="3" width="8" height="13" rx="1.6"/><path d="M4 14a8 8 0 0 0 13.5 5.8"/><path d="M18 16.5v3.5h-3.5"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
 moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
 system:'<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 close:'<path d="M7 7l10 10M17 7 7 17"/>',
 shield:'<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
 upload:'<path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M5 20h14"/>',
 hand:'<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-.5A5.5 5.5 0 0 1 5 16.3L3.6 13a1.5 1.5 0 0 1 2.6-1.4L8 14"/>',
};
export function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('aria-hidden','true');s.classList.add('ico');s.innerHTML=PATHS[name]||'';return s}
