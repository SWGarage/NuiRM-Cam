import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const video = document.querySelector('#cameraVideo');
const stage = document.querySelector('#stage');
const canvas = document.querySelector('#vrmCanvas');
const glowCanvas = document.querySelector('#glowCanvas');
const statusEl = document.querySelector('#status');
const cameraButton = document.querySelector('#cameraButton');
const vrmFile = document.querySelector('#vrmFile');
const captureButton = document.querySelector('#captureButton');
const resetButton = document.querySelector('#resetButton');
const captureCanvas = document.querySelector('#captureCanvas');
const expressionList = document.querySelector('#expressionList');
const mirrorButton = document.querySelector('#mirrorPose');
const keyLightColorInput = document.querySelector('#keyLightColor');
const keyLightIntensityInput = document.querySelector('#keyLightIntensity');
const keyLightIntensityOut = document.querySelector('#keyLightIntensityOut');
const ambientLightColorInput = document.querySelector('#ambientLightColor');
const ambientLightIntensityInput = document.querySelector('#ambientLightIntensity');
const ambientLightIntensityOut = document.querySelector('#ambientLightIntensityOut');
const glowStrengthInput = document.querySelector('#glowStrength');
const glowStrengthOut = document.querySelector('#glowStrengthOut');
const lightDirectionPad = document.querySelector('#lightDirectionPad');
const lightDirectionDot = document.querySelector('#lightDirectionDot');
const lightDirectionOut = document.querySelector('#lightDirectionOut');

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

// Glow専用レンダラー。カメラvideoとは完全に独立した透明Canvasへ描画する。
const glowRenderer = new THREE.WebGLRenderer({
  canvas: glowCanvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true,
});
glowRenderer.setClearColor(0x000000, 0);
glowRenderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(0, 1.0, 5.0);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.3);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(1, 1.5, 2);
scene.add(keyLight);
scene.add(keyLight.target);


const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

const clock = new THREE.Clock();

let stream = null;
let currentVrm = null;
let objectUrl = null;
let currentPose = 'neutral';
let poseMirrored = false;
let drag = null;
const activePointers = new Map();
let pinch = null;

const transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotX: 0,
  rotY: 180,
  rotZ: 0,
};

const lighting = {
  keyColor: '#ffffff',
  keyIntensity: 2.5,
  ambientColor: '#ffffff',
  ambientIntensity: 1.3,
  glowStrength: 0.1,
  // カメラ基準。yaw=左右、pitch=上下。
  yaw: THREE.MathUtils.degToRad(17),
  pitch: THREE.MathUtils.degToRad(17),
};

const cameraRightAxis = new THREE.Vector3();
const cameraUpAxis = new THREE.Vector3();
const cameraForwardAxis = new THREE.Vector3();
const qX = new THREE.Quaternion();
const qY = new THREE.Quaternion();
const qZ = new THREE.Quaternion();

function setStatus(text) {
  statusEl.textContent = text;
}

