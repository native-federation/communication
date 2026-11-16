import { createBus } from './lib/bus/create-bus.js';
import { installGlobalBus } from './lib/global/slot.js';

installGlobalBus(createBus());
