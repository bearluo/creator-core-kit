export {
  createSaveManager,
  createJsonSerializer,
  getSaveManager,
  SAVE_MANAGER,
} from './save-manager';
export type {
  SaveManager,
  SaveManagerOptions,
  SaveSerializer,
  Migration,
  SaveData,
} from './save-manager';
export { createMemoryStorage, STORAGE } from './storage';
export type { IStorage } from './storage';
