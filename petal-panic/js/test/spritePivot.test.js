import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Entity } from '../core/entity.js';
import { initProjectileSprites, projectilePool } from '../objects/projectile.js';
import { tryFire } from '../combat/shooting.js';

const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
test('box center is the transform origin under mirror/rotation; missing pivot centers art', () => {
  const e = new Entity({x:100,y:200,targetH:1});
  const data = { frames:[{file:'a',offset:{x:10,y:20}}], collisionBox:{x:10,y:20,w:80,h:40}, pivot:{x:30,y:35} };
  e.sprite={anims:{a:data},frames:new Map([['a',{complete:true,naturalWidth:80,naturalHeight:40}]])};
  e.setAnim('a');
  for (const mx of [false,true]) for(const my of [false,true]) {
    e.mirrorX=mx;e.mirrorY=my;e.rotation=0.7;
    const f=e.spriteFrame();
    // BOX-CENTER ANCHOR CONTRACT: the anchor is always the box center,
    // regardless of mirror/rotation — the AABB is the physics truth and the
    // transform origin, so the box↔art relationship never changes shape per
    // aim direction. (Old contract anchored on the raw sheet pivot.)
    near(f.anchorX,e.x+e.w/2);near(f.anchorY,e.y+e.h/2);
    // The PIVOT still positions the ART within that frame: dx/dy = offset−pivot.
    near(f.dx,-20);near(f.dy,-15);
    assert.equal(f.mirrorX,mx);assert.equal(f.mirrorY,my);
    const calls=[];const ctx={save(){},restore(){},translate(...v){calls.push(v)},scale(){},rotate(){},drawImage(){}};
    e.drawSprite(ctx);assert.deepEqual(calls[0],[f.anchorX,f.anchorY]);
  }
  data.pivot=null;const f=e.spriteFrame();near(f.anchorX,e.x+e.w/2);near(f.anchorY,e.y+e.h/2);
});

test('generic mirrored aiming aligns free angles; horizontal left is mirror only', () => {
  const e=new Entity();
  for (let i=0;i<64;i++) {
    const a=i*Math.PI/32;const vx=Math.cos(a),vy=Math.sin(a);
    e.orientSprite(vx,vy);
    near((e.mirrorX?-1:1)*Math.cos(e.rotation),vx);
    near(Math.sin(e.rotation),vy);
  }
  e.orientSprite(-1,0);assert.equal(e.mirrorX,true);near(e.rotation,0);
});

test('real thorn shooting centers its pivot on hero body plus directional muzzle offset', async () => {
  await initProjectileSprites();
  const h={selectedWeapon:'thorn',fireCooldown:0,bodyCenter:()=>({x:300,y:200}),resolveAim:i=>i.dir,stats:{projectile_freq:5}};
  for (const [dir,dx,dy] of [[0,16,0],[4,-16,0],[2,0,-16],[6,0,16]]) {
    h.fireCooldown=0;
    tryFire(h,{shoot:true,dir},1/60);
    const p=projectilePool.activeItems.at(-1);
    const img={complete:true,naturalWidth:244,naturalHeight:101};
    p.sprite={...p.sprite,frames:new Map(p.spriteAnimData.frames.map(f=>[f.file,img]))};
    const f=p.spriteFrame();near(f.anchorX,300+dx);near(f.anchorY,200+dy);
    p.alive=false;
  }
});
