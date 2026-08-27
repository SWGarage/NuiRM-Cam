import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const video = document.querySelector('#cameraVideo');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#vrmCanvas');
const statusEl = document.querySelector('#status');
const cameraButton = document.querySelector('#cameraButton');
const vrmFile = document.querySelector('#vrmFile');
const captureButton = document.querySelector('#captureButton');
const resetButton = document.querySelector('#resetButton');
const captureCanvas = document.querySelector('#captureCanvas');
const expressionList = document.querySelector('#expressionList');
const mirrorButton = document.querySelector('#mirrorPose');

const inputs = {
  scale: document.querySelector('#scale'),
  rotX: document.querySelector('#rotX'),
  rotY: document.querySelector('#rotY'),
  rotZ: document.querySelector('#rotZ'),
};

const outputs = {
  scale: document.querySelector('#scaleOut'),
  rotX: document.querySelector('#rotXOut'),
  rotY: document.querySelector('#rotYOut'),
  rotZ: document.querySelector('#rotZOut'),
};

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 1.0, 5.0);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(1, 1.5, 2);
scene.add(keyLight);

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const clock = new THREE.Clock();

let stream = null;
let currentVrm = null;
let objectUrl = null;
let currentPose = 'neutral';
let poseMirrored = false;
let drag = null;

const transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function resizeRenderer() {
  const rect = stage.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(rect.width, rect.height, false);

  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function applyTransform() {
  if (!currentVrm) return;

  const baseScale = currentVrm.scene.userData.baseScale ?? 1;
  const baseOffsetY = currentVrm.scene.userData.baseOffsetY ?? 0;

  currentVrm.scene.position.set(transform.x, transform.y + baseOffsetY, 0);
  currentVrm.scene.scale.setScalar(baseScale * transform.scale);
  currentVrm.scene.rotation.set(
    THREE.MathUtils.degToRad(transform.rotX),
    THREE.MathUtils.degToRad(transform.rotY),
    THREE.MathUtils.degToRad(transform.rotZ)
  );
}

function syncTransformUi() {
  inputs.scale.value = String(transform.scale);
  inputs.rotX.value = String(transform.rotX);
  inputs.rotY.value = String(transform.rotY);
  inputs.rotZ.value = String(transform.rotZ);

  outputs.scale.value = transform.scale.toFixed(2);
  outputs.rotX.value = `${Math.round(transform.rotX)}°`;
  outputs.rotY.value = `${Math.round(transform.rotY)}°`;
  outputs.rotZ.value = `${Math.round(transform.rotZ)}°`;
}

function resetTransform() {
  transform.x = 0;
  transform.y = 0;
  transform.scale = 1;
  transform.rotX = 0;
  transform.rotY = 0;
  transform.rotZ = 0;
  syncTransformUi();
  applyTransform();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus('このブラウザではカメラAPIを利用できません。');
    return;
  }

  try {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    cameraButton.textContent = 'カメラ再開';
    setStatus(currentVrm ? '撮影できます' : 'VRMを読み込んでください');
  } catch (error) {
    console.error(error);
    setStatus('カメラを開始できませんでした。HTTPSと権限を確認してください。');
  }
}

async function loadVrm(file) {
  if (!file) return;

  setStatus('VRMを読み込み中…');

  try {
    if (currentVrm) {
      scene.remove(currentVrm.scene);
      VRMUtils.deepDispose(currentVrm.scene);
      currentVrm = null;
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    const gltf = await loader.loadAsync(objectUrl);
    const vrm = gltf.userData.vrm;

    if (!vrm) throw new Error('VRM data not found');

    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);

    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    scene.add(vrm.scene);
    currentVrm = vrm;

    normalizeInitialVrm(vrm);
    buildExpressionButtons(vrm);
    currentPose = 'neutral';
    poseMirrored = false;
    applyPose();
    resetTransform();

    setStatus('VRM読込完了');
  } catch (error) {
    console.error(error);
    setStatus('VRMの読み込みに失敗しました。');
  }
}

function normalizeInitialVrm(vrm) {
  const box = new THREE.Box3().setFromObject(vrm.scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  const height = Math.max(size.y, 0.001);
  const desiredHeight = 2.5;
  const baseScale = desiredHeight / height;

  // モデル固有の基準スケール・縦オフセット。
  // ユーザーが操作するScale/X/Yとは分離して保持する。
  vrm.scene.userData.baseScale = baseScale;
  vrm.scene.userData.baseOffsetY = -center.y * baseScale;
}

function getBone(name) {
  return currentVrm?.humanoid?.getNormalizedBoneNode(name) ?? null;
}

function resetPoseBones() {
  if (!currentVrm?.humanoid) return;

  const boneNames = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
  ];

  for (const name of boneNames) {
    const bone = getBone(name);
    if (bone) bone.rotation.set(0, 0, 0);
  }
}

function setBoneRotation(name, x = 0, y = 0, z = 0) {
  const bone = getBone(name);
  if (!bone) return;
  bone.rotation.set(x, y, z);
}

function applyPose() {
  if (!currentVrm) return;

  resetPoseBones();

  if (currentPose === 'wave') {
    const side = poseMirrored ? 'right' : 'left';
    const upperArm = `${side}UpperArm`;
    const lowerArm = `${side}LowerArm`;
    const sign = poseMirrored ? -1 : 1;

    setBoneRotation(upperArm, 0.05, 0.0, sign * 1.0);
    setBoneRotation(lowerArm, 0.0, sign * 0.15, sign * 1.1);
  }
}

