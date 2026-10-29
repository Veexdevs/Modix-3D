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

export type RotationMode =
  | 'XYZ Euler'
  | 'XZY Euler'
  | 'YXZ Euler'
  | 'YZX Euler'
  | 'ZXY Euler'
  | 'ZYX Euler'
  | 'Quaternion';

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
  | 'grid'
  | 'uv_sphere'
  | 'ico_sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'capsule'
  | 'monkey'
  | 'wedge'
  | 'corner_wedge'
  | 'pyramid'
  | 'prism'
  | 'hex_cylinder'
  | 'pipe'
  | 'arch'
  | 'stairs'
  | 'star'
  | 'gear'
  | 'ring'
  | 'crystal'
  | 'heart'
  | 'torus_knot';

export type LightKind = 'POINT' | 'SUN' | 'SPOT' | 'AREA';

export type UVProjectionMode = 'box' | 'planar' | 'spherical' | 'cylindrical';

export interface AxisLocks {
  x: boolean;
  y: boolean;
  z: boolean;
}

export interface EditableMeshData {
  /** Vertex positions in local Z-up coordinates */
  vertices: [number, number, number][];
  /** Polygonal faces (triangles, quads, or n-gons) indexing into vertices */
  faces: number[][];
  /** Optional per-vertex RGB colors (0..1) */
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
  levels?: number;
  axisX?: boolean;
  axisY?: boolean;
  axisZ?: boolean;
  clipping?: boolean;
  count?: number;
  offset?: [number, number, number];
  thickness?: number;
  amount?: number;
  angleDeg?: number;
}

export interface MaterialData {
  name: string;
  baseColor: string;
  metallic: number;
  roughness: number;
  emissionColor: string;
  emissionStrength: number;
  opacity: number;
  wireframe: boolean;
  /** Optional 2D image/drawn/AI texture data URL (PNG/JPG) */
  textureDataUrl?: string;
  textureName?: string;
  uvProjection?: UVProjectionMode;
  repeatX?: number;
  repeatY?: number;
}

export interface TransformKeyframe {
  frame: number;
  location?: [number, number, number];
  rotationDeg?: [number, number, number];
  scale?: [number, number, number];
}

export interface CollectionGroup {
  id: string;
  name: string;
  visible: boolean;
  collapsed: boolean;
  color?: string;
}

export interface SceneObjectData {
  id: string;
  name: string;
  kind: ObjectKind;
  collection: string;
  visible: boolean;
  selectable: boolean;

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
  contrast: number;
  exposure: number;
  vignette: number;
  bloom: number;
}

export interface WorldSettings {
  backgroundColor: string;
  ambientStrength: number;
}

export interface SculptSettings {
  radius: number;
  strength: number;
  symmetryX: boolean;
  symmetryY: boolean;
  symmetryZ: boolean;
  paintColor: string;
  paintSecondaryColor?: string;
  paintBrushPx?: number;
  paintOpacity?: number;
  paintTarget?: 'texture' | 'vertex';
  paintToTexture?: boolean;
  brushPixelSize?: number;
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

  collections: CollectionGroup[];
  activeCollection: string;

  objects: SceneObjectData[];
  selectedIds: string[];
  activeObjectId: string | null;

  selectedVertices: number[];
  selectedFaces: number[];

  currentFrame: number;
  startFrame: number;
  endFrame: number;
  fps: number;
  isPlaying: boolean;
  playReverse: boolean;
  autoKeying: boolean;

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
