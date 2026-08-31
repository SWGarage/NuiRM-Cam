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
const poseList = document.querySelector('#poseList');
const lightPresetList = document.querySelector('#lightPresetList');
const mirrorButton = document.querySelector('#mirrorPose');
const keyLightColorInput = document.querySelector('#keyLightColor');
const keyLightIntensityInput = document.querySelector('#keyLightIntensity');
const keyLightIntensityOut = document.querySelector('#keyLightIntensityOut');
const ambientLightColorInput = document.querySelector('#ambientLightColor');
const ambientLightIntensityInput = document.querySelector('#ambientLightIntensity');
const ambientLightIntensityOut = document.querySelector('#ambientLightIntensityOut');
const lightDirectionPad = document.querySelector('#lightDirectionPad');
const lightDirectionDot = document.querySelector('#lightDirectionDot');
const lightDirectionOut = document.querySelector('#lightDirectionOut');
const focalLengthInput = document.querySelector('#focalLength');
const focalLengthOut = document.querySelector('#focalLengthOut');
const focalPresetButtons = [...document.querySelectorAll('.focal-preset')];
const debugOutput = document.querySelector('#debugOutput');
const refreshDebugButton = document.querySelector('#refreshDebug');
const copyDebugButton = document.querySelector('#copyDebug');

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

const cameraSettings = {
  focalLength: 24,
};

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.filmGauge = 35;
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
let currentGltfParser = null;
let objectUrl = null;
let currentPose = 'neutral';
let posePresets = [];
let lightPresets = [];
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

function applyFocalLength() {
  cameraSettings.focalLength = THREE.MathUtils.clamp(
    Number(cameraSettings.focalLength) || 24,
    24,
    70
  );

  camera.setFocalLength(cameraSettings.focalLength);
  camera.updateProjectionMatrix();

  focalLengthInput.value = String(cameraSettings.focalLength);
  focalLengthOut.value = `${Math.round(cameraSettings.focalLength)}mm`;

  focalPresetButtons.forEach((button) => {
    button.classList.toggle(
      'active',
      Number(button.dataset.focal) === cameraSettings.focalLength
    );
  });
}

function resizeRenderer() {
  const rect = stage.getBoundingClientRect();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(rect.width, rect.height, false);

  camera.aspect = rect.width / rect.height;
  applyFocalLength();
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
  updateLightDirection();
}

function syncLightingUi() {
  keyLightColorInput.value = lighting.keyColor;
  keyLightIntensityInput.value = String(lighting.keyIntensity);
  keyLightIntensityOut.value = lighting.keyIntensity.toFixed(2);
  ambientLightColorInput.value = lighting.ambientColor;
  ambientLightIntensityInput.value = String(lighting.ambientIntensity);
  ambientLightIntensityOut.value = lighting.ambientIntensity.toFixed(2);
  updateLightDirection();
}

function buildLightPresetButtons() {
  lightPresetList.innerHTML = '';

  if (!lightPresets.length) {
    lightPresetList.innerHTML = '<span class="muted">lights.json にプリセットがありません。</span>';
    return;
  }

  for (const preset of lightPresets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button light-preset-button';
    button.dataset.lightPreset = preset.id;
    button.textContent = preset.name ?? preset.id;
    button.addEventListener('click', () => {
      lighting.keyColor = preset.keyColor ?? lighting.keyColor;
      lighting.keyIntensity = Number(preset.keyIntensity ?? lighting.keyIntensity);
      lighting.ambientColor = preset.ambientColor ?? lighting.ambientColor;
      lighting.ambientIntensity = Number(preset.ambientIntensity ?? lighting.ambientIntensity);

      syncLightingUi();
      applyLighting();

      lightPresetList.querySelectorAll('.light-preset-button').forEach((b) => {
        b.classList.toggle('active', b === button);
      });
    });
    lightPresetList.appendChild(button);
  }
}

