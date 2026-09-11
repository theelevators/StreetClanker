export type { Entity } from "./entity.js";
export {
  INVALID_ENTITY,
  ENTITY_INDEX_BITS,
  ENTITY_INDEX_MASK,
  entityIndex,
  entityGeneration,
  packEntity,
} from "./entity.js";

export {
  component,
  tag,
  isComponentType,
  COMPONENT_TYPE,
  IS_COMPONENT_TYPE,
  type ComponentType,
  type InferComponent,
  type ComponentBundleItem,
} from "./component.js";

export { World } from "./world.js";
export { Query, type QueryRow, type QueryTuple } from "./query.js";
export { Commands } from "./commands.js";

export {
  resource,
  IS_RESOURCE_TYPE,
  type ResourceType,
  type ResourceKey,
  type ResourceConstructor,
} from "./resource.js";

export { event, EventStore, type EventType } from "./event.js";

export {
  Schedule,
  Startup,
  PreUpdate,
  FixedUpdate,
  Update,
  PostUpdate,
  PreRender,
  Render,
  PostRender,
  DEFAULT_SCHEDULE_ORDER,
  type SystemFn,
  type ScheduleLabel,
  type SystemConstraints,
} from "./schedule.js";

export {
  system,
  getSystemMeta,
  peekSystemMeta,
  isDeclaredSystem,
  accessesConflict,
  normalizeAccess,
  type SystemDefinition,
  type AccessDeclaration,
  type SystemMeta,
  type SystemId,
  type DeclaredSystem,
  type NormalizedAccess,
} from "./system.js";

export {
  formatExecutionPlan,
  planToJson,
  type ExecutionPlan,
  type PlanSystem,
  type AccessConflict,
  type DependencyEdge,
  type SystemTiming,
  type CompiledSchedule,
} from "./execution_plan.js";

export { Time, createTime, MAX_DELTA, type TimeData } from "./time.js";

export { Transform, type TransformData } from "./transform.js";
export {
  GlobalTransform,
  type GlobalTransformData,
} from "./global_transform.js";
export {
  Parent,
  Children,
  type ParentData,
  type ChildrenData,
  type SetParentOptions,
  type DespawnOptions,
  type HierarchyPreserve,
  type HierarchyDespawn,
} from "./hierarchy.js";
export { Name, type NameData } from "./name.js";
export {
  transformPropagation,
  recomputeLocalPreservingGlobal,
} from "./transform_propagate.js";
export {
  formatHierarchyTree,
  type EntityInspect,
} from "./math_trs.js";
export { ChangeTracker } from "./change_detection.js";
export { PendingDespawn } from "./pending_despawn.js";

export { App, type AppRunner, type AppOptions } from "./app.js";
export type { Plugin, PluginFactory } from "./plugin.js";
export { normalizePlugin } from "./plugin.js";

export {
  workerSystem,
  getWorkerMeta,
  isWorkerSystem,
  runWorkerSystemLocal,
  type WorkerSystemDefinition,
  type WorkerSystemMeta,
  type WorkerDeclaredSystem,
} from "./parallel/worker_system.js";

export {
  ABI_VERSION,
  AbiError,
  AbiIdRegistry,
  AbiContext,
  defineAbiSystem,
  buildSystemInvocation,
  InProcessAbiExecutor,
  JsWorkerAbiExecutor,
  abiSystem,
  getAbiMeta,
  isAbiSystem,
  runAbiSystemLocalSync,
  WasmAbiExecutor,
  wasmSystem,
  getWasmMeta,
  isWasmSystem,
  warmWasmSystem,
  runWasmSystem,
  ensureWasmExecutor,
  type SystemInvocation,
  type ExecutionResult,
  type AbiExecutor,
  type AbiSystemModule,
  type AbiSystemDefinition,
  type AbiSystemMeta,
  type StoreInvocation,
  type AccessDescriptor,
  type WasmSystemDefinition,
  type WasmSystemMeta,
} from "./abi/index.js";

export {
  parallelExecutor,
  ParallelExecutor,
  type ParallelExecutorOptions,
  type ParallelTimings,
  type ParallelDataPath,
} from "./parallel/executor.js";

export {
  createWorkerPool,
  workersSupported,
  type WorkerPool,
  type WorkerPoolOptions,
  type PoolMode,
} from "./parallel/pool.js";

export type {
  WorkerPayload,
  WorkerResult,
  WorkerWriteSlice,
  NumericSlice,
} from "./parallel/types.js";

export {
  isWorkerSafeComponent,
  getNumericLayout,
} from "./parallel/transfer.js";

export {
  packedComponent,
  getPackedMeta,
  isPackedComponent,
  f32,
  f64,
  i32,
  u32,
  PACKED_META,
  ObjectStorage,
  PackedStorage,
  SharedPackedStorage,
  sharedArrayBufferAvailable,
  type PackedComponentOptions,
  type PackedComponentType,
  type FieldKind,
  type FieldSchema,
  type InferSchema,
  type StorageKind,
  type ComponentStorage,
  type SharedStoreDescriptor,
  WasmMemoryArena,
  sharedWasmMemoryAvailable,
  webAssemblyAvailable,
  type WasmMemoryArenaOptions,
} from "./storage/index.js";

