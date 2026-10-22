import type { AudioPort, SoundName } from '../engine/types'

export const VOLUME_LEVELS = { minimum: 0.15, middle: 0.5, max: 1 } as const
export type VolumeLevel = keyof typeof VOLUME_LEVELS
const VOLUME_STORAGE = 'battle-city-volume'

function savedVolume(): VolumeLevel {
  try {
    const level = localStorage.getItem(VOLUME_STORAGE)
    if (level === 'minimum' || level === 'middle' || level === 'max') return level
  } catch {
    // Brak dostępu do pamięci przeglądarki nie blokuje dźwięku.
  }
  return 'middle'
}

// Vite 以 ?url 形式给出可访问 URL
const soundUrls = import.meta.glob('./sounds/*.ogg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

/** 从 glob key（".../bullet_shot.ogg"）取音效名 */
function nameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.ogg$/, '')
}

/**
 * Web Audio 封装。解码为 AudioBuffer，play 时新建 BufferSource，
 * 支持同一音效重叠播放。受浏览器自动播放策略限制，首次播放前需用户手势解锁。
 * 全局单例：启动时预加载一次，各局对战共用。
 */
export class AudioManager implements AudioPort {
  private ctx: AudioContext | null = null
  private output: GainNode | null = null
  private level: VolumeLevel = savedVolume()
  private readonly urls = new Map<string, string>()
  private readonly buffers = new Map<string, AudioBuffer>()
  private loading: Promise<void> | null = null
  private muted = false

  constructor() {
    for (const [path, url] of Object.entries(soundUrls)) {
      this.urls.set(nameFromPath(path), url)
    }
  }

  /** 预解码所有音效，重复调用返回同一个 Promise（失败静默） */
  preload(): Promise<void> {
    this.loading ??= this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    const ctx = this.ensureContext()
    if (ctx == null) {
      return
    }
    await Promise.all(
      [...this.urls.entries()].map(async ([name, url]) => {
        try {
          const res = await fetch(url)
          const buf = await res.arrayBuffer()
          this.buffers.set(name, await ctx.decodeAudioData(buf))
        } catch {
          // 忽略单个音效加载失败
        }
      }),
    )
  }

  /** 浏览器自动播放策略还没放行（尚无有效的用户手势） */
  get locked(): boolean {
    return this.ctx != null && this.ctx.state !== 'running'
  }

  /** 只有在用户手势的回调里调用才会生效 */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext()
    if (ctx != null && ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyVolume()
  }

  get volumeLevel(): VolumeLevel {
    return this.level
  }

  setVolumeLevel(level: VolumeLevel): void {
    this.level = level
    this.applyVolume()
    try {
      localStorage.setItem(VOLUME_STORAGE, level)
    } catch {
      // W trybie prywatnym wybór działa do zamknięcia strony.
    }
  }

  private applyVolume(): void {
    if (this.output != null && this.ctx != null) {
      // Płynna zmiana obejmuje również już odtwarzane dźwięki, bez trzasku.
      this.output.gain.setTargetAtTime(
        this.muted ? 0 : VOLUME_LEVELS[this.level],
        this.ctx.currentTime,
        0.01,
      )
    }
  }

  play(name: SoundName): void {
    if (this.muted) {
      return
    }
    const ctx = this.ensureContext()
    if (ctx == null) {
      return
    }
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    const buffer = this.buffers.get(name)
    if (buffer == null) {
      return // 尚未解码完成，跳过
    }
    try {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(this.output!)
      source.start()
    } catch {
      // 忽略播放异常
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx == null) {
      try {
        const ctx = new AudioContext()
        const output = ctx.createGain()
        output.gain.value = this.muted ? 0 : VOLUME_LEVELS[this.level]
        output.connect(ctx.destination)
        this.output = output
        this.ctx = ctx
      } catch {
        return null
      }
    }
    return this.ctx
  }
}

const audioManager = new AudioManager()
export default audioManager
