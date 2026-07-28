/**
 * @cck/tools 入口。出包期工具，纯 node、零 cc。
 * 首个模块：热更 manifest 生成/校验（对齐 Cocos 官方 version_generator.js）。
 */
export {
  buildManifest,
  toVersionManifest,
  writeManifests,
  verifyManifest,
} from './hot-update-manifest';
export type {
  AssetEntry,
  Manifest,
  VersionManifest,
  ManifestOptions,
  WriteResult,
  VerifyIssue,
} from './hot-update-manifest';
