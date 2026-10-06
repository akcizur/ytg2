
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const keys = Object.create(null);
const mouse = { down: false, x: 0, y: 0, active: false };
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();

const state = {
  started: false, paused: false, dead: false,
  time: 18, money: 1250, health: 100, stamina: 100,
  wanted: 0, heat: 0, score: 0, weather: 0,
  weatherNames: ['CLEAR', 'RAIN', 'STORM', 'FOG'],
  mission: 0, missionStep: 0, missionKills: 0, autosave: 8
};

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance'
  });
} catch (error) {
  document.body.innerHTML = '<main style="display:grid;place-items:center;width:100vw;height:100vh;background:#070b0f;color:#eef1f4;font:600 16px system-ui;text-align:center;padding:24px">WebGL 2 není v tomto prohlížeči dostupné.<br>Aktualizuj ovladač grafiky nebo použij moderní Firefox/Chrome/Edge.</main>';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.8));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x071016, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);
scene.fog = new THREE.FogExp2(0x111111, 0.0022);

const camera = new THREE.PerspectiveCamera(49, innerWidth / innerHeight, 0.1, 2600);
camera.position.set(250, 430, 300);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.48, 0.62, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const hemi = new THREE.HemisphereLight(0xffffff, 0x171717, 1.7);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1500;
sun.shadow.camera.left = -520;
sun.shadow.camera.right = 520;
sun.shadow.camera.top = 520;
sun.shadow.camera.bottom = -520;
scene.add(sun);
scene.add(sun.target);

const moon = new THREE.DirectionalLight(0xbdbdbd, 0.3);
moon.castShadow = false;
scene.add(moon);
scene.add(moon.target);

const world = {
  size: 2200, half: 1100, roadWidth: 86, grid: 320,
  colliders: [], roads: [], buildings: [], streetLights: [],
  cars: [], npcs: [], particles: [], puddles: [], rain: null,
  rainMaterial: null, player: null, roadSurfaceMaterial: null, playerHeadlights: null
};

