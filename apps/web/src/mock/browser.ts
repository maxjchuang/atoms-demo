import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { coordinationHandlers } from './coordination-handlers';
export const worker = setupWorker(...coordinationHandlers, ...handlers);
