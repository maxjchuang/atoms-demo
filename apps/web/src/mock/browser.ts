import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { coordinationHandlers } from './coordination-handlers';
import { deliveryHandlers } from './delivery-handlers';
import { sharingHandlers } from './sharing-handlers';
export const worker = setupWorker(...sharingHandlers, ...deliveryHandlers, ...coordinationHandlers, ...handlers);