const textures = {};
function noiseCanvas(size, base, variance, grid) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0,0,size,size);
  for (let i=0;i<Math.floor(size*size/18);i++) {
    const v = Math.max(0, Math.min(255, Math.floor(128 + (Math.random()-.5)*variance)));
    x.fillStyle = 'rgb('+v+','+v+','+v+')';
    const px = Math.floor(Math.random()*size/grid)*grid;
    const py = Math.floor(Math.random()*size/grid)*grid;
    x.fillRect(px, py, grid, grid);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function heightFromTexture(texture) {
  const src = texture.image;
  const c=document.createElement('canvas'); c.width=c.height=src.width;
  const x=c.getContext('2d'); x.drawImage(src,0,0);
  const img=x.getImageData(0,0,src.width,src.height);
  for(let i=0;i<img.data.length;i+=4){
    const g=(img.data[i]+img.data[i+1]+img.data[i+2])/3;
    img.data[i]=img.data[i+1]=img.data[i+2]=g;
  }
  x.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; return t;
}
textures.asphalt=noiseCanvas(256,'#454545',42,2);
textures.concrete=noiseCanvas(256,'#858585',34,3);
textures.roof=noiseCanvas(256,'#5b5b5b',34,2);
textures.ground=noiseCanvas(256,'#505050',38,4);
textures.asphaltBump=heightFromTexture(textures.asphalt);
textures.concreteBump=heightFromTexture(textures.concrete);
textures.roofBump=heightFromTexture(textures.roof);
textures.asphalt.repeat.set(18,18);
textures.asphaltBump.repeat.set(18,18);
textures.concrete.repeat.set(4,4);
textures.concreteBump.repeat.set(4,4);
textures.roof.repeat.set(4,4);
textures.roofBump.repeat.set(4,4);
textures.ground.repeat.set(14,14);

function windowsTexture() {
  const c=document.createElement('canvas'); c.width=c.height=256;
  const x=c.getContext('2d'); x.fillStyle='#07090c'; x.fillRect(0,0,256,256);
  for(let yy=10;yy<250;yy+=22) for(let xx=10;xx<250;xx+=18) {
    if(Math.random()>.38){
      x.fillStyle=Math.random()>.2?'#c98d49':'#6fa3c7';
      x.globalAlpha=.35+.6*Math.random(); x.fillRect(xx,yy,9,12);
    }
  }
  x.globalAlpha=1;
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return t;
}
textures.windows=windowsTexture();

const asphaltMat=new THREE.MeshStandardMaterial({
  map:textures.asphalt, roughness:.77, metalness:.05, bumpMap:textures.asphaltBump, bumpScale:.11
});
const concreteMat=new THREE.MeshStandardMaterial({
  map:textures.concrete, roughness:.86, metalness:0, bumpMap:textures.concreteBump, bumpScale:.06
});
const roofMat=new THREE.MeshStandardMaterial({
  map:textures.roof, roughness:.74, metalness:.05, bumpMap:textures.roofBump, bumpScale:.08
});
const grassMat=new THREE.MeshStandardMaterial({map:textures.ground,roughness:1});

function buildingMaterial(seed) {
  const levels = [0.18,0.23,0.28,0.34,0.40,0.47,0.54];
  const tone = levels[Math.abs(seed)%levels.length];
  return new THREE.MeshStandardMaterial({
    color:new THREE.Color(tone,tone,tone),
    map:textures.concrete,
    roughness:.94,
    metalness:0,
    bumpMap:textures.concreteBump,
    bumpScale:.035,
    flatShading:true
  });
}
function createBuilding(x,z,w,d,h){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),buildingMaterial(Math.floor(Math.random()*999)));
  mesh.position.set(x,h/2,z); mesh.castShadow=true; mesh.receiveShadow=true; scene.add(mesh);
  world.buildings.push(mesh);
  world.colliders.push({minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2});
  const roof=new THREE.Mesh(new THREE.BoxGeometry(w+3,2,d+3),roofMat); roof.geometry.computeVertexNormals();
  roof.position.set(x,h+1,z); roof.castShadow=true; scene.add(roof);
  if(h>70){
    const cap=new THREE.Mesh(new THREE.BoxGeometry(w*.45,8,d*.45),roofMat);
    cap.position.set(x,h+6,z); cap.castShadow=true; scene.add(cap);
  }
}
function createPark(x,z){
  const base=new THREE.Mesh(new THREE.BoxGeometry(230,.16,230),grassMat);
  base.position.set(x,.08,z); base.receiveShadow=true; scene.add(base);
  for(let i=0;i<16;i++){
    const tree=new THREE.Group();
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.8,1,10,6),new THREE.MeshStandardMaterial({color:0x3c3c3c,roughness:1,flatShading:true}));
    trunk.position.y=5;
    const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(6+Math.random()*4,1),new THREE.MeshStandardMaterial({color:0x5e5e5e,roughness:1,flatShading:true}));
    crown.position.y=11; tree.add(trunk,crown);
    tree.position.set(x+(Math.random()-.5)*190,0,z+(Math.random()-.5)*190);
    tree.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}}); scene.add(tree);
  }
}
function createLamp(x,z){
  const g=new THREE.Group();
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.55,.75,18,8),new THREE.MeshStandardMaterial({color:0x303030,metalness:.55,roughness:.5,flatShading:true}));
  pole.position.y=9;
  const head=new THREE.Mesh(new THREE.BoxGeometry(3,1.2,2.5),new THREE.MeshStandardMaterial({color:0x181818,metalness:.35,roughness:.5,emissive:0xffffff,emissiveIntensity:.25,flatShading:true}));
  head.position.y=18;
  const light=new THREE.PointLight(0xffffff,5.5,105,2); light.position.y=16;
  g.add(pole,head,light); g.position.set(x,0,z); scene.add(g);
  world.streetLights.push({light,head});
}
function createPuddle(x,z,size){
  const m=new THREE.MeshPhysicalMaterial({color:0x777777,roughness:.14,metalness:.7,transmission:.05,transparent:true,opacity:.20});
  const p=new THREE.Mesh(new THREE.CircleGeometry(size,32),m);
  p.rotation.x=-Math.PI/2; p.position.set(x,.145,z); scene.add(p); world.puddles.push(p);
}