async function loadLightPresets() {
  try {
    const response = await fetch('./lights.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    lightPresets = Array.isArray(data.presets) ? data.presets : [];
    buildLightPresetButtons();

    const daylightButton = lightPresetList.querySelector('[data-light-preset="daylight"]');
    if (daylightButton) daylightButton.classList.add('active');
  } catch (error) {
    console.error('lights.json load failed:', error);
    lightPresetList.innerHTML = '<span class="muted">lights.json を読み込めませんでした。</span>';
  }
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


function formatDebugValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(value.toFixed(5)) : String(value);
  }

  if (typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }

  if (value?.isColor && typeof value.getHexString === 'function') {
    return `#${value.getHexString()}`;
  }

  if (value?.isTexture) {
    return {
      texture: true,
      name: value.name || '',
      colorSpace: value.colorSpace ?? null,
    };
  }

  if (value?.isVector2 || value?.isVector3 || value?.isVector4) {
    const result = {};
    if ('x' in value) result.x = formatDebugValue(value.x);
    if ('y' in value) result.y = formatDebugValue(value.y);
    if ('z' in value) result.z = formatDebugValue(value.z);
    if ('w' in value) result.w = formatDebugValue(value.w);
    return result;
  }

  return String(value);
}

function collectMaterialDebug(material, index, meshes) {
  const candidateKeys = [
    'metalness',
    'roughness',
    'specularIntensity',
    'specularColor',
    'ior',
    'reflectivity',
    'envMapIntensity',
    'clearcoat',
    'clearcoatRoughness',
    'sheen',
    'sheenRoughness',
    'emissive',
    'emissiveIntensity',
    'opacity',
    'transparent',
    'alphaTest',
    'depthWrite',
    'side',
    'shadeColorFactor',
    'shadingShiftFactor',
    'shadingToonyFactor',
    'giEqualizationFactor',
    'matcapFactor',
    'parametricRimColorFactor',
    'parametricRimFresnelPowerFactor',
    'parametricRimLiftFactor',
    'rimLightingMixFactor',
    'outlineWidthFactor',
    'outlineLightingMixFactor',
  ];

  const properties = {};
  for (const key of candidateKeys) {
    if (key in material) {
      properties[key] = formatDebugValue(material[key]);
    }
  }

  return {
    index,
    name: material.name || '(unnamed)',
    type: material.type || material.constructor?.name || '(unknown)',
    constructor: material.constructor?.name || '(unknown)',
    isMToonMaterial: Boolean(material.isMToonMaterial),
    isMeshStandardMaterial: Boolean(material.isMeshStandardMaterial),
    isMeshPhysicalMaterial: Boolean(material.isMeshPhysicalMaterial),
    shaderName: material.userData?.shaderName ?? null,
    meshes,
    properties,
  };
}


function collectRawGltfMaterials(vrm = currentVrm) {
  const parser = vrm?.userData?.gltfExtensions
    ? null
    : null;

  // GLTFLoaderのparserはgltf.userData側に保持されることがあるため、
  // load時にcurrentGltfParserへ保存したものを優先する。
  const json = currentGltfParser?.json;
  const materials = json?.materials ?? [];

  return materials.map((material, index) => {
    const pbr = material.pbrMetallicRoughness ?? {};

    return {
      index,
      name: material.name ?? '(unnamed)',
      alphaMode: material.alphaMode ?? 'OPAQUE',
      doubleSided: Boolean(material.doubleSided),
      pbrMetallicRoughness: {
        baseColorFactor: pbr.baseColorFactor ?? null,
        metallicFactor: pbr.metallicFactor ?? 1,
        roughnessFactor: pbr.roughnessFactor ?? 1,
        baseColorTexture: pbr.baseColorTexture ?? null,
        metallicRoughnessTexture: pbr.metallicRoughnessTexture ?? null,
      },
      extensions: material.extensions ?? null,
    };
  });
}

