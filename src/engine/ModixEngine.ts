import * as THREE from 'three';
import type {
  ActiveToolId,
  CollectionGroup,
  EditableMeshData,
  MaterialData,
  ModixProjectState,
  ObjectKind,
  PrimitiveType,
  SceneObjectData,
  UVProjectionMode
} from '../types/scene';
import {
  bevelFaces,
  buildThreeGeometries,
  catmullClarkSubdivide,
  cloneMeshData,
  computeFaceCenter,
  computeVertexNormals,
  createPrimitiveMesh,
  deleteFaces,
  displaceMeshNoise,
  evaluateMeshWithModifiers,
  extrudeFaces,
  insetFaces,
  loopCutAxis,
  separateLooseParts,
  sliceMeshByPlane,
  splitMeshInTwo,
  subdivideFlat,
  taperMeshZ
} from './MeshOperations';

// Enforce Blender Z-up convention globally
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

interface RuntimeMeshEntry {
  root: THREE.Group;
  surface: THREE.Mesh;
  wireOverlay: THREE.LineSegments;
  silhouette: THREE.Mesh;
  triangleToFaceIndex: number[];
  evaluatedMesh: EditableMeshData;
}

interface LiveTextureEntry {
  sourceUrl: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

export class ModixEngine {
  public state: ModixProjectState;
  private onChangeCallbacks: Array<(state: ModixProjectState) => void> = [];

  private container: HTMLElement | null = null;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private perspCamera!: THREE.PerspectiveCamera;
  private orthoCamera!: THREE.OrthographicCamera;

  // Orbit state in Z-up spherical coordinates around target
  private orbitTarget = new THREE.Vector3(0, 0, 0);
  private orbitRadius = 11.0;
  private orbitAzimuth = -0.742; // ~ -42.5 deg -> camera at (+7.2, -6.6, +5.1)
  private orbitElevation = 0.485; // ~ 27.8 deg above ground

  // Overlays & helpers
  private overlaysGroup = new THREE.Group();
  private objectsGroup = new THREE.Group();
  private editHelpersGroup = new THREE.Group();
  private gizmoGroup = new THREE.Group();
  private annotationsGroup = new THREE.Group();
  private cursorSprite!: THREE.Sprite;

  // Lighting
  private studioAmbient!: THREE.AmbientLight;
  private studioKeyLight!: THREE.DirectionalLight;
  private studioFillLight!: THREE.DirectionalLight;
  private studioRimLight!: THREE.DirectionalLight;
  private sceneLightsGroup = new THREE.Group();

  // Runtime object & live texture maps
  private meshMap = new Map<string, RuntimeMeshEntry>();
  private helperMap = new Map<string, THREE.Object3D>();
  private textureCanvases = new Map<string, LiveTextureEntry>();

  // Internal clipboard for Copy / Cut / Paste
  private clipboard: SceneObjectData[] = [];

  // Undo / Redo stacks
  private undoStack: string[] = [];
  private redoStack: string[] = [];

  // Pointer / Touch interaction state
  private activePointers = new Map<number, { x: number; y: number }>();
  private pointerDownPos = { x: 0, y: 0 };
  private pointerMoved = false;
  private draggingGizmoAxis: 'X' | 'Y' | 'Z' | 'XYZ' | null = null;
  private gizmoStartPoint = new THREE.Vector3();
  private gizmoStartLoc: [number, number, number] = [0, 0, 0];
  private gizmoStartRot: [number, number, number] = [0, 0, 0];
  private gizmoStartScale: [number, number, number] = [1, 1, 1];
  private gizmoStartVerts: [number, number, number][] = [];
  private lastPinchDist = 0;
  private lastTwoMid = { x: 0, y: 0 };
  private isSculptingStroke = false;
  private lastPaintUV: { objId: string; u: number; v: number } | null = null;
  private paintedCanvasObjId: string | null = null;
  private grabBrushIndices: Array<{ idx: number; weight: number; start: [number, number, number] }> = [];
  private activeAnnotation: [number, number, number][] | null = null;
  private activeMeasureIndex: number | null = null;

  // Playback loop
  private rafId = 0;
  private lastFrameTime = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.state = this.createStartupState();
  }

  public createStartupState(): ModixProjectState {
    const cubeObj: SceneObjectData = {
      id: 'obj_cube',
      name: 'Cube',
      kind: 'MESH',
      collection: 'Collection',
      visible: true,
      selectable: true,
      location: [0, 0, 0],
      rotationDeg: [0, 0, 0],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      primitive: 'cube',
      mesh: createPrimitiveMesh('cube'),
      modifiers: [],
      material: {
        name: 'Material',
        baseColor: '#9a9a9a',
        metallic: 0.05,
        roughness: 0.55,
        emissionColor: '#000000',
        emissionStrength: 0,
        opacity: 1,
        wireframe: false,
        uvProjection: 'box',
        repeatX: 1,
        repeatY: 1
      },
      keyframes: []
    };

    const cameraObj: SceneObjectData = {
      id: 'obj_camera',
      name: 'Camera',
      kind: 'CAMERA',
      collection: 'Collection',
      visible: true,
      selectable: true,
      location: [-2.85, -3.35, 0.55],
      rotationDeg: [78, 0, -40],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      modifiers: [],
      material: {
        name: 'CameraMat',
        baseColor: '#111111',
        metallic: 0,
        roughness: 1,
        emissionColor: '#000000',
        emissionStrength: 0,
        opacity: 1,
        wireframe: false
      },
      cameraFov: 50,
      cameraClipStart: 0.1,
      cameraClipEnd: 100,
      keyframes: []
    };

    const lightObj: SceneObjectData = {
      id: 'obj_light',
      name: 'Light',
      kind: 'LIGHT',
      collection: 'Collection',
      visible: true,
      selectable: true,
      location: [-0.85, 2.25, 2.95],
      rotationDeg: [0, 0, 0],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      modifiers: [],
      material: {
        name: 'LightMat',
        baseColor: '#ffffff',
        metallic: 0,
        roughness: 1,
        emissionColor: '#ffffff',
        emissionStrength: 1,
        opacity: 1,
        wireframe: false
      },
      lightKind: 'POINT',
      lightColor: '#ffffff',
      lightPower: 1000,
      keyframes: []
    };

    return {
      version: '2.0.0',
      sceneName: 'Scene',
      viewLayerName: 'ViewLayer',
      workspace: 'Layout',
      mode: 'OBJECT',
      editSelectMode: 'FACE',
      activeTool: 'select_box',
      shading: 'SOLID',
      showOverlays: true,
      xray: false,
      snapEnabled: false,
      proportionalEnabled: false,
      orientation: 'Global',
      pivotPoint: 'Median Point',
      isOrthographic: false,
      inCameraView: false,
      viewLabel: 'User Perspective',
      cursor3D: [0, 0, 0],
      collections: [
        {
          id: 'col_default',
          name: 'Collection',
          visible: true,
          collapsed: false
        }
      ],
      activeCollection: 'Collection',
      objects: [cameraObj, cubeObj, lightObj],
      selectedIds: ['obj_cube'],
      activeObjectId: 'obj_cube',
      selectedVertices: [],
      selectedFaces: [1],
      currentFrame: 1,
      startFrame: 1,
      endFrame: 250,
      fps: 24,
      isPlaying: false,
      playReverse: false,
      autoKeying: false,
      activePropertiesTab: 'object',
      outlinerSearch: '',
      propertiesSearch: '',
      deltaTransformExpanded: false,
      sculpt: {
        radius: 0.55,
        strength: 0.45,
        symmetryX: true,
        symmetryY: false,
        symmetryZ: false,
        paintColor: '#3b82f6',
        paintSecondaryColor: '#ffffff',
        paintBrushPx: 18,
        paintOpacity: 1,
        paintTarget: 'texture'
      },
      world: {
        backgroundColor: '#202020',
        ambientStrength: 0.65
      },
      compositor: {
        useNodes: true,
        monochromeBW: false,
        contrast: 1.0,
        exposure: 1.0,
        vignette: 0.0,
        bloom: 0.0
      },
      annotations: [],
      measures: []
    };
  }

  public subscribe(cb: (state: ModixProjectState) => void): () => void {
    this.onChangeCallbacks.push(cb);
    return () => {
      this.onChangeCallbacks = this.onChangeCallbacks.filter((x) => x !== cb);
    };
  }

  public notify(): void {
    for (const cb of this.onChangeCallbacks) {
      cb(this.state);
    }
  }

  public pushUndoSnapshot(): void {
    const snap = JSON.stringify({
      collections: this.state.collections,
      activeCollection: this.state.activeCollection,
      objects: this.state.objects,
      selectedIds: this.state.selectedIds,
      activeObjectId: this.state.activeObjectId,
      cursor3D: this.state.cursor3D,
      annotations: this.state.annotations,
      measures: this.state.measures
    });
    if (this.undoStack[this.undoStack.length - 1] !== snap) {
      this.undoStack.push(snap);
      if (this.undoStack.length > 30) this.undoStack.shift();
      this.redoStack = [];
    }
  }

  public undo(): boolean {
    if (this.undoStack.length === 0) return false;
    const current = JSON.stringify({
      collections: this.state.collections,
      activeCollection: this.state.activeCollection,
      objects: this.state.objects,
      selectedIds: this.state.selectedIds,
      activeObjectId: this.state.activeObjectId,
      cursor3D: this.state.cursor3D,
      annotations: this.state.annotations,
      measures: this.state.measures
    });
    this.redoStack.push(current);
    const prev = JSON.parse(this.undoStack.pop()!);
    this.state.collections = prev.collections || [{ id: 'col_default', name: 'Collection', visible: true, collapsed: false }];
    this.state.activeCollection = prev.activeCollection || 'Collection';
    this.state.objects = prev.objects;
    this.state.selectedIds = prev.selectedIds;
    this.state.activeObjectId = prev.activeObjectId;
    this.state.cursor3D = prev.cursor3D;
    this.state.annotations = prev.annotations || [];
    this.state.measures = prev.measures || [];
    this.rebuildSceneObjects();
    this.notify();
    return true;
  }

  public redo(): boolean {
    if (this.redoStack.length === 0) return false;
    const current = JSON.stringify({
      collections: this.state.collections,
      activeCollection: this.state.activeCollection,
      objects: this.state.objects,
      selectedIds: this.state.selectedIds,
      activeObjectId: this.state.activeObjectId,
      cursor3D: this.state.cursor3D,
      annotations: this.state.annotations,
      measures: this.state.measures
    });
    this.undoStack.push(current);
    const next = JSON.parse(this.redoStack.pop()!);
    this.state.collections = next.collections || [{ id: 'col_default', name: 'Collection', visible: true, collapsed: false }];
    this.state.activeCollection = next.activeCollection || 'Collection';
    this.state.objects = next.objects;
    this.state.selectedIds = next.selectedIds;
    this.state.activeObjectId = next.activeObjectId;
    this.state.cursor3D = next.cursor3D;
    this.state.annotations = next.annotations || [];
    this.state.measures = next.measures || [];
    this.rebuildSceneObjects();
    this.notify();
    return true;
  }

  public mount(container: HTMLElement): void {
    this.container = container;
    const rect = container.getBoundingClientRect();
    const w = Math.max(320, rect.width || 960);
    const h = Math.max(200, rect.height || 540);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.state.world.backgroundColor);

    this.perspCamera = new THREE.PerspectiveCamera(42, w / h, 0.05, 600);
    this.perspCamera.up.set(0, 0, 1);

    const aspect = w / h;
    const orthoHalfH = 4.2;
    this.orthoCamera = new THREE.OrthographicCamera(
      -orthoHalfH * aspect,
      orthoHalfH * aspect,
      orthoHalfH,
      -orthoHalfH,
      -200,
      600
    );
    this.orthoCamera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'modix-webgl-canvas';
    container.appendChild(this.renderer.domElement);

    // Studio Solid Shading Lights
    this.studioAmbient = new THREE.AmbientLight(0xffffff, 0.56);
    this.studioKeyLight = new THREE.DirectionalLight(0xffffff, 0.72);
    this.studioKeyLight.position.set(3.5, -5.5, 9.0);
    this.studioFillLight = new THREE.DirectionalLight(0xdde6f0, 0.28);
    this.studioFillLight.position.set(-7.0, -2.5, 2.0);
    this.studioRimLight = new THREE.DirectionalLight(0xffffff, 0.16);
    this.studioRimLight.position.set(-3.0, 7.0, -4.0);

    this.scene.add(
      this.studioAmbient,
      this.studioKeyLight,
      this.studioFillLight,
      this.studioRimLight,
      this.sceneLightsGroup,
      this.overlaysGroup,
      this.objectsGroup,
      this.editHelpersGroup,
      this.annotationsGroup,
      this.gizmoGroup
    );

