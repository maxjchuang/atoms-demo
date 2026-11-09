import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { coordinationHandlers } from './coordination-handlers';
import { deliveryHandlers } from './delivery-handlers';
import { sharingHandlers } from './sharing-handlers';
import { budgetRecoveryHandlers } from './budget-recovery-handlers';
export const worker = setupWorker(...budgetRecoveryHandlers, ...sharingHandlers, ...deliveryHandlers, ...coordinationHandlers, ...handlers);
