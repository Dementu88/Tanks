import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioManager } from '../src/audio/AudioManager'

const target = vi.fn()
const gain = { gain: { value: 0, setTargetAtTime: target }, connect: vi.fn() }
const source = { buffer: null, connect: vi.fn(), start: vi.fn() }
const destination = {}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running'
      currentTime = 10
      destination = destination
      createGain = () => gain
      createBufferSource = () => source
      decodeAudioData = async () => ({})
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(0) })),
  )
})
afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

it('domyślnie odtwarza middle przez wspólny regulator, także dla trwających dźwięków', async () => {
  const audio = new AudioManager()
  await audio.preload()
  expect(audio.volumeLevel).toBe('middle')
  expect(gain.gain.value).toBe(0.5)
  expect(gain.connect).toHaveBeenCalledWith(destination)
  audio.play('pause')
  expect(source.connect).toHaveBeenCalledWith(gain)
  expect(source.start).toHaveBeenCalled()
  audio.setVolumeLevel('minimum')
  expect(target).toHaveBeenLastCalledWith(0.15, 10, 0.01)
  audio.setVolumeLevel('max')
  expect(target).toHaveBeenLastCalledWith(1, 10, 0.01)
})

it('zapamiętuje wybór i stosuje go przed pierwszym dźwiękiem', async () => {
  new AudioManager().setVolumeLevel('minimum')
  const audio = new AudioManager()
  expect(audio.volumeLevel).toBe('minimum')
  await audio.preload()
  expect(gain.gain.value).toBe(0.15)
})

it('zachowuje wyciszenie niezależnie od poziomu, po odciszeniu przywraca wybór', async () => {
  const audio = new AudioManager()
  await audio.preload()
  audio.setMuted(true)
  audio.setVolumeLevel('max')
  expect(target).toHaveBeenLastCalledWith(0, 10, 0.01)
  audio.play('pause')
  expect(source.start).not.toHaveBeenCalled()
  audio.setMuted(false)
  expect(target).toHaveBeenLastCalledWith(1, 10, 0.01)
})

it('nie blokuje dźwięku przy uszkodzonym zapisie lub niedostępnej pamięci', () => {
  localStorage.setItem('battle-city-volume', 'invalid')
  expect(new AudioManager().volumeLevel).toBe('middle')
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied')
  })
  const audio = new AudioManager()
  expect(() => audio.setVolumeLevel('minimum')).not.toThrow()
  expect(audio.volumeLevel).toBe('minimum')
})
