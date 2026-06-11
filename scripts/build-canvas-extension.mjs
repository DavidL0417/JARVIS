import { cp, mkdir, mkdtemp, rm } from "node:fs/promises"
import { spawn } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceDir = path.join(root, "extensions", "canvas-reader", "src")
const downloadsDir = path.join(root, "public", "downloads")
const zipPath = path.join(downloadsDir, "jarvis-canvas-reader.zip")
const userDownloadsExtensionDir = path.join(homedir(), "Downloads", "jarvis-canvas-reader")

async function zipDirectory(distDir) {
  await new Promise((resolve, reject) => {
    const child = spawn("zip", ["-qr", zipPath, "."], {
      cwd: distDir,
      stdio: "inherit",
    })

    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`zip exited with code ${code}`))
      }
    })
  })
}

await mkdir(downloadsDir, { recursive: true })
await rm(zipPath, { force: true })
const tempRoot = await mkdtemp(path.join(tmpdir(), "jarvis-canvas-reader-"))
const distDir = path.join(tempRoot, "canvas-reader")

try {
  await cp(sourceDir, distDir, { recursive: true })
  await zipDirectory(distDir)
  await rm(userDownloadsExtensionDir, { recursive: true, force: true })
  await cp(distDir, userDownloadsExtensionDir, { recursive: true })
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log(`Built ${path.relative(root, zipPath)}`)
console.log(`Copied unpacked extension to ${userDownloadsExtensionDir}`)
