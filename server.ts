import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import apiRouter from './server/routes/api.ts';
import { getStore } from './server/persistence/store.ts';

async function startServer() {
  // Initialize demo/persisted store on startup
  getStore();

  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  app.use('/api', apiRouter);

  // Error handler for multer / JSON / route errors
  app.use(
    (
      err: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error('Server error:', err);
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Uploaded file exceeds the 10 MB size limit.' });
        return;
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        res.status(400).json({ error: 'Upload limit exceeded (maximum 10 files per batch).' });
        return;
      }
      res.status(err.status || 500).json({
        error: err.message || 'Internal server error',
      });
    }
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`GST Reconcile AI server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
