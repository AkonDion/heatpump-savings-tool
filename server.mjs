import express from 'express'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createServer as createViteServer } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const isProduction = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? 5173)

if (isProduction) {
  const distPath = path.join(__dirname, 'dist')
  app.use(express.static(distPath))
  app.use((_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'))
  })
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

app.listen(port, () => {
  console.log(`Server ready at http://localhost:${port}/`)
})
