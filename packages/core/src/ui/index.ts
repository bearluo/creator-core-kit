export {
  createUIManager,
  getUIManager,
  getUIVariant,
  setUIVariant,
  UI_MANAGER,
} from './ui-manager';
export type { UIManager, UIManagerOptions } from './ui-manager';
export {
  clearUIRegistry,
  getUIDef,
  layerOfDef,
  listUIDefs,
  registerUI,
  resolveUIDef,
  DEFAULT_UI_LAYER,
  DEFAULT_UI_VARIANT,
  UI_LAYERS,
} from './ui-registry';
export type { Orientation, ResolvedUI, UIDef, UILayer, UIVariant } from './ui-registry';
export { createMemoryUIView, UI_VIEW } from './ui-view';
export type { IUIView, UIViewSpec } from './ui-view';