function createCity(){
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(world.size,world.size),asphaltMat);
  floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);

  const roadMat=new THREE.MeshStandardMaterial({color:0x242424,roughness:.96,metalness:0,flatShading:true});
  world.roadSurfaceMaterial=roadMat;
  for(let gx=-world.half;gx<=world.half;gx+=world.grid){
    const road=new THREE.Mesh(new THREE.BoxGeometry(world.roadWidth,.12,world.size),roadMat);
    road.position.set(gx,.06,0); road.receiveShadow=true; scene.add(road);
    world.roads.push({x:gx,z:0,vertical:true});
  }
  for(let gz=-world.half;gz<=world.half;gz+=world.grid){
    const road=new THREE.Mesh(new THREE.BoxGeometry(world.size,.12,world.roadWidth),roadMat);
    road.position.set(0,.065,gz); road.receiveShadow=true; scene.add(road);
    world.roads.push({x:0,z:gz,vertical:false});
  }

  const lineMat=new THREE.MeshStandardMaterial({color:0x888888,roughness:1,metalness:0,flatShading:true});
  for(let gx=-world.half;gx<=world.half;gx+=world.grid) for(let z=-world.half;z<world.half;z+=80){
    const lane=new THREE.Mesh(new THREE.BoxGeometry(2,.13,36),lineMat); lane.position.set(gx,.13,z); scene.add(lane);
  }
  for(let gz=-world.half;gz<=world.half;gz+=world.grid) for(let x=-world.half;x<world.half;x+=80){
    const lane=new THREE.Mesh(new THREE.BoxGeometry(36,.13,2),lineMat); lane.position.set(x,.135,gz); scene.add(lane);
  }

  for(let bx=-world.half+world.grid/2;bx<world.half;bx+=world.grid){
    for(let bz=-world.half+world.grid/2;bz<world.half;bz+=world.grid){
      if(Math.random()<.12){createPark(bx,bz);continue;}
      const w=120+Math.random()*96,d=120+Math.random()*96,h=26+Math.random()*110;
      createBuilding(bx+(Math.random()-.5)*44,bz+(Math.random()-.5)*44,w,d,h);
    }
  }

  for(let i=0;i<84;i++){
    const vertical=Math.random()<.5;
    const road=Math.round((Math.random()*world.size-world.half)/world.grid)*world.grid;
    const x=vertical?road+(Math.random()>.5?30:-30):(-world.half+Math.random()*world.size);
    const z=vertical?(-world.half+Math.random()*world.size):road+(Math.random()>.5?30:-30);
    createLamp(x,z);
  }

  const sky=new THREE.Mesh(new THREE.SphereGeometry(1700,32,20),new THREE.MeshBasicMaterial({color:0x0e1720,side:THREE.BackSide}));
  scene.add(sky);
  for(let i=0;i<38;i++) createPuddle(-1000+Math.random()*2000,-1000+Math.random()*2000,6+Math.random()*18);
}

function createCar(color, police){
  const g=new THREE.Group();
  const carTone = police ? 0.72 : 0.28 + (Number(color)&255)/255*.35;
  const bodyMat=new THREE.MeshPhysicalMaterial({color:new THREE.Color(carTone,carTone,carTone),metalness:.32,roughness:.38,clearcoat:.55,clearcoatRoughness:.24,flatShading:true});
  const glassMat=new THREE.MeshPhysicalMaterial({color:0x191919,metalness:.05,roughness:.18,transmission:.05,transparent:true,opacity:.9,flatShading:true});
  const tyre=new THREE.MeshStandardMaterial({color:0x0b0b0b,roughness:1,flatShading:true});
  const body=new THREE.Mesh(new THREE.BoxGeometry(4.1,1.1,8.8),bodyMat); body.position.y=1.05;
  const cabin=new THREE.Mesh(new THREE.BoxGeometry(3.35,.92,4.0),glassMat); cabin.position.set(0,1.72,-.15);
  g.add(body,cabin);
  for(const x of [-1.9,1.9]) for(const z of [-2.95,2.95]){
    const w=new THREE.Mesh(new THREE.CylinderGeometry(.8,.8,.45,16),tyre); w.rotation.z=Math.PI/2; w.position.set(x,.78,z); g.add(w);
  }
  const lampMat=new THREE.MeshStandardMaterial({color:0xcfcfcf,emissive:0xffffff,emissiveIntensity:1.1,flatShading:true});
  for(const x of [-1.25,1.25]){
    const l=new THREE.Mesh(new THREE.BoxGeometry(.7,.45,.2),lampMat);
    l.position.set(x,1.28,4.5);g.add(l);
  }
  const frontBumper=new THREE.Mesh(
    new THREE.BoxGeometry(4.0,.24,.28),
    new THREE.MeshStandardMaterial({color:0x171a1d,metalness:.5,roughness:.4})
  );
  frontBumper.position.set(0,.7,4.42);g.add(frontBumper);
  const rearBumper=frontBumper.clone();
  rearBumper.position.z=-4.42;g.add(rearBumper);
  if(police){
    const red=new THREE.MeshStandardMaterial({color:0xbdbdbd,emissive:0xffffff,emissiveIntensity:2.4,flatShading:true});
    const blue=new THREE.MeshStandardMaterial({color:0x5f5f5f,emissive:0xffffff,emissiveIntensity:1.4,flatShading:true});
    const r=new THREE.Mesh(new THREE.BoxGeometry(.62,.25,.8),red);r.position.set(-.35,2.3,0);
    const b=new THREE.Mesh(new THREE.BoxGeometry(.62,.25,.8),blue);b.position.set(.35,2.3,0);g.add(r,b);
  }
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(g);
  const c={group:g,x:0,z:0,yaw:0,speed:0,maxSpeed:8+Math.random()*4,health:100,police:!!police,occupied:false,stolen:false,marked:false};
  world.cars.push(c);return c;
}
function enablePlayerHeadlights(car, enabled){
  if (!car) return;
  if (!car.headlights) {
    const rig=new THREE.Group();
    const mk=(x)=>{
      const spot=new THREE.SpotLight(0xffefcf,7.5,115,Math.PI/7,.42,1.5);
      spot.position.set(x,1.55,4.0);
      spot.target.position.set(x,0,26);
      spot.castShadow=false;
      rig.add(spot,spot.target);
      return spot;
    };
    car.headlights={rig,left:mk(-1.15),right:mk(1.15)};
    car.group.add(rig);
  }
  car.headlights.rig.visible=enabled;
}
function addMarkedBeacon(car){
  if (!car || !car.marked || car.beacon) return;
  const beacon=new THREE.Mesh(
    new THREE.TorusGeometry(2.8,.22,8,32),
    new THREE.MeshBasicMaterial({color:0xffbd52,transparent:true,opacity:.9})
  );
  beacon.rotation.x=Math.PI/2;
  beacon.position.y=6;
  car.group.add(beacon);
  car.beacon=beacon;
}
function createNPC(kind){
  const g=new THREE.Group();
  const skin=new THREE.MeshStandardMaterial({color:0x9a9a9a,roughness:.95,flatShading:true});
  const coat=new THREE.MeshStandardMaterial({color:kind==='gang'?0x575757:0x353535,roughness:.92,flatShading:true});
  const body=new THREE.Mesh(new THREE.CapsuleGeometry(.52,1.5,4,8),coat);body.position.y=1.2;
  const head=new THREE.Mesh(new THREE.SphereGeometry(.45,12,8),skin);head.position.y=2.62;g.add(body,head);
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(g);
  const n={group:g,x:0,z:0,yaw:Math.random()*Math.PI*2,speed:1+Math.random()*1.6,health:kind==='gang'?60:35,kind,alive:true,fire:Math.random()};
  world.npcs.push(n);return n;
}