    this.buildViewportGridAndCursor();
    this.updateCameraFromOrbit();
    this.rebuildSceneObjects();
    this.bindInputEvents(this.renderer.domElement);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.lastFrameTime = performance.now();
    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = (now - this.lastFrameTime) / 1000;
      if (this.state.isPlaying && dt >= 1 / this.state.fps) {
        this.lastFrameTime = now;
        const step = this.state.playReverse ? -1 : 1;
        let next = this.state.currentFrame + step;
        if (next > this.state.endFrame) next = this.state.startFrame;
        if (next < this.state.startFrame) next = this.state.endFrame;
        this.setCurrentFrame(next);
      }
      this.applyCompositorCSS();
      this.renderFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  public handleResize(): void {
    if (!this.container || !this.renderer) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(100, rect.width);
    const h = Math.max(100, rect.height);
    const aspect = w / h;

    this.perspCamera.aspect = aspect;
    this.perspCamera.updateProjectionMatrix();

    const orthoHalfH = this.orbitRadius * 0.38;
    this.orthoCamera.left = -orthoHalfH * aspect;
    this.orthoCamera.right = orthoHalfH * aspect;
    this.orthoCamera.top = orthoHalfH;
    this.orthoCamera.bottom = -orthoHalfH;
    this.orthoCamera.updateProjectionMatrix();

    this.renderer.setSize(w, h);
    this.renderFrame();
  }

  public getActiveCamera(): THREE.Camera {
    return this.state.isOrthographic ? this.orthoCamera : this.perspCamera;
  }

  public getGizmoOrientationScreenAxes(): Array<{
    axis: 'X' | 'Y' | 'Z' | '-X' | '-Y' | '-Z';
    sx: number;
    sy: number;
    sz: number;
    color: string;
    positive: boolean;
  }> {
    const cam = this.getActiveCamera();
    cam.updateMatrixWorld();
    const invRot = new THREE.Quaternion().copy(cam.quaternion).invert();
    const defs: Array<{ axis: 'X' | 'Y' | 'Z' | '-X' | '-Y' | '-Z'; vec: THREE.Vector3; color: string; positive: boolean }> = [
      { axis: 'X', vec: new THREE.Vector3(1, 0, 0), color: '#e33b4b', positive: true },
      { axis: 'Y', vec: new THREE.Vector3(0, 1, 0), color: '#6bbf2b', positive: true },
      { axis: 'Z', vec: new THREE.Vector3(0, 0, 1), color: '#2b83f6', positive: true },
      { axis: '-X', vec: new THREE.Vector3(-1, 0, 0), color: '#e33b4b', positive: false },
      { axis: '-Y', vec: new THREE.Vector3(0, -1, 0), color: '#6bbf2b', positive: false },
      { axis: '-Z', vec: new THREE.Vector3(0, 0, -1), color: '#2b83f6', positive: false }
    ];
    return defs
      .map((d) => {
        const v = d.vec.clone().applyQuaternion(invRot);
        return {
          axis: d.axis,
          sx: v.x,
          sy: -v.y,
          sz: v.z,
          color: d.color,
          positive: d.positive
        };
      })
      .sort((a, b) => a.sz - b.sz);
  }

  public snapViewToAxis(axis: 'X' | 'Y' | 'Z' | '-X' | '-Y' | '-Z'): void {
    this.state.inCameraView = false;
    this.state.isOrthographic = true;
    switch (axis) {
      case 'X':
        this.orbitAzimuth = 0;
        this.orbitElevation = 0.001;
        this.state.viewLabel = 'Right Orthographic';
        break;
      case '-X':
        this.orbitAzimuth = Math.PI;
        this.orbitElevation = 0.001;
        this.state.viewLabel = 'Left Orthographic';
        break;
      case 'Y':
        this.orbitAzimuth = Math.PI * 0.5;
        this.orbitElevation = 0.001;
        this.state.viewLabel = 'Back Orthographic';
        break;
      case '-Y':
        this.orbitAzimuth = -Math.PI * 0.5;
        this.orbitElevation = 0.001;
        this.state.viewLabel = 'Front Orthographic';
        break;
      case 'Z':
        this.orbitAzimuth = -Math.PI * 0.5;
        this.orbitElevation = Math.PI * 0.499;
        this.state.viewLabel = 'Top Orthographic';
        break;
      case '-Z':
        this.orbitAzimuth = -Math.PI * 0.5;
        this.orbitElevation = -Math.PI * 0.499;
        this.state.viewLabel = 'Bottom Orthographic';
        break;
    }
    this.updateCameraFromOrbit();
    this.handleResize();
    this.notify();
  }

  public orbitByDelta(dx: number, dy: number): void {
    if (this.state.inCameraView) {
      this.state.inCameraView = false;
    }
    this.orbitAzimuth -= dx * 0.0075;
    this.orbitElevation = Math.max(
      -Math.PI * 0.485,
      Math.min(Math.PI * 0.485, this.orbitElevation + dy * 0.0075)
    );
    this.state.viewLabel = this.state.isOrthographic ? 'User Orthographic' : 'User Perspective';
    this.updateCameraFromOrbit();
  }

  public panByDelta(dx: number, dy: number): void {
    if (this.state.inCameraView) this.state.inCameraView = false;
    const cam = this.getActiveCamera();
    cam.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const factor = this.orbitRadius * 0.0016;
    this.orbitTarget.addScaledVector(right, -dx * factor);
    this.orbitTarget.addScaledVector(up, dy * factor);
    this.updateCameraFromOrbit();
  }

  public zoomByFactor(factor: number): void {
    this.orbitRadius = Math.max(1.2, Math.min(120, this.orbitRadius * factor));
    this.updateCameraFromOrbit();
    this.handleResize();
  }

  public toggleCameraView(): void {
    this.state.inCameraView = !this.state.inCameraView;
    if (this.state.inCameraView) {
      this.state.isOrthographic = false;
      this.state.viewLabel = 'Camera Perspective';
      const camObj = this.state.objects.find((o) => o.kind === 'CAMERA');
      if (camObj) {
        this.perspCamera.position.set(camObj.location[0], camObj.location[1], camObj.location[2]);
        this.perspCamera.lookAt(0, 0, 0);
      }
    } else {
      this.state.viewLabel = 'User Perspective';
      this.updateCameraFromOrbit();
    }
    this.rebuildGizmo();
    this.notify();
  }

  public toggleProjection(): void {
    this.state.inCameraView = false;
    this.state.isOrthographic = !this.state.isOrthographic;
    this.state.viewLabel = this.state.isOrthographic ? 'User Orthographic' : 'User Perspective';
    this.handleResize();
    this.notify();
  }

  public frameSelected(): void {
    const active = this.getActiveObject();
    if (active) {
      this.orbitTarget.set(active.location[0], active.location[1], active.location[2]);
      this.orbitRadius = 8.5;
    } else {
      this.orbitTarget.set(0, 0, 0);
      this.orbitRadius = 11.0;
    }
    this.updateCameraFromOrbit();
    this.handleResize();
  }

  private updateCameraFromOrbit(): void {
    if (!this.perspCamera || !this.orthoCamera) return;
    if (this.state.inCameraView) return;
    const cosEl = Math.cos(this.orbitElevation);
    const x = this.orbitTarget.x + this.orbitRadius * cosEl * Math.cos(this.orbitAzimuth);
    const y = this.orbitTarget.y + this.orbitRadius * cosEl * Math.sin(this.orbitAzimuth);
    const z = this.orbitTarget.z + this.orbitRadius * Math.sin(this.orbitElevation);

    this.perspCamera.position.set(x, y, z);
    this.perspCamera.up.set(0, 0, 1);
    this.perspCamera.lookAt(this.orbitTarget);

    this.orthoCamera.position.set(x, y, z);
    this.orthoCamera.up.set(0, 0, 1);
    this.orthoCamera.lookAt(this.orbitTarget);

    this.rebuildGizmo();
  }

