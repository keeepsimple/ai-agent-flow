import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { DATA } from './store.js'

export const UPLOADS = path.join(DATA, 'uploads')
fs.mkdirSync(UPLOADS, { recursive: true })

const MAX_BYTES = 10 * 1024 * 1024

// Sniff the bytes rather than trust the request: the header is whatever the
// caller felt like sending, and these files get handed to an agent to read.
const MAGIC = [
  ['png', [0x89, 0x50, 0x4e, 0x47]],
  ['jpg', [0xff, 0xd8, 0xff]],
  ['gif', [0x47, 0x49, 0x46, 0x38]],
]

function sniff(buffer) {
  for (const [ext, bytes] of MAGIC) {
    if (bytes.every((b, i) => buffer[i] === b)) return ext
  }
  const riff = [0x52, 0x49, 0x46, 0x46]
  const webp = [0x57, 0x45, 0x42, 0x50]
  if (riff.every((b, i) => buffer[i] === b) && webp.every((b, i) => buffer[8 + i] === b)) return 'webp'
  return null
}

export function save(buffer, name = '') {
  if (!buffer.length) throw new Error('the upload is empty')
  if (buffer.length > MAX_BYTES) throw new Error('images are capped at 10 MB')
  const ext = sniff(buffer)
  if (!ext) throw new Error('that is not a PNG, JPEG, GIF or WebP')

  const stem = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40)
  const file = `${randomBytes(4).toString('hex')}-${stem || 'pasted'}.${ext}`
  fs.writeFileSync(path.join(UPLOADS, file), buffer)
  return { file, path: path.join(UPLOADS, file) }
}

/** Resolve a client-supplied path, refusing anything outside the uploads dir. */
export function verify(given) {
  const resolved = path.resolve(given)
  if (path.dirname(resolved) !== UPLOADS) throw new Error(`not an uploaded image: ${given}`)
  if (!fs.existsSync(resolved)) throw new Error(`image is gone: ${path.basename(resolved)}`)
  return resolved
}

export function read(file) {
  // basename strips any traversal the URL tried to smuggle in.
  const resolved = path.join(UPLOADS, path.basename(file))
  return fs.existsSync(resolved) ? resolved : null
}
