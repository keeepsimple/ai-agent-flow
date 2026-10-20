// Dev loop: the API server plus Vite with hot reload, in one terminal, on every
// platform. Vite is started through its JS entry rather than the .bin shim,
// which Node cannot spawn directly on Windows.
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.join(import.meta.dirname, '..')
const run = (args) => spawn(process.execPath, args, { cwd: root, stdio: 'inherit' })

const children = [
  run([path.join(root, 'server', 'index.js')]),
  run([path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')]),
]

const stop = () => children.forEach((c) => c.kill())
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
children.forEach((child) => child.on('exit', (code) => { stop(); process.exit(code ?? 0) }))
