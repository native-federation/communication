import { busFrom } from './bus-from.js';
import { getGlobalBus } from './slot.js';

export const bus = busFrom(getGlobalBus);