function buildMaterialDebugReport(vrm = currentVrm) {
  if (!vrm?.scene) {
    return 'VRMを読み込むとマテリアル情報が表示されます。';
  }

  const materialMap = new Map();

  vrm.scene.traverse((object) => {
    if (!object.isMesh && !object.isSkinnedMesh) return;

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];

    for (const material of materials) {
      if (!material) continue;

      if (!materialMap.has(material)) {
        materialMap.set(material, []);
      }

      materialMap.get(material).push(object.name || '(unnamed mesh)');
    }
  });

  const materials = [...materialMap.entries()].map(
    ([material, meshes], index) => collectMaterialDebug(material, index, meshes)
  );

  const metaVersion =
    vrm.meta?.metaVersion ??
    vrm.meta?.version ??
    '(unknown)';

  const report = {
    NuiRMDebug: 1,
    vrm: {
      metaVersion,
      materialCount: materials.length,
    },
    rawGltfMaterials: collectRawGltfMaterials(vrm),
    renderer: {
      outputColorSpace: renderer.outputColorSpace,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
    },
    lighting: {
      directional: {
        intensity: keyLight.intensity,
        color: `#${keyLight.color.getHexString()}`,
      },
      ambient: {
        intensity: ambientLight.intensity,
        color: `#${ambientLight.color.getHexString()}`,
      },
    },
    materials,
    roughnessComparison: materials.map((material, index) => {
      const raw = collectRawGltfMaterials(vrm)[index];
      return {
        index,
        name: material.name,
        rawRoughnessFactor:
          raw?.pbrMetallicRoughness?.roughnessFactor ?? null,
        threeRoughness:
          material.properties?.roughness ?? null,
        matches:
          raw?.pbrMetallicRoughness?.roughnessFactor ===
          material.properties?.roughness,
      };
    }),
  };

  return JSON.stringify(report, null, 2);
}

function refreshMaterialDebug() {
  debugOutput.textContent = buildMaterialDebugReport();
}

async function copyMaterialDebug() {
  const text = debugOutput.textContent || buildMaterialDebugReport();

  try {
    await navigator.clipboard.writeText(text);
    setStatus('DEBUG情報をコピーしました。');
  } catch (error) {
    console.error(error);
    setStatus('コピーできませんでした。DEBUG欄を長押しして選択してください。');
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
      currentGltfParser = null;
      debugOutput.textContent = 'VRMを読み込むとマテリアル情報が表示されます。';
    }

    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);

    const gltf = await loader.loadAsync(objectUrl);
    currentGltfParser = gltf.parser ?? null;
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
    refreshMaterialDebug();

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

const poseBoneNames = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];

function resetPoseBones() {
  if (!currentVrm?.humanoid) return;

  for (const name of poseBoneNames) {
    const bone = getBone(name);
    if (bone) bone.quaternion.identity();
  }
}

function mirroredBoneName(name) {
  if (name.startsWith('left')) return `right${name.slice(4)}`;
  if (name.startsWith('right')) return `left${name.slice(5)}`;
  return name;
}

function mirroredQuaternion(rotation) {
  // 左右反転（YZ平面で鏡映）を回転Quaternionへ変換。
  return {
    x: rotation.x,
    y: -rotation.y,
    z: -rotation.z,
    w: rotation.w,
  };
}

function applyPose() {
  if (!currentVrm) return;

  resetPoseBones();

  const pose = posePresets.find((item) => item.id === currentPose);
  if (!pose) return;

  for (const item of pose.bones ?? []) {
    const sourceRotation = item.rotation;
    if (!sourceRotation) continue;

    const boneName = poseMirrored ? mirroredBoneName(item.bone) : item.bone;
    const rotation = poseMirrored ? mirroredQuaternion(sourceRotation) : sourceRotation;
    const bone = getBone(boneName);
    if (!bone) continue;

    bone.quaternion.set(
      Number(rotation.x) || 0,
      Number(rotation.y) || 0,
      Number(rotation.z) || 0,
      Number(rotation.w) || 1
    ).normalize();
  }
}

