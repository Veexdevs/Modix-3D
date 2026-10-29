export type WorkspaceId =
  | 'Layout'
  | 'Modeling'
  | 'Sculpting'
  | 'UV Editing'
  | 'Texture Paint'
  | 'Shading'
  | 'Animation'
  | 'Rendering'
  | 'Compositing'
  | 'Geometry Nodes'
  | 'Scripting';

export type InteractionMode = 'OBJECT' | 'EDIT' | 'SCULPT' | 'TEXTURE_PAINT';

export type EditSelectMode = 'VERTEX' | 'EDGE' | 'FACE';

export type ActiveToolId =
  | 'select_box'
  | 'cursor'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'transform'
  | 'annotate'
  | 'measure'
  | 'add_cube'
  // Edit Mode tools
  | 'extrude'
  | 'inset'
  | 'bevel'
  | 'loop_cut'
  // Sculpt Mode tools
  | 'sculpt_draw'
  | 'sculpt_inflate'
  | 'sculpt_smooth'
  | 'sculpt_grab'
  | 'sculpt_flatten'
  | 'sculpt_pinch';

export type ViewportShading = 'WIREFRAME' | 'SOLID' | 'MATERIAL' | 'RENDERED';

export type TransformOrientation = 'Global' | 'Local' | 'Normal' | 'View';

export type PivotPoint = 'Median Point' | '3D Cursor' | 'Individual Origins' | 'Bounding Box';

export type RotationMode = 'XYZ Euler' | 'XZY Euler' | 'YXZ Euler' | 'YZX Euler' | 'ZXY Euler' | 'ZYX Euler' | 'Quaternion';

export type PropertiesTabId =
  | 'tool'
  | 'render'
  | 'output'
  | 'view_layer'
  | 'scene'
  | 'world'
  | 'collection'
  | 'object'
  | 'modifiers'
  | 'particles'
  | 'physics'
  | 'constraints'
  | 'data'
  | 'material'
  | 'texture';

export type ObjectKind = 'MESH' | 'CAMERA' | 'LIGHT' | 'EMPTY';

export type PrimitiveType =
  | 'cube'
  | 'plane'
  | 'uv_sphere'
  | 'ico_sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'capsule'
  | 'monkey';

export type LightKind = 'POINT' | 'SUN' | 'SPOT' | 'AREA';

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

export interface AxisLocks {
  x: boolean;
  y: boolean;
  z: boolean;
}

export interface EditableMeshData {
  /** Vertex positions in local Z-up Blender coordinates */
  vertices: [number, number, number][];
  /** Polygonal faces (triangles, quads, or n-gons) indexing into vertices */
  faces: number[][];
  /** Optional per-vertex RGB colors (0..1) for Texture/Vertex Paint */
  vertexColors?: [number, number, number][];
  /** Smooth vs Flat shading */
  shadeSmooth?: boolean;
}

export type ModifierType =
  | 'SUBSURF'
  | 'MIRROR'
  | 'ARRAY'
  | 'SOLIDIFY'
  | 'BEVEL'
  | 'WIREFRAME'
  | 'TWIST';

export interface ModifierItem {
  id: string;
  type: ModifierType;
  name: string;
  enabled: boolean;
  // Parameters
  levels?: number;         // SUBSURF
  axisX?: boolean;         // MIRROR
  axisY?: boolean;
  axisZ?: boolean;
  clipping?: boolean;      // MIRROR
  count?: number;          // ARRAY
  offset?: [number, number, number]; // ARRAY
  thickness?: number;      // SOLIDIFY / WIREFRAME
  amount?: number;         // BEVEL
  angleDeg?: number;       // TWIST
}

export interface MaterialData {
  name: string;
  baseColor: string;       // hex e.g. '#b8b8b8'
  metallic: number;        // 0..1
  roughness: number;       // 0..1
  emissionColor: string;   // hex
  emissionStrength: number;// 0..10
  opacity: number;         // 0..1
  wireframe: boolean;
}

export interface TransformKeyframe {
  frame: number;
  location?: [number, number, number];
  rotationDeg?: [number, number, number];
  scale?: [number, number, number];
}

export interface SceneObjectData {
  id: string;
  name: string;
  kind: ObjectKind;
  collection: string;
  visible: boolean;
  selectable: boolean;

  // Transform in Z-up meters & degrees (identical to Blender UI)
  location: [number, number, number];
  rotationDeg: [number, number, number];
  rotationMode: RotationMode;
  scale: [number, number, number];

  deltaLocation: [number, number, number];
  deltaRotationDeg: [number, number, number];
  deltaScale: [number, number, number];

  lockLocation: AxisLocks;
  lockRotation: AxisLocks;
  lockScale: AxisLocks;

  // Kind-specific payloads
  primitive?: PrimitiveType;
  mesh?: EditableMeshData;
  modifiers: ModifierItem[];
  material: MaterialData;

  lightKind?: LightKind;
  lightColor?: string;
  lightPower?: number;

  cameraFov?: number;
  cameraClipStart?: number;
  cameraClipEnd?: number;

  keyframes: TransformKeyframe[];
}

export interface CompositorSettings {
  useNodes: boolean;
  monochromeBW: boolean;
  contrast: number;    // 0.5 .. 2.0
  exposure: number;    // 0.2 .. 2.5
  vignette: number;    // 0 .. 1
  bloom: number;       // 0 .. 1
}

export interface WorldSettings {
  backgroundColor: string;
  ambientStrength: number;
}

export interface SculptSettings {
  radius: number;      // in world units, e.g. 0.45
  strength: number;    // 0.05 .. 1.0
  symmetryX: boolean;
  symmetryY: boolean;
  symmetryZ: boolean;
  paintColor: string;
}

export interface AnnotationStroke {
  points: [number, number, number][];
}

export interface MeasureSegment {
  start: [number, number, number];
  end: [number, number, number];
}

export interface ModixProjectState {
  version: string;
  sceneName: string;
  viewLayerName: string;
  workspace: WorkspaceId;
  mode: InteractionMode;
  editSelectMode: EditSelectMode;
  activeTool: ActiveToolId;
  shading: ViewportShading;
  showOverlays: boolean;
  xray: boolean;
  snapEnabled: boolean;
  proportionalEnabled: boolean;
  orientation: TransformOrientation;
  pivotPoint: PivotPoint;
  isOrthographic: boolean;
  inCameraView: boolean;
  viewLabel: string;

  cursor3D: [number, number, number];

  objects: SceneObjectData[];
  selectedIds: string[];
  activeObjectId: string | null;

  // Edit mode sub-selections on active mesh
  selectedVertices: number[];
  selectedFaces: number[];

  // Timeline
  currentFrame: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  isPlaying: boolean;
  playReverse: boolean;
  autoKeying: boolean;

  // Inspector
  activePropertiesTab: PropertiesTabId;
  outlinerSearch: string;
  propertiesSearch: string;
  deltaTransformExpanded: boolean;

  sculpt: SculptSettings;
  world: WorldSettings;
  compositor: CompositorSettings;
  annotations: AnnotationStroke[];
  measures: MeasureSegment[];
}