  private buildViewportGridAndCursor(): void {
    this.overlaysGroup.clear();

    const size = 24;
    const minorPositions: number[] = [];
    const majorPositions: number[] = [];

    for (let i = -size; i <= size; i++) {
      if (i === 0) continue;
      const target = i % 5 === 0 ? majorPositions : minorPositions;
      target.push(-size, i, 0, size, i, 0);
      target.push(i, -size, 0, i, size, 0);
    }

    const minorGeo = new THREE.BufferGeometry();
    minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorPositions, 3));
    const minorLines = new THREE.LineSegments(
      minorGeo,
      new THREE.LineBasicMaterial({ color: 0x282828, transparent: true, opacity: 0.9 })
    );

    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPositions, 3));
    const majorLines = new THREE.LineSegments(
      majorGeo,
      new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.95 })
    );

    const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-size, 0, 0.002),
      new THREE.Vector3(size, 0, 0.002)
    ]);
    const xAxisLine = new THREE.Line(xAxisGeo, new THREE.LineBasicMaterial({ color: 0xc22f3d }));

    const yAxisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -size, 0.002),
      new THREE.Vector3(0, size, 0.002)
    ]);
    const yAxisLine = new THREE.Line(yAxisGeo, new THREE.LineBasicMaterial({ color: 0x629627 }));

    this.overlaysGroup.add(minorLines, majorLines, xAxisLine, yAxisLine);

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const cx = 64;
    const cy = 64;
    const r = 34;

    ctx.lineWidth = 5.5;
    ctx.strokeStyle = '#f5f5f5';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#e03b3b';
    for (let s = 0; s < 4; s++) {
      const a0 = (s * Math.PI) / 2 + 0.2;
      const a1 = a0 + Math.PI / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a0, a1);
      ctx.stroke();
    }

    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 4;
    const drawTick = (x1: number, y1: number, x2: number, y2: number) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };
    drawTick(cx, 8, cx, 44);
    drawTick(cx, 84, cx, 120);
    drawTick(8, cy, 44, cy);
    drawTick(84, cy, 120, cy);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spriteMat = new THREE.SpriteMaterial({
      map: tex,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      transparent: true
    });
    this.cursorSprite = new THREE.Sprite(spriteMat);
    this.cursorSprite.scale.set(0.052, 0.052, 1);
    this.cursorSprite.renderOrder = 950;
    this.cursorSprite.position.set(
      this.state.cursor3D[0],
      this.state.cursor3D[1],
      this.state.cursor3D[2]
    );
    this.overlaysGroup.add(this.cursorSprite);
  }

  public getActiveObject(): SceneObjectData | null {
    return this.state.objects.find((o) => o.id === this.state.activeObjectId) || null;
  }

  public findObjectByNameOrId(query: string): SceneObjectData | null {
    if (!query) return null;
    const exact = this.state.objects.find((o) => o.id === query || o.name === query);
    if (exact) return exact;
    const lower = query.toLowerCase();
    return this.state.objects.find((o) => o.name.toLowerCase() === lower) || null;
  }

  public selectObject(id: string | null, additive = false): void {
    if (!id) {
      this.state.selectedIds = [];
      this.state.activeObjectId = null;
    } else if (additive) {
      if (this.state.selectedIds.includes(id)) {
        this.state.selectedIds = this.state.selectedIds.filter((x) => x !== id);
        this.state.activeObjectId = this.state.selectedIds[this.state.selectedIds.length - 1] || null;
      } else {
        this.state.selectedIds.push(id);
        this.state.activeObjectId = id;
      }
    } else {
      this.state.selectedIds = [id];
      this.state.activeObjectId = id;
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  // ==========================================================================
  // COLLECTIONS / GROUPS ("Colocar em Grupo", "Renomear Grupo", etc.)
  // ==========================================================================

  private ensureCollectionsValid(): void {
    if (!this.state.collections || this.state.collections.length === 0) {
      this.state.collections = [{ id: 'col_default', name: 'Collection', visible: true, collapsed: false }];
    }
    const known = new Set(this.state.collections.map((c) => c.name));
    for (const obj of this.state.objects) {
      if (!obj.collection) obj.collection = 'Collection';
      if (!known.has(obj.collection)) {
        this.state.collections.push({
          id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
          name: obj.collection,
          visible: true,
          collapsed: false
        });
        known.add(obj.collection);
      }
    }
    if (!this.state.activeCollection || !known.has(this.state.activeCollection)) {
      this.state.activeCollection = this.state.collections[0].name;
    }
  }

  public createCollection(baseName = 'Group', color?: string): CollectionGroup {
    this.ensureCollectionsValid();
    this.pushUndoSnapshot();
    const existing = new Set(this.state.collections.map((c) => c.name));
    let name = baseName.trim() || 'Group';
    if (existing.has(name)) {
      for (let i = 1; i < 999; i++) {
        const cand = `${name}.${String(i).padStart(3, '0')}`;
        if (!existing.has(cand)) {
          name = cand;
          break;
        }
      }
    }
    const group: CollectionGroup = {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      visible: true,
      collapsed: false,
      color
    };
    this.state.collections.push(group);
    this.state.activeCollection = name;
    this.notify();
    return group;
  }

  public renameCollection(oldName: string, rawNewName: string): boolean {
    const newName = rawNewName.trim();
    if (!newName || oldName === newName) return false;
    this.ensureCollectionsValid();
    if (this.state.collections.some((c) => c.name === newName)) return false;

    this.pushUndoSnapshot();
    const col = this.state.collections.find((c) => c.name === oldName);
    if (col) col.name = newName;
    for (const obj of this.state.objects) {
      if (obj.collection === oldName) obj.collection = newName;
    }
    if (this.state.activeCollection === oldName) {
      this.state.activeCollection = newName;
    }
    this.notify();
    return true;
  }

  public deleteCollection(name: string, deleteObjectsInside = false): void {
    this.ensureCollectionsValid();
    if (this.state.collections.length <= 1 && !deleteObjectsInside) return;
    this.pushUndoSnapshot();

    if (deleteObjectsInside) {
      const removedIds = new Set(
        this.state.objects.filter((o) => o.collection === name).map((o) => o.id)
      );
      this.state.objects = this.state.objects.filter((o) => o.collection !== name);
      this.state.selectedIds = this.state.selectedIds.filter((id) => !removedIds.has(id));
      if (this.state.activeObjectId && removedIds.has(this.state.activeObjectId)) {
        this.state.activeObjectId = this.state.selectedIds[0] || this.state.objects[0]?.id || null;
      }
    }

    if (this.state.collections.length > 1) {
      this.state.collections = this.state.collections.filter((c) => c.name !== name);
    }
    const fallback = this.state.collections[0]?.name || 'Collection';
    if (!deleteObjectsInside) {
      for (const obj of this.state.objects) {
        if (obj.collection === name) obj.collection = fallback;
      }
    }
    if (this.state.activeCollection === name) {
      this.state.activeCollection = fallback;
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public toggleCollectionCollapsed(name: string): void {
    const col = this.state.collections.find((c) => c.name === name);
    if (!col) return;
    col.collapsed = !col.collapsed;
    this.notify();
  }

  public toggleCollectionVisible(name: string): void {
    const col = this.state.collections.find((c) => c.name === name);
    if (!col) return;
    col.visible = !col.visible;
    for (const obj of this.state.objects) {
      if (obj.collection === name) {
        obj.visible = col.visible;
      }
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public selectCollectionObjects(name: string): void {
    const ids = this.state.objects.filter((o) => o.collection === name).map((o) => o.id);
    this.state.activeCollection = name;
    if (ids.length > 0) {
      this.state.selectedIds = ids;
      this.state.activeObjectId = ids[0];
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public moveObjectsToCollection(ids: string[], targetCollection: string): void {
    if (ids.length === 0) return;
    this.ensureCollectionsValid();
    if (!this.state.collections.some((c) => c.name === targetCollection)) {
      this.createCollection(targetCollection);
    } else {
      this.pushUndoSnapshot();
    }
    const idSet = new Set(ids);
    for (const obj of this.state.objects) {
      if (idSet.has(obj.id)) {
        obj.collection = targetCollection;
      }
    }
    this.state.activeCollection = targetCollection;
    this.notify();
  }

  public groupSelectedIntoNewCollection(groupName = 'Grupo'): CollectionGroup | null {
    if (this.state.selectedIds.length === 0) return null;
    const grp = this.createCollection(groupName);
    const idSet = new Set(this.state.selectedIds);
    for (const obj of this.state.objects) {
      if (idSet.has(obj.id)) obj.collection = grp.name;
    }
    this.notify();
    return grp;
  }

  public ungroupSelected(): void {
    const defaultCol = this.state.collections[0]?.name || 'Collection';
    this.moveObjectsToCollection(this.state.selectedIds, defaultCol);
  }

  // ==========================================================================
  // RENAME, COPY, CUT, PASTE, JOIN ("Unir"), SEPARATE & SLICE ("Recortar 3D")
  // ==========================================================================

  public renameObject(id: string, rawNewName: string): boolean {
    const clean = rawNewName.trim();
    if (!clean) return false;
    const obj = this.state.objects.find((o) => o.id === id);
    if (!obj || obj.name === clean) return false;
    this.pushUndoSnapshot();
    obj.name = this.makeUniqueName(clean, id);
    this.notify();
    return true;
  }

  public hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  public copySelected(): number {
    const selSet = new Set(this.state.selectedIds);
    const chosen = this.state.objects.filter((o) => selSet.has(o.id));
    if (chosen.length === 0) return 0;
    this.clipboard = JSON.parse(JSON.stringify(chosen));
    return this.clipboard.length;
  }

  public cutSelected(): number {
    const count = this.copySelected();
    if (count > 0) {
      this.deleteSelected();
    }
    return count;
  }

  public pasteClipboard(offset: [number, number, number] = [0.6, 0.6, 0]): SceneObjectData[] {
    if (this.clipboard.length === 0) return [];
    this.pushUndoSnapshot();
    const pasted: SceneObjectData[] = [];
    for (const src of this.clipboard) {
      const clone: SceneObjectData = JSON.parse(JSON.stringify(src));
      clone.id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      clone.name = this.makeUniqueName(src.name.replace(/\.\d+$/, ''));
      clone.collection = this.state.activeCollection || src.collection || 'Collection';
      clone.location = [
        Number((src.location[0] + offset[0]).toFixed(3)),
        Number((src.location[1] + offset[1]).toFixed(3)),
        Number((src.location[2] + offset[2]).toFixed(3))
      ];
      this.state.objects.push(clone);
      pasted.push(clone);
    }
    this.state.selectedIds = pasted.map((p) => p.id);
    this.state.activeObjectId = pasted[pasted.length - 1]?.id || null;
    this.rebuildSceneObjects();
    this.notify();
    return pasted;
  }

  private getObjectMatrix4(obj: SceneObjectData): THREE.Matrix4 {
    const pos = new THREE.Vector3(
      obj.location[0] + obj.deltaLocation[0],
      obj.location[1] + obj.deltaLocation[1],
      obj.location[2] + obj.deltaLocation[2]
    );
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(obj.rotationDeg[0] + obj.deltaRotationDeg[0]),
      THREE.MathUtils.degToRad(obj.rotationDeg[1] + obj.deltaRotationDeg[1]),
      THREE.MathUtils.degToRad(obj.rotationDeg[2] + obj.deltaRotationDeg[2]),
      'XYZ'
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const scl = new THREE.Vector3(
      obj.scale[0] * obj.deltaScale[0],
      obj.scale[1] * obj.deltaScale[1],
      obj.scale[2] * obj.deltaScale[2]
    );
    return new THREE.Matrix4().compose(pos, quat, scl);
  }

  /** Joins (unites) 2 or more selected MESH objects into the active object cleanly in world space */
  public joinSelected(): SceneObjectData | null {
    const selMeshes = this.state.objects.filter(
      (o) => this.state.selectedIds.includes(o.id) && o.kind === 'MESH' && o.mesh
    );
    if (selMeshes.length < 2) return null;

    const target =
      selMeshes.find((o) => o.id === this.state.activeObjectId) || selMeshes[0];
    this.pushUndoSnapshot();

    const targetWorldMat = this.getObjectMatrix4(target);
    const invTargetMat = targetWorldMat.clone().invert();

    const mergedVertices: [number, number, number][] = [];
    const mergedFaces: number[][] = [];
    const mergedColors: [number, number, number][] = [];
    let anyColors = false;
    const v = new THREE.Vector3();

    for (const part of selMeshes) {
      const evaluated = evaluateMeshWithModifiers(part.mesh!, part.modifiers);
      const partMat = this.getObjectMatrix4(part);
      const toTargetLocal = invTargetMat.clone().multiply(partMat);
      const baseV = mergedVertices.length;
      const col = new THREE.Color(part.material.baseColor || '#9a9a9a');

      evaluated.vertices.forEach(([x, y, z], vi) => {
        v.set(x, y, z).applyMatrix4(toTargetLocal);
        mergedVertices.push([v.x, v.y, v.z]);
        if (evaluated.vertexColors && evaluated.vertexColors[vi]) {
          mergedColors.push([...evaluated.vertexColors[vi]]);
          anyColors = true;
        } else {
          mergedColors.push([col.r, col.g, col.b]);
          if (part.material.baseColor !== target.material.baseColor) {
            anyColors = true;
          }
        }
      });

      for (const f of evaluated.faces) {
        mergedFaces.push(f.map((idx) => idx + baseV));
      }
    }

    target.mesh = {
      vertices: mergedVertices,
      faces: mergedFaces,
      shadeSmooth: target.mesh?.shadeSmooth ?? false,
      vertexColors: anyColors ? mergedColors : undefined
    };
    target.modifiers = [];

    const removeSet = new Set(selMeshes.filter((o) => o.id !== target.id).map((o) => o.id));
    this.state.objects = this.state.objects.filter((o) => !removeSet.has(o.id));
    this.state.selectedIds = [target.id];
    this.state.activeObjectId = target.id;
    this.rebuildSceneObjects();
    this.notify();
    return target;
  }

  /** Separates disconnected mesh islands into individual objects */
  public separateSelectedByLooseParts(): SceneObjectData[] {
    const active = this.getActiveObject();
    if (!active || active.kind !== 'MESH' || !active.mesh) return [];
    const evaluated = evaluateMeshWithModifiers(active.mesh, active.modifiers);
    const parts = separateLooseParts(evaluated);
    if (parts.length <= 1) return [active];

    this.pushUndoSnapshot();
    active.mesh = parts[0];
    active.modifiers = [];
    const created: SceneObjectData[] = [active];

    for (let i = 1; i < parts.length; i++) {
      const clone: SceneObjectData = JSON.parse(JSON.stringify(active));
      clone.id = `obj_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 5)}`;
      clone.name = this.makeUniqueName(`${active.name}_Part`);
      clone.mesh = parts[i];
      this.state.objects.push(clone);
      created.push(clone);
    }

    this.state.selectedIds = created.map((c) => c.id);
    this.rebuildSceneObjects();
    this.notify();
    return created;
  }

  /** Cuts / Slices active mesh along a plane ('split' into 2 objects or trim one half) */
  public sliceActiveMesh(
    axis: 'X' | 'Y' | 'Z' | 'CUSTOM',
    mode: 'split' | 'keep_pos' | 'keep_neg' = 'split',
    offset = 0,
    customNormal?: [number, number, number],
    separationGap = 0.08
  ): SceneObjectData[] {
    const active = this.getActiveObject();
    if (!active || active.kind !== 'MESH' || !active.mesh) return [];
    this.pushUndoSnapshot();

    const evaluated = evaluateMeshWithModifiers(active.mesh, active.modifiers);
    const normal: [number, number, number] =
      axis === 'X'
        ? [1, 0, 0]
        : axis === 'Y'
          ? [0, 1, 0]
          : axis === 'Z'
            ? [0, 0, 1]
            : customNormal || [0, 0, 1];
    const axisIdx: 0 | 1 | 2 =
      axis === 'X'
        ? 0
        : axis === 'Y'
          ? 1
          : axis === 'Z'
            ? 2
            : Math.abs(normal[0]) >= Math.abs(normal[1]) && Math.abs(normal[0]) >= Math.abs(normal[2])
              ? 0
              : Math.abs(normal[1]) >= Math.abs(normal[2])
                ? 1
                : 2;

    if (mode === 'keep_pos' || mode === 'keep_neg') {
      const sliced = sliceMeshByPlane(
        evaluated,
        axisIdx,
        offset,
        mode === 'keep_pos' ? 'positive' : 'negative',
        true
      );
      if (sliced.faces.length > 0) {
        active.mesh = sliced;
        active.modifiers = [];
      }
      this.rebuildSceneObjects();
      this.notify();
      return [active];
    }

    // Split into two separate objects with sealed caps!
    const { positive, negative } = splitMeshInTwo(evaluated, axisIdx, offset);
    if (positive.faces.length === 0 || negative.faces.length === 0) {
      return [active];
    }

    active.mesh = negative;
    active.modifiers = [];
    const second: SceneObjectData = JSON.parse(JSON.stringify(active));
    second.id = `obj_${Date.now()}_cut_${Math.random().toString(36).slice(2, 6)}`;
    second.name = this.makeUniqueName(`${active.name}_Cut`);
    second.mesh = positive;

    // Slight visual separation along cut normal if requested
    if (separationGap > 0) {
      active.location = [
        Number((active.location[0] - normal[0] * separationGap * 0.5).toFixed(3)),
        Number((active.location[1] - normal[1] * separationGap * 0.5).toFixed(3)),
        Number((active.location[2] - normal[2] * separationGap * 0.5).toFixed(3))
      ];
      second.location = [
        Number((second.location[0] + normal[0] * separationGap * 0.5).toFixed(3)),
        Number((second.location[1] + normal[1] * separationGap * 0.5).toFixed(3)),
        Number((second.location[2] + normal[2] * separationGap * 0.5).toFixed(3))
      ];
    }

    this.state.objects.push(second);
    this.state.selectedIds = [active.id, second.id];
    this.state.activeObjectId = second.id;
    this.rebuildSceneObjects();
    this.notify();
    return [active, second];
  }

  // ==========================================================================
  // PRIMITIVES, CUSTOM MESHES & DEFORMERS
  // ==========================================================================

  public addPrimitive(type: PrimitiveType): SceneObjectData {
    this.ensureCollectionsValid();
    this.pushUndoSnapshot();
    const baseNames: Record<PrimitiveType, string> = {
      cube: 'Cube',
      plane: 'Plane',
      grid: 'Grid',
      uv_sphere: 'Sphere',
      ico_sphere: 'Icosphere',
      cylinder: 'Cylinder',
      hex_cylinder: 'Hexagon',
      cone: 'Cone',
      pyramid: 'Pyramid',
      wedge: 'Wedge',
      corner_wedge: 'CornerWedge',
      prism: 'Prism',
      torus: 'Torus',
      torus_knot: 'TorusKnot',
      capsule: 'Capsule',
      pipe: 'Pipe',
      arch: 'Arch',
      stairs: 'Stairs',
      star: 'Star',
      gear: 'Gear',
      ring: 'Ring',
      crystal: 'Crystal',
      heart: 'Heart',
      monkey: 'Suzanne'
    };
    const base = baseNames[type] || 'Mesh';
    const name = this.makeUniqueName(base);

    const newObj: SceneObjectData = {
      id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      kind: 'MESH',
      collection: this.state.activeCollection || 'Collection',
      visible: true,
      selectable: true,
      location: [...this.state.cursor3D],
      rotationDeg: [0, 0, 0],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      primitive: type,
      mesh: createPrimitiveMesh(type),
      modifiers: [],
      material: {
        name: `${name}Mat`,
        baseColor: '#9a9a9a',
        metallic: 0.05,
        roughness: 0.55,
        emissionColor: '#000000',
        emissionStrength: 0,
        opacity: 1,
        wireframe: false,
        uvProjection: 'box',
        repeatX: 1,
        repeatY: 1
      },
      keyframes: []
    };

    this.state.objects.push(newObj);
    this.state.selectedIds = [newObj.id];
    this.state.activeObjectId = newObj.id;
    this.rebuildSceneObjects();
    this.notify();
    return newObj;
  }

  public addSceneNonMesh(kind: Exclude<ObjectKind, 'MESH'>): SceneObjectData {
    this.ensureCollectionsValid();
    this.pushUndoSnapshot();
    const base = kind === 'LIGHT' ? 'Light' : kind === 'CAMERA' ? 'Camera' : 'Empty';
    const name = this.makeUniqueName(base);
    const obj: SceneObjectData = {
      id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      kind,
      collection: this.state.activeCollection || 'Collection',
      visible: true,
      selectable: true,
      location: [...this.state.cursor3D],
      rotationDeg: kind === 'CAMERA' ? [75, 0, -45] : [0, 0, 0],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      modifiers: [],
      material: {
        name: 'Default',
        baseColor: '#ffffff',
        metallic: 0,
        roughness: 0.5,
        emissionColor: '#000000',
        emissionStrength: 0,
        opacity: 1,
        wireframe: false
      },
      lightKind: kind === 'LIGHT' ? 'POINT' : undefined,
      lightColor: '#ffffff',
      lightPower: 1000,
      cameraFov: 50,
      cameraClipStart: 0.1,
      cameraClipEnd: 100,
      keyframes: []
    };
    this.state.objects.push(obj);
    this.state.selectedIds = [obj.id];
    this.state.activeObjectId = obj.id;
    this.rebuildSceneObjects();
    this.notify();
    return obj;
  }

  public addImportedMesh(
    nameBase: string,
    mesh: EditableMeshData,
    materialOverrides?: Partial<MaterialData>,
    customLocation?: [number, number, number]
  ): SceneObjectData {
    this.ensureCollectionsValid();
    this.pushUndoSnapshot();
    const name = this.makeUniqueName(nameBase || 'Imported');
    const obj: SceneObjectData = {
      id: `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      kind: 'MESH',
      collection: this.state.activeCollection || 'Collection',
      visible: true,
      selectable: true,
      location: customLocation ? [...customLocation] : [...this.state.cursor3D],
      rotationDeg: [0, 0, 0],
      rotationMode: 'XYZ Euler',
      scale: [1, 1, 1],
      deltaLocation: [0, 0, 0],
      deltaRotationDeg: [0, 0, 0],
      deltaScale: [1, 1, 1],
      lockLocation: { x: false, y: false, z: false },
      lockRotation: { x: false, y: false, z: false },
      lockScale: { x: false, y: false, z: false },
      mesh,
      modifiers: [],
      material: {
        name: `${name}Mat`,
        baseColor: '#a6a6a6',
        metallic: 0.08,
        roughness: 0.5,
        emissionColor: '#000000',
        emissionStrength: 0,
        opacity: 1,
        wireframe: false,
        uvProjection: 'box',
        repeatX: 1,
        repeatY: 1,
        ...materialOverrides
      },
      keyframes: []
    };
    this.state.objects.push(obj);
    this.state.selectedIds = [obj.id];
    this.state.activeObjectId = obj.id;
    this.rebuildSceneObjects();
    this.notify();
    return obj;
  }

  public deformMeshObject(
    objId: string,
    op: { type: 'noise'; amplitude: number; frequency?: number } | { type: 'taper'; topScale: number } | { type: 'smooth'; levels?: number }
  ): void {
    const obj = this.state.objects.find((o) => o.id === objId);
    if (!obj || obj.kind !== 'MESH' || !obj.mesh) return;
    this.pushUndoSnapshot();
    if (op.type === 'noise') {
      obj.mesh = displaceMeshNoise(obj.mesh, op.amplitude, op.frequency ?? 1.8);
    } else if (op.type === 'taper') {
      obj.mesh = taperMeshZ(obj.mesh, op.topScale);
    } else if (op.type === 'smooth') {
      obj.mesh = catmullClarkSubdivide(obj.mesh, Math.min(2, Math.max(1, op.levels ?? 1)));
      obj.mesh.shadeSmooth = true;
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public duplicateSelected(): void {
    const selSet = new Set(this.state.selectedIds);
    const chosen = this.state.objects.filter((o) => selSet.has(o.id));
    if (chosen.length === 0) return;
    this.pushUndoSnapshot();

    const clones: SceneObjectData[] = [];
    for (const active of chosen) {
      const clone: SceneObjectData = JSON.parse(JSON.stringify(active));
      clone.id = `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      clone.name = this.makeUniqueName(active.name.replace(/\.\d+$/, ''));
      clone.location = [
        Number((active.location[0] + 0.6).toFixed(3)),
        Number((active.location[1] + 0.6).toFixed(3)),
        active.location[2]
      ];
      this.state.objects.push(clone);
      clones.push(clone);
    }
    this.state.selectedIds = clones.map((c) => c.id);
    this.state.activeObjectId = clones[clones.length - 1]?.id || null;
    this.rebuildSceneObjects();
    this.notify();
  }

  public deleteSelected(): void {
    if (this.state.mode === 'EDIT') {
      this.performEditMeshOp('delete_faces');
      return;
    }
    if (this.state.selectedIds.length === 0) return;
    this.pushUndoSnapshot();
    const drop = new Set(this.state.selectedIds);
    for (const id of drop) this.disposeObjectTexture(id);
    this.state.objects = this.state.objects.filter((o) => !drop.has(o.id));
    this.state.selectedIds = [];
    this.state.activeObjectId = this.state.objects[0]?.id || null;
    if (this.state.activeObjectId) this.state.selectedIds = [this.state.activeObjectId];
    this.rebuildSceneObjects();
    this.notify();
  }

  public clearAllMeshObjects(): void {
    this.pushUndoSnapshot();
    const meshIds = this.state.objects.filter((o) => o.kind === 'MESH').map((o) => o.id);
    for (const id of meshIds) this.disposeObjectTexture(id);
    this.state.objects = this.state.objects.filter((o) => o.kind !== 'MESH');
    this.state.selectedIds = [];
    this.state.activeObjectId = null;
    this.rebuildSceneObjects();
    this.notify();
  }

  // ==========================================================================
  // TEXTURE SYSTEM & 3D VIEWPORT UV TEXTURE PAINTING
  // ==========================================================================

  private disposeObjectTexture(objId: string): void {
    const entry = this.textureCanvases.get(objId);
    if (entry) {
      entry.texture.dispose();
      this.textureCanvases.delete(objId);
    }
  }

  public getOrCreateLiveTexture(obj: SceneObjectData, createBlankIfMissing = false): LiveTextureEntry | null {
    const url = obj.material.textureDataUrl;
    if (!url && !createBlankIfMissing) {
      this.disposeObjectTexture(obj.id);
      return null;
    }

    const existing = this.textureCanvases.get(obj.id);
    if (existing && url && existing.sourceUrl === url) {
      existing.texture.repeat.set(obj.material.repeatX ?? 1, obj.material.repeatY ?? 1);
      return existing;
    }

    // Create 512x512 live paintable canvas
    const canvas = existing?.canvas || document.createElement('canvas');
    if (!existing) {
      canvas.width = 512;
      canvas.height = 512;
    }
    const ctx = canvas.getContext('2d')!;
    const fillHex = obj.material.baseColor && obj.material.baseColor !== '#9a9a9a'
      ? obj.material.baseColor
      : '#e5e7eb';

    if (!url && createBlankIfMissing) {
      ctx.fillStyle = fillHex;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const blankUrl = canvas.toDataURL('image/png');
      obj.material.textureDataUrl = blankUrl;
      obj.material.textureName = obj.material.textureName || `${obj.name}_Paint.png`;
    }

    const texture = existing?.texture || new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(obj.material.repeatX ?? 1, obj.material.repeatY ?? 1);

    const activeUrl = obj.material.textureDataUrl!;
    const entry: LiveTextureEntry = {
      sourceUrl: activeUrl,
      canvas,
      ctx,
      texture
    };
    this.textureCanvases.set(obj.id, entry);

    if (url) {
      const img = new Image();
      img.onload = () => {
        if (this.textureCanvases.get(obj.id)?.sourceUrl === activeUrl) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          texture.needsUpdate = true;
          this.renderFrame();
        }
      };
      img.src = activeUrl;
    } else {
      texture.needsUpdate = true;
    }

    return entry;
  }

  public applyTextureDataUrl(
    objId: string,
    dataUrl: string | undefined,
    textureName?: string,
    uvProjection?: UVProjectionMode
  ): void {
    const obj = this.state.objects.find((o) => o.id === objId);
    if (!obj) return;
    this.pushUndoSnapshot();
    obj.material.textureDataUrl = dataUrl;
    obj.material.textureName = dataUrl ? (textureName || `${obj.name}_Texture.png`) : undefined;
    if (uvProjection) obj.material.uvProjection = uvProjection;
    if (!dataUrl) {
      this.disposeObjectTexture(obj.id);
    } else {
      // Keep baseColor neutral white if still default gray so texture shows full brightness
      if (obj.material.baseColor === '#9a9a9a') {
        obj.material.baseColor = '#ffffff';
      }
      this.disposeObjectTexture(obj.id);
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public performEditMeshOp(
    op: 'extrude' | 'inset' | 'bevel' | 'subdivide' | 'subsurf' | 'loop_cut' | 'delete_faces' | 'shade_smooth' | 'shade_flat'
  ): void {
    const active = this.getActiveObject();
    if (!active || active.kind !== 'MESH' || !active.mesh) return;
    this.pushUndoSnapshot();

    switch (op) {
      case 'extrude': {
        const res = extrudeFaces(active.mesh, this.state.selectedFaces, 0.45);
        active.mesh = res.mesh;
        this.state.selectedFaces = res.newFaceIndices;
        break;
      }
      case 'inset': {
        const res = insetFaces(active.mesh, this.state.selectedFaces, 0.28, 0);
        active.mesh = res.mesh;
        this.state.selectedFaces = res.newFaceIndices;
        break;
      }
      case 'bevel': {
        const res = bevelFaces(active.mesh, this.state.selectedFaces, 0.22);
        active.mesh = res.mesh;
        this.state.selectedFaces = res.newFaceIndices;
        break;
      }
      case 'subdivide': {
        active.mesh = subdivideFlat(active.mesh, this.state.selectedFaces);
        this.state.selectedFaces = [];
        break;
      }
      case 'subsurf': {
        active.mesh = catmullClarkSubdivide(active.mesh, 1);
        this.state.selectedFaces = [];
        break;
      }
      case 'loop_cut': {
        active.mesh = loopCutAxis(active.mesh, 2);
        break;
      }
      case 'delete_faces': {
        active.mesh = deleteFaces(active.mesh, this.state.selectedFaces);
        this.state.selectedFaces = [];
        break;
      }
      case 'shade_smooth': {
        active.mesh.shadeSmooth = true;
        break;
      }
      case 'shade_flat': {
        active.mesh.shadeSmooth = false;
        break;
      }
    }
    this.rebuildSceneObjects();
    this.notify();
  }

  public toggleKeyframeForProperty(
    objId: string,
    channel: 'location' | 'rotationDeg' | 'scale'
  ): void {
    const obj = this.state.objects.find((o) => o.id === objId);
    if (!obj) return;
    const frame = this.state.currentFrame;
    let kf = obj.keyframes.find((k) => k.frame === frame);
    if (!kf) {
      kf = { frame };
      obj.keyframes.push(kf);
      obj.keyframes.sort((a, b) => a.frame - b.frame);
    }
    if (kf[channel]) {
      delete kf[channel];
      if (!kf.location && !kf.rotationDeg && !kf.scale) {
        obj.keyframes = obj.keyframes.filter((k) => k.frame !== frame);
      }
    } else {
      kf[channel] = [...obj[channel]] as [number, number, number];
    }
    this.notify();
  }

  public recordAutoKeyIfEnabled(obj: SceneObjectData): void {
    if (!this.state.autoKeying) return;
    const frame = this.state.currentFrame;
    let kf = obj.keyframes.find((k) => k.frame === frame);
    if (!kf) {
      kf = { frame };
      obj.keyframes.push(kf);
      obj.keyframes.sort((a, b) => a.frame - b.frame);
    }
    kf.location = [...obj.location];
    kf.rotationDeg = [...obj.rotationDeg];
    kf.scale = [...obj.scale];
  }

  public setCurrentFrame(frame: number): void {
    const f = Math.max(this.state.startFrame, Math.min(this.state.endFrame, Math.round(frame)));
    this.state.currentFrame = f;

    for (const obj of this.state.objects) {
      if (obj.keyframes.length === 0) continue;
      this.evaluateObjectKeyframesAt(obj, f);
    }
    this.syncObjectTransformsOnly();
    this.rebuildGizmo();
    this.notify();
  }

  private evaluateObjectKeyframesAt(obj: SceneObjectData, frame: number): void {
    const channels: Array<'location' | 'rotationDeg' | 'scale'> = [
      'location',
      'rotationDeg',
      'scale'
    ];
    for (const ch of channels) {
      const keys = obj.keyframes.filter((k) => k[ch] !== undefined);
      if (keys.length === 0) continue;
      if (frame <= keys[0].frame) {
        obj[ch] = [...keys[0][ch]!];
        continue;
      }
      if (frame >= keys[keys.length - 1].frame) {
        obj[ch] = [...keys[keys.length - 1][ch]!];
        continue;
      }
      for (let i = 0; i < keys.length - 1; i++) {
        const k0 = keys[i];
        const k1 = keys[i + 1];
        if (frame >= k0.frame && frame <= k1.frame) {
          const t = (frame - k0.frame) / Math.max(1, k1.frame - k0.frame);
          const s = t * t * (3 - 2 * t);
          const a = k0[ch]!;
          const b = k1[ch]!;
          obj[ch] = [
            a[0] + (b[0] - a[0]) * s,
            a[1] + (b[1] - a[1]) * s,
            a[2] + (b[2] - a[2]) * s
          ];
          break;
        }
      }
    }
  }

  public makeUniqueName(base: string, ignoreId?: string): string {
    const existing = new Set(
      this.state.objects.filter((o) => o.id !== ignoreId).map((o) => o.name)
    );
    if (!existing.has(base)) return base;
    for (let i = 1; i < 999; i++) {
      const candidate = `${base}.${String(i).padStart(3, '0')}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}.${Date.now()}`;
  }

  public syncObjectTransformsOnly(): void {
    for (const obj of this.state.objects) {
      const target =
        obj.kind === 'MESH'
          ? this.meshMap.get(obj.id)?.root
          : this.helperMap.get(obj.id);
      if (!target) continue;
      target.visible = obj.visible;
      target.position.set(
        obj.location[0] + obj.deltaLocation[0],
        obj.location[1] + obj.deltaLocation[1],
        obj.location[2] + obj.deltaLocation[2]
      );
      target.rotation.set(
        THREE.MathUtils.degToRad(obj.rotationDeg[0] + obj.deltaRotationDeg[0]),
        THREE.MathUtils.degToRad(obj.rotationDeg[1] + obj.deltaRotationDeg[1]),
        THREE.MathUtils.degToRad(obj.rotationDeg[2] + obj.deltaRotationDeg[2]),
        'XYZ'
      );
      target.scale.set(
        obj.scale[0] * obj.deltaScale[0],
        obj.scale[1] * obj.deltaScale[1],
        obj.scale[2] * obj.deltaScale[2]
      );
    }
  }

  public rebuildSceneObjects(): void {
    if (!this.scene) return;
    this.ensureCollectionsValid();

    this.objectsGroup.clear();
    this.sceneLightsGroup.clear();
    this.editHelpersGroup.clear();
    this.annotationsGroup.clear();
    this.meshMap.clear();
    this.helperMap.clear();

    this.scene.background = new THREE.Color(this.state.world.backgroundColor);
    this.overlaysGroup.visible = this.state.showOverlays;
    if (this.cursorSprite) {
      this.cursorSprite.position.set(
        this.state.cursor3D[0],
        this.state.cursor3D[1],
        this.state.cursor3D[2]
      );
    }

    const shading = this.state.shading;
    if (shading === 'RENDERED') {
      this.studioAmbient.intensity = 0.25 * this.state.world.ambientStrength;
      this.studioKeyLight.intensity = 0;
      this.studioFillLight.intensity = 0;
      this.studioRimLight.intensity = 0;
    } else if (shading === 'MATERIAL') {
      this.studioAmbient.intensity = 0.72;
      this.studioKeyLight.intensity = 0.9;
      this.studioFillLight.intensity = 0.45;
      this.studioRimLight.intensity = 0.3;
    } else {
      this.studioAmbient.intensity = 0.56;
      this.studioKeyLight.intensity = 0.74;
      this.studioFillLight.intensity = 0.28;
      this.studioRimLight.intensity = 0.14;
    }

    for (const obj of this.state.objects) {
      const isSelected = this.state.selectedIds.includes(obj.id);
      const isActive = this.state.activeObjectId === obj.id;

      if (obj.kind === 'MESH' && obj.mesh) {
        const evaluated =
          isActive && this.state.mode === 'EDIT'
            ? cloneMeshData(obj.mesh)
            : evaluateMeshWithModifiers(obj.mesh, obj.modifiers);

        const uvMode = obj.material.uvProjection ?? 'box';
        const built = buildThreeGeometries(evaluated, uvMode, 1, 1);
        const root = new THREE.Group();
        root.userData = { objectId: obj.id };

        let surfaceMat: THREE.Material;
        const xrayOpacity = this.state.xray ? 0.45 : obj.material.opacity;
        const isTransparent = this.state.xray || xrayOpacity < 1;
        const liveTex = this.getOrCreateLiveTexture(obj, false);

        if (shading === 'WIREFRAME') {
          surfaceMat = new THREE.MeshBasicMaterial({
            color: 0x202020,
            transparent: true,
            opacity: 0.01,
            depthWrite: false
          });
        } else if (shading === 'SOLID' && this.state.mode !== 'TEXTURE_PAINT') {
          const hasPaint = Boolean(evaluated.vertexColors && evaluated.vertexColors.length > 0);
          const hasCustomColor =
            Boolean(obj.material.baseColor) && obj.material.baseColor.toLowerCase() !== '#9a9a9a';
          const solidHex = hasPaint
            ? '#ffffff'
            : liveTex
              ? obj.material.baseColor || '#ffffff'
              : hasCustomColor
                ? obj.material.baseColor
                : '#9c9c9c';

          surfaceMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(solidHex),
            map: liveTex ? liveTex.texture : null,
            vertexColors: hasPaint,
            roughness: hasCustomColor || liveTex ? obj.material.roughness : 0.68,
            metalness: hasCustomColor || liveTex ? obj.material.metallic : 0.05,
            emissive: new THREE.Color(obj.material.emissionColor || '#000000'),
            emissiveIntensity: obj.material.emissionStrength || 0,
            transparent: isTransparent,
            opacity: xrayOpacity,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          });
        } else {
          // MATERIAL, RENDERED, or TEXTURE_PAINT mode
          surfaceMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(
              liveTex && obj.material.baseColor === '#9a9a9a' ? '#ffffff' : obj.material.baseColor
            ),
            map: liveTex ? liveTex.texture : null,
            vertexColors: Boolean(evaluated.vertexColors && evaluated.vertexColors.length > 0),
            metalness: obj.material.metallic,
            roughness: obj.material.roughness,
            emissive: new THREE.Color(obj.material.emissionColor),
            emissiveIntensity: obj.material.emissionStrength,
            wireframe: obj.material.wireframe,
            transparent: isTransparent,
            opacity: xrayOpacity,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          });
        }

        const surface = new THREE.Mesh(built.surfaceGeometry, surfaceMat);
        surface.castShadow = true;
        surface.receiveShadow = true;
        surface.userData = { objectId: obj.id };
        root.add(surface);

        const showWire =
          shading === 'WIREFRAME' ||
          (isActive && this.state.mode === 'EDIT') ||
          obj.material.wireframe;
        const wireMat = new THREE.LineBasicMaterial({
          color:
            shading === 'WIREFRAME' && isSelected
              ? 0xf58b20
              : isActive && this.state.mode === 'EDIT'
                ? 0x111111
                : 0x888888,
          transparent: true,
          opacity: showWire ? 0.95 : 0
        });
        const wireOverlay = new THREE.LineSegments(built.polygonWireGeometry, wireMat);
        wireOverlay.visible = showWire;
        root.add(wireOverlay);

        // Selection Silhouette Hull
        const silhouetteGeo = built.surfaceGeometry.clone();
        const posAttr = silhouetteGeo.getAttribute('position');
        const smoothMap = new Map<string, THREE.Vector3>();
        const nAttr = silhouetteGeo.getAttribute('normal');
        for (let i = 0; i < posAttr.count; i++) {
          const key = `${posAttr.getX(i).toFixed(4)}_${posAttr.getY(i).toFixed(4)}_${posAttr.getZ(i).toFixed(4)}`;
          let acc = smoothMap.get(key);
          if (!acc) {
            acc = new THREE.Vector3();
            smoothMap.set(key, acc);
          }
          acc.add(new THREE.Vector3(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i)));
        }
        const smoothNormalsArr = new Float32Array(posAttr.count * 3);
        for (let i = 0; i < posAttr.count; i++) {
          const key = `${posAttr.getX(i).toFixed(4)}_${posAttr.getY(i).toFixed(4)}_${posAttr.getZ(i).toFixed(4)}`;
          const v = smoothMap.get(key)!.clone().normalize();
          smoothNormalsArr[i * 3] = v.x;
          smoothNormalsArr[i * 3 + 1] = v.y;
          smoothNormalsArr[i * 3 + 2] = v.z;
        }
        silhouetteGeo.setAttribute('smoothNormal', new THREE.BufferAttribute(smoothNormalsArr, 3));

        const outlineColor = isActive ? '#f58b20' : '#d65d1e';
        const silhouetteMat = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(outlineColor) },
            uThickness: { value: 0.026 }
          },
          vertexShader: `
            attribute vec3 smoothNormal;
            uniform float uThickness;
            void main() {
              vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
              float distScale = max(0.35, length(mvPos.xyz) * 0.09);
              vec3 displaced = position + normalize(smoothNormal) * uThickness * distScale;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
            }
          `,
          fragmentShader: `
            uniform vec3 uColor;
            void main() {
              gl_FragColor = vec4(uColor, 1.0);
            }
          `,
          side: THREE.BackSide,
          depthWrite: false
        });
        const silhouette = new THREE.Mesh(silhouetteGeo, silhouetteMat);
        silhouette.visible =
          this.state.showOverlays &&
          isSelected &&
          shading !== 'WIREFRAME' &&
          this.state.mode === 'OBJECT';
        root.add(silhouette);

        if (this.state.showOverlays && isSelected) {
          const dotGeo = new THREE.BufferGeometry();
          dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
          const dot = new THREE.Points(
            dotGeo,
            new THREE.PointsMaterial({
              color: 0xff9f2e,
              size: 5,
              sizeAttenuation: false,
              depthTest: false
            })
          );
          dot.renderOrder = 920;
          root.add(dot);
        }

        root.visible = obj.visible;
        this.objectsGroup.add(root);
        this.meshMap.set(obj.id, {
          root,
          surface,
          wireOverlay,
          silhouette,
          triangleToFaceIndex: built.triangleToFaceIndex,
          evaluatedMesh: evaluated
        });

        if (isActive && this.state.mode === 'EDIT' && obj.visible) {
          this.buildEditModeOverlays(obj, evaluated, root);
        }
      } else if (obj.kind === 'CAMERA') {
        const camHelper = this.createBlenderCameraWireframe(obj, isSelected);
        camHelper.visible = obj.visible && this.state.showOverlays && !this.state.inCameraView;
        this.objectsGroup.add(camHelper);
        this.helperMap.set(obj.id, camHelper);
      } else if (obj.kind === 'LIGHT') {
        const lightHelper = this.createBlenderLightHelper(obj, isSelected);
        lightHelper.visible = obj.visible && this.state.showOverlays;
        this.objectsGroup.add(lightHelper);
        this.helperMap.set(obj.id, lightHelper);

        if (obj.visible) {
          const color = new THREE.Color(obj.lightColor || '#ffffff');
          if (obj.lightKind === 'SUN') {
            const sun = new THREE.DirectionalLight(color, (obj.lightPower ?? 1000) / 450);
            sun.position.set(obj.location[0], obj.location[1], obj.location[2]);
            sun.castShadow = true;
            this.sceneLightsGroup.add(sun);
          } else {
            const pt = new THREE.PointLight(color, (obj.lightPower ?? 1000) / 45, 60, 1.6);
            pt.position.set(obj.location[0], obj.location[1], obj.location[2]);
            pt.castShadow = true;
            this.sceneLightsGroup.add(pt);
          }
        }
      } else if (obj.kind === 'EMPTY') {
        const emptyHelper = this.createBlenderEmptyAxes(obj, isSelected);
        emptyHelper.visible = obj.visible && this.state.showOverlays;
        this.objectsGroup.add(emptyHelper);
        this.helperMap.set(obj.id, emptyHelper);
      }
    }

    if (shading === 'RENDERED') {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 50),
        new THREE.ShadowMaterial({ opacity: 0.38 })
      );
      ground.position.z = -0.002;
      ground.receiveShadow = true;
      this.sceneLightsGroup.add(ground);
    }

    this.syncObjectTransformsOnly();
    this.rebuildAnnotationsAndMeasures();
    this.rebuildGizmo();
  }

  private createBlenderCameraWireframe(obj: SceneObjectData, isSelected: boolean): THREE.Group {
    const group = new THREE.Group();
    group.userData = { objectId: obj.id };
    const col = isSelected ? 0xf58b20 : 0x050505;

    const w = 0.62;
    const h = 0.42;
    const d = -1.05;
    const pts = [
      0, 0, 0, -w, -h, d,
      0, 0, 0, w, -h, d,
      0, 0, 0, w, h, d,
      0, 0, 0, -w, h, d,
      -w, -h, d, w, -h, d,
      w, -h, d, w, h, d,
      w, h, d, -w, h, d,
      -w, h, d, -w, -h, d
    ];
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: col })));

    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-w * 0.68, h + 0.07, d, w * 0.68, h + 0.07, d, 0, h + 0.52, d],
        3
      )
    );
    const triMesh = new THREE.Mesh(
      triGeo,
      new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })
    );
    triMesh.userData = { objectId: obj.id };
    group.add(triMesh);

    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 1.0, 1.2),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitBox.position.set(0, 0.1, -0.55);
    hitBox.userData = { objectId: obj.id };
    group.add(hitBox);

    return group;
  }

  private createBlenderLightHelper(obj: SceneObjectData, isSelected: boolean): THREE.Group {
    const group = new THREE.Group();
    group.userData = { objectId: obj.id };
    const col = isSelected ? 0xf58b20 : 0x080808;

    const dotGeo = new THREE.SphereGeometry(0.08, 10, 10);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: col }));
    dot.userData = { objectId: obj.id };
    group.add(dot);

    const segs = 16;
    const ringPts: number[] = [];
    const r = 0.26;
    for (let i = 0; i < segs; i += 2) {
      const a0 = (2 * Math.PI * i) / segs;
      const a1 = (2 * Math.PI * (i + 1)) / segs;
      ringPts.push(r * Math.cos(a0), r * Math.sin(a0), 0, r * Math.cos(a1), r * Math.sin(a1), 0);
      ringPts.push(r * Math.cos(a0), 0, r * Math.sin(a0), r * Math.cos(a1), 0, r * Math.sin(a1));
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
    group.add(new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({ color: col })));

    const zHeight = obj.location[2] + obj.deltaLocation[2];
    const stalkGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -zHeight)
    ]);
    group.add(
      new THREE.Line(
        stalkGeo,
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.72 })
      )
    );

    const hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitSphere.userData = { objectId: obj.id };
    group.add(hitSphere);

    return group;
  }

  private createBlenderEmptyAxes(obj: SceneObjectData, isSelected: boolean): THREE.Group {
    const group = new THREE.Group();
    group.userData = { objectId: obj.id };
    const col = isSelected ? 0xf58b20 : 0x111111;
    const pts = [-0.8, 0, 0, 0.8, 0, 0, 0, -0.8, 0, 0, 0.8, 0, 0, 0, -0.8, 0, 0, 0.8];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: col })));
    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.userData = { objectId: obj.id };
    group.add(hit);
    return group;
  }

  private buildEditModeOverlays(
    obj: SceneObjectData,
    mesh: EditableMeshData,
    parentGroup: THREE.Group
  ): void {
    if (this.state.selectedFaces.length > 0) {
      const selPos: number[] = [];
      for (const fIdx of this.state.selectedFaces) {
        const f = mesh.faces[fIdx];
        if (!f || f.length < 3) continue;
        for (let i = 1; i < f.length - 1; i++) {
          const va = mesh.vertices[f[0]];
          const vb = mesh.vertices[f[i]];
          const vc = mesh.vertices[f[i + 1]];
          selPos.push(va[0], va[1], va[2], vb[0], vb[1], vb[2], vc[0], vc[1], vc[2]);
        }
      }
      if (selPos.length > 0) {
        const fGeo = new THREE.BufferGeometry();
        fGeo.setAttribute('position', new THREE.Float32BufferAttribute(selPos, 3));
        const fMesh = new THREE.Mesh(
          fGeo,
          new THREE.MeshBasicMaterial({
            color: 0xff9426,
            transparent: true,
            opacity: 0.42,
            side: THREE.DoubleSide,
            depthTest: true
          })
        );
        parentGroup.add(fMesh);
      }
    }

    if (this.state.editSelectMode === 'VERTEX') {
      const unselPos: number[] = [];
      const selPos: number[] = [];
      const selSet = new Set(this.state.selectedVertices);
      mesh.vertices.forEach((v, idx) => {
        if (selSet.has(idx)) selPos.push(v[0], v[1], v[2]);
        else unselPos.push(v[0], v[1], v[2]);
      });

      if (unselPos.length > 0) {
        const ug = new THREE.BufferGeometry();
        ug.setAttribute('position', new THREE.Float32BufferAttribute(unselPos, 3));
        parentGroup.add(
          new THREE.Points(
            ug,
            new THREE.PointsMaterial({ color: 0x111111, size: 5.5, sizeAttenuation: false })
          )
        );
      }
      if (selPos.length > 0) {
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(selPos, 3));
        parentGroup.add(
          new THREE.Points(
            sg,
            new THREE.PointsMaterial({
              color: 0xff9426,
              size: 7.5,
              sizeAttenuation: false,
              depthTest: false
            })
          )
        );
      }
    }
    void obj;
  }

  private rebuildAnnotationsAndMeasures(): void {
    this.annotationsGroup.clear();
    for (const stroke of this.state.annotations) {
      if (stroke.points.length < 2) continue;
      const pts = stroke.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.annotationsGroup.add(
        new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x62d8ff, depthTest: false }))
      );
    }

    for (const seg of this.state.measures) {
      const a = new THREE.Vector3(...seg.start);
      const b = new THREE.Vector3(...seg.end);
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      this.annotationsGroup.add(
        new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd24c, depthTest: false }))
      );
      const dist = a.distanceTo(b);
      if (dist > 0.01) {
        const label = this.createTextLabelSprite(`${dist.toFixed(2)} m`);
        label.position.copy(a).add(b).multiplyScalar(0.5);
        this.annotationsGroup.add(label);
      }
    }
  }

  private createTextLabelSprite(text: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(15, 15, 15, 0.85)';
    ctx.roundRect(6, 6, 148, 36, 8);
    ctx.fill();
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#ffd24c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 80, 25);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: false })
    );
    sp.scale.set(0.11, 0.035, 1);
    sp.renderOrder = 960;
    return sp;
  }

  public rebuildGizmo(): void {
    if (!this.gizmoGroup) return;
    this.gizmoGroup.clear();
    if (!this.state.showOverlays || this.state.inCameraView) return;

    const tool = this.state.activeTool;
    const isTransformTool =
      tool === 'move' ||
      tool === 'rotate' ||
      tool === 'scale' ||
      tool === 'transform' ||
      (this.state.mode === 'EDIT' && (tool === 'extrude' || tool === 'inset'));
    if (!isTransformTool) return;

    const active = this.getActiveObject();
    if (!active || !active.visible) return;

    const center = this.getGizmoWorldOrigin(active);
    this.gizmoGroup.position.copy(center);

    const cam = this.getActiveCamera();
    const dist = cam.position.distanceTo(center);
    const s = this.state.isOrthographic ? this.orbitRadius * 0.14 : Math.max(0.5, dist * 0.15);
    this.gizmoGroup.scale.setScalar(s);

    const axes: Array<{ axis: 'X' | 'Y' | 'Z'; dir: THREE.Vector3; color: number }> = [
      { axis: 'X', dir: new THREE.Vector3(1, 0, 0), color: 0xe33b4b },
      { axis: 'Y', dir: new THREE.Vector3(0, 1, 0), color: 0x6bbf2b },
      { axis: 'Z', dir: new THREE.Vector3(0, 0, 1), color: 0x2b83f6 }
    ];

    for (const { axis, dir, color } of axes) {
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const lineMat = new THREE.LineBasicMaterial({ color, depthTest: false });

      if (tool === 'move' || tool === 'transform' || tool === 'extrude') {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          dir.clone().multiplyScalar(1.0)
        ]);
        const line = new THREE.Line(lineGeo, lineMat);
        line.renderOrder = 980;
        this.gizmoGroup.add(line);

        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 12), mat);
        cone.position.copy(dir).multiplyScalar(1.08);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        cone.renderOrder = 981;
        cone.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(cone);

        const hit = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 1.2, 8),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.copy(dir).multiplyScalar(0.6);
        hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        hit.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(hit);
      }

      if (tool === 'scale' || tool === 'transform') {
        const len = tool === 'transform' ? 0.72 : 1.0;
        if (tool === 'scale') {
          const lineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            dir.clone().multiplyScalar(len)
          ]);
          const line = new THREE.Line(lineGeo, lineMat);
          line.renderOrder = 980;
          this.gizmoGroup.add(line);
        }
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), mat);
        tip.position.copy(dir).multiplyScalar(len);
        tip.renderOrder = 982;
        tip.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(tip);

        const hit = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, len, 8),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.copy(dir).multiplyScalar(len * 0.5);
        hit.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        hit.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(hit);
      }

      if (tool === 'rotate' || tool === 'transform') {
        const torusR = tool === 'transform' ? 0.85 : 1.0;
        const torus = new THREE.Mesh(new THREE.TorusGeometry(torusR, 0.025, 8, 48), mat);
        torus.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        torus.renderOrder = 980;
        torus.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(torus);

        const hitTorus = new THREE.Mesh(
          new THREE.TorusGeometry(torusR, 0.13, 8, 28),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hitTorus.quaternion.copy(torus.quaternion);
        hitTorus.userData = { gizmoAxis: axis };
        this.gizmoGroup.add(hitTorus);
      }
    }

    const centerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.02, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    centerRing.quaternion.copy(cam.quaternion);
    centerRing.renderOrder = 985;
    centerRing.userData = { gizmoAxis: 'XYZ' };
    this.gizmoGroup.add(centerRing);

    const centerHit = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 10, 10),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    centerHit.userData = { gizmoAxis: 'XYZ' };
    this.gizmoGroup.add(centerHit);
  }

  private getGizmoWorldOrigin(obj: SceneObjectData): THREE.Vector3 {
    if (this.state.pivotPoint === '3D Cursor') {
      return new THREE.Vector3(...this.state.cursor3D);
    }
    const base = new THREE.Vector3(
      obj.location[0] + obj.deltaLocation[0],
      obj.location[1] + obj.deltaLocation[1],
      obj.location[2] + obj.deltaLocation[2]
    );
    if (this.state.mode === 'EDIT' && obj.mesh) {
      if (this.state.editSelectMode === 'FACE' && this.state.selectedFaces.length > 0) {
        const acc = new THREE.Vector3();
        let count = 0;
        for (const fi of this.state.selectedFaces) {
          const f = obj.mesh.faces[fi];
          if (!f) continue;
          const c = computeFaceCenter(obj.mesh.vertices, f);
          acc.add(new THREE.Vector3(c[0], c[1], c[2]));
          count++;
        }
        if (count > 0) {
          acc.divideScalar(count);
          const entry = this.meshMap.get(obj.id);
          if (entry) {
            entry.root.updateMatrixWorld();
            return acc.applyMatrix4(entry.root.matrixWorld);
          }
        }
      } else if (this.state.selectedVertices.length > 0) {
        const acc = new THREE.Vector3();
        for (const vi of this.state.selectedVertices) {
          const v = obj.mesh.vertices[vi];
          if (v) acc.add(new THREE.Vector3(v[0], v[1], v[2]));
        }
        acc.divideScalar(this.state.selectedVertices.length);
        const entry = this.meshMap.get(obj.id);
        if (entry) {
          entry.root.updateMatrixWorld();
          return acc.applyMatrix4(entry.root.matrixWorld);
        }
      }
    }
    return base;
  }

  private getNDC(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private bindInputEvents(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pointerDownPos = { x: e.clientX, y: e.clientY };
      this.pointerMoved = false;

      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        this.lastTwoMid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
        this.draggingGizmoAxis = null;
        this.isSculptingStroke = false;
        this.lastPaintUV = null;
        return;
      }

      if (this.activePointers.size === 1 && e.button !== 1 && e.button !== 2) {
        const gizmoHit = this.raycastGizmo(e.clientX, e.clientY);
        if (gizmoHit) {
          this.pushUndoSnapshot();
          this.draggingGizmoAxis = gizmoHit;
          this.gizmoStartPoint.set(e.clientX, e.clientY, 0);
          const active = this.getActiveObject();
          if (active) {
            this.gizmoStartLoc = [...active.location];
            this.gizmoStartRot = [...active.rotationDeg];
            this.gizmoStartScale = [...active.scale];
            if (active.mesh) {
              this.gizmoStartVerts = active.mesh.vertices.map((v) => [...v]);
            }
          }
          return;
        }

        if (this.state.mode === 'SCULPT' || this.state.mode === 'TEXTURE_PAINT') {
          this.lastPaintUV = null;
          this.paintedCanvasObjId = null;
          this.pushUndoSnapshot();
          if (this.trySculptOrPaintAt(e.clientX, e.clientY, true)) {
            this.isSculptingStroke = true;
            return;
          } else {
            // Revert unused snapshot if stroke missed mesh
            this.undoStack.pop();
          }
        }

        if (this.state.activeTool === 'annotate') {
          const hitPt = this.raycastGroundOrSurface(e.clientX, e.clientY);
          if (hitPt) {
            this.pushUndoSnapshot();
            this.activeAnnotation = [[hitPt.x, hitPt.y, hitPt.z]];
            this.state.annotations.push({ points: this.activeAnnotation });
            return;
          }
        }

        if (this.state.activeTool === 'measure') {
          const hitPt = this.raycastGroundOrSurface(e.clientX, e.clientY);
          if (hitPt) {
            this.pushUndoSnapshot();
            const pt: [number, number, number] = [hitPt.x, hitPt.y, hitPt.z];
            this.state.measures.push({ start: pt, end: [...pt] });
            this.activeMeasureIndex = this.state.measures.length - 1;
            return;
          }
        }
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      const prev = this.activePointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > 5) {
        this.pointerMoved = true;
      }

      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
        if (this.lastPinchDist > 10 && dist > 10) {
          this.zoomByFactor(this.lastPinchDist / dist);
        }
        this.panByDelta(mid.x - this.lastTwoMid.x, mid.y - this.lastTwoMid.y);
        this.lastPinchDist = dist;
        this.lastTwoMid = mid;
        return;
      }

      if (this.draggingGizmoAxis) {
        this.applyGizmoDrag(e.clientX, e.clientY);
        return;
      }

      if (this.isSculptingStroke) {
        this.trySculptOrPaintAt(e.clientX, e.clientY, false, dx, dy);
        return;
      }

      if (this.activeAnnotation) {
        const pt = this.raycastGroundOrSurface(e.clientX, e.clientY);
        if (pt) {
          this.activeAnnotation.push([pt.x, pt.y, pt.z]);
          this.rebuildAnnotationsAndMeasures();
        }
        return;
      }

      if (this.activeMeasureIndex !== null) {
        const pt = this.raycastGroundOrSurface(e.clientX, e.clientY);
        if (pt && this.state.measures[this.activeMeasureIndex]) {
          this.state.measures[this.activeMeasureIndex].end = [pt.x, pt.y, pt.z];
          this.rebuildAnnotationsAndMeasures();
        }
        return;
      }

      if (e.buttons === 4 || e.shiftKey) {
        this.panByDelta(dx, dy);
      } else {
        this.orbitByDelta(dx, dy);
        this.notify();
      }
    });

    const endPointer = (e: PointerEvent) => {
      const wasSingleTap = !this.pointerMoved && this.activePointers.size === 1;
      this.activePointers.delete(e.pointerId);

      if (this.draggingGizmoAxis) {
        const active = this.getActiveObject();
        if (active) this.recordAutoKeyIfEnabled(active);
        this.draggingGizmoAxis = null;
        this.notify();
        return;
      }

      if (this.isSculptingStroke) {
        this.isSculptingStroke = false;
        this.lastPaintUV = null;
        this.grabBrushIndices = [];
        // Commit 3D painted canvas texture back to object MaterialData for Undo & Export!
        if (this.paintedCanvasObjId) {
          const obj = this.state.objects.find((o) => o.id === this.paintedCanvasObjId);
          const live = this.textureCanvases.get(this.paintedCanvasObjId);
          if (obj && live) {
            const url = live.canvas.toDataURL('image/png');
            obj.material.textureDataUrl = url;
            live.sourceUrl = url;
          }
          this.paintedCanvasObjId = null;
        }
        this.notify();
        return;
      }

      if (this.activeAnnotation) {
        this.activeAnnotation = null;
        this.notify();
        return;
      }

      if (this.activeMeasureIndex !== null) {
        this.activeMeasureIndex = null;
        this.notify();
        return;
      }

      if (wasSingleTap) {
        this.handleViewportTap(e.clientX, e.clientY, e.shiftKey);
      }
    };

    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.09 : 0.91;
        this.zoomByFactor(factor);
      },
      { passive: false }
    );
  }

  private raycastGizmo(clientX: number, clientY: number): 'X' | 'Y' | 'Z' | 'XYZ' | null {
    if (this.gizmoGroup.children.length === 0) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.getNDC(clientX, clientY), this.getActiveCamera());
    const hits = raycaster.intersectObjects(this.gizmoGroup.children, true);
    for (const h of hits) {
      const ax = h.object.userData?.gizmoAxis;
      if (ax) return ax;
    }
    return null;
  }

  private applyGizmoDrag(clientX: number, clientY: number): void {
    const active = this.getActiveObject();
    if (!active || !this.draggingGizmoAxis) return;

    const totalDx = clientX - this.gizmoStartPoint.x;
    const totalDy = clientY - this.gizmoStartPoint.y;

    const cam = this.getActiveCamera();
    cam.updateMatrixWorld();

    const axisMap: Record<'X' | 'Y' | 'Z', THREE.Vector3> = {
      X: new THREE.Vector3(1, 0, 0),
      Y: new THREE.Vector3(0, 1, 0),
      Z: new THREE.Vector3(0, 0, 1)
    };

    let signedUnits = (totalDx - totalDy) * 0.015;
    if (this.draggingGizmoAxis !== 'XYZ') {
      const originWorld = this.gizmoGroup.position.clone();
      const tipWorld = originWorld.clone().add(axisMap[this.draggingGizmoAxis]);
      const p0 = originWorld.project(cam);
      const p1 = tipWorld.project(cam);
      const sx = p1.x - p0.x;
      const sy = -(p1.y - p0.y);
      const len = Math.hypot(sx, sy) || 1;
      const dirX = sx / len;
      const dirY = sy / len;
      signedUnits = (totalDx * dirX + totalDy * dirY) * (this.orbitRadius * 0.0022);
    }

    const tool = this.state.activeTool;

    if (this.state.mode === 'EDIT' && active.mesh) {
      const targetVerts = this.getSelectedVertexSet(active.mesh);
      const axesToMove: Array<0 | 1 | 2> =
        this.draggingGizmoAxis === 'X'
          ? [0]
          : this.draggingGizmoAxis === 'Y'
            ? [1]
            : this.draggingGizmoAxis === 'Z'
              ? [2]
              : [0, 1, 2];

      for (const vIdx of targetVerts) {
        const start = this.gizmoStartVerts[vIdx];
        if (!start) continue;
        active.mesh.vertices[vIdx] = [...start];
        for (const ax of axesToMove) {
          if (tool === 'scale') {
            const factor = Math.max(0.05, 1 + signedUnits * 0.5);
            active.mesh.vertices[vIdx][ax] = start[ax] * factor;
          } else {
            let delta = signedUnits;
            if (this.state.snapEnabled) delta = Math.round(delta / 0.25) * 0.25;
            active.mesh.vertices[vIdx][ax] = start[ax] + delta;
          }
        }
      }
      this.rebuildSceneObjects();
      this.notify();
      return;
    }

    const idxMap: Record<'X' | 'Y' | 'Z', 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };
    const lockKeys: Record<'X' | 'Y' | 'Z', 'x' | 'y' | 'z'> = { X: 'x', Y: 'y', Z: 'z' };

    if (tool === 'rotate') {
      let deg = (totalDx - totalDy) * 0.65;
      if (this.state.snapEnabled) deg = Math.round(deg / 15) * 15;
      if (this.draggingGizmoAxis === 'XYZ') {
        if (!active.lockRotation.z) active.rotationDeg[2] = Number((this.gizmoStartRot[2] + deg).toFixed(1));
      } else {
        const ax = idxMap[this.draggingGizmoAxis];
        const lk = lockKeys[this.draggingGizmoAxis];
        if (!active.lockRotation[lk]) {
          active.rotationDeg[ax] = Number((this.gizmoStartRot[ax] + deg).toFixed(1));
        }
      }
    } else if (tool === 'scale') {
      let factor = Math.max(0.05, 1 + signedUnits * 0.45);
      if (this.state.snapEnabled) factor = Math.round(factor * 10) / 10;
      if (this.draggingGizmoAxis === 'XYZ') {
        if (!active.lockScale.x) active.scale[0] = Number((this.gizmoStartScale[0] * factor).toFixed(3));
        if (!active.lockScale.y) active.scale[1] = Number((this.gizmoStartScale[1] * factor).toFixed(3));
        if (!active.lockScale.z) active.scale[2] = Number((this.gizmoStartScale[2] * factor).toFixed(3));
      } else {
        const ax = idxMap[this.draggingGizmoAxis];
        const lk = lockKeys[this.draggingGizmoAxis];
        if (!active.lockScale[lk]) {
          active.scale[ax] = Number((this.gizmoStartScale[ax] * factor).toFixed(3));
        }
      }
    } else {
      let delta = signedUnits;
      if (this.state.snapEnabled) delta = Math.round(delta / 0.25) * 0.25;
      if (this.draggingGizmoAxis === 'XYZ') {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const worldDelta = right
          .multiplyScalar(totalDx * this.orbitRadius * 0.0016)
          .add(up.multiplyScalar(-totalDy * this.orbitRadius * 0.0016));
        if (!active.lockLocation.x)
          active.location[0] = Number((this.gizmoStartLoc[0] + worldDelta.x).toFixed(3));
        if (!active.lockLocation.y)
          active.location[1] = Number((this.gizmoStartLoc[1] + worldDelta.y).toFixed(3));
        if (!active.lockLocation.z)
          active.location[2] = Number((this.gizmoStartLoc[2] + worldDelta.z).toFixed(3));
      } else {
        const ax = idxMap[this.draggingGizmoAxis];
        const lk = lockKeys[this.draggingGizmoAxis];
        if (!active.lockLocation[lk]) {
          active.location[ax] = Number((this.gizmoStartLoc[ax] + delta).toFixed(3));
        }
      }
    }

    this.syncObjectTransformsOnly();
    this.rebuildGizmo();
    this.notify();
  }

  private getSelectedVertexSet(mesh: EditableMeshData): Set<number> {
    const out = new Set<number>();
    if (this.state.editSelectMode === 'VERTEX') {
      for (const v of this.state.selectedVertices) out.add(v);
    } else {
      for (const fIdx of this.state.selectedFaces) {
        const f = mesh.faces[fIdx];
        if (f) for (const v of f) out.add(v);
      }
    }
    if (out.size === 0) {
      mesh.vertices.forEach((_, i) => out.add(i));
    }
    return out;
  }

  private handleViewportTap(clientX: number, clientY: number, additive: boolean): void {
    if (this.state.activeTool === 'cursor') {
      const pt = this.raycastGroundOrSurface(clientX, clientY);
      if (pt) {
        this.state.cursor3D = [
          Number(pt.x.toFixed(3)),
          Number(pt.y.toFixed(3)),
          Number(pt.z.toFixed(3))
        ];
        if (this.cursorSprite) this.cursorSprite.position.copy(pt);
        this.rebuildGizmo();
        this.notify();
      }
      return;
    }

    if (this.state.activeTool === 'add_cube' && this.state.mode === 'OBJECT') {
      const pt = this.raycastGroundOrSurface(clientX, clientY);
      if (pt) {
        const prevCursor = [...this.state.cursor3D] as [number, number, number];
        this.state.cursor3D = [Number(pt.x.toFixed(2)), Number(pt.y.toFixed(2)), 1.0];
        this.addPrimitive('cube');
        this.state.cursor3D = prevCursor;
      }
      return;
    }

    if (this.state.mode === 'EDIT') {
      const active = this.getActiveObject();
      const entry = active ? this.meshMap.get(active.id) : null;
      if (active && active.mesh && entry) {
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(this.getNDC(clientX, clientY), this.getActiveCamera());
        const hits = raycaster.intersectObject(entry.surface, false);
        if (hits.length > 0 && hits[0].faceIndex !== undefined && hits[0].faceIndex !== null) {
          const polyFaceIdx = entry.triangleToFaceIndex[hits[0].faceIndex];
          if (polyFaceIdx !== undefined) {
            if (this.state.editSelectMode === 'VERTEX') {
              const localHit = entry.root.worldToLocal(hits[0].point.clone());
              let bestV = active.mesh.faces[polyFaceIdx][0];
              let bestD = Infinity;
              for (const vi of active.mesh.faces[polyFaceIdx]) {
                const v = active.mesh.vertices[vi];
                const d = localHit.distanceTo(new THREE.Vector3(v[0], v[1], v[2]));
                if (d < bestD) {
                  bestD = d;
                  bestV = vi;
                }
              }
              this.state.selectedVertices = additive
                ? [...new Set([...this.state.selectedVertices, bestV])]
                : [bestV];
            } else {
              this.state.selectedFaces = additive
                ? [...new Set([...this.state.selectedFaces, polyFaceIdx])]
                : [polyFaceIdx];
            }
            this.rebuildSceneObjects();
            this.notify();
          }
        }
      }
      return;
    }

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.getNDC(clientX, clientY), this.getActiveCamera());
    const hits = raycaster.intersectObjects(this.objectsGroup.children, true);
    for (const hit of hits) {
      let cur: THREE.Object3D | null = hit.object;
      while (cur) {
        if (cur.userData?.objectId) {
          this.selectObject(cur.userData.objectId, additive);
          return;
        }
        cur = cur.parent;
      }
    }
  }

  private raycastGroundOrSurface(clientX: number, clientY: number): THREE.Vector3 | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.getNDC(clientX, clientY), this.getActiveCamera());
    const surfaces: THREE.Object3D[] = [];
    for (const m of this.meshMap.values()) surfaces.push(m.surface);
    const hits = raycaster.intersectObjects(surfaces, false);
    if (hits.length > 0) return hits[0].point.clone();

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const out = new THREE.Vector3();
    return raycaster.ray.intersectPlane(groundPlane, out);
  }

  /** Real-time 3D Sculpting, Live 3D UV Texture Painting & Vertex Painting */
  private trySculptOrPaintAt(
    clientX: number,
    clientY: number,
    isStart: boolean,
    dx = 0,
    dy = 0
  ): boolean {
    const active = this.getActiveObject();
    if (!active || active.kind !== 'MESH' || !active.mesh) return false;
    const entry = this.meshMap.get(active.id);
    if (!entry) return false;

    if (isStart && this.state.mode === 'SCULPT' && active.mesh.vertices.length < 30) {
      active.mesh = catmullClarkSubdivide(active.mesh, 2);
      active.mesh.shadeSmooth = true;
      this.rebuildSceneObjects();
    }

    const updatedEntry = this.meshMap.get(active.id)!;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.getNDC(clientX, clientY), this.getActiveCamera());

    if (
      this.state.mode === 'SCULPT' &&
      this.state.activeTool === 'sculpt_grab' &&
      !isStart &&
      this.grabBrushIndices.length > 0
    ) {
      const cam = this.getActiveCamera();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const deltaWorld = right
        .multiplyScalar(dx * this.orbitRadius * 0.0018)
        .add(up.multiplyScalar(-dy * this.orbitRadius * 0.0018));
      const invMat = updatedEntry.root.matrixWorld.clone().invert();
      const deltaLocal = deltaWorld.transformDirection(invMat);

      for (const item of this.grabBrushIndices) {
        const v = active.mesh.vertices[item.idx];
        v[0] += deltaLocal.x * item.weight;
        v[1] += deltaLocal.y * item.weight;
        v[2] += deltaLocal.z * item.weight;
      }
      this.rebuildSceneObjects();
      return true;
    }

    const hits = raycaster.intersectObject(updatedEntry.surface, false);
    if (hits.length === 0) return false;

    const hit = hits[0];
    const hitLocal = updatedEntry.root.worldToLocal(hit.point.clone());
    const hitNormal = hit.face
      ? hit.face.normal.clone().normalize()
      : new THREE.Vector3(0, 0, 1);

    const radius = this.state.sculpt.radius;
    const strength = this.state.sculpt.strength;

    // 3D TEXTURE PAINT / VERTEX PAINT MODE
    if (this.state.mode === 'TEXTURE_PAINT') {
      const paintTarget = this.state.sculpt.paintTarget ?? 'texture';

      // A) Direct 60fps UV Canvas Texture Painting on the 3D surface!
      if (paintTarget === 'texture' && hit.uv) {
        const hadTexBefore = this.textureCanvases.has(active.id);
        const live = this.getOrCreateLiveTexture(active, true);
        if (!live) return false;
        if (!hadTexBefore) {
          if (active.material.baseColor === '#9a9a9a') active.material.baseColor = '#ffffff';
          this.rebuildSceneObjects();
        }

        const repX = active.material.repeatX ?? 1;
        const repY = active.material.repeatY ?? 1;
        const u = (((hit.uv.x * repX) % 1) + 1) % 1;
        const v = (((hit.uv.y * repY) % 1) + 1) % 1;

        const w = live.canvas.width;
        const h = live.canvas.height;
        const px = u * w;
        const py = (1 - v) * h;
        const brushPx = Math.max(2, this.state.sculpt.paintBrushPx ?? Math.round(radius * 32));
        const ctx = live.ctx;

        ctx.save();
        ctx.globalAlpha = Math.max(0.05, Math.min(1, this.state.sculpt.paintOpacity ?? strength));
        ctx.fillStyle = this.state.sculpt.paintColor;
        ctx.strokeStyle = this.state.sculpt.paintColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushPx * 2;

        if (
          this.lastPaintUV &&
          this.lastPaintUV.objId === active.id &&
          Math.hypot(u - this.lastPaintUV.u, v - this.lastPaintUV.v) < 0.22
        ) {
          ctx.beginPath();
          ctx.moveTo(this.lastPaintUV.u * w, (1 - this.lastPaintUV.v) * h);
          ctx.lineTo(px, py);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(px, py, brushPx, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        this.lastPaintUV = { objId: active.id, u, v };
        this.paintedCanvasObjId = active.id;
        live.texture.needsUpdate = true;
        this.renderFrame();
        return true;
      }

      // B) Per-vertex color painting fallback
      if (!active.mesh.vertexColors || active.mesh.vertexColors.length !== active.mesh.vertices.length) {
        active.mesh.vertexColors = active.mesh.vertices.map(() => [0.85, 0.85, 0.85]);
      }
      const paintCol = new THREE.Color(this.state.sculpt.paintColor);
      active.mesh.vertices.forEach((v, i) => {
        const d = Math.hypot(v[0] - hitLocal.x, v[1] - hitLocal.y, v[2] - hitLocal.z);
        if (d < radius) {
          const w = (1 - d / radius) * strength;
          const vc = active.mesh!.vertexColors![i];
          vc[0] = vc[0] + (paintCol.r - vc[0]) * w;
          vc[1] = vc[1] + (paintCol.g - vc[1]) * w;
          vc[2] = vc[2] + (paintCol.b - vc[2]) * w;
        }
      });
      this.rebuildSceneObjects();
      return true;
    }

    // SCULPT BRUSHES
    const symCenters: THREE.Vector3[] = [hitLocal.clone()];
    const symNormals: THREE.Vector3[] = [hitNormal.clone()];
    if (this.state.sculpt.symmetryX && Math.abs(hitLocal.x) > 0.02) {
      symCenters.push(new THREE.Vector3(-hitLocal.x, hitLocal.y, hitLocal.z));
      symNormals.push(new THREE.Vector3(-hitNormal.x, hitNormal.y, hitNormal.z));
    }

    const vNormals = computeVertexNormals(active.mesh);
    const tool: ActiveToolId =
      this.state.activeTool.startsWith('sculpt_') ? this.state.activeTool : 'sculpt_draw';

    if (tool === 'sculpt_grab' && isStart) {
      this.grabBrushIndices = [];
      active.mesh.vertices.forEach((v, idx) => {
        const d = Math.hypot(v[0] - hitLocal.x, v[1] - hitLocal.y, v[2] - hitLocal.z);
        if (d < radius) {
          const t = 1 - d / radius;
          this.grabBrushIndices.push({ idx, weight: t * t, start: [...v] });
        }
      });
      return this.grabBrushIndices.length > 0;
    }

    for (let s = 0; s < symCenters.length; s++) {
      const center = symCenters[s];
      const brushN = symNormals[s];

      active.mesh.vertices.forEach((v, idx) => {
        const d = Math.hypot(v[0] - center.x, v[1] - center.y, v[2] - center.z);
        if (d >= radius) return;
        const falloff = Math.pow(1 - d / radius, 2);
        const amt = falloff * strength * 0.14;

        if (tool === 'sculpt_draw') {
          v[0] += brushN.x * amt;
          v[1] += brushN.y * amt;
          v[2] += brushN.z * amt;
        } else if (tool === 'sculpt_inflate') {
          const vn = vNormals[idx];
          v[0] += vn[0] * amt;
          v[1] += vn[1] * amt;
          v[2] += vn[2] * amt;
        } else if (tool === 'sculpt_pinch') {
          v[0] += (center.x - v[0]) * amt * 1.4;
          v[1] += (center.y - v[1]) * amt * 1.4;
          v[2] += (center.z - v[2]) * amt * 1.4;
        } else if (tool === 'sculpt_flatten') {
          const distToPlane =
            (v[0] - center.x) * brushN.x +
            (v[1] - center.y) * brushN.y +
            (v[2] - center.z) * brushN.z;
          v[0] -= brushN.x * distToPlane * falloff * strength * 0.35;
          v[1] -= brushN.y * distToPlane * falloff * strength * 0.35;
          v[2] -= brushN.z * distToPlane * falloff * strength * 0.35;
        } else if (tool === 'sculpt_smooth') {
          v[0] += (center.x - v[0]) * amt * 0.45;
          v[1] += (center.y - v[1]) * amt * 0.45;
          v[2] += (center.z - v[2]) * amt * 0.45;
        }
      });
    }

    this.rebuildSceneObjects();
    return true;
  }

  private applyCompositorCSS(): void {
    if (!this.renderer) return;
    const c = this.state.compositor;
    if (!c.useNodes) {
      this.renderer.domElement.style.filter = 'none';
      return;
    }
    const parts: string[] = [];
    if (c.monochromeBW) parts.push('grayscale(100%)');
    if (c.contrast !== 1) parts.push(`contrast(${c.contrast})`);
    if (c.exposure !== 1) parts.push(`brightness(${c.exposure})`);
    this.renderer.domElement.style.filter = parts.length > 0 ? parts.join(' ') : 'none';
  }

  public renderFrame(): void {
    if (!this.renderer || !this.scene) return;
    this.renderer.render(this.scene, this.getActiveCamera());
  }

  public captureRenderDataURL(width = 1280, height = 720): string {
    const prevOverlays = this.overlaysGroup.visible;
    const prevGizmo = this.gizmoGroup.visible;
    this.overlaysGroup.visible = false;
    this.gizmoGroup.visible = false;
    for (const m of this.meshMap.values()) m.silhouette.visible = false;

    const prevSize = new THREE.Vector2();
    this.renderer.getSize(prevSize);
    this.renderer.setSize(width, height, false);
    this.perspCamera.aspect = width / height;
    this.perspCamera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.perspCamera);
    const dataUrl = this.renderer.domElement.toDataURL('image/png');

    this.overlaysGroup.visible = prevOverlays;
    this.gizmoGroup.visible = prevGizmo;
    this.handleResize();
    this.rebuildSceneObjects();
    return dataUrl;
  }

  public captureThumbnailDataURL(width = 360, height = 202): string {
    if (!this.renderer || !this.scene) return '';
    try {
      const prevSize = new THREE.Vector2();
      this.renderer.getSize(prevSize);
      this.renderer.setSize(width, height, false);
      this.perspCamera.aspect = width / height;
      this.perspCamera.updateProjectionMatrix();

      this.renderer.render(this.scene, this.perspCamera);
      const dataUrl = this.renderer.domElement.toDataURL('image/jpeg', 0.8);

      this.handleResize();
      this.renderFrame();
      return dataUrl;
    } catch {
      return '';
    }
  }

  public loadProjectState(nextState: ModixProjectState): void {
    for (const entry of this.textureCanvases.values()) {
      entry.texture.dispose();
    }
    this.textureCanvases.clear();
    this.undoStack = [];
    this.redoStack = [];
    const base = this.createStartupState();
    this.state = {
      ...base,
      ...JSON.parse(JSON.stringify(nextState)),
      sculpt: {
        ...base.sculpt,
        ...(nextState.sculpt || {})
      },
      world: {
        ...base.world,
        ...(nextState.world || {})
      },
      compositor: {
        ...base.compositor,
        ...(nextState.compositor || {})
      }
    };
    this.rebuildSceneObjects();
    this.notify();
  }

  public getExportableThreeGroup(): THREE.Group {
    const exportGroup = new THREE.Group();
    for (const obj of this.state.objects) {
      if (obj.kind !== 'MESH' || !obj.mesh || !obj.visible) continue;
      const evaluated = evaluateMeshWithModifiers(obj.mesh, obj.modifiers);
      const built = buildThreeGeometries(
        evaluated,
        obj.material.uvProjection ?? 'box',
        obj.material.repeatX ?? 1,
        obj.material.repeatY ?? 1
      );
      const liveTex = this.getOrCreateLiveTexture(obj, false);
      const mesh = new THREE.Mesh(
        built.surfaceGeometry,
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(
            liveTex && obj.material.baseColor === '#9a9a9a' ? '#ffffff' : obj.material.baseColor
          ),
          map: liveTex ? liveTex.texture : null,
          metalness: obj.material.metallic,
          roughness: obj.material.roughness,
          emissive: new THREE.Color(obj.material.emissionColor),
          emissiveIntensity: obj.material.emissionStrength,
          transparent: obj.material.opacity < 1,
          opacity: obj.material.opacity
        })
      );
      mesh.name = obj.name;
      mesh.position.set(
        obj.location[0] + obj.deltaLocation[0],
        obj.location[1] + obj.deltaLocation[1],
        obj.location[2] + obj.deltaLocation[2]
      );
      mesh.rotation.set(
        THREE.MathUtils.degToRad(obj.rotationDeg[0] + obj.deltaRotationDeg[0]),
        THREE.MathUtils.degToRad(obj.rotationDeg[1] + obj.deltaRotationDeg[1]),
        THREE.MathUtils.degToRad(obj.rotationDeg[2] + obj.deltaRotationDeg[2])
      );
      mesh.scale.set(
        obj.scale[0] * obj.deltaScale[0],
        obj.scale[1] * obj.deltaScale[1],
        obj.scale[2] * obj.deltaScale[2]
      );
      exportGroup.add(mesh);
    }
    return exportGroup;
  }

  public getSceneSummaryForAI(): string {
    const summary = {
      mode: this.state.mode,
      shading: this.state.shading,
      collections: this.state.collections.map((c) => c.name),
      activeObject: this.getActiveObject()?.name || null,
      selectedObjects: this.state.objects
        .filter((o) => this.state.selectedIds.includes(o.id))
        .map((o) => o.name),
      objects: this.state.objects.map((o) => ({
        name: o.name,
        kind: o.kind,
        group: o.collection,
        location: o.location,
        rotationDeg: o.rotationDeg,
        scale: o.scale,
        color: o.material.baseColor,
        hasTexture: Boolean(o.material.textureDataUrl),
        textureName: o.material.textureName || null,
        verts: o.mesh?.vertices.length ?? 0,
        faces: o.mesh?.faces.length ?? 0
      }))
    };
    return JSON.stringify(summary);
  }

  public getPolyStats(): { verts: number; faces: number; tris: number } {
    let verts = 0;
    let faces = 0;
    let tris = 0;
    for (const entry of this.meshMap.values()) {
      verts += entry.evaluatedMesh.vertices.length;
      faces += entry.evaluatedMesh.faces.length;
      tris += entry.triangleToFaceIndex.length;
    }
    return { verts, faces, tris };
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    for (const entry of this.textureCanvases.values()) {
      entry.texture.dispose();
    }
    this.renderer?.dispose();
  }
}
