import { busFrom } from './bus-from.js';
import { getNFBus } from './slot.js';

export const bus = busFrom(getNFBus);