function resizeRenderer() {
  const rect = stage.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(rect.width, rect.height, false);
  glowRenderer.setPixelRatio(pixelRatio);
  glowRenderer.setSize(rect.width, rect.height, false);

  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function applyTransform() {
  if (!currentVrm) return;

  const baseScale = currentVrm.scene.userData.baseScale ?? 1;
  const baseOffsetY = currentVrm.scene.userData.baseOffsetY ?? 0;

  currentVrm.scene.position.set(transform.x, transform.y + baseOffsetY, 0);
  currentVrm.scene.scale.setScalar(baseScale * transform.scale);

  // 回転軸はアバター自身ではなくカメラ（画面）基準で固定する。
  // Y: 画面の上方向、X: 画面の右方向、Z: カメラ正面方向。
  cameraRightAxis.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  cameraUpAxis.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  cameraForwardAxis.set(0, 0, 1).applyQuaternion(camera.quaternion).normalize();

  qY.setFromAxisAngle(cameraUpAxis, THREE.MathUtils.degToRad(transform.rotY));
  qX.setFromAxisAngle(cameraRightAxis, THREE.MathUtils.degToRad(transform.rotX));
  qZ.setFromAxisAngle(cameraForwardAxis, THREE.MathUtils.degToRad(transform.rotZ));

  // yaw(Y) → pitch(X) → roll(Z)。各軸そのものはカメラ基準で固定。
  currentVrm.scene.quaternion.copy(qZ).multiply(qX).multiply(qY);
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
  transform.rotY = 180;
  transform.rotZ = 0;
  syncTransformUi();
  applyTransform();
}


function updateLightDirection() {
  const cp = Math.cos(lighting.pitch);
  const direction = new THREE.Vector3(
    Math.sin(lighting.yaw) * cp,
    Math.sin(lighting.pitch),
    Math.cos(lighting.yaw) * cp
  ).normalize();

  keyLight.position.copy(direction.multiplyScalar(5));
  keyLight.target.position.set(0, 0, 0);
  keyLight.target.updateMatrixWorld();

  const yawDeg = Math.round(THREE.MathUtils.radToDeg(lighting.yaw));
  const pitchDeg = Math.round(THREE.MathUtils.radToDeg(lighting.pitch));
  lightDirectionOut.value = `X ${pitchDeg}° / Y ${yawDeg}°`;

  const x = THREE.MathUtils.clamp((yawDeg / 180) * 50 + 50, 0, 100);
  const y = THREE.MathUtils.clamp(50 - (pitchDeg / 90) * 50, 0, 100);
  lightDirectionDot.style.left = `${x}%`;
  lightDirectionDot.style.top = `${y}%`;
}

function applyLighting() {
  keyLight.color.set(lighting.keyColor);
  keyLight.intensity = lighting.keyIntensity;
  ambientLight.color.set(lighting.ambientColor);
  ambientLight.intensity = lighting.ambientIntensity;
  // Glow Canvasの透明度・明るさだけを変更。背景videoには一切影響しない。
  const opacity = THREE.MathUtils.clamp(lighting.glowStrength, 0, 1);
  const brightness = 1 + Math.max(0, lighting.glowStrength - 0.5) * 1.2;
  glowCanvas.style.opacity = String(opacity);
  glowCanvas.style.filter = `blur(10px) brightness(${brightness})`;
  updateLightDirection();
}

function syncLightingUi() {
  keyLightColorInput.value = lighting.keyColor;
  keyLightIntensityInput.value = String(lighting.keyIntensity);
  keyLightIntensityOut.value = lighting.keyIntensity.toFixed(2);
  ambientLightColorInput.value = lighting.ambientColor;
  ambientLightIntensityInput.value = String(lighting.ambientIntensity);
  ambientLightIntensityOut.value = lighting.ambientIntensity.toFixed(2);
  glowStrengthInput.value = String(lighting.glowStrength);
  glowStrengthOut.value = lighting.glowStrength.toFixed(2);
  updateLightDirection();
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

  // 通常VRMとGlow用VRMを別Canvasへ描画する。
  // どちらも透明背景なので、その下のカメラvideoを覆わない。
  glowRenderer.render(scene, camera);
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


keyLightColorInput.addEventListener('input', () => {
  lighting.keyColor = keyLightColorInput.value;
  applyLighting();
});

keyLightIntensityInput.addEventListener('input', () => {
  lighting.keyIntensity = Number(keyLightIntensityInput.value);
  keyLightIntensityOut.value = lighting.keyIntensity.toFixed(2);
  applyLighting();
});

ambientLightColorInput.addEventListener('input', () => {
  lighting.ambientColor = ambientLightColorInput.value;
  applyLighting();
});

ambientLightIntensityInput.addEventListener('input', () => {
  lighting.ambientIntensity = Number(ambientLightIntensityInput.value);
  ambientLightIntensityOut.value = lighting.ambientIntensity.toFixed(2);
  applyLighting();
});

glowStrengthInput.addEventListener('input', () => {
  lighting.glowStrength = Number(glowStrengthInput.value);
  glowStrengthOut.value = lighting.glowStrength.toFixed(2);
  applyLighting();
});

function setLightDirectionFromPointer(event) {
  const rect = lightDirectionPad.getBoundingClientRect();
  const nx = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const ny = THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1);

  lighting.yaw = THREE.MathUtils.degToRad((nx * 2 - 1) * 180);
  lighting.pitch = THREE.MathUtils.degToRad((1 - ny * 2) * 90);
  updateLightDirection();
}

lightDirectionPad.addEventListener('pointerdown', (event) => {
  lightDirectionPad.setPointerCapture(event.pointerId);
  setLightDirectionFromPointer(event);
});

lightDirectionPad.addEventListener('pointermove', (event) => {
  if (lightDirectionPad.hasPointerCapture(event.pointerId)) {
    setLightDirectionFromPointer(event);
  }
});

function getPointerDistance() {
  const points = [...activePointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

stage.addEventListener('pointerdown', (event) => {
  if (!currentVrm) return;
  if (event.target.closest('.top-actions')) return;

  stage.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 1) {
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
    };
    pinch = null;
  } else if (activePointers.size === 2) {
    drag = null;
    pinch = {
      startDistance: getPointerDistance(),
      startScale: transform.scale,
    };
  }
});

stage.addEventListener('pointermove', (event) => {
  if (!currentVrm || !activePointers.has(event.pointerId)) return;

  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size >= 2 && pinch) {
    const distance = getPointerDistance();
    if (pinch.startDistance > 0) {
      const ratio = distance / pinch.startDistance;
      transform.scale = THREE.MathUtils.clamp(pinch.startScale * ratio, 0.2, 5);
      inputs.scale.value = String(transform.scale);
      outputs.scale.value = transform.scale.toFixed(2);
      applyTransform();
    }
    return;
  }

  if (!drag || event.pointerId !== drag.id) return;

  const rect = stage.getBoundingClientRect();
  const dx = (event.clientX - drag.startX) / rect.width;
  const dy = (event.clientY - drag.startY) / rect.height;

  transform.x = drag.originX + dx * 3.2;
  transform.y = drag.originY - dy * 4.2;
  applyTransform();
});

