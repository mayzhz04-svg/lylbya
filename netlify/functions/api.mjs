import serverless from 'serverless-http';
import { app, readyPromise } from '../../server/index.js';

const expressHandler = serverless(app);

export async function handler(event, context) {
  await readyPromise;
  return expressHandler(event, context);
}
