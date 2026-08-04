[**@cck/core API**](README.md)

***

[@cck/core API](README.md) / audio

# audio

## Interfaces

### AudioPlaySpec

Defined in: [packages/core/src/audio/audio-player.ts:7](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L7)

一次播放的规格。volume 是 core 已算好的**最终音量**（master×分类×静音），engine 直接用不再叠加。

#### Properties

##### channel

> **channel**: [`AudioChannel`](audio.md#audiochannel)

Defined in: [packages/core/src/audio/audio-player.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L10)

##### loop

> **loop**: `boolean`

Defined in: [packages/core/src/audio/audio-player.ts:11](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L11)

##### name

> **name**: `string`

Defined in: [packages/core/src/audio/audio-player.ts:9](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L9)

资源名/路径，engine 侧经 IAssetLoader 加载 AudioClip。

##### volume

> **volume**: `number`

Defined in: [packages/core/src/audio/audio-player.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L13)

最终音量 0..1（core 已折算）。

***

### AudioServiceOptions

Defined in: [packages/core/src/audio/audio-service.ts:53](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L53)

#### Properties

##### player?

> `optional` **player**: [`IAudioPlayer`](audio.md#iaudioplayer)

Defined in: [packages/core/src/audio/audio-service.ts:55](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L55)

播放后端。默认：DI AUDIO_PLAYER，未注册则空实现（无声）。

***

### IAudioPlayer

Defined in: [packages/core/src/audio/audio-player.ts:21](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L21)

播放接缝：core 只认本接口（守零 cc 铁律）。engine 用 cc.AudioSource（BGM 单条 + 音效池）实现，
负责实际出声、AudioClip 加载、Web autoplay 解锁、切后台 pause/resume。
handle 是 engine 分配的不透明正整数；core 用它 stop/setVolume/pause/resume 指定的在播源。

#### Methods

##### pause()

> **pause**(`handle`): `void`

Defined in: [packages/core/src/audio/audio-player.ts:28](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L28)

###### Parameters

###### handle

`number`

###### Returns

`void`

##### play()

> **play**(`spec`): `number`

Defined in: [packages/core/src/audio/audio-player.ts:23](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L23)

起播一条可控源，返回 handle(>0)。

###### Parameters

###### spec

[`AudioPlaySpec`](audio.md#audioplayspec)

###### Returns

`number`

##### playOneShot()

> **playOneShot**(`name`, `volume`): `void`

Defined in: [packages/core/src/audio/audio-player.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L31)

fire-and-forget 一次性音效（无句柄、不可停）。volume 为最终音量。

###### Parameters

###### name

`string`

###### volume

`number`

###### Returns

`void`

##### resume()

> **resume**(`handle`): `void`

Defined in: [packages/core/src/audio/audio-player.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L29)

###### Parameters

###### handle

`number`

###### Returns

`void`

##### setVolume()

> **setVolume**(`handle`, `volume`): `void`

Defined in: [packages/core/src/audio/audio-player.ts:27](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L27)

改在播源的最终音量。

###### Parameters

###### handle

`number`

###### volume

`number`

###### Returns

`void`

##### stop()

> **stop**(`handle`): `void`

Defined in: [packages/core/src/audio/audio-player.ts:25](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L25)

停止并回收 handle。未知 handle 为 no-op。

###### Parameters

###### handle

`number`

###### Returns

`void`

***

### IAudioService

Defined in: [packages/core/src/audio/audio-service.ts:29](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L29)

#### Methods

##### getVolume()

> **getVolume**(`category`): `number`

Defined in: [packages/core/src/audio/audio-service.ts:44](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L44)

###### Parameters

###### category

[`AudioCategory`](audio.md#audiocategory)

###### Returns

`number`

##### isMuted()

> **isMuted**(`category`): `boolean`

Defined in: [packages/core/src/audio/audio-service.ts:47](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L47)

###### Parameters

###### category

[`AudioCategory`](audio.md#audiocategory)

###### Returns

`boolean`

##### pauseAll()

> **pauseAll**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:49](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L49)

暂停/恢复全部在播源（切后台用；oneShot 不受控）。

###### Returns

`void`

##### pauseMusic()

> **pauseMusic**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:33](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L33)

###### Returns

`void`

##### playEffect()

> **playEffect**(`name`, `opts`?): `number`

Defined in: [packages/core/src/audio/audio-service.ts:38](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L38)

可停止音效：返回句柄，用 stopEffect 停。

###### Parameters

###### name

`string`

###### opts?

[`PlayEffectOptions`](audio.md#playeffectoptions)

###### Returns

`number`

##### playMusic()

> **playMusic**(`name`, `opts`?): `void`

Defined in: [packages/core/src/audio/audio-service.ts:31](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L31)

播 BGM（单轨：先停当前再播）。

###### Parameters

###### name

`string`

###### opts?

[`PlayMusicOptions`](audio.md#playmusicoptions)

###### Returns

`void`

##### playOneShot()

> **playOneShot**(`name`, `volumeScale`?): `void`

Defined in: [packages/core/src/audio/audio-service.ts:36](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L36)

fire-and-forget 音效：便捷、不可停。volumeScale 默认 1。

###### Parameters

###### name

`string`

###### volumeScale?

`number`

###### Returns

`void`

##### resumeAll()

> **resumeAll**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:50](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L50)

###### Returns

`void`

##### resumeMusic()

> **resumeMusic**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:34](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L34)

###### Returns

`void`

##### setMute()

> **setMute**(`category`, `muted`): `void`

Defined in: [packages/core/src/audio/audio-service.ts:46](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L46)

设分类静音，实时作用到在播源。

###### Parameters

###### category

[`AudioCategory`](audio.md#audiocategory)

###### muted

`boolean`

###### Returns

`void`

##### setVolume()

> **setVolume**(`category`, `v`): `void`

Defined in: [packages/core/src/audio/audio-service.ts:43](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L43)

设分类音量 0..1（越界自动 clamp），实时作用到该分类在播源。

###### Parameters

###### category

[`AudioCategory`](audio.md#audiocategory)

###### v

`number`

###### Returns

`void`

##### stopAllEffects()

> **stopAllEffects**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L41)

###### Returns

`void`

##### stopEffect()

> **stopEffect**(`handle`): `void`

Defined in: [packages/core/src/audio/audio-service.ts:40](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L40)

停指定音效句柄（非音效句柄/未知句柄为 no-op）。

###### Parameters

###### handle

`number`

###### Returns

`void`

##### stopMusic()

> **stopMusic**(): `void`

Defined in: [packages/core/src/audio/audio-service.ts:32](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L32)

###### Returns

`void`

***

### PlayEffectOptions

Defined in: [packages/core/src/audio/audio-service.ts:22](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L22)

#### Properties

##### loop?

> `optional` **loop**: `boolean`

Defined in: [packages/core/src/audio/audio-service.ts:24](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L24)

默认 false。循环音效（如脚步声）设 true，用返回句柄停。

##### volume?

> `optional` **volume**: `number`

Defined in: [packages/core/src/audio/audio-service.ts:26](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L26)

本音效基准音量 0..1，默认 1。

***

### PlayMusicOptions

Defined in: [packages/core/src/audio/audio-service.ts:15](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L15)

#### Properties

##### loop?

> `optional` **loop**: `boolean`

Defined in: [packages/core/src/audio/audio-service.ts:17](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L17)

默认 true（BGM 循环）。

##### volume?

> `optional` **volume**: `number`

Defined in: [packages/core/src/audio/audio-service.ts:19](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L19)

本曲基准音量 0..1，默认 1（再乘 music 有效音量得最终值）。

## Type Aliases

### AudioCategory

> **AudioCategory**: `"master"` \| `"music"` \| `"sfx"`

Defined in: [packages/core/src/audio/audio-service.ts:10](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L10)

音量/静音分类：master 为总闸，music/sfx 为通道。有效音量 = master × 通道（任一静音则 0）。

***

### AudioChannel

> **AudioChannel**: `"music"` \| `"sfx"`

Defined in: [packages/core/src/audio/audio-player.ts:4](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L4)

播放通道：BGM（单轨）/ 音效（可并发）。用于让 engine 播放器区分挂哪种 AudioSource。

***

### AudioHandle

> **AudioHandle**: `number`

Defined in: [packages/core/src/audio/audio-service.ts:13](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L13)

可停止音效句柄（不透明正整数；0 表示无效/未跟踪）。

## Variables

### AUDIO\_PLAYER

> `const` **AUDIO\_PLAYER**: [`Token`](di.md#tokent)\<[`IAudioPlayer`](audio.md#iaudioplayer)\>

Defined in: [packages/core/src/audio/audio-player.ts:35](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L35)

DI token：engine Bootstrap register cc.AudioSource 适配；未注册时 AudioService 回退空实现（无声）。

***

### AUDIO\_SERVICE

> `const` **AUDIO\_SERVICE**: [`Token`](di.md#tokent)\<[`IAudioService`](audio.md#iaudioservice)\>

Defined in: [packages/core/src/audio/audio-service.ts:168](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L168)

DI token：项目可 register 自己的 AudioService 覆盖默认。

## Functions

### createAudioService()

> **createAudioService**(`opts`?): [`IAudioService`](audio.md#iaudioservice)

Defined in: [packages/core/src/audio/audio-service.ts:69](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L69)

造 AudioService（纯逻辑、零 cc；播放经 IAudioPlayer 接缝注入）。

#### Parameters

##### opts?

[`AudioServiceOptions`](audio.md#audioserviceoptions)

#### Returns

[`IAudioService`](audio.md#iaudioservice)

***

### createMemoryAudioPlayer()

> **createMemoryAudioPlayer**(): [`IAudioPlayer`](audio.md#iaudioplayer)

Defined in: [packages/core/src/audio/audio-player.ts:41](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-player.ts#L41)

空播放器（null object）：不出声，只发号。默认实现（无 engine 时）+ 单测背书。
让 AudioService 的音量/单轨/句柄逻辑在 node 环境可脱引擎跑。

#### Returns

[`IAudioPlayer`](audio.md#iaudioplayer)

***

### getAudioService()

> **getAudioService**(): [`IAudioService`](audio.md#iaudioservice)

Defined in: [packages/core/src/audio/audio-service.ts:173](https://hlgit.5518game.com/luohao/creator-core-kit/-/blob/main/packages/core/src/audio/audio-service.ts#L173)

便捷取用：优先 tryResolve(AUDIO_SERVICE)；未注册则进程级默认（空播放器背书，无声但逻辑可跑）。

#### Returns

[`IAudioService`](audio.md#iaudioservice)
