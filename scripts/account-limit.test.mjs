// Constant-time compare for secrets (app/account-limit.mjs). The per-account sign-in limit is tested in scripts/signin-guard.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';
const {safeEq}=await import('../app/account-limit.mjs');
test('constant-time compare: equal strings match, different ones and different lengths do not',()=>{
 assert.ok(safeEq('abc123','abc123'));assert.ok(!safeEq('abc123','abc124'));assert.ok(!safeEq('abc','abc123'));assert.ok(!safeEq('x',''));assert.ok(safeEq(undefined,''))});