createCity();
for(let i=0;i<36;i++)createCar([0xa6b0bc,0xc94c42,0x4d77a8,0x8d6a47,0xb8a33e,0x3f8a62][i%6],false);
for(let i=0;i<4;i++)createCar(0xdbe3ed,true);
for(let i=0;i<75;i++)createNPC('civilian');
for(let i=0;i<10;i++)createNPC('gang');

function placeEntities(){
  const roads=[-960,-640,-320,0,320,640,960],lane=26;
  for(const c of world.cars){
    const vertical=Math.random()<.5;
    if(vertical){c.x=roads[Math.floor(Math.random()*roads.length)]+(Math.random()>.5?lane:-lane);c.z=-1000+Math.random()*2000;c.yaw=Math.PI/2;}
    else{c.x=-1000+Math.random()*2000;c.z=roads[Math.floor(Math.random()*roads.length)]+(Math.random()>.5?lane:-lane);c.yaw=0;}
    c.group.position.set(c.x,0,c.z);c.group.rotation.y=c.yaw;
  }
  for(const n of world.npcs){
    const r=world.roads[Math.floor(Math.random()*world.roads.length)];
    n.x=r.x+(r.vertical?(Math.random()-.5)*world.roadWidth*1.25:0);
    n.z=r.z+(r.vertical?0:(Math.random()-.5)*world.roadWidth*1.25);
    n.group.position.set(n.x,0,n.z);
  }
}
placeEntities();

const player={x:-480,z:-420,yaw:0,speed:0,car:null,fire:0,invuln:0};
world.player=player;
const playerMesh=new THREE.Group();
const pBody=new THREE.Mesh(new THREE.CapsuleGeometry(.6,1.6,4,9),new THREE.MeshStandardMaterial({color:0xd7d7d7,roughness:.72,flatShading:true}));
pBody.position.y=1.25;
const pHead=new THREE.Mesh(new THREE.SphereGeometry(.48,12,9),new THREE.MeshStandardMaterial({color:0x8c8c8c,roughness:.88,flatShading:true}));
pHead.position.y=2.72;playerMesh.add(pBody,pHead);
playerMesh.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(playerMesh);

const jobs=[
  {x:-480,z:-420,c:0xffffff,label:'SAFEHOUSE'},
  {x:900,z:-900,c:0xbdbdbd,label:'DOCKS'},
  {x:900,z:900,c:0x7f7f7f,label:'GARAGE'}
];
for(const j of jobs){
  const g=new THREE.Group();
  const ring=new THREE.Mesh(new THREE.TorusGeometry(7,.9,10,40),new THREE.MeshBasicMaterial({color:j.c,transparent:true,opacity:.9}));
  ring.rotation.x=Math.PI/2;
  const beam=new THREE.Mesh(new THREE.CylinderGeometry(.05,.3,22,10,1,true),new THREE.MeshBasicMaterial({color:j.c,transparent:true,opacity:.12,depthWrite:false}));
  beam.position.y=11;g.add(ring,beam);g.position.set(j.x,.4,j.z);g.userData.ytg2JobMarker=true;scene.add(g);
}

