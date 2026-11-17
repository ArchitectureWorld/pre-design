import test from 'node:test'
import assert from 'node:assert/strict'
import {prototypeSlotContract} from '../src/layout-library/native-reference-workflow.mjs'
test('image prototypes receive the exact strict slot schema with fit nested under style',()=>{
 const schema=prototypeSlotContract({roles:['title','image']},'legacy-image-v1').contentSlotJsonSchema
 assert.equal(schema.additionalProperties,false);assert.equal(schema.properties.fit,undefined);assert.ok(schema.properties.index)
 assert.deepEqual(schema.properties.style.properties.fit.enum,['contain','cover'])
 assert.equal(schema.properties.style.additionalProperties,false)
 assert.deepEqual(prototypeSlotContract({roles:['title']},'legacy-image-v1'),{},'non-image prototype prompts and their exact checkpoints remain unchanged')
})
