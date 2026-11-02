import './config/env';
import { createApp } from './app';
import { env } from './config/env';
import { startScheduler } from './jobs/scheduler';
import { attachDevTerminal } from './modules/dev/terminal';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`VryGraphic API em http://localhost:${env.PORT}/api/v1/health`);
  startScheduler();
});
attachDevTerminal(server);
