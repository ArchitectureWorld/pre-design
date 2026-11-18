import test from 'node:test'
import assert from 'node:assert/strict'
import {referenceFidelityInventory} from '../src/layout-library/reference-fidelity-inventory.mjs'
const sha='a'.repeat(64)
test('extracted archetype source page never falls back to unrelated design-system observation',()=>{
 const profile={archetypes:[{id:'a',evidenceIds:['native']}],designSystem:{evidenceIds:['visual']},evidence:[{id:'native',provenance:'extracted',fileSha256:sha,pageNumber:1,factId:'native-1'},{id:'visual',provenance:'observed',fileSha256:sha,pageNumber:2,factId:'visual-1'}]}
 const features=referenceFidelityInventory({profile,layouts:[{id:'l',archetypeId:'a'}],observations:[{pages:[{fileSha256:sha,pageNumber:2,facts:[{id:'visual-1',property:'background',value:'#ffffff'}]}]}]})
 assert.deepEqual(features,[])
})