function buildExpressionButtons(vrm) {
  expressionList.innerHTML = '';

  const manager = vrm.expressionManager;
  if (!manager) {
    expressionList.innerHTML = '<span class="muted">このVRMにはExpression Managerがありません。</span>';
    return;
  }

  const names = Object.keys(manager.expressionMap ?? {}).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.className = 'button expression-button active';
  clearButton.textContent = 'なし';
  clearButton.addEventListener('click', () => {
    manager.resetValues();
    manager.update();
    markActiveExpression(clearButton);
  });
  expressionList.appendChild(clearButton);

  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button expression-button';
    button.textContent = name;

    button.addEventListener('click', () => {
      manager.resetValues();
      manager.setValue(name, 1.0);
      manager.update();
      markActiveExpression(button);
    });

    expressionList.appendChild(button);
  }

  if (names.length === 0) {
    const text = document.createElement('span');
    text.className = 'muted';
    text.textContent = '定義済み表情はありません。';
    expressionList.appendChild(text);
  }
}

function markActiveExpression(button) {
  expressionList.querySelectorAll('.expression-button').forEach((el) => {
    el.classList.toggle('active', el === button);
  });
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (currentVrm) currentVrm.update(delta);
  renderer.render(scene, camera);
}
animate();

for (const [key, input] of Object.entries(inputs)) {
  input.addEventListener('input', () => {
    const value = Number(input.value);

    if (key === 'scale') {
      transform.scale = value;
      outputs.scale.value = value.toFixed(2);
    } else if (key === 'rotX') {
      transform.rotX = value;
      outputs.rotX.value = `${Math.round(value)}°`;
    } else if (key === 'rotY') {
      transform.rotY = value;
      outputs.rotY.value = `${Math.round(value)}°`;
    } else if (key === 'rotZ') {
      transform.rotZ = value;
      outputs.rotZ.value = `${Math.round(value)}°`;
    }

    applyTransform();
  });
}

stage.addEventListener('pointerdown', (event) => {
  if (!currentVrm) return;
  if (event.target.closest('.top-actions')) return;

  stage.setPointerCapture(event.pointerId);
  drag = {
    id: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    originX: transform.x,
    originY: transform.y,
  };
});

stage.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id || !currentVrm) return;

  const rect = stage.getBoundingClientRect();
  const dx = (event.clientX - drag.startX) / rect.width;
  const dy = (event.clientY - drag.startY) / rect.height;

  // Perspective Camera上で扱いやすい感度へ変換
  transform.x = drag.originX + dx * 3.2;
  transform.y = drag.originY - dy * 4.2;
  applyTransform();
});

function endDrag(event) {
  if (drag?.id === event.pointerId) drag = null;
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));

    tab.classList.add('active');
    document.querySelector(`#${tab.dataset.panel}`).classList.add('active');
  });
});

document.querySelectorAll('.pose-button').forEach((button) => {
  button.addEventListener('click', () => {
    currentPose = button.dataset.pose;
    document.querySelectorAll('.pose-button').forEach((b) => {
      b.classList.toggle('active', b === button);
    });
    applyPose();
  });
});

mirrorButton.addEventListener('click', () => {
  poseMirrored = !poseMirrored;
  mirrorButton.classList.toggle('active', poseMirrored);
  applyPose();
});

cameraButton.addEventListener('click', startCamera);
vrmFile.addEventListener('change', () => loadVrm(vrmFile.files?.[0]));

resetButton.addEventListener('click', () => {
  resetTransform();
  currentPose = 'neutral';
  poseMirrored = false;
  mirrorButton.classList.remove('active');

  document.querySelectorAll('.pose-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.pose === 'neutral');
  });

  applyPose();

  if (currentVrm?.expressionManager) {
    currentVrm.expressionManager.resetValues();
    currentVrm.expressionManager.update();
    const first = expressionList.querySelector('.expression-button');
    if (first) markActiveExpression(first);
  }
});

captureButton.addEventListener('click', capturePhoto);

async function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) {
    setStatus('先にカメラを開始してください。');
    return;
  }

  const w = video.videoWidth;
  const h = video.videoHeight;
  captureCanvas.width = w;
  captureCanvas.height = h;

  const ctx = captureCanvas.getContext('2d');
  if (!ctx) return;

  // CSS object-fit: cover と同等になるようにカメラ映像を切り抜く
  const stageRatio = stage.clientWidth / stage.clientHeight;
  const videoRatio = w / h;

  let sx = 0, sy = 0, sw = w, sh = h;

  if (videoRatio > stageRatio) {
    sw = h * stageRatio;
    sx = (w - sw) / 2;
  } else {
    sh = w / stageRatio;
    sy = (h - sh) / 2;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

  // WebGL Canvasをカメラ解像度へ拡大合成
  ctx.drawImage(renderer.domElement, 0, 0, w, h);

  const blob = await new Promise((resolve) =>
    captureCanvas.toBlob(resolve, 'image/jpeg', 0.92)
  );

  if (!blob) {
    setStatus('画像生成に失敗しました。');
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `virtual-nuikatsu-${stamp}.jpg`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus('写真を書き出しました。');
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(stage);
resizeRenderer();
syncTransformUi();
