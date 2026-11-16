import { createBus } from './lib/bus/create-bus.js';
import { installNFBus } from './lib/global/global-bus.js';

installNFBus(createBus());
