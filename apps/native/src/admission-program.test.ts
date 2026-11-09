import { describe,it,expect } from 'vitest';
import { admissionLayers } from './admission-program';
describe('native admission scheduling',()=>{
  it('hands all boundaries to native layers, including intro and repeating silent gaps',()=>{
    expect(admissionLayers({groupId:'ki',intro:[{src:'intro.mp3',durationMs:1000},{durationMs:500}],loop:[{src:'loop.mp3',durationMs:2000},{durationMs:3000}]},100)).toEqual([
      {id:'admission-intro-0',src:'intro.mp3',startAt:100,endAt:1100},
      {id:'admission-loop-0',src:'loop.mp3',startAt:1600,endAt:3600,repeatEveryMs:5000},
    ]);
  });
});
