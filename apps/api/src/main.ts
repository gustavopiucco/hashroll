import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';

// Loads the monorepo root .env (apps/api/dist/main.js → ../../../.env), if present.
try {
  process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
} catch {
  /* no .env: use the defaults */
}

const { AppModule } = await import('./app.module.js');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' });
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(`Hashroll API at http://localhost:${port}`);
}
await bootstrap();
