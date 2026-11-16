import { createBus } from './lib/bus/create-bus.js';
import { installNFBus } from './lib/global/slot.js';

installNFBus(createBus());