function blocked(x,z,r){
  for(const b of world.colliders){
    const px=Math.max(b.minX,Math.min(x,b.maxX)),pz=Math.max(b.minZ,Math.min(z,b.maxZ));
    if(Math.hypot(x-px,z-pz)<r)return true;
  }
  return x<-1090||x>1090||z<-1090||z>1090;
}
function moveActor(x,z,dx,dz,r){
  let nx=x+dx,nz=z+dz;
  if(blocked(nx,z,r))nx=x;if(blocked(nx,nz,r))nz=z;
  return{x:nx,z:nz};
}
function enterCar(){
  if(player.car){
    const c=player.car,side=new THREE.Vector3(Math.cos(c.yaw+Math.PI/2)*4,0,Math.sin(c.yaw+Math.PI/2)*4);
    const p=moveActor(c.x+side.x,c.z+side.z,0,0,1);
    player.x=p.x;player.z=p.z;player.car=null;c.occupied=false;
    enablePlayerHeadlights(c,false);
    playerMesh.visible=true;return;
  }
  let best=null,bd=7;
  for(const c of world.cars){if(c.occupied)continue;const d=Math.hypot(c.x-player.x,c.z-player.z);if(d<bd){bd=d;best=c;}}
  if(!best)return;
  player.car=best;best.occupied=true;best.stolen=true;
  addMarkedBeacon(best);
  enablePlayerHeadlights(best,true);
  state.wanted=Math.min(5,state.wanted+.75);state.heat=8;playerMesh.visible=false;
}
function lineOfSight(x1,z1,x2,z2){
  for(let i=1;i<20;i++){const t=i/20,x=THREE.MathUtils.lerp(x1,x2,t),z=THREE.MathUtils.lerp(z1,z2,t);
    for(const b of world.colliders)if(x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ)return false;}
  return true;
}
function fire(){
  if(player.fire>0||state.health<=0)return;
  player.fire=.18;

  raycaster.setFromCamera(new THREE.Vector2(mouse.x,mouse.y),camera);
  if(!raycaster.ray.intersectPlane(aimPlane,aimPoint)){
    camera.getWorldDirection(aimPoint);
    aimPoint.multiplyScalar(90).add(new THREE.Vector3(player.x,0,player.z));
  }

  const origin=new THREE.Vector3(player.x,1.65,player.z);
  const flatAim=new THREE.Vector3(aimPoint.x,1.65,aimPoint.z);
  const dir=flatAim.sub(origin).normalize();
  const start=origin.clone().add(dir.clone().multiplyScalar(2.2));
  const end=start.clone().add(dir.clone().multiplyScalar(95));

  const line=new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([start,end]),
    new THREE.LineBasicMaterial({color:0xffe2a2,transparent:true,opacity:.82})
  );
  scene.add(line);
  world.particles.push({mesh:line,life:.055,update(dt){this.life-=dt;}});

  state.wanted=Math.min(5,state.wanted+.12);
  state.heat=8;

  let best=null,bestD=6;
  for(const n of world.npcs){
    if(!n.alive||n.kind!=='gang')continue;
    const p=new THREE.Vector3(n.x,1.25,n.z);
    const d=p.distanceTo(start);
    const lateral=pointToLineDistance(p,start,end);
    if(d<end.distanceTo(start)&&lateral<1.7&&lineOfSight(start.x,start.z,n.x,n.z)&&lateral<bestD){
      best=n;bestD=lateral;
    }
  }
  if(best){
    best.health-=30;
    if(best.health<=0){
      best.alive=false;best.group.visible=false;
      state.score+=150;state.money+=100;state.missionKills++;
    }
  }
}

function pointToLineDistance(p,a,b){
  const ab=b.clone().sub(a);
  const denom=Math.max(ab.lengthSq(),0.0001);
  const t=THREE.MathUtils.clamp(p.clone().sub(a).dot(ab)/denom,0,1);
  return p.distanceTo(a.clone().add(ab.multiplyScalar(t)));
}

