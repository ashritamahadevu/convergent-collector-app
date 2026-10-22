import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { requireAuth, type AuthVariables } from './middleware/auth.js';

function parseCorsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) {
    return ['http://localhost:8081', 'http://localhost:19006', 'http://localhost:3000'];
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

const app = new Hono<{ Variables: AuthVariables }>();

app.use(
  '*',
  cors({
    origin: parseCorsOrigins(),
    allowHeaders: ['Authorization', 'Content-Type'],
  }),
);

app.get('/health', (c) => c.json({ ok: true, service: 'convergent-api' }));

const v1 = new Hono<{ Variables: AuthVariables }>();

v1.get('/me', requireAuth, (c) => {
  return c.json({
    userId: c.get('userId'),
    email: c.get('email'),
  });
});

app.route('/api/v1', v1);

export default app;
