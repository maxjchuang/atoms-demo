import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { coordinationHandlers } from './coordination-handlers';
import { deliveryHandlers } from './delivery-handlers';
export const worker = setupWorker(...deliveryHandlers, ...coordinationHandlers, ...handlers);
