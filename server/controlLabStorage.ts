import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseLabProfile, type LabProfile } from '../src/party/labProfile'

export function controlLabStorage(path: string) {
  let pending = Promise.resolve()
  return {
    async load() {
      await pending
      try {
        return parseLabProfile(JSON.parse(await readFile(path, 'utf8')))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    save(profile: LabProfile): Promise<void> {
      const write = pending.then(async () => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(`${path}.tmp`, JSON.stringify(profile, null, 2) + '\n', 'utf8')
        await rename(`${path}.tmp`, path)
      })
      pending = write.catch(() => {})
      return write
    },
  }
}
