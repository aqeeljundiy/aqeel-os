import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {pdfText,contentText} from './pdf-text.mjs';

function makePdf(content,{compress}={}){const body=compress?deflateSync(Buffer.from(content,'latin1')):Buffer.from(content,'latin1');
 const head=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length '+body.length+(compress?' /Filter /FlateDecode':'')+' >>\nstream\n','latin1');return Buffer.concat([head,body,Buffer.from('\nendstream\nendobj\n%%EOF','latin1')])}

test('reads Tj strings with escapes and line breaks',()=>{
 const t=pdfText(makePdf('BT /F1 12 Tf 72 720 Td (Hello \\(world\\)) Tj 0 -14 Td (Second line) Tj ET'));
 assert.equal(t,'Hello (world)\nSecond line');
});

test('reads compressed streams and TJ arrays',()=>{
 const t=pdfText(makePdf('BT [(Secret) -250 (word) -250 (PINEAPPLE-42)] TJ ET',{compress:true}));
 assert.equal(t,'Secret word PINEAPPLE-42');
 assert.equal(contentText('BT [(Kern)-20(ing)] TJ ET').trim(),'Kerning');
});

test('reads hex strings and skips images',()=>{
 assert.equal(pdfText(makePdf('BT <48692074686572> Tj ET')),'Hi ther');
 const img=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Subtype /Image /Length 3 >>\nstream\nabc\nendstream\nendobj','latin1');assert.equal(pdfText(img),'');
});

test('readable rejects symbol soup',async()=>{const {readable}=await import('./pdf-text.mjs');
 assert.equal(readable('Certificate of analysis. Purity 99.1% by HPLC, batch 42.'),true);
 assert.equal(readable('\u0003\u0011#$%^&*{}~`|\u0007@@##$$%%^^&&**'),false);assert.equal(readable('short'),false)});
