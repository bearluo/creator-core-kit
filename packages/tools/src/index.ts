/**
 * @cck/tools 入口。出包期工具，纯 node、零 cc。
 * 首个模块：热更 manifest 生成/校验（对齐 Cocos 官方 version_generator.js）。
 */
export {
  DEFAULT_BASE_BUNDLES,
  isEngineBound,
  buildManifest,
  buildSplitManifests,
  toVersionManifest,
  writeManifests,
  writeSplitManifests,
  verifyManifest,
} from './hot-update-manifest';
export type {
  AssetEntry,
  Manifest,
  VersionManifest,
  ManifestOptions,
  SplitManifestOptions,
  SplitManifests,
  SplitWriteResult,
  WriteResult,
  VerifyIssue,
} from './hot-update-manifest';

export {
  DEFAULT_SHARED_BUNDLES,
  collectBundleDeps,
  findDepViolations,
  scanAssetRefs,
  findUnpinnedRefs,
} from './bundle-deps';
export type { BundleDeps, DepViolation, AssetRefs, UnpinnedRef } from './bundle-deps';

export { rowsToTable, parseWorkbook, excelToJson } from './config-excel';
export type { FieldType, ConventionOptions, ExcelOptions, TableResult } from './config-excel';

export {
  hashApiSurface,
  computeCoreApiHash,
  writeStamp,
  readStamp,
  verifyCompat,
} from './api-stamp';
export type { CompatStamp, CompatResult } from './api-stamp';

export { readBundleVers, buildWebVersions, writeWebVersions } from './web-versions';
export type { WebVersions, WebVersionsOptions } from './web-versions';
