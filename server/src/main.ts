import { ConfigService } from '@nestjs/config';
import {
  configureApp,
  configureSwagger,
  createApp,
  configureCors,
  listen,
  registerFastifyPlugins,
} from './bootstrap/app.bootstrap';

async function bootstrap() {
  const app = await createApp();
  const config = app.get(ConfigService);

  configureApp(app);
  configureCors(app, config);
  // 安全標頭 + cookie + multipart——與 e2e 共用同一註冊
  await registerFastifyPlugins(app);

  // swagger文件非正式環境可看
  configureSwagger(app, config);
  await listen(app, config);
}
void bootstrap();
