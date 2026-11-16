import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, migrate } from './db.js';
import { createApi } from './api.js';
import { createAdminAuth, migrateAdmin } from './admin-auth.js';
import { createAdminApi } from './admin-api.js';

const root = process.env.NETLIFY ? process.cwd() : path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT) || 3000;
const pool = createPool();
let ready = false;

const app = express();
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const api = createApi({ pool, isReady: () => ready });
const adminAuth = createAdminAuth({ pool, isReady: () => ready });
const adminApi = createAdminApi({ pool });
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/admin/session', route(adminAuth.session));
app.post('/api/admin/login', route(adminAuth.login));
app.post('/api/admin/auth/start', route(adminAuth.start));
app.post('/api/admin/auth/complete', route(adminAuth.complete));
app.post('/api/admin/logout', route(adminAuth.logout));
app.use('/api/admin', route(adminAuth.requireAdmin));
app.get('/api/admin/summary', route(adminApi.summary));
app.get('/api/admin/users', route(adminApi.users));
app.get('/api/admin/users/:id', route(adminApi.user));
app.patch('/api/admin/users/:id/access-status', route(adminApi.updateUserAccessStatus));
app.get('/api/admin/accounts', route(adminApi.accounts));
app.get('/api/admin/accounts/:id', route(adminApi.account));
app.get('/api/admin/requests', route(adminApi.requests));
app.get('/api/admin/requests/:id', route(adminApi.request));
app.patch('/api/admin/requests/:id/status', route(adminApi.updateRequestStatus));

app.get('/api/health', api.health);
app.post('/api/register', api.register);
app.post('/api/login', api.login);
app.post('/api/access-status', api.accessStatus);
app.post('/api/resend', api.resend);
app.post('/api/presence', api.presence);
app.post('/api/verify', api.verify);
app.post('/api/logout', api.logout);
app.get('/api/session', api.requireSession, api.session);
app.get('/api/banks', api.requireSession, api.banks);
app.post('/api/accounts', api.requireSession, api.addAccount);
app.get('/api/accounts/:id', api.requireSession, api.account);
app.post('/api/accounts/:id/requests', api.requireSession, api.addRequest);
app.get('/api/requests/:id', api.requireSession, api.request);
app.use('/api', (req, res) => res.status(404).json({ error: { message: 'المسار غير موجود.' } }));

app.use('/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://manus.im https://www.manus.im https://manus.ai https://www.manus.ai");
  next();
});

app.get(['/admin', '/admin/callback'], (req, res) => {
  res.sendFile(path.join(root, 'public', 'admin', 'index.html'));
});

app.use(express.static(path.join(root, 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || filePath.endsWith('.json')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

app.use((req, res) => {
  res.status(404).sendFile(path.join(root, 'public', 'index.html'));
});

app.use((cause, req, res, next) => {
  if (res.headersSent) return next(cause);
  console.error('Request failed:', cause.code || cause.name || 'Error');
  res.status(500).json({ error: { message: 'تعذر إكمال الطلب. حاول مجددًا.' } });
});

// The listener answers health checks while schema preparation finishes.
export const readyPromise = migrate(pool)
  .then(() => migrateAdmin(pool))
  .then(() => {
    ready = true;
    console.log('FCMS schema ready');
  })
  .catch(async cause => {
    console.error('FCMS migration failed:', cause?.message || cause);
    if (!process.env.NETLIFY) setTimeout(() => process.exit(1), 0);
    if (process.env.NETLIFY) globalThis.__fcmsStartupError = cause;
    else throw cause;
  });

export { app };

if (!process.env.NETLIFY) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`FCMS interface listening on ${port}`);
  });
}
