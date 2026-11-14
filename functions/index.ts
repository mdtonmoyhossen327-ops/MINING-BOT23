import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from './_qoder/backend.mjs';
import { application } from './routes.mjs';

const handle = application({
  db: createDatabaseClient(),
  env: {
    BOT_TOKEN: Deno.env.get('BOT_TOKEN') ?? '',
    ADMIN_IDS: Deno.env.get('ADMIN_IDS') ?? '',
    WEBHOOK_SECRET: Deno.env.get('WEBHOOK_SECRET') ?? '',
  },
  BackendError,
});

Deno.serve(async request => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});