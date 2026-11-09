import { describe,it,expect } from 'vitest';
import { admissionPosition } from '@entertheblackbox/scenario';
import { AdmissionPrograms } from './admission-program.js';
const program={groupId:'a',intro:[{src:'intro.mp3',durationMs:100000}],loop:[{src:'loop.mp3',durationMs:50000},{durationMs:10000}]};
describe('admission clocks',()=>{
  it('keeps independent anchors, resumes rather than restarting, and computes loop silence',()=>{
    const e=new AdmissionPrograms();e.ensure('p1','a',0);e.ensure('p2','a',40000);
    expect(e.ensure('p1','a',50000).anchor).toBe(0);
    expect(admissionPosition(program,0,50000)?.offsetMs).toBe(50000);
    expect(admissionPosition(program,40000,50000)?.offsetMs).toBe(10000);
    expect(admissionPosition(program,0,155000)).toMatchObject({section:'loop',iteration:0,src:null,offsetMs:5000});
    expect(admissionPosition(program,0,165000)).toMatchObject({section:'loop',iteration:1,src:'loop.mp3',offsetMs:5000});
  });
  it('changes revision on assignment/restart and generation when admission ends',()=>{
    const e=new AdmissionPrograms();const generation=e.generation;e.ensure('p','a',0);
    expect(e.ensure('p','b',40)).toMatchObject({anchor:40,revision:2});
    expect(e.ensure('p','b',80,true)).toMatchObject({anchor:80,revision:3});
    e.reset();expect(e.generation).not.toBe(generation);expect(e.get('p')).toBeUndefined();
  });
});
