// The title of an alert is its first line; a long one is cut at a sentence or a word (never mid-word) and the text goes on from the cut
// (UI walk of 12 Nov 2026: Activity read "...1094 a" over "dded .bundled_manifest...", one word split between the two lines).
export function alertTitle(text){const line=String(text).split('\n')[0];let cut=line.length;
 if(cut>140){const b=Math.max(line.lastIndexOf(': ',138),line.lastIndexOf('. ',138)),w=line.lastIndexOf(' ',138);cut=b>60?b+1:w>40?w:140}
 return {first:line.slice(0,cut).trim(),cut}}