function updateTraffic(dt){
  for(const c of world.cars){
    if(c===player.car)continue;
    if(c.police&&state.wanted>.2){
      const a=Math.atan2(player.x-c.x,player.z-c.z);c.yaw=THREE.MathUtils.lerp(c.yaw,Math.round(a/(Math.PI/2))*(Math.PI/2),dt*3);c.speed=THREE.MathUtils.lerp(c.speed,c.maxSpeed+3,dt*1.1);
    }else{
      c.speed=THREE.MathUtils.lerp(c.speed,c.maxSpeed*.55,dt*.8);
      if(Math.random()<dt*.22)c.yaw=Math.round(c.yaw/(Math.PI/2))*(Math.PI/2);
    }
    const p=moveActor(c.x,c.z,Math.sin(c.yaw)*c.speed*dt,Math.cos(c.yaw)*c.speed*dt,2.6);
    c.x=p.x;c.z=p.z;c.group.position.set(c.x,0,c.z);c.group.rotation.y=c.yaw;
    if(c.police && state.wanted<0.15 && Math.hypot(c.x-player.x,c.z-player.z)>900) c.health-=dt*5;
    if(c.marked) addMarkedBeacon(c);
    if(c.beacon){
      c.beacon.visible=c.marked;
      c.beacon.rotation.z+=dt*2.4;
      c.beacon.material.opacity=.55+.35*(Math.sin(performance.now()*.006)+1)/2;
    }
  }
}
function updatePlayer(dt){
  player.fire=Math.max(0,player.fire-dt);
  if(player.car){
    const c=player.car,steer=(keys.d?1:0)-(keys.a?1:0);
    if(keys.w)c.speed=THREE.MathUtils.lerp(c.speed,13,dt*3);
    else if(keys.s)c.speed=THREE.MathUtils.lerp(c.speed,-6,dt*4);
    else c.speed=THREE.MathUtils.lerp(c.speed,0,dt*2);
    c.yaw-=steer*(Math.abs(c.speed)/13)*dt*2.2;
    const p=moveActor(c.x,c.z,Math.sin(c.yaw)*c.speed*dt,Math.cos(c.yaw)*c.speed*dt,2.5);
    c.x=p.x;c.z=p.z;c.group.position.set(c.x,0,c.z);c.group.rotation.y=c.yaw;player.x=c.x;player.z=c.z;player.yaw=c.yaw;
    for(const other of world.cars){
      if(other===c)continue;
      const d=Math.hypot(other.x-c.x,other.z-c.z);
      if(d<6.2 && Math.abs(c.speed)>2.5){
        other.health=Math.max(0,other.health-Math.abs(c.speed)*dt*1.6);
        c.speed*=.82;
        state.wanted=Math.min(5,state.wanted+.015);
      }
    }
    return;
  }
  let mx=(keys.d?1:0)-(keys.a?1:0),mz=(keys.s?1:0)-(keys.w?1:0);
  if(mx||mz){
    const l=Math.hypot(mx,mz);mx/=l;mz/=l;const s=keys.shift&&state.stamina>5?7.6:5.1;
    state.stamina=Math.max(0,state.stamina-(keys.shift?14:-7)*dt);
    const p=moveActor(player.x,player.z,mx*s*dt,mz*s*dt,1.2);player.x=p.x;player.z=p.z;player.yaw=Math.atan2(mx,mz);
  }else state.stamina=Math.min(100,state.stamina+11*dt);
  if(mouse.down||keys[' '])fire();
  playerMesh.position.set(player.x,0,player.z);playerMesh.rotation.y=player.yaw;
}
function updateNPCs(dt){
  for(const n of world.npcs){
    if(!n.alive)continue;
    const d=Math.hypot(player.x-n.x,player.z-n.z);
    let yaw=n.yaw;
    if(n.kind==='gang'&&d<42){yaw=Math.atan2(player.x-n.x,player.z-n.z);if(n.fire<=0&&lineOfSight(n.x,n.z,player.x,player.z)){n.fire=1;state.health=Math.max(0,state.health-9);}}
    else if(Math.random()<dt*.4)yaw=n.yaw+(Math.random()-.5)*1.6;
    n.yaw=THREE.MathUtils.lerp(n.yaw,yaw,dt*2);
    const speed=n.kind==='civilian'?n.speed:2.1;
    const p=moveActor(n.x,n.z,Math.sin(n.yaw)*speed*dt,Math.cos(n.yaw)*speed*dt,.9);n.x=p.x;n.z=p.z;
    n.fire=Math.max(0,n.fire-dt);n.group.position.set(n.x,0,n.z);n.group.rotation.y=n.yaw;
  }
}
function jobsMeshSafe(){
  const arr=[];
  scene.traverse(o=>{if(o.userData&&o.userData.ytg2JobMarker)arr.push(o);});
  return arr;
}
function updateMission(){
  let text='';
  if(state.mission===0){
    text='Reach the safehouse and accept the courier job.';
    if(Math.hypot(player.x+480,player.z+420)<30)text='E — accept courier contract.';
  }else if(state.mission===1){
    if(state.missionStep===1)text='Find the marked car.';
    else if(state.missionStep===2)text='Take the marked car.';
    else text='Lose the police and reach the garage.';
  }else text='Clean the street: '+state.missionKills+'/6 targets.';
  $('missionText').textContent=text;
  $('hint').textContent='E — interact / exit';
  $('missionNo').textContent='MISSION '+String(state.mission+1).padStart(2,'0');
}
function progressMission(){
  if(state.mission===0){
    if(Math.hypot(player.x+480,player.z+420)<30&&keys.e){state.mission=1;state.missionStep=1;state.money+=150;state.score+=300;}
  }else if(state.mission===1){
    if(state.missionStep===1){
      const c=world.cars.find(v=>!v.police&&!v.occupied&&!v.marked);if(c)c.marked=true,state.missionStep=2;
    }else if(state.missionStep===2){
      const c=world.cars.find(v=>v.marked);if(c&&player.car===c){state.wanted=3;state.heat=12;state.missionStep=3;}
    }else if(state.wanted<.35&&Math.hypot(player.x-900,player.z-900)<35){state.money+=850;state.score+=1600;state.mission=2;state.missionStep=0;for(let i=0;i<10;i++)createNPC('gang');}
  }else if(state.missionKills>=6&&Math.hypot(player.x+850,player.z-720)<40){
    state.money+=1200;state.score+=2200;state.mission=0;state.missionStep=0;state.missionKills=0;
    world.npcs.filter(n=>n.kind==='gang').forEach(n=>n.alive=true);
  }
}
function updateWanted(dt){
  if(state.heat>0)state.heat-=dt;else if(state.wanted>0)state.wanted=Math.max(0,state.wanted-dt*.075);
}
function updateWeather(dt){
  state.time+=dt*.02;if(state.time>24)state.time-=24;
  const night=state.time>18||state.time<6;
  const sunAngle=(state.time/24)*Math.PI*2-Math.PI/2;
  sun.position.set(Math.cos(sunAngle)*700,Math.max(70,Math.sin(sunAngle)*700),Math.sin(sunAngle)*500);
  sun.target.position.set(player.x,0,player.z);
  moon.target.position.set(player.x,0,player.z);
  sun.intensity=night?.9:3.6;
  moon.intensity=night?.34:.06;
  hemi.intensity=night?.62:1.35;
  scene.fog.color.set(state.weather===3?0x666666:night?0x101010:0x6f6f6f);
  scene.fog.density=state.weather===3?.0045:state.weather===2?.0028:.0017;
  bloom.strength=night?.72:.38;
  if(world.rain){
    world.rain.visible=state.weather>0;
    world.rain.position.set(player.x,0,player.z);
  }
  if(world.rainMaterial)world.rainMaterial.uniforms.uTime.value=performance.now()/1000;
  const wet=state.weather>0 ? .34 : .86;
  if(world.roadSurfaceMaterial) world.roadSurfaceMaterial.roughness=wet;
  asphaltMat.roughness=state.weather>0?.42:.86;
  for(const b of world.buildings){
    if(b.material && 'emissiveIntensity' in b.material)b.material.emissiveIntensity=night?1.3:.08;
  }
  for(const s of world.streetLights){
    s.light.intensity=night?(state.weather===2?10:7):.35;
    s.head.material.emissiveIntensity=night?2.4:.25;
  }
  for(const p of world.puddles)p.material.opacity=state.weather>0?.5:.16;
  if(player.car) enablePlayerHeadlights(player.car,night||state.weather>0);
}
function createRain(){
  const count=4500,pos=new Float32Array(count*3);
  for(let i=0;i<count;i++){pos[i*3]=(Math.random()-.5)*1500;pos[i*3+1]=Math.random()*520;pos[i*3+2]=(Math.random()-.5)*1500;}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
  const mat=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{uTime:{value:0}},
    vertexShader:'uniform float uTime; varying float vA; void main(){vec3 p=position; p.y=mod(p.y-uTime*320.0,520.0); p.x+=sin(p.z*.01+uTime)*3.0; vec4 mv=modelViewMatrix*vec4(p,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=2.2; vA=.25+.75*clamp(p.y/520.0,0.0,1.0);}',
    fragmentShader:'varying float vA; void main(){vec2 uv=gl_PointCoord.xy-.5; if(length(uv)>.5)discard; gl_FragColor=vec4(.78,.78,.78,.26*vA);}'
  });
  world.rainMaterial=mat;world.rain=new THREE.Points(geo,mat);world.rain.frustumCulled=false;scene.add(world.rain);
}
function updateCamera(dt){
  const fx=player.x+(player.car?Math.sin(player.yaw)*42:0),fz=player.z+(player.car?Math.cos(player.yaw)*42:0);
  camera.position.lerp(new THREE.Vector3(fx+250,430,fz+300),1-Math.pow(.0006,dt));
  camera.lookAt(fx,0,fz);
}
function save(){
  localStorage.setItem('ytg2-3d-save',JSON.stringify({money:state.money,score:state.score,mission:state.mission,time:state.time}));
}
function load(){
  try{
    const s=JSON.parse(localStorage.getItem('ytg2-3d-save')||'null');if(!s)return;
    state.money=Number(s.money)||1250;state.score=Number(s.score)||0;
    state.mission=Number.isFinite(s.mission)?s.mission:0;state.time=Number.isFinite(s.time)?s.time:18;
  }catch(_){}
}
function die(){
  state.dead=true;state.paused=false;$('busted').classList.remove('hidden');
  $('bustedText').textContent='Score '+Math.floor(state.score)+' • cash $'+Math.floor(state.money);save();
}
function drawMinimap(){
  const c=$('mapCanvas'),x=c.getContext('2d');x.clearRect(0,0,180,180);x.fillStyle='#0d151b';x.fillRect(0,0,180,180);
  const s=180/world.size;x.fillStyle='#303941';
  for(let i=-1100;i<=1100;i+=320){x.fillRect((i+1100)*s,0,7,180);x.fillRect(0,(i+1100)*s,180,7);}
  x.fillStyle='#131a20';
  for(const b of world.colliders)x.fillRect((b.minX+1100)*s,(b.minZ+1100)*s,(b.maxX-b.minX)*s,(b.maxZ-b.minZ)*s);
  x.fillStyle='#ff5a67';for(const c0 of world.cars)if(c0.police)x.fillRect((c0.x+1100)*s-1,(c0.z+1100)*s-1,3,3);
  x.fillStyle='#d7ff48';x.beginPath();x.arc((player.x+1100)*s,(player.z+1100)*s,3.5,0,Math.PI*2);x.fill();
}
function updateHUD(){
  $('health').style.width=Math.max(0,state.health)+'%';$('stamina').style.width=Math.max(0,state.stamina)+'%';
  $('money').textContent='$'+Math.floor(state.money).toLocaleString('en-US');
  const starCount=Math.ceil(state.wanted);$('stars').textContent='★'.repeat(starCount)+'☆'.repeat(5-starCount);
  $('weather').textContent=state.weatherNames[state.weather];$('weatherIcon').textContent=['◌','╱╱','ϟ','≈'][state.weather];
  const h=Math.floor(state.time),m=Math.floor((state.time-h)*60);$('time').textContent=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
}
function cycleWeather(){state.weather=(state.weather+1)%4;state.heat+=1;}
function tick(dt){
  if(!state.started||state.paused||state.dead)return;
  for(const j of jobsMeshSafe()) j.rotation.y+=dt*.8;
  updatePlayer(dt);updateTraffic(dt);updateNPCs(dt);updateWeather(dt);updateWanted(dt);progressMission();updateMission();updateCamera(dt);drawMinimap();
  state.autosave-=dt;if(state.autosave<0){state.autosave=9;save();}
  if(state.health<=0&&!state.dead)die();
  for(let i=world.particles.length-1;i>=0;i--){const p=world.particles[i];p.life-=dt;if(p.life<=0){p.mesh.removeFromParent();world.particles.splice(i,1);}}
}
function render(){composer.render();updateHUD();}
function loop(now){
  const last=loop.last||now;loop.last=now;tick(Math.min(.033,(now-last)/1000));render();requestAnimationFrame(loop);
}
function start(){
  state.started=true;state.dead=false;state.paused=false;load();$('boot').classList.add('hidden');$('pause').classList.add('hidden');$('busted').classList.add('hidden');requestAnimationFrame(loop);
}
function pause(){if(!state.started||state.dead)return;state.paused=!state.paused;$('pause').classList.toggle('hidden',!state.paused);}
$('start').addEventListener('click',start);
$('resume').addEventListener('click',pause);
$('save').addEventListener('click',save);
$('respawn').addEventListener('click',()=>{state.dead=false;state.health=100;state.wanted=0;state.heat=0;state.paused=false;if(player.car) enablePlayerHeadlights(player.car,false);
  player.x=-480;player.z=-420;player.car=null;playerMesh.visible=true;$('busted').classList.add('hidden');});
window.addEventListener('keydown',e=>{keys[e.key.toLowerCase()]=true;if([' ','arrowup','arrowdown','arrowleft','arrowright'].includes(e.key.toLowerCase()))e.preventDefault();if(e.key.toLowerCase()==='e')enterCar();if(e.key.toLowerCase()==='r')cycleWeather();if(e.key==='Escape')pause();});
window.addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);
window.addEventListener('pointermove',e=>{
  mouse.x=(e.clientX/innerWidth)*2-1;
  mouse.y=-(e.clientY/innerHeight)*2+1;
  mouse.active=true;
});
window.addEventListener('pointerdown',e=>{
  mouse.down=true;
  mouse.x=(e.clientX/innerWidth)*2-1;
  mouse.y=-(e.clientY/innerHeight)*2+1;
  mouse.active=true;
});
window.addEventListener('pointerup',()=>mouse.down=false);
window.addEventListener('blur',()=>{mouse.down=false;Object.keys(keys).forEach(k=>keys[k]=false);if(state.started&&!state.paused)pause();});
window.addEventListener('resize',()=>{const w=innerWidth,h=innerHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h);renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));composer.setSize(w,h);bloom.setSize(w,h);});

createRain();load();updateHUD();render();
