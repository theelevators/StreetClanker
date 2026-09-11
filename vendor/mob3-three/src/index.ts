export {
  Transform,
  ThreeObject,
  threeObject,
  ThreeScene,
  ThreeRenderer,
  ThreeCamera,
  type TransformData,
  type ThreePluginOptions,
} from "./components.js";

export {
  ThreePlugin,
  syncTransforms,
  renderFrame,
  detachPendingThreeObjects,
} from "./plugin.js";

export {
  GltfAsset,
  createGltfLoader,
  minimalBoxGltfJson,
  type GltfAssetData,
  type GltfLoaderOptions,
} from "./assets/gltf.js";

export {
  instantiateGltf,
  despawnGltfInstance,
  releaseGltfInstance,
  AssetInstanceRef,
  gltfDataFromObject3D,
  gltfDataFromObject3DWithClips,
  type InstantiateGltfOptions,
  type AssetInstanceRefData,
} from "./assets/instantiate.js";

export {
  ThreeAssetsPlugin,
  type ThreeAssetsPluginOptions,
} from "./assets/plugin.js";

export {
  AnimationPlayer,
  BoneAttachment,
  AnimationFinished,
  AnimationLooped,
  type AnimationPlayerData,
  type BoneAttachmentData,
  type AnimationFinishedEvent,
  type AnimationLoopedEvent,
} from "./animation/components.js";

export {
  AnimationPlugin,
  AnimationRuntimes,
  animationStoreOf,
  animationIntent,
  animationMixerUpdate,
  animationEventFlush,
  boneAttachmentSample,
  animationDespawnCleanup,
  type AnimationPluginOptions,
} from "./animation/systems.js";

export {
  playAnimation,
  pauseAnimation,
  resumeAnimation,
  stopAnimation,
  crossfadeAnimation,
  listAnimationClips,
  inspectAnimation,
} from "./animation/api.js";

export {
  instantiateAnimatedGltf,
  despawnAnimatedGltf,
  createProceduralCharacterAsset,
  type InstantiateAnimatedOptions,
} from "./animation/instantiate_animated.js";

export {
  AnimationRuntimeStore,
  stripRootMotion,
  type AnimationRuntime,
} from "./animation/runtime.js";