function buildPoseButtons() {
  poseList.innerHTML = '';

  if (!posePresets.length) {
    poseList.innerHTML = '<span class="muted">poses.json にポーズがありません。</span>';
    return;
  }

  for (const pose of posePresets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button pose-button';
    button.dataset.pose = pose.id;
    button.textContent = pose.name ?? pose.id;
    button.classList.toggle('active', pose.id === currentPose);
    button.addEventListener('click', () => {
      currentPose = pose.id;
      poseList.querySelectorAll('.pose-button').forEach((b) => {
        b.classList.toggle('active', b === button);
      });
      applyPose();
    });
    poseList.appendChild(button);
  }
}

async function loadPosePresets() {
  try {
    const response = await fetch('./poses.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    posePresets = Array.isArray(data.poses) ? data.poses : [];
    currentPose = posePresets.some((pose) => pose.id === 'neutral')
      ? 'neutral'
      : (posePresets[0]?.id ?? 'neutral');
    buildPoseButtons();
    applyPose();
  } catch (error) {
    console.error('poses.json load failed:', error);
    poseList.innerHTML = '<span class="muted">poses.json を読み込めませんでした。</span>';
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


focalLengthInput.addEventListener('input', () => {
  cameraSettings.focalLength = Number(focalLengthInput.value);
  applyFocalLength();
});

focalPresetButtons.forEach((button) => {
  button.addEventListener('click', () => {
    cameraSettings.focalLength = Number(button.dataset.focal);
    applyFocalLength();
  });
});


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


mirrorButton.addEventListener('click', () => {
  poseMirrored = !poseMirrored;
  mirrorButton.classList.toggle('active', poseMirrored);
  applyPose();
});

cameraButton.addEventListener('click', startCamera);
vrmFile.addEventListener('change', () => loadVrm(vrmFile.files?.[0]));
refreshDebugButton.addEventListener('click', refreshMaterialDebug);
copyDebugButton.addEventListener('click', copyMaterialDebug);

resetButton.addEventListener('click', () => {
  resetTransform();
  cameraSettings.focalLength = 24;
  applyFocalLength();
  currentPose = 'neutral';
  poseMirrored = false;
  mirrorButton.classList.remove('active');

  poseList.querySelectorAll('.pose-button').forEach((button) => {
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

function makeFilename() {
  const now = new Date();
  const pad2 = (value) => String(value).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-` +
    `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;

  return `NuiRM-${stamp}.jpg`;
}

function dataUrlToBlob(dataUrl) {
  const [header, payload] = dataUrl.split(',');
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch?.[1] || 'image/jpeg';
  const bytes = atob(payload);
  const array = new Uint8Array(bytes.length);

  for (let i = 0; i < bytes.length; i += 1) {
    array[i] = bytes.charCodeAt(i);
  }

  return new Blob([array], { type: mime });
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) {
    setStatus('先にカメラを開始してください。');
    return;
  }

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

  renderer.render(scene, camera);
  ctx.drawImage(renderer.domElement, 0, 0, outW, outH);

  // Web Share APIはユーザー操作が必要なため、JPEG生成を同期処理にする。
  const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.92);
  const blob = dataUrlToBlob(dataUrl);
  const filename = makeFilename();

  if (navigator.share && navigator.canShare) {
    const file = new File([blob], filename, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    if (navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] })
        .then(() => {
          setStatus(`写真を共有しました（${outW}×${outH}）`);
        })
        .catch((error) => {
          if (error?.name === 'AbortError') {
            setStatus('保存をキャンセルしました。');
          } else {
            console.error(error);
            setStatus('共有に失敗したため、ファイルとして保存します。');
            downloadBlob(blob, filename);
          }
        });
      return;
    }
  }

  downloadBlob(blob, filename);
  setStatus(`写真を書き出しました（${outW}×${outH}）`);
}

const resizeObserver = new ResizeObserver(resizeRenderer);
resizeObserver.observe(stage);
resizeRenderer();
syncTransformUi();
applyFocalLength();
syncLightingUi();
applyLighting();
loadPosePresets();
loadLightPresets();