function endPointer(event) {
  activePointers.delete(event.pointerId);

  if (activePointers.size < 2) {
    pinch = null;
  }

  if (activePointers.size === 1) {
    const [id, point] = activePointers.entries().next().value;
    drag = {
      id,
      startX: point.x,
      startY: point.y,
      originX: transform.x,
      originY: transform.y,
    };
  } else {
    drag = null;
  }
}

stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);

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

  // 保存画像はプレビュー(stage)と同じアスペクト比に固定する。
  // 長辺の解像度は元カメラを超えない範囲で決める。
  const stageRatio = stage.clientWidth / stage.clientHeight;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  const videoRatio = videoW / videoH;

  let sx = 0, sy = 0, sw = videoW, sh = videoH;

  if (videoRatio > stageRatio) {
    sw = videoH * stageRatio;
    sx = (videoW - sw) / 2;
  } else {
    sh = videoW / stageRatio;
    sy = (videoH - sh) / 2;
  }

  const maxOutputLongSide = 2048;
  let outW, outH;

  if (stageRatio >= 1) {
    outW = Math.min(Math.round(sw), maxOutputLongSide);
    outH = Math.round(outW / stageRatio);
  } else {
    outH = Math.min(Math.round(sh), maxOutputLongSide);
    outW = Math.round(outH * stageRatio);
  }

  captureCanvas.width = outW;
  captureCanvas.height = outH;

  const ctx = captureCanvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);

  // Glowは撮影Canvas側でもVRMだけをぼかして加算合成する。
  if (lighting.glowStrength > 0) {
    glowRenderer.render(scene, camera);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = THREE.MathUtils.clamp(lighting.glowStrength, 0, 1);
    ctx.filter = `blur(${Math.round(10 * (outW / Math.max(stage.clientWidth, 1)))}px)`;
    ctx.drawImage(glowRenderer.domElement, 0, 0, outW, outH);
    ctx.restore();
  }

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, outW, outH);

  const blob = await new Promise((resolve) =>
    captureCanvas.toBlob(resolve, 'image/jpeg', 0.92)
  );

  if (!blob) {
    setStatus('画像生成に失敗しました。');
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  const now = new Date();
  const pad2 = (value) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

  a.href = url;
  a.download = `NuiRM-${stamp}.jpg`;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`写真を書き出しました（${outW}×${outH}）`);
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(stage);
resizeRenderer();
syncTransformUi();
syncLightingUi();
applyLighting();
