import test from 'node:test';
import assert from 'node:assert/strict';
import {Screen,renderRow,keyBytes,color} from './vt.js';

test('prints, wraps and scrolls into history',()=>{const s=new Screen(10,3);s.write('hello\r\nworld\r\n0123456789AB\r\nlast');
 assert.equal(s.text(),'0123456789\nAB\nlast');assert.equal(s.history.map(l=>l.map(c=>c.c).join('').trim()).join('|'),'hello|world')});

test('cursor addressing, erase and insert/delete',()=>{const s=new Screen(10,4);s.write('aaaa\r\nbbbb\r\ncccc');s.write('\x1b[1;3HXY');assert.equal(s.text().split('\n')[0],'aaXY');
 s.write('\x1b[2;1H\x1b[K');assert.equal(s.text().split('\n')[1],'');s.write('\x1b[3;2H\x1b[P');assert.equal(s.text().split('\n')[2],'ccc');
 s.write('\x1b[1;1H\x1b[L');assert.equal(s.text().split('\n')[0],'');assert.equal(s.text().split('\n')[1],'aaXY');s.write('\x1b[2J');assert.equal(s.text(),'')});

test('alternate screen keeps the shell output underneath',()=>{const s=new Screen(10,3);s.write('$ vim');s.write('\x1b[?1049h\x1b[H~\r\n~');assert.equal(s.text(),'~\n~');
 s.write('\x1b[?1049l');assert.equal(s.text(),'$ vim')});

test('scroll region, reverse index and colours',()=>{const s=new Screen(5,4);s.write('1\r\n2\r\n3\r\n4');s.write('\x1b[2;3r\x1b[3;1H\n');assert.equal(s.text(),'1\n3\n\n4');
 s.write('\x1b[2;1H\x1bM');assert.equal(s.text(),'1\n\n3\n4');
 const c=new Screen(5,1);c.write('\x1b[1;31mR\x1b[0m\x1b[38;5;196mX\x1b[48;2;1;2;3mY');const html=renderRow(c.lines[0]);
 assert.match(html,/color:var\(--t9\);font-weight:700;">R/);assert.match(html,/rgb\(255,0,0\)/);assert.match(html,/background:#010203/);assert.equal(color(232),'rgb(8,8,8)')});

test('replies to cursor position requests and maps keys',()=>{const replies=[];const s=new Screen(10,3,{onReply:r=>replies.push(r)});s.write('ab\x1b[6n');assert.deepEqual(replies,['\x1b[1;3R']);
 assert.equal(keyBytes({key:'c',ctrlKey:true}),'\x03');assert.equal(keyBytes({key:'ArrowUp'},false),'\x1b[A');assert.equal(keyBytes({key:'ArrowUp'},true),'\x1bOA');assert.equal(keyBytes({key:'Enter'}),'\r');assert.equal(keyBytes({key:'x',altKey:true}),'\x1bx')});

test('resize keeps the cursor on screen',()=>{const s=new Screen(10,6);s.write('1\r\n2\r\n3\r\n4\r\n5\r\n6');s.resize(6,4);assert.equal(s.rows,4);assert.ok(s.y<=3);assert.equal(s.text(),'3\n4\n5\n6')});
